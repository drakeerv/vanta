mod api;
mod app_state;
mod image_processor;
mod router;
mod templates;
mod vault;

use app_state::AppState;
use std::env;
use tokio::{net::TcpListener, signal};
use tower_sessions::{MemoryStore, SessionManagerLayer, Expiry};
use time::Duration;

async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => println!("Shutdown signal received via Ctrl+C"),
        _ = terminate => println!("Shutdown signal received via SIGTERM"),
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let port = env::var("PORT").unwrap_or("3000".to_string());
    let host = env::var("HOST").unwrap_or("0.0.0.0".to_string());
    let addr = format!("{}:{}", host, port);

    let state = match AppState::new() {
        Ok(state) => state,
        Err(e) => {
            eprintln!("Failed to initialize app state: {}", e);
            return Err(e.into());
        }
    };

    // Session Store
    let session_store = MemoryStore::default();
    let session_layer = SessionManagerLayer::new(session_store)
        .with_secure(false) // For local development. Set to true in prod with HTTPS
        .with_expiry(Expiry::OnInactivity(Duration::minutes(30)));

    let router = router::get_router(state.clone())
        .layer(session_layer);

    let listener = match TcpListener::bind(&addr).await {
        Ok(listener) => listener,
        Err(e) => {
            eprintln!("Failed to bind to address {}: {}", addr, e);
            return Err(e.into());
        }
    };

    println!("Listening at {}", addr);

    if let Err(e) = axum::serve(listener, router)
        .with_graceful_shutdown(shutdown_signal())
        .await
    {
        eprintln!("Server error: {}", e);
        return Err(e.into());
    }

    state.vault.write().await.shutdown()?;

    Ok(())
}
