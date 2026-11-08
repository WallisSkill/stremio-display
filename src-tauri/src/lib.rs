mod addons;
mod api;
mod commands;
mod player;
mod server;
mod state;
#[cfg(target_os = "ios")]
mod torrent;
mod util;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "ios")]
    let builder = builder.plugin(tauri_plugin_wistv_video::init());
    builder
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
            commands::player_command,
            commands::player_set,
            commands::player_stop,
            commands::player_fullscreen,
            commands::startup_open,
            commands::open_url,
            commands::subtitles,
            commands::addon_install,
            commands::addon_remove,
            commands::addon_move,
            commands::addon_discover,
        ])
        .run(tauri::generate_context!())
        .expect("WiS TV failed to start");
}
