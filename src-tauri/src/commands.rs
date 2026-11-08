use crate::addons::{self, Addon};
use crate::api;
use crate::player;
use crate::server;
use crate::state::{AppState, Session};
use crate::util::now_iso;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

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
pub async fn streams(st: State<'_, AppState>, kind: String, id: String) -> R<Vec<Value>> {
    let list = load_addons(&st, false).await?;
    let http = st.http.clone();
    let jobs = list
        .into_iter()
        .filter(|a| a.supports("stream", &kind, &id))
        .map(|a| {
            let http = http.clone();
            let url = a.resource_url("stream", &kind, &id, &[]);
            async move {
                let res = addons::get_json(&http, &url).await;
                (a, res)
            }
        });
    let results = futures::future::join_all(jobs).await;
    let mut out = Vec::new();
    for (a, res) in results {
        let Ok(v) = res else { continue };
        let Some(list) = v["streams"].as_array().filter(|s| !s.is_empty()) else {
            continue;
        };
        out.push(json!({
            "addon": a.name(),
            "logo": a.manifest["logo"],
            "streams": list,
        }));
    }
    Ok(out)
}

#[tauri::command]
pub async fn library(st: State<'_, AppState>) -> R<Vec<Value>> {
    let Some(key) = st.auth_key() else {
        return Ok(Vec::new());
    };
    let items = api::library_get(&st.http, &key).await?;
    *st.library.lock().unwrap() = items.clone();
    Ok(items)
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
    api::library_put(&st.http, &key, &item).await?;
    st.cache_library_item(&item);
    Ok(!in_library)
}

#[derive(Deserialize, Clone)]
pub struct PlayCtx {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub poster: Option<String>,
    pub video: String,
    pub start: Option<u64>,
}

fn open_external(url: &str) -> R<()> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Liên kết ngoài không hợp lệ".into());
    }
    std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", url])
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

async fn resolve(st: &AppState, stream: &Value) -> R<String> {
    if let Some(u) = stream["url"].as_str() {
        return Ok(u.to_string());
    }
    if let Some(hash) = stream["infoHash"].as_str() {
        let sources: Vec<String> = stream["sources"]
            .as_array()
            .map(|a| a.iter().filter_map(|s| s.as_str().map(str::to_string)).collect())
            .unwrap_or_default();
        return server::torrent_url(&st.http, hash, stream["fileIdx"].as_i64(), sources).await;
    }
    if stream["ytId"].is_string() {
        return Err("Nguồn YouTube chưa được hỗ trợ".into());
    }
    Err("Không hỗ trợ loại nguồn này".into())
}

#[tauri::command]
pub async fn play(app: AppHandle, st: State<'_, AppState>, stream: Value, ctx: PlayCtx) -> R<()> {
    if let Some(ext) = stream["externalUrl"].as_str() {
        return open_external(ext);
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
    let stop = Arc::new(AtomicBool::new(false));
    if let Some(prev) = st.player_stop.lock().unwrap().replace(stop.clone()) {
        prev.store(true, Ordering::SeqCst);
    }
    let req = player::Request {
        url,
        title: ctx.name.clone(),
        start_ms: ctx.start.unwrap_or(0),
        headers,
    };
    player::play(req, stop, move |out| {
        let _ = app.emit(
            "player-ended",
            json!({
                "id": ctx.id,
                "video": ctx.video,
                "position": out.position_ms,
                "duration": out.duration_ms,
                "error": out.error,
            }),
        );
        tauri::async_runtime::spawn(async move {
            let st = app.state::<AppState>();
            let saved = save_progress(&st, &ctx, &out).await;
            let _ = app.emit("library-changed", json!({ "ok": saved.is_ok(), "error": saved.err() }));
        });
    });
    Ok(())
}

async fn save_progress(st: &AppState, ctx: &PlayCtx, out: &player::Outcome) -> R<()> {
    let Some(key) = st.auth_key() else {
        return Ok(());
    };
    if out.duration_ms == 0 || out.error.is_some() {
        return Ok(());
    }
    let lib = api::library_get(&st.http, &key).await?;
    let now = now_iso();
    let mut item = lib
        .into_iter()
        .find(|i| i["_id"].as_str() == Some(ctx.id.as_str()))
        .unwrap_or_else(|| {
            new_item(&ctx.id, &json!(ctx.name), &json!(ctx.kind), &json!(ctx.poster), &now)
        });
    if !item["state"].is_object() {
        item["state"] = json!({});
    }
    let watched = out.position_ms.saturating_sub(ctx.start.unwrap_or(0));
    let finished = out.position_ms.saturating_mul(10) >= out.duration_ms.saturating_mul(9);
    let s = &mut item["state"];
    let num = |v: &Value| v.as_u64().unwrap_or(0);
    let time_watched = num(&s["timeWatched"]) + watched;
    let overall = num(&s["overallTimeWatched"]) + watched;
    s["lastWatched"] = json!(now);
    s["video_id"] = json!(ctx.video);
    s["duration"] = json!(out.duration_ms);
    s["timeWatched"] = json!(time_watched);
    s["overallTimeWatched"] = json!(overall);
    if finished {
        s["timeOffset"] = json!(0);
        s["timesWatched"] = json!(num(&s["timesWatched"]) + 1);
        s["flaggedWatched"] = json!(1);
    } else {
        s["timeOffset"] = json!(out.position_ms);
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
    api::library_put(&st.http, &key, &item).await?;
    st.cache_library_item(&item);
    Ok(())
}
