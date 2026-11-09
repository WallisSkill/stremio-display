mod addons;
#[cfg(target_os = "android")]
mod android;
mod api;
mod autocrop;
mod commands;
mod player;
mod server;
mod state;
mod subinfo;
mod torrent;
#[cfg(desktop)]
mod update;
mod util;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_wistv_video::init());
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    builder
        .setup(|app| {
            let st = state::AppState::load(app.handle())?;
            app.manage(st);
            #[cfg(desktop)]
            update::spawn(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::session,
            commands::login,
            commands::logout,
            commands::addons,
            commands::catalog,
            commands::meta,
            commands::stream_addons,
            commands::streams_from,
            commands::library,
            commands::library_toggle,
            commands::profiles,
            commands::profiles_save,
            commands::profile_use,
            commands::profile_unlock,
            commands::play,
            commands::player_command,
            commands::player_set,
            commands::player_background,
            commands::player_fill,
            commands::device_battery,
            commands::player_stop,
            commands::player_fullscreen,
            commands::startup_open,
            commands::open_url,
            commands::subtitles,
            commands::subtitle_info,
            commands::addon_install,
            commands::addon_remove,
            commands::addon_move,
            commands::addon_discover,
        ])
        .run(tauri::generate_context!())
        .expect("WiS TV failed to start");
}
