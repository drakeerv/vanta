use crate::vault::ImageVariant;
use fast_image_resize::{ResizeOptions, Resizer, images::Image};
use image::{
    AnimationDecoder, DynamicImage, ImageError, ImageFormat,
    codecs::{gif::GifDecoder, webp::WebPDecoder},
};
use jxl_oxide::integration::JxlDecoder;
use rayon::prelude::*;
use std::io::Cursor;
use thiserror::Error;
use webp_animation::Encoder;

/// Maximum dimension (longest side) for each resized variant.
const THUMBNAIL_MAX: u32 = 400;
const LOW_MAX: u32 = 960;
const HIGH_MAX: u32 = 2560;

#[derive(Error, Debug)]
pub enum ProcessingError {
    #[error("Failed to decode image: {0}")]
    Decode(String),

    #[error("Failed to resize image: {0}")]
    Resize(String),

    #[error("Failed to encode image: {0}")]
    Encode(String),

    #[error("Image error: {0}")]
    Image(#[from] ImageError),
}

/// The result of processing an uploaded image into multiple resolution variants.
pub struct ProcessedImage {
    pub original_mime: String,
    pub original_size: u64,
    pub variants: Vec<(ImageVariant, Vec<u8>)>,
}

/// Processes an uploaded image: strips metadata, decodes, and generates multiple
/// resolution variants (thumbnail, low, high in WebP + original in source format).
pub fn process_upload(raw_data: &[u8], mime: &str) -> Result<ProcessedImage, ProcessingError> {
    let mut variants = Vec::with_capacity(4);

    // Original: keep the raw bytes in whatever format the user uploaded
    variants.push((ImageVariant::Original, raw_data.to_vec()));

    let is_animated = is_animated_image(mime, raw_data);

    let (frames, src_image) = if is_animated {
        (Some(extract_frames(mime, raw_data)?), None)
    } else {
        (
            None,
            Some(decode_image(raw_data, mime)?),
        )
    };

    // Generate resized WebP variants concurrently
    let resized_results: Result<Vec<_>, ProcessingError> = [
        (ImageVariant::High, HIGH_MAX),
        (ImageVariant::Low, LOW_MAX),
        (ImageVariant::Thumbnail, THUMBNAIL_MAX),
    ]
    .par_iter()
    .map(|&(variant, max_dim)| {
        let webp_data = if is_animated {
            let frames_ref = frames.as_ref().unwrap();
            resize_animated_to_webp(frames_ref, max_dim)?
        } else {
            let img_ref = src_image.as_ref().unwrap();
            fast_resize_to_webp(img_ref, max_dim)?
        };
        Ok((variant, webp_data))
    })
    .collect();

    variants.extend(resized_results?);

    Ok(ProcessedImage {
        original_mime: mime.to_string(),
        original_size: raw_data.len() as u64,
        variants,
    })
}

/// Decode image from raw bytes, handling JXL specially
fn decode_image(data: &[u8], mime: &str) -> Result<DynamicImage, ProcessingError> {
    match mime {
        "image/jxl" => {
            // Decode JXL using jxl-oxide decoder
            let decoder = JxlDecoder::new(Cursor::new(data))
                .map_err(|e| ProcessingError::Decode(format!("JXL decode error: {}", e)))?;
            
            DynamicImage::from_decoder(decoder)
                .map_err(|e| ProcessingError::Decode(format!("JXL image conversion error: {}", e)))
        }
        _ => {
            // Use standard image crate decoding for other formats
            image::load_from_memory(data)
                .map_err(|e| ProcessingError::Decode(e.to_string()))
        }
    }
}

/// Detects if the image contains animation based on its MIME type and then image data.
pub fn is_animated_image(mime: &str, data: &[u8]) -> bool {
    let cursor = Cursor::new(data);

    match mime {
        "image/gif" => GifDecoder::new(cursor)
            .map(|d| d.into_frames().take(2).count() > 1)
            .unwrap_or(false),
        "image/webp" => WebPDecoder::new(cursor)
            .map(|d| d.has_animation())
            .unwrap_or(false),
        _ => false,
    }
}

fn calculate_aspect_fit_dimensions(src_width: u32, src_height: u32, max_dim: u32) -> (u32, u32) {
    if src_width <= max_dim && src_height <= max_dim {
        (src_width, src_height)
    } else if src_width >= src_height {
        let ratio = max_dim as f64 / src_width as f64;
        (max_dim, (src_height as f64 * ratio).max(1.0) as u32)
    } else {
        let ratio = max_dim as f64 / src_height as f64;
        ((src_width as f64 * ratio).max(1.0) as u32, max_dim)
    }
}

/// Resizes an image to fit within `max_dim × max_dim` (preserving aspect ratio)
/// and returns the raw buffer of the image so we can share the resizing logic
fn fast_resize(src: &DynamicImage, max_dim: u32) -> Result<(Vec<u8>, (u32, u32)), ProcessingError> {
    let src_width = src.width();
    let src_height = src.height();

    let (dst_width, dst_height) = calculate_aspect_fit_dimensions(src_width, src_height, max_dim);
    let rgba = src.to_rgba8();

    // If no resize needed, just return the original buffer
    if dst_width == src_width && dst_height == src_height {
        return Ok((rgba.into_raw(), (dst_width, dst_height)));
    }

    // Resize using fast_image_resize (Lanczos3 by default)
    let src_view = Image::from_vec_u8(
        src_width,
        src_height,
        rgba.into_raw(),
        fast_image_resize::PixelType::U8x4,
    )
    .map_err(|e| ProcessingError::Resize(e.to_string()))?;

    let mut dst_view = Image::new(dst_width, dst_height, src_view.pixel_type());

    let mut resizer = Resizer::new();
    resizer
        .resize(&src_view, &mut dst_view, &ResizeOptions::default())
        .map_err(|e| ProcessingError::Resize(e.to_string()))?;

    Ok((dst_view.buffer().to_vec(), (dst_width, dst_height)))
}

/// Resizes an image to fit within `max_dim × max_dim` (preserving aspect ratio)
/// and encodes the result as WebP. If the source is already smaller than `max_dim`,
/// it is encoded to WebP at its original resolution (no upscaling).
fn fast_resize_to_webp(src: &DynamicImage, max_dim: u32) -> Result<Vec<u8>, ProcessingError> {
    let (buffer, (dst_width, dst_height)) = fast_resize(src, max_dim)?;
    let result = image::ImageBuffer::<image::Rgba<u8>, _>::from_raw(dst_width, dst_height, buffer)
        .ok_or_else(|| ProcessingError::Resize("Failed to create result buffer".to_string()))?;

    let mut buf = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(result)
        .write_to(&mut buf, ImageFormat::WebP)
        .map_err(|e| ProcessingError::Encode(e.to_string()))?;

    Ok(buf.into_inner())
}

/// Make a seperate function to extract frames from an animated image to prevent constantly decoding the image
/// This is used for both resizing animated images and for transcoding animated images to WebP without resizing
fn extract_frames(mime: &str, data: &[u8]) -> Result<Vec<image::Frame>, ProcessingError> {
    let cursor = Cursor::new(data);

    match mime {
        "image/gif" => GifDecoder::new(cursor)
            .map_err(|e| ProcessingError::Decode(e.to_string()))?
            .into_frames()
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| ProcessingError::Decode(e.to_string())),
        "image/webp" => WebPDecoder::new(cursor)
            .map_err(|e| ProcessingError::Decode(e.to_string()))?
            .into_frames()
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| ProcessingError::Decode(e.to_string())),
        _ => Err(ProcessingError::Decode(
            "Unsupported animated format".to_string(),
        )),
    }
}

/// Resizes an animated image (e.g. GIF) to fit within `max_dim × max_dim` (preserving aspect ratio)
/// and encodes the result as WebP. This is a fallback for formats that `fast_image_resize` doesn't support.
fn resize_animated_to_webp(
    frames: &[image::Frame],
    max_dim: u32,
) -> Result<Vec<u8>, ProcessingError> {
    let mut encoder: Option<Encoder> = None;
    let mut timestamp: i32 = 0;

    for frame in frames {
        let (num, den) = frame.delay().numer_denom_ms();
        let delay = num / den;

        // Convert to DynamicImage for resizing
        let img = DynamicImage::ImageRgba8(frame.buffer().clone());
        let (resized, (resized_width, resized_height)) =
            fast_resize(&img, max_dim).map_err(|e| ProcessingError::Resize(e.to_string()))?;

        if encoder.is_none() {
            encoder = Some(
                Encoder::new((resized_width, resized_height))
                    .map_err(|e| ProcessingError::Encode(e.to_string()))?,
            );
        }

        if let Some(enc) = &mut encoder {
            let frame_timestamp = timestamp + delay as i32;
            enc.add_frame(&resized, frame_timestamp)
                .map_err(|e| ProcessingError::Encode(e.to_string()))?;
            timestamp = frame_timestamp;
        }
    }

    let webp_data = encoder
        .ok_or_else(|| ProcessingError::Encode("Failed to create WebP encoder".to_string()))?
        .finalize(timestamp)
        .map_err(|e| ProcessingError::Encode(e.to_string()))?
        .to_vec();
    Ok(webp_data)
}
