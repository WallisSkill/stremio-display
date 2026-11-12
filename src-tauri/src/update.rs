use serde_json::{json, Value};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

pub fn spawn(app: AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(3)).await;
        if let Err(e) = install(&app).await {
            let _ = app.emit("update-state", json!({ "error": e }));
        }
    });
}

pub async fn install(app: &AppHandle) -> Result<Value, String> {
    if cfg!(debug_assertions) {
        return Ok(json!({ "version": null }));
    }
    let updater = app.updater().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(json!({ "version": null }));
    };
    let _ = app.emit("update-state", json!({ "version": update.version }));
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    app.restart();
}
