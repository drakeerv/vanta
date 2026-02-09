use axum::Router;
use axum::extract::State;
use axum::response::{Html, Redirect};
use axum::routing::get;
use tower_http::services::ServeDir;
use tower_sessions::Session;

use crate::api::get_api_router;
use crate::app_state::AppState;
use crate::templates;

pub fn get_router(state: AppState) -> Router {
    Router::new()
        .route("/", get(index))
        .route("/setup", get(setup))
        .route("/unlock", get(unlock))
        .route("/app", get(app))
        .with_state(state.clone())
        .nest("/api", get_api_router(state.clone()))
        .nest_service("/public", ServeDir::new("public"))
}

async fn index(State(state): State<AppState>, session: Session) -> Redirect {
    let vault = state.vault.read().await;
    let is_authenticated = session.get::<bool>("authenticated").await.unwrap_or(None).unwrap_or(false);

    if vault.needs_setup() {
        Redirect::to("/setup")
    } else if !vault.is_unlocked() {
        Redirect::to("/unlock")
    } else if !is_authenticated {
        // Vault is unlocked but user is not authenticated: ask for password to login
        Redirect::to("/unlock")
    } else {
        Redirect::to("/app")
    }
}


async fn setup() -> Html<String> {
    Html(templates::TEMPLATES.render("setup.tera", &tera::Context::new()).unwrap())
}

async fn unlock(State(state): State<AppState>) -> Html<String> {
    let vault = state.vault.read().await;
    let mut context = tera::Context::new();
    
    // Check if the vault is actually locked (no data in memory)
    // or if it's unlocked but the user just isn't logged in
    if vault.is_unlocked() {
        context.insert("status", "login_only");
    } else {
        context.insert("status", "locked");
    }
    
    Html(templates::TEMPLATES.render("unlock.tera", &context).unwrap())
}

async fn app() -> Html<String> {
    Html(templates::TEMPLATES.render("app.tera", &tera::Context::new()).unwrap())
}