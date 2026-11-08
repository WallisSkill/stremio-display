#![windows_subsystem = "windows"]

mod addons;
mod api;
mod commands;
mod player;
mod server;
mod state;
mod util;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let st = state::AppState::load(app.handle())?;
            app.manage(st);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::session,
            commands::login,
            commands::logout,
            commands::addons,
            commands::catalog,
            commands::meta,
            commands::streams,
            commands::library,
            commands::library_toggle,
            commands::play,
        ])
        .run(tauri::generate_context!())
        .expect("WiS TV failed to start");
}
