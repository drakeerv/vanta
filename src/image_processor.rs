use crate::vault::ImageVariant;
use fast_image_resize::{images::Image, ResizeOptions, Resizer};
use image::{DynamicImage, ImageFormat};
use std::io::Cursor;
use thiserror::Error;

/// Maximum dimension (longest side) for each resized variant.
const THUMBNAIL_MAX: u32 = 400;
const LOW_MAX: u32 = 960;
const HIGH_MAX: u32 = 2560;

#[derive(Error, Debug)]
pub enum ProcessingError {
    #[error("Failed to strip metadata: {0}")]
    MetadataStrip(String),

    #[error("Failed to decode image: {0}")]
    Decode(String),

    #[error("Failed to resize image: {0}")]
    Resize(String),

    #[error("Failed to encode image: {0}")]
    Encode(String),
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
    // Strip EXIF and other metadata from the original
    let stripped = metastrip::strip_metadata(raw_data)
        .map_err(|e| ProcessingError::MetadataStrip(e.to_string()))?;
    let original_size = stripped.len() as u64;

    // Decode the image for generating resized variants
    let src_image = image::load_from_memory(&stripped)
        .map_err(|e| ProcessingError::Decode(e.to_string()))?;

    let mut variants = Vec::with_capacity(4);

    // Original: keep the stripped bytes in whatever format the user uploaded
    variants.push((ImageVariant::Original, stripped));

    // Generate resized WebP variants at different quality tiers
    for (variant, max_dim) in [
        (ImageVariant::High, HIGH_MAX),
        (ImageVariant::Low, LOW_MAX),
        (ImageVariant::Thumbnail, THUMBNAIL_MAX),
    ] {
        let webp_data = resize_to_webp(&src_image, max_dim)?;
        variants.push((variant, webp_data));
    }

    Ok(ProcessedImage {
        original_mime: mime.to_string(),
        original_size,
        variants,
    })
}

/// Resizes an image to fit within `max_dim × max_dim` (preserving aspect ratio)
/// and encodes the result as WebP. If the source is already smaller than `max_dim`,
/// it is encoded to WebP at its original resolution (no upscaling).
fn resize_to_webp(src: &DynamicImage, max_dim: u32) -> Result<Vec<u8>, ProcessingError> {
    let src_width = src.width();
    let src_height = src.height();

    // Calculate target dimensions preserving aspect ratio, never upscale
    let (dst_width, dst_height) = if src_width <= max_dim && src_height <= max_dim {
        (src_width, src_height)
    } else if src_width >= src_height {
        let ratio = max_dim as f64 / src_width as f64;
        (max_dim, (src_height as f64 * ratio).max(1.0) as u32)
    } else {
        let ratio = max_dim as f64 / src_height as f64;
        ((src_width as f64 * ratio).max(1.0) as u32, max_dim)
    };

    let dst_width = dst_width.max(1);
    let dst_height = dst_height.max(1);
    let rgba = src.to_rgba8();

    // If no resize needed, just transcode to WebP
    if dst_width == src_width && dst_height == src_height {
        let mut buf = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(rgba)
            .write_to(&mut buf, ImageFormat::WebP)
            .map_err(|e| ProcessingError::Encode(e.to_string()))?;
        return Ok(buf.into_inner());
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

    let buffer = dst_view.buffer().to_vec();
    let result = image::ImageBuffer::<image::Rgba<u8>, _>::from_raw(dst_width, dst_height, buffer)
        .ok_or_else(|| ProcessingError::Resize("Failed to create result buffer".to_string()))?;

    let mut buf = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(result)
        .write_to(&mut buf, ImageFormat::WebP)
        .map_err(|e| ProcessingError::Encode(e.to_string()))?;

    Ok(buf.into_inner())
}
