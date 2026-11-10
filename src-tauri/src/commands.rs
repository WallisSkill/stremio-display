use crate::addons::{self, Addon};
use crate::api;
use crate::player;
use crate::server;
use crate::state::{AppState, Session};
use crate::util::now_iso;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
#[cfg(desktop)]
use tauri::WebviewWindow;

const SAVE_EVERY: Duration = Duration::from_secs(30);
const MAX_STEP_MS: u64 = 5_000;

struct Watch {
    last_pos: Option<u64>,
    unsaved: u64,
    last_save: Instant,
    was_paused: bool,
}

impl Watch {
    fn new() -> Self {
        Self { last_pos: None, unsaved: 0, last_save: Instant::now(), was_paused: false }
    }

    fn step(&mut self, pos: u64, playing: bool) {
        if let Some(prev) = self.last_pos {
            if playing && pos > prev && pos - prev < MAX_STEP_MS {
                self.unsaved += pos - prev;
            }
        }
        self.last_pos = Some(pos);
    }

    fn observe(&mut self, pos: u64, dur: u64, playing: bool, paused: bool) -> Option<u64> {
        self.step(pos, playing);
        let just_paused = paused && !self.was_paused;
        self.was_paused = paused;
        if dur == 0 || self.unsaved == 0 || !(just_paused || self.last_save.elapsed() >= SAVE_EVERY) {
            return None;
        }
        self.last_save = Instant::now();
        Some(std::mem::take(&mut self.unsaved))
    }

    fn finish(&mut self, pos: u64) -> u64 {
        self.step(pos, true);
        std::mem::take(&mut self.unsaved)
    }
}

struct Progress {
    position_ms: u64,
    duration_ms: u64,
    watched_ms: u64,
    finished: bool,
}

type R<T> = Result<T, String>;

#[tauri::command]
pub fn session(st: State<'_, AppState>) -> Option<Value> {
    st.session.lock().unwrap().as_ref().map(|s| s.user.clone())
}

#[tauri::command]
pub async fn login(st: State<'_, AppState>, email: String, password: String) -> R<Value> {
    let res = api::login(&st.http, email.trim(), &password).await?;
    let auth_key = res["authKey"]
        .as_str()
        .ok_or("Đăng nhập thất bại")?
        .to_string();
    let user = crate::state::slim_user(&res["user"]);
    st.set_session(Some(Session {
        auth_key,
        user: user.clone(),
    }))?;
    Ok(user)
}

#[tauri::command]
pub async fn logout(st: State<'_, AppState>) -> R<()> {
    if let Some(key) = st.auth_key() {
        let _ = api::logout(&st.http, &key).await;
    }
    st.set_session(None)
}

async fn load_addons(st: &AppState, refresh: bool) -> R<Vec<Addon>> {
    if !refresh {
        let cached = st.addons.lock().unwrap().clone();
        if !cached.is_empty() {
            return Ok(cached);
        }
    }
    let list = match st.auth_key() {
        Some(key) => api::addon_collection(&st.http, &key).await?,
        None => addons::guest(&st.http).await?,
    };
    *st.addons.lock().unwrap() = list.clone();
    Ok(list)
}

#[tauri::command]
pub async fn addons(st: State<'_, AppState>, refresh: Option<bool>) -> R<Vec<Addon>> {
    load_addons(&st, refresh.unwrap_or(false)).await
}

#[tauri::command]
pub async fn catalog(
    st: State<'_, AppState>,
    url: String,
    kind: String,
    id: String,
    extra: Option<Vec<(String, String)>>,
) -> R<Vec<Value>> {
    let addon = Addon {
        transport_url: url,
        manifest: Value::Null,
        flags: Value::Null,
    };
    let u = addon.resource_url("catalog", &kind, &id, &extra.unwrap_or_default());
    let v = addons::get_json(&st.http, &u).await?;
    Ok(v["metas"].as_array().cloned().unwrap_or_default())
}

#[tauri::command]
pub async fn meta(st: State<'_, AppState>, kind: String, id: String) -> R<Value> {
    let list = load_addons(&st, false).await?;
    let mut last_err = None;
    for a in list.iter().filter(|a| a.supports("meta", &kind, &id)) {
        match addons::get_json(&st.http, &a.resource_url("meta", &kind, &id, &[])).await {
            Ok(v) if v["meta"].is_object() => return Ok(v["meta"].clone()),
            Ok(_) => {}
            Err(e) => last_err = Some(e),
        }
    }
    Err(last_err.unwrap_or_else(|| "Không tìm thấy thông tin phim".into()))
}

#[tauri::command]
pub async fn stream_addons(st: State<'_, AppState>, kind: String, id: String) -> R<Vec<Value>> {
    let list = load_addons(&st, false).await?;
    Ok(list
        .into_iter()
        .filter(|a| a.supports("stream", &kind, &id))
        .map(|a| json!({ "url": a.transport_url, "addon": a.name(), "logo": a.manifest["logo"] }))
        .collect())
}

#[tauri::command]
pub async fn streams_from(st: State<'_, AppState>, url: String, kind: String, id: String) -> R<Value> {
    let list = load_addons(&st, false).await?;
    let a = list
        .into_iter()
        .find(|a| a.transport_url == url && a.supports("stream", &kind, &id))
        .ok_or("Addon này không còn được cài")?;
    let v = addons::get_json(&st.http, &a.resource_url("stream", &kind, &id, &[])).await?;
    let streams = v["streams"].as_array().cloned().unwrap_or_default();
    Ok(json!({ "addon": a.name(), "logo": a.manifest["logo"], "streams": streams }))
}

#[tauri::command]
pub async fn library(st: State<'_, AppState>) -> R<Vec<Value>> {
    let Some(key) = st.auth_key() else {
        return Ok(Vec::new());
    };
    let items = api::library_get(&st.http, &key, &st.profile()).await?;
    *st.library.lock().unwrap() = items.clone();
    Ok(items)
}

fn profile_list(st: &AppState, list: Vec<Value>) -> R<Value> {
    let active = st.profile().id;
    if !list.iter().any(|p| p["id"].as_str() == Some(active.as_str())) {
        st.set_profile(api::Profile::main())?;
    }
    Ok(json!({ "active": st.profile().id, "list": list }))
}

#[tauri::command]
pub async fn profiles(st: State<'_, AppState>) -> R<Value> {
    let Some(key) = st.auth_key() else {
        return Ok(json!({ "active": api::MAIN_PROFILE, "list": [] }));
    };
    let list = api::profiles_get(&st.http, &key).await?;
    profile_list(&st, list)
}

#[tauri::command]
pub async fn profiles_save(st: State<'_, AppState>, list: Value, tokens: Option<Value>) -> R<Value> {
    let key = st.auth_key().ok_or("Đăng nhập tài khoản Stremio để dùng hồ sơ")?;
    let list = api::profiles_set(&st.http, &key, &list, &tokens.unwrap_or_else(|| json!({}))).await?;
    profile_list(&st, list)
}

#[tauri::command]
pub async fn room_create(st: State<'_, AppState>) -> R<Value> {
    let key = st.auth_key().ok_or("Đăng nhập tài khoản Stremio để tạo phòng xem chung")?;
    api::room_create(&st.http, &key).await
}

#[tauri::command]
pub async fn prefs_get(st: State<'_, AppState>) -> R<Value> {
    let Some(key) = st.auth_key() else {
        return Ok(Value::Null);
    };
    api::prefs_get(&st.http, &key, &st.profile()).await
}

#[tauri::command]
pub async fn prefs_set(st: State<'_, AppState>, prefs: Value, profile: Option<String>) -> R<()> {
    let Some(key) = st.auth_key() else {
        return Ok(());
    };
    let active = st.profile();
    if profile.is_some_and(|p| p != active.id) {
        return Err("Hồ sơ đã đổi".into());
    }
    api::prefs_set(&st.http, &key, &active, &prefs).await
}

#[tauri::command]
pub async fn profile_unlock(st: State<'_, AppState>, id: String, pin: String) -> R<String> {
    let key = st.auth_key().ok_or("Đăng nhập tài khoản Stremio để dùng hồ sơ")?;
    api::profile_unlock(&st.http, &key, &id, &pin).await
}

#[tauri::command]
pub fn profile_use(st: State<'_, AppState>, id: String, token: Option<String>) -> R<()> {
    st.set_profile(api::Profile { id, token: token.unwrap_or_default() })
}

fn new_item(id: &str, name: &Value, kind: &Value, poster: &Value, now: &str) -> Value {
    json!({
        "_id": id,
        "name": name,
        "type": kind,
        "poster": poster,
        "posterShape": "poster",
        "removed": true,
        "temp": true,
        "_ctime": now,
        "_mtime": now,
        "state": {
            "lastWatched": null,
            "timeWatched": 0,
            "timeOffset": 0,
            "overallTimeWatched": 0,
            "timesWatched": 0,
            "flaggedWatched": 0,
            "duration": 0,
            "video_id": null,
            "watched": null,
            "noNotif": false
        },
        "behaviorHints": {
            "defaultVideoId": null,
            "featuredVideoId": null,
            "hasScheduledVideos": false
        }
    })
}

fn cached_item(st: &AppState, id: &str) -> Option<Value> {
    st.library
        .lock()
        .unwrap()
        .iter()
        .find(|i| i["_id"].as_str() == Some(id))
        .cloned()
}

#[tauri::command]
pub async fn library_toggle(st: State<'_, AppState>, meta: Value) -> R<bool> {
    let key = st
        .auth_key()
        .ok_or("Đăng nhập tài khoản Stremio để dùng Thư viện")?;
    let id = meta["id"].as_str().ok_or("Thiếu mã phim")?.to_string();
    let now = now_iso();
    let mut item = cached_item(&st, &id)
        .unwrap_or_else(|| new_item(&id, &meta["name"], &meta["type"], &meta["poster"], &now));
    let in_library = !item["removed"].as_bool().unwrap_or(false) && !item["temp"].as_bool().unwrap_or(false);
    item["removed"] = json!(in_library);
    item["temp"] = json!(false);
    item["_mtime"] = json!(now);
    api::library_put(&st.http, &key, &st.profile(), &item).await?;
    st.cache_library_item(&item);
    Ok(!in_library)
}

#[tauri::command]
pub async fn library_rewind(st: State<'_, AppState>, id: String) -> R<()> {
    let key = st
        .auth_key()
        .ok_or("Đăng nhập tài khoản Stremio để dùng Thư viện")?;
    let profile = st.profile();
    let mut item = match cached_item(&st, &id) {
        Some(item) => item,
        None => api::library_get_one(&st.http, &key, &profile, &id)
            .await?
            .ok_or("Không tìm thấy phim trong lịch sử xem")?,
    };
    if !item["state"].is_object() {
        item["state"] = json!({});
    }
    item["state"]["timeOffset"] = json!(0);
    item["_mtime"] = json!(now_iso());
    api::library_put(&st.http, &key, &profile, &item).await?;
    st.cache_library_item(&item);
    Ok(())
}

#[derive(Deserialize, Clone)]
pub struct PlayCtx {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub poster: Option<String>,
    pub video: String,
    pub start: Option<u64>,
    #[serde(default)]
    pub session: u64,
    #[serde(skip)]
    pub profile: api::Profile,
}

fn open_external(app: &AppHandle, url: &str) -> R<()> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Liên kết ngoài không hợp lệ".into());
    }
    #[cfg(mobile)]
    {
        use tauri_plugin_wistv_video::VideoExt;
        app.video().open(url)
    }
    #[cfg(desktop)]
    {
        let _ = app;
        #[cfg(windows)]
        let mut cmd = std::process::Command::new("rundll32");
        #[cfg(windows)]
        cmd.args(["url.dll,FileProtocolHandler", url]);
        #[cfg(target_os = "macos")]
        let mut cmd = std::process::Command::new("open");
        #[cfg(target_os = "macos")]
        cmd.arg(url);
        #[cfg(not(any(windows, target_os = "macos")))]
        let mut cmd = std::process::Command::new("xdg-open");
        #[cfg(not(any(windows, target_os = "macos")))]
        cmd.arg(url);
        cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
    }
}

type Target = (i64, Vec<(String, String)>);

#[cfg(target_os = "ios")]
async fn video_target(app: &AppHandle, _st: &AppState) -> R<Target> {
    use tauri_plugin_wistv_video::VideoExt;
    let video = app.video();
    let _ = video.landscape(true);
    let until = Instant::now() + Duration::from_millis(1500);
    while Instant::now() < until {
        if matches!(video.layer_size(), Ok((w, h)) if w > h) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    Ok((video.layer()?, Vec::new()))
}

#[cfg(windows)]
async fn video_target(app: &AppHandle, _st: &AppState) -> R<Target> {
    let window = app.get_webview_window("main").ok_or("Không tìm thấy cửa sổ chính")?;
    let hwnd = window.hwnd().map(|h| h.0 as i64).map_err(|e| e.to_string())?;
    Ok((hwnd, Vec::new()))
}

#[cfg(target_os = "android")]
const SYSTEM_FONTS: &[&str] = &[
    "/system/fonts/Roboto-Regular.ttf",
    "/system/fonts/NotoSans-Regular.ttf",
    "/system/fonts/DroidSans.ttf",
];

#[cfg(target_os = "android")]
fn mpv_config_dir(st: &AppState) -> R<String> {
    let dir = st.cache_dir.join("mpv");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let font = dir.join("subfont.ttf");
    if !font.is_file() {
        let src = SYSTEM_FONTS
            .iter()
            .find(|p| std::path::Path::new(p).is_file())
            .ok_or("Không tìm thấy phông chữ hệ thống cho phụ đề")?;
        std::fs::copy(src, &font).map_err(|e| e.to_string())?;
    }
    Ok(dir.to_string_lossy().into_owned())
}

#[cfg(target_os = "linux")]
async fn video_target(_app: &AppHandle, _st: &AppState) -> R<Target> {
    Ok((0, Vec::new()))
}

#[cfg(target_os = "android")]
async fn video_target(_app: &AppHandle, st: &AppState) -> R<Target> {
    let until = Instant::now() + Duration::from_secs(5);
    let surface = loop {
        if let (_, Some(s)) = crate::android::state() {
            break s;
        }
        if Instant::now() >= until {
            return Err("Chưa có vùng hiển thị video".into());
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    };
    let extra = vec![
        ("android-surface-size".to_string(), format!("{}x{}", surface.width, surface.height)),
        ("config-dir".to_string(), mpv_config_dir(st)?),
    ];
    Ok((surface.wid, extra))
}

#[cfg(mobile)]
fn keep_awake(app: &AppHandle, on: bool) {
    use tauri_plugin_wistv_video::VideoExt;
    let _ = app.video().awake(on);
    let _ = app.video().landscape(on);
}

#[cfg(desktop)]
fn keep_awake(_app: &AppHandle, _on: bool) {}

async fn resolve(st: &AppState, stream: &Value) -> R<String> {
    if let Some(u) = stream["url"].as_str() {
        return Ok(u.to_string());
    }
    if let Some(hash) = stream["infoHash"].as_str() {
        let sources: Vec<String> = stream["sources"]
            .as_array()
            .map(|a| a.iter().filter_map(|s| s.as_str().map(str::to_string)).collect())
            .unwrap_or_default();
        return server::torrent_url(st, hash, stream["fileIdx"].as_i64(), sources).await;
    }
    if stream["ytId"].is_string() {
        return Err("Nguồn YouTube chưa được hỗ trợ".into());
    }
    Err("Không hỗ trợ loại nguồn này".into())
}

#[tauri::command]
pub async fn play(
    app: AppHandle,
    st: State<'_, AppState>,
    stream: Value,
    mut ctx: PlayCtx,
) -> R<()> {
    ctx.profile = st.profile();
    if let Some(ext) = stream["externalUrl"].as_str() {
        return open_external(&app, ext);
    }
    let url = resolve(&st, &stream).await?;
    let headers: Vec<String> = stream["behaviorHints"]["proxyHeaders"]["request"]
        .as_object()
        .map(|o| {
            o.iter()
                .filter_map(|(k, v)| v.as_str().map(|v| format!("{k}: {v}")))
                .collect()
        })
        .unwrap_or_default();
    let (wid, mut extra) = video_target(&app, &st).await?;
    let spill = st.cache_dir.join("mpv-cache");
    if std::fs::create_dir_all(&spill).is_ok() {
        extra.push(("cache-on-disk".to_string(), "yes".to_string()));
        extra.push(("demuxer-cache-dir".to_string(), spill.to_string_lossy().into_owned()));
    }
    let req = player::Request {
        url,
        title: ctx.name.clone(),
        start_ms: ctx.start.unwrap_or(0),
        headers,
        wid,
        extra,
    };
    let awake_app = app.clone();
    let state_app = app.clone();
    let session = ctx.session;
    let watch = Arc::new(Mutex::new(Watch::new()));
    let lock = Arc::new(tauri::async_runtime::Mutex::new(()));
    let (state_watch, state_lock, state_ctx) = (watch.clone(), lock.clone(), ctx.clone());
    st.player.start(
        req,
        move |mut s| {
            s["session"] = json!(session);
            let _ = state_app.emit("player-state", &s);
            if s["loaded"].as_bool() != Some(true) {
                return;
            }
            let ms = |k: &str| (s[k].as_f64().unwrap_or(0.0).max(0.0) * 1000.0) as u64;
            let (pos, dur) = (ms("time"), ms("duration"));
            let paused = s["paused"].as_bool() == Some(true);
            let playing = !paused && s["buffering"].as_bool() != Some(true);
            let due = state_watch.lock().unwrap().observe(pos, dur, playing, paused);
            if let Some(watched) = due {
                let (app, ctx, lock) = (state_app.clone(), state_ctx.clone(), state_lock.clone());
                tauri::async_runtime::spawn(async move {
                    let _guard = lock.lock().await;
                    let st = app.state::<AppState>();
                    let p = Progress { position_ms: pos, duration_ms: dur, watched_ms: watched, finished: false };
                    if save_progress(&st, &ctx, &p).await.is_ok() {
                        let _ = app.emit("library-changed", json!({ "ok": true, "quiet": true }));
                    }
                });
            }
        },
        move |out| {
            if !app.state::<AppState>().player.active() {
                keep_awake(&app, false);
            }
            let _ = app.emit(
                "player-ended",
                json!({
                    "session": ctx.session,
                    "id": ctx.id,
                    "video": ctx.video,
                    "position": out.position_ms,
                    "duration": out.duration_ms,
                    "ended": out.ended,
                    "error": out.error,
                }),
            );
            if out.error.is_some() {
                return;
            }
            let watched = watch.lock().unwrap().finish(out.position_ms);
            tauri::async_runtime::spawn(async move {
                let _guard = lock.lock().await;
                let st = app.state::<AppState>();
                let p = Progress {
                    position_ms: out.position_ms,
                    duration_ms: out.duration_ms,
                    watched_ms: watched,
                    finished: out.ended || out.position_ms.saturating_mul(10) >= out.duration_ms.saturating_mul(9),
                };
                let saved = save_progress(&st, &ctx, &p).await;
                let _ = app.emit("library-changed", json!({ "ok": saved.is_ok(), "error": saved.err() }));
            });
        },
    )
    .inspect_err(|_| keep_awake(&awake_app, false))?;
    keep_awake(&awake_app, true);
    Ok(())
}

async fn off_main<T: Send + 'static>(app: AppHandle, f: impl FnOnce(&AppState) -> R<T> + Send + 'static) -> R<T> {
    tauri::async_runtime::spawn_blocking(move || f(&app.state::<AppState>()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn player_command(app: AppHandle, args: Vec<String>) -> R<()> {
    off_main(app, move |st| st.player.command(&args)).await
}

#[tauri::command]
pub async fn player_set(app: AppHandle, name: String, value: String) -> R<()> {
    off_main(app, move |st| st.player.set(&name, &value)).await
}

#[cfg(mobile)]
#[tauri::command]
pub async fn device_battery(app: AppHandle) -> R<Value> {
    use tauri_plugin_wistv_video::VideoExt;
    tauri::async_runtime::spawn_blocking(move || app.video().battery())
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(desktop)]
#[tauri::command]
pub async fn device_battery() -> R<Value> {
    Ok(Value::Null)
}

#[tauri::command]
pub async fn player_fill(app: AppHandle, on: bool) -> R<Value> {
    #[cfg(target_os = "ios")]
    let layer = {
        use tauri_plugin_wistv_video::VideoExt;
        let video = app.video();
        let _ = video.gravity(on);
        video.layer_info().unwrap_or(Value::Null)
    };
    #[cfg(not(target_os = "ios"))]
    let layer = Value::Null;
    off_main(app, move |st| {
        st.player.set_crop(on);
        st.player.set("keepaspect", if on { "no" } else { "yes" })?;
        Ok(json!({ "mpv": st.player.layout(), "layer": layer }))
    })
    .await
}

#[tauri::command]
pub async fn player_background(app: AppHandle, hidden: bool) -> R<()> {
    off_main(app, move |st| st.player.background(hidden)).await
}

#[tauri::command]
pub fn player_stop(st: State<'_, AppState>) {
    st.player.stop();
    tauri::async_runtime::spawn(crate::torrent::release());
}

#[cfg(mobile)]
#[tauri::command]
pub fn player_fullscreen(app: AppHandle, on: Option<bool>) -> R<bool> {
    let on = on.unwrap_or(true);
    #[cfg(target_os = "android")]
    {
        use tauri_plugin_wistv_video::VideoExt;
        app.video().fullscreen(on)?;
    }
    #[cfg(not(target_os = "android"))]
    let _ = app;
    Ok(on)
}

#[cfg(mobile)]
#[tauri::command]
pub async fn screen_brightness(app: AppHandle, level: Option<f64>) -> R<f64> {
    use tauri_plugin_wistv_video::VideoExt;
    let level = level.unwrap_or(-2.0);
    tauri::async_runtime::spawn_blocking(move || app.video().brightness(level))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(desktop)]
#[tauri::command]
pub async fn screen_brightness(level: Option<f64>) -> R<f64> {
    let _ = level;
    Err("Máy tính không chỉnh độ sáng màn hình trong app".into())
}

#[cfg(desktop)]
#[tauri::command]
pub fn player_fullscreen(window: WebviewWindow, on: Option<bool>) -> R<bool> {
    let cur = window.is_fullscreen().map_err(|e| e.to_string())?;
    let next = on.unwrap_or(!cur);
    if next != cur {
        window.set_fullscreen(next).map_err(|e| e.to_string())?;
    }
    Ok(next)
}

#[tauri::command]
pub async fn open_url(app: AppHandle, url: String) -> R<()> {
    tauri::async_runtime::spawn_blocking(move || open_external(&app, &url))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn startup_open() -> Option<String> {
    std::env::var("WISTV_OPEN")
        .ok()
        .filter(|u| u.starts_with("http://") || u.starts_with("https://"))
}

#[cfg(target_os = "android")]
#[tauri::command]
pub fn startup_open(app: AppHandle) -> Option<String> {
    use tauri_plugin_wistv_video::VideoExt;
    app.video()
        .startup_url()
        .filter(|u| u.starts_with("http://") || u.starts_with("https://"))
}

#[tauri::command]
pub async fn subtitles(st: State<'_, AppState>, kind: String, id: String) -> R<Vec<Value>> {
    let list = load_addons(&st, false).await?;
    let http = st.http.clone();
    let jobs = list
        .into_iter()
        .filter(|a| a.supports("subtitles", &kind, &id))
        .map(|a| {
            let http = http.clone();
            let url = a.resource_url("subtitles", &kind, &id, &[]);
            async move { (a.name(), addons::get_json(&http, &url).await) }
        });
    let mut out = Vec::new();
    for (name, res) in futures::future::join_all(jobs).await {
        let Ok(v) = res else { continue };
        for s in v["subtitles"].as_array().into_iter().flatten() {
            if s["url"].as_str().is_some() {
                let mut item = s.clone();
                item["addon"] = json!(name);
                out.push(item);
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn subtitle_info(st: State<'_, AppState>, url: String) -> R<Value> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Địa chỉ phụ đề không hợp lệ".into());
    }
    let mut resp = st.http.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let mut body = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        body.extend_from_slice(&chunk);
        if body.len() > crate::subinfo::MAX_BYTES {
            return Err("Tệp phụ đề quá lớn".into());
        }
    }
    Ok(crate::subinfo::summarize(&String::from_utf8_lossy(&body)))
}

fn manifest_url(raw: &str) -> R<String> {
    let u = raw.trim();
    let u = match u.strip_prefix("stremio://") {
        Some(rest) => format!("https://{rest}"),
        None => u.to_string(),
    };
    if !(u.starts_with("https://") || u.starts_with("http://")) {
        return Err("Địa chỉ addon phải bắt đầu bằng https:// hoặc stremio://".into());
    }
    Ok(u)
}

fn position_of(list: &[Value], url: &str) -> R<usize> {
    list.iter()
        .position(|a| a["transportUrl"].as_str() == Some(url))
        .ok_or_else(|| "Không tìm thấy addon này".to_string())
}

fn is_protected(a: &Value) -> bool {
    a["flags"]["protected"].as_bool() == Some(true)
}

#[tauri::command]
pub async fn addon_install(st: State<'_, AppState>, url: String) -> R<Vec<Addon>> {
    let key = st.auth_key().ok_or("Đăng nhập tài khoản Stremio để cài addon")?;
    let url = manifest_url(&url)?;
    let manifest = addons::get_json(&st.http, &url)
        .await
        .map_err(|e| format!("Không đọc được manifest: {e}"))?;
    let id = manifest["id"]
        .as_str()
        .ok_or("Địa chỉ này không phải manifest của addon Stremio")?
        .to_string();
    let mut list = api::addon_collection_raw(&st.http, &key).await?;
    if list.iter().any(|a| a["transportUrl"].as_str() == Some(url.as_str())) {
        return Err(format!("{} đã được cài", manifest["name"].as_str().unwrap_or(&id)));
    }
    let entry = json!({
        "transportUrl": url,
        "transportName": "",
        "manifest": manifest,
        "flags": { "official": false, "protected": false },
    });
    match list.iter().position(|a| a["manifest"]["id"].as_str() == Some(id.as_str())) {
        Some(i) if is_protected(&list[i]) => return Err("Không thay được addon gốc của Stremio".into()),
        Some(i) => list[i] = entry,
        None => list.push(entry),
    }
    api::addon_collection_set(&st.http, &key, &list).await?;
    load_addons(&st, true).await
}

#[tauri::command]
pub async fn addon_remove(st: State<'_, AppState>, url: String) -> R<Vec<Addon>> {
    let key = st.auth_key().ok_or("Đăng nhập tài khoản Stremio để gỡ addon")?;
    let mut list = api::addon_collection_raw(&st.http, &key).await?;
    let pos = position_of(&list, &url)?;
    if is_protected(&list[pos]) {
        return Err("Đây là addon gốc của Stremio, không gỡ được".into());
    }
    list.remove(pos);
    api::addon_collection_set(&st.http, &key, &list).await?;
    load_addons(&st, true).await
}

#[tauri::command]
pub async fn addon_move(st: State<'_, AppState>, url: String, delta: i64) -> R<Vec<Addon>> {
    let key = st.auth_key().ok_or("Đăng nhập tài khoản Stremio để sắp xếp addon")?;
    let mut list = api::addon_collection_raw(&st.http, &key).await?;
    let pos = position_of(&list, &url)?;
    let target = (pos as i64 + delta).clamp(0, list.len() as i64 - 1) as usize;
    if target != pos {
        let item = list.remove(pos);
        list.insert(target, item);
        api::addon_collection_set(&st.http, &key, &list).await?;
    }
    load_addons(&st, true).await
}

#[tauri::command]
pub async fn addon_discover(st: State<'_, AppState>) -> R<Vec<Value>> {
    let urls = [
        "https://api.strem.io/addonsofficialcollection.json",
        "https://api.strem.io/addonscollection.json",
    ];
    let results = futures::future::join_all(urls.iter().map(|u| addons::get_json(&st.http, u))).await;
    let mut out: Vec<Value> = Vec::new();
    let mut last_err = None;
    for res in results {
        match res {
            Ok(Value::Array(list)) => {
                for a in list {
                    let ok = a["transportUrl"].as_str().is_some_and(|u| u.starts_with("http"));
                    if ok && !out.iter().any(|o| o["transportUrl"] == a["transportUrl"]) {
                        out.push(a);
                    }
                }
            }
            Ok(_) => {}
            Err(e) => last_err = Some(e),
        }
    }
    if out.is_empty() {
        return Err(last_err.unwrap_or_else(|| "Không tải được danh sách addon".into()));
    }
    Ok(out)
}

fn season_episode(video: &str) -> Option<(u64, u64)> {
    let mut parts = video.rsplit(':');
    let episode = parts.next()?.parse().ok()?;
    let season = parts.next()?.parse().ok()?;
    Some((season, episode))
}

async fn save_progress(st: &AppState, ctx: &PlayCtx, p: &Progress) -> R<()> {
    let Some(key) = st.auth_key() else {
        return Ok(());
    };
    if ctx.id.starts_with("local:") || ctx.kind == "tv" || p.duration_ms == 0 {
        return Ok(());
    }
    let now = now_iso();
    let profile = if ctx.profile.id.is_empty() { api::Profile::main() } else { ctx.profile.clone() };
    let mut item = api::library_get_one(&st.http, &key, &profile, &ctx.id)
        .await?
        .unwrap_or_else(|| new_item(&ctx.id, &json!(ctx.name), &json!(ctx.kind), &json!(ctx.poster), &now));
    if !item["state"].is_object() {
        item["state"] = json!({});
    }
    let s = &mut item["state"];
    let num = |v: &Value| v.as_u64().unwrap_or(0);
    let same_video = s["video_id"].as_str() == Some(ctx.video.as_str());
    let time_watched = if same_video { num(&s["timeWatched"]) } else { 0 } + p.watched_ms;
    let overall = num(&s["overallTimeWatched"]) + p.watched_ms;
    s["lastWatched"] = json!(now);
    s["video_id"] = json!(ctx.video);
    s["duration"] = json!(p.duration_ms);
    s["timeWatched"] = json!(time_watched);
    s["overallTimeWatched"] = json!(overall);
    if ctx.kind == "series" {
        if let Some((season, episode)) = season_episode(&ctx.video) {
            s["season"] = json!(season);
            s["episode"] = json!(episode);
        }
    }
    if !same_video {
        s["flaggedWatched"] = json!(0);
    }
    if p.finished {
        s["timeOffset"] = json!(0);
        s["timesWatched"] = json!(num(&s["timesWatched"]) + 1);
        s["flaggedWatched"] = json!(1);
    } else {
        s["timeOffset"] = json!(p.position_ms);
        for f in ["timesWatched", "flaggedWatched"] {
            if s[f].is_null() {
                s[f] = json!(0);
            }
        }
    }
    if s["noNotif"].is_null() {
        s["noNotif"] = json!(false);
    }
    item["_mtime"] = json!(now);
    api::library_put(&st.http, &key, &profile, &item).await?;
    if profile.id == st.profile().id {
        st.cache_library_item(&item);
    }
    Ok(())
}
