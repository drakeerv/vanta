use axum::Router;
use axum::extract::DefaultBodyLimit;
use tower_http::services::{ServeDir, ServeFile};

use crate::api::get_api_router;
use crate::app_state::AppState;

pub fn get_router(state: AppState) -> Router {
    // Serve the SolidJS SPA from frontend/dist, with SPA fallback to index.html
    let spa = ServeDir::new("frontend/dist")
        .not_found_service(ServeFile::new("frontend/dist/index.html"));

    Router::new()
        .nest("/api", get_api_router(state))
        .fallback_service(spa)
        .layer(DefaultBodyLimit::max(50 * 1024 * 1024)) // 50 MB max for uploads
}
