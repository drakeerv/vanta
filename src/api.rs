use axum::{
    Json, Router,
    extract::{Multipart, Query, Request, State},
    http::StatusCode,
    middleware,
    response::IntoResponse,
    routing::{delete, get, post},
};
use tower_sessions::Session;

use crate::{
    app_state::AppState,
    image_processor,
    vault::{ImageVariant, VaultError},
};

const ALLOWED_IMAGE_TYPES: &[&str] = &["image/jpeg", "image/png", "image/webp"];

use serde::Deserialize;

#[derive(Deserialize)]
pub struct UnlockRequest {
    pub password: String,
}

#[derive(Deserialize)]
pub struct SetupRequest {
    pub password: String,
}

#[derive(Deserialize)]
pub struct TagRequest {
    pub tag: String,
}

#[derive(Deserialize)]
pub struct RenameTagRequest {
    pub old_tag: String,
    pub new_tag: String,
}

#[derive(Deserialize)]
pub struct ListParams {
    /// Tag search query: space-separated tags. Prefix with - to exclude.
    /// Example: "landscape sunset -blurry" = has landscape AND sunset, NOT blurry
    pub q: Option<String>,
}

pub fn get_api_router(state: AppState) -> Router {
    let protected_routes = Router::new()
        .route("/images", get(list_images))
        .route("/upload", post(upload_image))
        .route("/images/{id}/{variant}", get(get_image))
        .route("/images/{id}", delete(delete_image))
        .route("/images/{id}/tags", post(add_tag))
        .route("/images/{id}/tags", delete(remove_tag))
        .route("/tags", get(list_tags))
        .route("/tags/rename", post(rename_tag))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ));

    Router::new()
        .route("/status", get(get_status))
        .route("/unlock", post(unlock_vault))
        .route("/setup", post(setup_vault))
        .route("/logout", post(logout))
        .route("/lock", post(lock_vault))
        .merge(protected_routes)
        .with_state(state)
}

async fn auth_middleware(
    State(state): State<AppState>,
    session: Session,
    request: Request,
    next: middleware::Next,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let is_authenticated = session
        .get::<bool>("authenticated")
        .await
        .unwrap_or(None)
        .unwrap_or(false);

    if !is_authenticated {
        return Err((StatusCode::UNAUTHORIZED, "Not authenticated".to_string()));
    }

    {
        let vault = state.vault.read().await;
        if !vault.is_unlocked() {
            return Err((StatusCode::FORBIDDEN, "Vault is locked".to_string()));
        }
    }

    Ok(next.run(request).await)
}

async fn get_status(
    State(state): State<AppState>,
    session: Session,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let vault = state.vault.read().await;
    let is_authenticated = session
        .get("authenticated")
        .await
        .unwrap_or(None)
        .unwrap_or(false);

    let status = serde_json::json!({
        "initialized": !vault.needs_setup(),
        "unlocked": vault.is_unlocked(),
        "authenticated": is_authenticated,
    });

    Ok(Json(status))
}

async fn logout(session: Session) -> impl IntoResponse {
    session.flush().await.ok();
    (StatusCode::OK, "Logged out")
}

async fn lock_vault(
    State(state): State<AppState>,
    session: Session,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    session.flush().await.ok();

    let vault = state.vault.read().await;
    vault.lock();

    Ok((StatusCode::OK, "Vault locked and logged out"))
}

async fn setup_vault(
    State(state): State<AppState>,
    session: Session,
    Json(payload): Json<SetupRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let mut vault = state.vault.write().await;

    vault
        .setup(&payload.password)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    session
        .insert("authenticated", true)
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create session".to_string(),
            )
        })?;

    Ok((StatusCode::CREATED, "Vault initialized and unlocked"))
}

async fn unlock_vault(
    State(state): State<AppState>,
    session: Session,
    Json(payload): Json<UnlockRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let vault = state.vault.read().await;

    if vault.is_unlocked() {
        vault
            .verify_password(&payload.password)
            .map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;
    } else {
        vault
            .unlock(&payload.password)
            .map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;
    }

    session
        .insert("authenticated", true)
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create session".to_string(),
            )
        })?;

    Ok("Vault unlocked")
}

async fn list_images(
    State(state): State<AppState>,
    Query(params): Query<ListParams>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let vault = state.vault.read().await;

    let images = if let Some(query) = params.q {
        // Parse query: words prefixed with - are exclusions
        let mut include_tags = Vec::new();
        let mut exclude_tags = Vec::new();
        
        for term in query.split_whitespace() {
            let term = term.trim();
            if term.is_empty() {
                continue;
            }
            if let Some(tag) = term.strip_prefix('-') {
                if !tag.is_empty() {
                    exclude_tags.push(tag.to_string());
                }
            } else {
                include_tags.push(term.to_string());
            }
        }
        
        vault.search_by_tags(&include_tags, &exclude_tags)
    } else {
        vault.list_images()
    }
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(images))
}

async fn upload_image(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let vault = state.vault.read().await;

    while let Some(field) = multipart.next_field().await.unwrap() {
        let name = field.name().unwrap_or_default().to_string();
        let mime = field.content_type().unwrap_or("image/jpeg").to_string();

        if !ALLOWED_IMAGE_TYPES.contains(&mime.as_str()) {
            return Err((StatusCode::BAD_REQUEST, "Unsupported file type".to_string()));
        }

        if name == "file" {
            let raw_data = field
                .bytes()
                .await
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

            // Process the image: strip metadata + generate all resolution variants
            let processed = image_processor::process_upload(&raw_data, &mime)
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

            let entry = vault
                .store_image(
                    processed.original_mime,
                    processed.original_size,
                    processed.variants,
                )
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            return Ok((StatusCode::CREATED, Json(entry)));
        }
    }

    Err((StatusCode::BAD_REQUEST, "No file provided".to_string()))
}

async fn get_image(
    State(state): State<AppState>,
    axum::extract::Path((id, variant_name)): axum::extract::Path<(uuid::Uuid, String)>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let variant = ImageVariant::from_name(&variant_name)
        .ok_or((StatusCode::BAD_REQUEST, format!("Invalid variant: {variant_name}")))?;

    let vault = state.vault.read().await;

    let (data, mime) = vault.retrieve_image(id, variant).await.map_err(|e| match e {
        VaultError::NotFound(_) => (StatusCode::NOT_FOUND, "Image not found".to_string()),
        _ => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    })?;

    // Vault images are immutable once stored so we can cache them aggressively
    Ok((
        [
            (axum::http::header::CONTENT_TYPE, mime),
            (
                axum::http::header::CACHE_CONTROL,
                "private, max-age=31536000, immutable".to_string(),
            ),
        ],
        data,
    ))
}

async fn delete_image(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<uuid::Uuid>,
) -> Result<StatusCode, (StatusCode, String)> {
    let vault = state.vault.read().await;

    vault.delete_image(id).await.map_err(|e| match e {
        VaultError::NotFound(_) => (StatusCode::NOT_FOUND, "Image not found".to_string()),
        _ => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    })?;

    Ok(StatusCode::NO_CONTENT)
}

async fn add_tag(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<uuid::Uuid>,
    Json(payload): Json<TagRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let vault = state.vault.read().await;

    let entry = vault.tag_image(id, &payload.tag).map_err(|e| match e {
        VaultError::NotFound(_) => (StatusCode::NOT_FOUND, "Image not found".to_string()),
        VaultError::Corruption(msg) => (StatusCode::BAD_REQUEST, msg),
        _ => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    })?;

    Ok(Json(entry))
}

async fn remove_tag(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<uuid::Uuid>,
    Query(params): Query<TagRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let vault = state.vault.read().await;

    let entry = vault.untag_image(id, &params.tag).map_err(|e| match e {
        VaultError::NotFound(_) => (StatusCode::NOT_FOUND, "Image not found".to_string()),
        VaultError::Corruption(msg) => (StatusCode::BAD_REQUEST, msg),
        _ => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    })?;

    Ok(Json(entry))
}

async fn list_tags(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let vault = state.vault.read().await;

    let tags = vault
        .list_tags()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(tags))
}

async fn rename_tag(
    State(state): State<AppState>,
    Json(payload): Json<RenameTagRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let vault = state.vault.read().await;

    let count = vault
        .rename_tag(&payload.old_tag, &payload.new_tag)
        .map_err(|e| match e {
            VaultError::Corruption(msg) => (StatusCode::BAD_REQUEST, msg),
            _ => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
        })?;

    Ok(Json(serde_json::json!({ "renamed": count })))
}
