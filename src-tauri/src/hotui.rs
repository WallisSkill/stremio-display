use crate::state::AppState;
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use std::borrow::Cow;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock, RwLock};
use tauri::utils::assets::{AssetKey, AssetsIter, CspHash};
use tauri::{App, Assets, Context, Manager, Runtime, State};

pub const API: u32 = 1;
const BASE: &str = "https://film.wis237.online/ui/";
const MAX_BYTES: usize = 16 << 20;

type R<T> = Result<T, String>;

#[derive(Deserialize)]
struct Bundle {
    v: u64,
    api: u32,
    files: HashMap<String, String>,
}

#[derive(Deserialize)]
struct Announce {
    v: u64,
    api: u32,
}

struct Loaded {
    v: u64,
    files: HashMap<String, Box<[u8]>>,
}

struct Ctx {
    dir: PathBuf,
    key: String,
}

static CTX: OnceLock<Ctx> = OnceLock::new();
static ACTIVE: RwLock<Option<Arc<Loaded>>> = RwLock::new(None);
static STAGED: AtomicU64 = AtomicU64::new(0);

fn embedded() -> u64 {
    option_env!("WISTV_UI_V").and_then(|s| s.trim().parse().ok()).unwrap_or(0)
}

fn active_v() -> u64 {
    ACTIVE.read().ok().and_then(|g| g.as_ref().map(|b| b.v)).unwrap_or(0)
}

fn current() -> u64 {
    embedded().max(active_v()).max(STAGED.load(Ordering::SeqCst))
}

struct Empty;

impl<Rt: Runtime> Assets<Rt> for Empty {
    fn get(&self, _key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        None
    }
    fn iter(&self) -> Box<AssetsIter<'_>> {
        Box::new(std::iter::empty())
    }
    fn csp_hashes(&self, _html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        Box::new(std::iter::empty())
    }
}

pub struct Overlay<Rt: Runtime> {
    inner: Box<dyn Assets<Rt>>,
}

pub fn wrap<Rt: Runtime>(ctx: &mut Context<Rt>) {
    let inner = ctx.set_assets(Box::new(Empty));
    ctx.set_assets(Box::new(Overlay { inner }));
}

impl<Rt: Runtime> Assets<Rt> for Overlay<Rt> {
    fn setup(&self, app: &App<Rt>) {
        self.inner.setup(app);
        if cfg!(debug_assertions) {
            return;
        }
        let key = app
            .config()
            .plugins
            .0
            .get("updater")
            .and_then(|u| u.get("pubkey"))
            .and_then(|k| k.as_str())
            .map(str::to_string);
        let (Some(key), Ok(dir)) = (key, app.path().app_data_dir()) else {
            return;
        };
        if CTX.set(Ctx { dir: dir.join("ui"), key }).is_err() {
            return;
        }
        match load_disk() {
            Some(b) if b.v > embedded() => {
                STAGED.store(b.v, Ordering::SeqCst);
                *ACTIVE.write().unwrap() = Some(Arc::new(b));
            }
            _ => clear_disk(),
        }
    }

    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        let active = ACTIVE.read().ok().and_then(|g| g.clone());
        if let Some(bytes) = active.as_ref().and_then(|b| b.files.get(key.as_ref())) {
            return Some(Cow::Owned(bytes.to_vec()));
        }
        self.inner.get(key)
    }

    fn iter(&self) -> Box<AssetsIter<'_>> {
        self.inner.iter()
    }

    fn csp_hashes(&self, html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        self.inner.csp_hashes(html_path)
    }
}

fn b64_text(s: &str) -> R<String> {
    let raw = base64::engine::general_purpose::STANDARD
        .decode(s.trim())
        .map_err(|e| e.to_string())?;
    String::from_utf8(raw).map_err(|e| e.to_string())
}

fn verify(key: &str, data: &[u8], sig: &str) -> R<()> {
    let key = minisign_verify::PublicKey::decode(&b64_text(key)?).map_err(|e| e.to_string())?;
    let sig = minisign_verify::Signature::decode(&b64_text(sig)?).map_err(|e| e.to_string())?;
    key.verify(data, &sig, true).map_err(|e| e.to_string())
}

fn parse(data: &[u8]) -> R<Loaded> {
    let b: Bundle = serde_json::from_slice(data).map_err(|e| e.to_string())?;
    if b.api != API {
        return Err(crate::util::msg("err.uiApi"));
    }
    if !b.files.contains_key("/index.html") || b.files.keys().any(|k| !k.starts_with('/') || k.contains("..")) {
        return Err(crate::util::msg("err.uiBundle"));
    }
    let files = b.files.into_iter().map(|(k, v)| (k, v.into_bytes().into_boxed_slice())).collect();
    Ok(Loaded { v: b.v, files })
}

fn paths(dir: &std::path::Path, v: u64) -> (PathBuf, PathBuf) {
    (dir.join(format!("bundle-{v}.json")), dir.join(format!("bundle-{v}.json.sig")))
}

fn load_disk() -> Option<Loaded> {
    let ctx = CTX.get()?;
    let v: u64 = std::fs::read_to_string(ctx.dir.join("current")).ok()?.trim().parse().ok()?;
    let (json_path, sig_path) = paths(&ctx.dir, v);
    let data = std::fs::read(json_path).ok()?;
    let sig = std::fs::read_to_string(sig_path).ok()?;
    verify(&ctx.key, &data, &sig).ok()?;
    parse(&data).ok().filter(|b| b.v == v)
}

fn clear_disk() {
    if let Some(ctx) = CTX.get() {
        let _ = std::fs::remove_dir_all(&ctx.dir);
    }
}

fn save_disk(ctx: &Ctx, v: u64, data: &[u8], sig: &str) -> R<()> {
    std::fs::create_dir_all(&ctx.dir).map_err(|e| e.to_string())?;
    let (json_path, sig_path) = paths(&ctx.dir, v);
    std::fs::write(&json_path, data).map_err(|e| e.to_string())?;
    std::fs::write(&sig_path, sig).map_err(|e| e.to_string())?;
    let tmp = ctx.dir.join("current.tmp");
    std::fs::write(&tmp, v.to_string()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, ctx.dir.join("current")).map_err(|e| e.to_string())?;
    let keep = [json_path, sig_path, ctx.dir.join("current")];
    if let Ok(list) = std::fs::read_dir(&ctx.dir) {
        for e in list.flatten() {
            if !keep.contains(&e.path()) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    Ok(())
}

async fn fetch(http: &reqwest::Client, url: &str) -> R<Vec<u8>> {
    let res = http
        .get(url)
        .header("cache-control", "no-cache")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    if res.content_length().is_some_and(|n| n as usize > MAX_BYTES) {
        return Err(crate::util::msg("err.uiBundle"));
    }
    let body = res.bytes().await.map_err(|e| e.to_string())?;
    if body.len() > MAX_BYTES {
        return Err(crate::util::msg("err.uiBundle"));
    }
    Ok(body.to_vec())
}

fn activate() -> Option<u64> {
    let b = load_disk()?;
    let v = b.v;
    *ACTIVE.write().unwrap() = Some(Arc::new(b));
    Some(v)
}

#[tauri::command]
pub async fn ui_update(st: State<'_, AppState>, apply: bool) -> R<Value> {
    let Some(ctx) = CTX.get() else {
        return Ok(json!({ "state": "off" }));
    };
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let announce: Announce = serde_json::from_slice(&fetch(&st.http, &format!("{BASE}version.json?t={stamp}")).await?)
        .map_err(|e| e.to_string())?;
    let have = current();
    if announce.v <= have {
        if apply && STAGED.load(Ordering::SeqCst) > active_v().max(embedded()) {
            if let Some(v) = activate() {
                return Ok(json!({ "state": "applied", "v": v }));
            }
        }
        return Ok(json!({ "state": "latest", "v": have }));
    }
    if announce.api != API {
        return Ok(json!({ "state": "native", "v": announce.v }));
    }
    let q = format!("?v={}", announce.v);
    let data = fetch(&st.http, &format!("{BASE}bundle.json{q}")).await?;
    let sig = String::from_utf8(fetch(&st.http, &format!("{BASE}bundle.json.sig{q}")).await?).map_err(|e| e.to_string())?;
    verify(&ctx.key, &data, &sig)?;
    let bundle = parse(&data)?;
    if bundle.v <= have {
        return Ok(json!({ "state": "latest", "v": have }));
    }
    let v = bundle.v;
    save_disk(ctx, v, &data, &sig)?;
    STAGED.store(v, Ordering::SeqCst);
    drop(bundle);
    if apply {
        activate().ok_or_else(|| crate::util::msg("err.uiBundle"))?;
        return Ok(json!({ "state": "applied", "v": v }));
    }
    Ok(json!({ "state": "staged", "v": v }))
}

#[tauri::command]
pub fn ui_version() -> Value {
    json!({
        "v": active_v().max(embedded()),
        "embedded": embedded(),
        "staged": STAGED.load(Ordering::SeqCst),
        "api": API,
        "hot": active_v() > embedded(),
        "enabled": CTX.get().is_some(),
    })
}
