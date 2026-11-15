mod addons;
#[cfg(target_os = "android")]
mod android;
mod api;
mod autocrop;
mod commands;
mod hotui;
#[cfg(windows)]
mod mini;
mod player;
mod server;
mod state;
mod subinfo;
mod torrent;
#[cfg(desktop)]
mod update;
mod util;

use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut context = tauri::generate_context!();
    hotui::wrap(&mut context);
    let builder = tauri::Builder::default();
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_wistv_video::init());
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build());
    let builder = builder.plugin(tauri_plugin_deep_link::init());
    builder
        .setup(|app| {
            let st = state::AppState::load(app.handle())?;
            app.manage(st);
            #[cfg(any(windows, target_os = "linux"))]
            let _ = app.deep_link().register_all();
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                let urls: Vec<String> = event.urls().iter().map(|u| u.to_string()).collect();
                let _ = handle.emit("deep-link", urls);
            });
            #[cfg(desktop)]
            update::spawn(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::session,
            commands::login,
            commands::login_key,
            commands::logout,
            commands::addons,
            commands::catalog,
            commands::meta,
            commands::stream_addons,
            commands::streams_from,
            commands::torrent_warm,
            commands::library,
            commands::library_toggle,
            commands::library_rewind,
            commands::profiles,
            commands::profiles_save,
            commands::profile_use,
            commands::profile_unlock,
            commands::prefs_get,
            commands::prefs_set,
            commands::room_create,
            commands::cast_token,
            commands::intro_times,
            commands::play,
            commands::player_command,
            commands::player_set,
            commands::player_background,
            commands::player_fill,
            commands::device_battery,
            commands::player_stop,
            commands::player_fullscreen,
            commands::player_mini,
            commands::player_mini_state,
            commands::player_mini_sync,
            commands::window_drag,
            commands::screen_brightness,
            commands::startup_open,
            commands::startup_links,
            commands::open_url,
            commands::subtitles,
            commands::subtitle_info,
            commands::addon_install,
            commands::addon_remove,
            commands::addon_move,
            commands::addon_discover,
            commands::app_update,
            hotui::ui_update,
            hotui::ui_version,
        ])
        .run(context)
        .expect("WiS TV failed to start");
}
