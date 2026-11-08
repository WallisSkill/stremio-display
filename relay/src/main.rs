#![windows_subsystem = "windows"]

use bytes::Bytes;
use futures_util::TryStreamExt;
use http_body_util::{combinators::UnsyncBoxBody, BodyExt, Empty, Full, StreamBody};
use hyper::body::{Frame, Incoming};
use hyper::header::{HeaderName, HeaderValue};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde_json::{json, Value};
use std::io::Write;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::net::TcpListener;
use tokio::sync::watch;

const STREMIO: &str = "http://127.0.0.1:11470";
const LISTEN: &str = "127.0.0.1:11471";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const HEARTBEAT: Duration = Duration::from_secs(600);
const PASS_REQUEST: [&str; 8] = ["range", "content-type", "accept", "accept-encoding", "if-range", "if-none-match", "if-modified-since", "cache-control"];
const PASS_RESPONSE: [&str; 9] = ["content-type", "content-length", "content-range", "accept-ranges", "cache-control", "etag", "last-modified", "content-encoding", "content-disposition"];

type Body = UnsyncBoxBody<Bytes, std::io::Error>;

struct Config {
    dir: PathBuf,
    token: String,
    register: String,
    cloudflared: PathBuf,
}

fn data_dir() -> PathBuf {
    let base = std::env::var("APPDATA").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("."));
    base.join("tv.wis.app")
}

fn log(dir: &Path, msg: &str) {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("relay.log")) {
        let _ = writeln!(f, "{secs} {msg}");
    }
}

fn new_token() -> String {
    let mut buf = [0u8; 32];
    getrandom::getrandom(&mut buf).expect("system random source unavailable");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

fn find_cloudflared(cfg: &Value) -> PathBuf {
    if let Some(p) = cfg["cloudflared"].as_str().filter(|p| !p.is_empty()) {
        return PathBuf::from(p);
    }
    let mut candidates = Vec::new();
    if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)) {
        candidates.push(dir.join("cloudflared.exe"));
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        candidates.push(PathBuf::from(local).join("WiSTV").join("cloudflared.exe"));
    }
    candidates.into_iter().find(|p| p.is_file()).unwrap_or_else(|| PathBuf::from("cloudflared.exe"))
}

fn load_config() -> Config {
    let dir = data_dir();
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("relay.json");
    let mut cfg: Value = std::fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_else(|| json!({}));
    let valid = cfg["token"].as_str().is_some_and(|t| t.len() == 64 && t.bytes().all(|c| c.is_ascii_hexdigit()));
    if !valid {
        cfg["token"] = json!(new_token());
    }
    if !cfg["register"].is_string() {
        cfg["register"] = json!("");
    }
    if let Ok(bytes) = serde_json::to_vec_pretty(&cfg) {
        let _ = std::fs::write(&path, bytes);
    }
    Config {
        token: cfg["token"].as_str().unwrap_or_default().to_string(),
        register: cfg["register"].as_str().unwrap_or_default().to_string(),
        cloudflared: find_cloudflared(&cfg),
        dir,
    }
}

fn stremio_dirs() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(p) = std::env::var("WISTV_STREMIO_DIR") {
        out.push(PathBuf::from(p));
    }
    if let Ok(p) = std::env::var("LOCALAPPDATA") {
        out.push(PathBuf::from(p).join("Programs").join("Stremio"));
    }
    for var in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Ok(p) = std::env::var(var) {
            out.push(PathBuf::from(p).join("Stremio"));
        }
    }
    out
}

async fn stremio_alive(http: &reqwest::Client) -> bool {
    http.get(format!("{STREMIO}/settings"))
        .timeout(Duration::from_secs(4))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

async fn stremio_listening() -> bool {
    let connect = tokio::net::TcpStream::connect(("127.0.0.1", 11470));
    matches!(tokio::time::timeout(Duration::from_secs(2), connect).await, Ok(Ok(_)))
}

async fn ensure_stremio(http: &reqwest::Client, dir: &Path) -> bool {
    if stremio_alive(http).await || stremio_listening().await {
        return true;
    }
    let Some(home) = stremio_dirs()
        .into_iter()
        .find(|d| d.join("stremio-runtime.exe").is_file() && d.join("server.js").is_file())
    else {
        log(dir, "stremio server not found");
        return false;
    };
    let spawned = std::process::Command::new(home.join("stremio-runtime.exe"))
        .arg(home.join("server.js"))
        .current_dir(&home)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
    if let Err(e) = spawned {
        log(dir, &format!("cannot start stremio server: {e}"));
        return false;
    }
    for _ in 0..40 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        if stremio_alive(http).await {
            log(dir, "stremio server started");
            return true;
        }
    }
    log(dir, "stremio server did not answer");
    false
}

fn empty() -> Body {
    Empty::<Bytes>::new().map_err(|never| match never {}).boxed_unsync()
}

fn text(status: StatusCode, msg: &'static str) -> Response<Body> {
    let mut res = Response::new(Full::new(Bytes::from_static(msg.as_bytes())).map_err(|never| match never {}).boxed_unsync());
    *res.status_mut() = status;
    res
}

fn with_cors(mut res: Response<Body>) -> Response<Body> {
    let h = res.headers_mut();
    h.insert("access-control-allow-origin", HeaderValue::from_static("*"));
    h.insert("access-control-allow-methods", HeaderValue::from_static("GET, POST, HEAD, OPTIONS"));
    h.insert("access-control-allow-headers", HeaderValue::from_static("content-type, range"));
    h.insert("access-control-expose-headers", HeaderValue::from_static("content-length, content-range, accept-ranges"));
    h.insert("access-control-max-age", HeaderValue::from_static("600"));
    res
}

fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

struct Shared {
    http: reqwest::Client,
    token: String,
    dir: PathBuf,
}

async fn forward(req: Request<Incoming>, rest: &str, sh: &Shared) -> Response<Body> {
    let query = req.uri().query().map(|q| format!("?{q}")).unwrap_or_default();
    let target = format!("{STREMIO}/{rest}{query}");
    let method = match reqwest::Method::from_bytes(req.method().as_str().as_bytes()) {
        Ok(m) => m,
        Err(_) => return text(StatusCode::METHOD_NOT_ALLOWED, "method not allowed"),
    };
    let mut out = sh.http.request(method, &target);
    for name in PASS_REQUEST {
        if let Some(v) = req.headers().get(name).and_then(|v| v.to_str().ok()) {
            out = out.header(name, v);
        }
    }
    let body = match req.into_body().collect().await {
        Ok(b) => b.to_bytes(),
        Err(_) => return text(StatusCode::BAD_REQUEST, "bad request body"),
    };
    if !body.is_empty() {
        out = out.body(body.clone());
    }
    let resp = match out.send().await {
        Ok(r) => r,
        Err(_) => {
            if !ensure_stremio(&sh.http, &sh.dir).await {
                return text(StatusCode::BAD_GATEWAY, "stremio server is not running");
            }
            return text(StatusCode::SERVICE_UNAVAILABLE, "stremio server restarted, retry");
        }
    };
    let mut res = Response::builder().status(resp.status().as_u16());
    for name in PASS_RESPONSE {
        if let Some(v) = resp.headers().get(name) {
            if let (Ok(n), Ok(v)) = (HeaderName::from_bytes(name.as_bytes()), HeaderValue::from_bytes(v.as_bytes())) {
                res = res.header(n, v);
            }
        }
    }
    let stream = resp
        .bytes_stream()
        .map_ok(Frame::data)
        .map_err(std::io::Error::other);
    res.body(BodyExt::boxed_unsync(StreamBody::new(stream)))
        .unwrap_or_else(|_| text(StatusCode::BAD_GATEWAY, "bad upstream response"))
}

async fn handle(req: Request<Incoming>, sh: Arc<Shared>) -> Result<Response<Body>, std::convert::Infallible> {
    if req.method() == Method::OPTIONS {
        let mut res = Response::new(empty());
        *res.status_mut() = StatusCode::NO_CONTENT;
        return Ok(with_cors(res));
    }
    let path = req.uri().path().trim_start_matches('/').to_string();
    let (token, rest) = path.split_once('/').unwrap_or((path.as_str(), ""));
    if !same(token, &sh.token) {
        return Ok(with_cors(text(StatusCode::NOT_FOUND, "not found")));
    }
    let rest = rest.to_string();
    Ok(with_cors(forward(req, &rest, &sh).await))
}

fn tunnel_url(line: &str) -> Option<String> {
    let start = line.find("https://")?;
    let url: String = line[start..].chars().take_while(|c| !c.is_whitespace() && *c != '|').collect();
    url.ends_with(".trycloudflare.com").then_some(url)
}

async fn run_tunnel(cfg: Arc<Config>, tx: watch::Sender<Option<String>>) {
    loop {
        let child = tokio::process::Command::new(&cfg.cloudflared)
            .args(["tunnel", "--no-autoupdate", "--url", &format!("http://{LISTEN}")])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .creation_flags(CREATE_NO_WINDOW)
            .kill_on_drop(true)
            .spawn();
        let mut child = match child {
            Ok(c) => c,
            Err(e) => {
                log(&cfg.dir, &format!("cannot start cloudflared at {}: {e}", cfg.cloudflared.display()));
                tokio::time::sleep(Duration::from_secs(60)).await;
                continue;
            }
        };
        if let Some(err) = child.stderr.take() {
            let mut lines = BufReader::new(err).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(url) = tunnel_url(&line) {
                    log(&cfg.dir, &format!("tunnel up at {url}"));
                    let _ = tx.send(Some(url));
                }
            }
        }
        let status = child.wait().await;
        let _ = tx.send(None);
        log(&cfg.dir, &format!("cloudflared exited: {status:?}"));
        tokio::time::sleep(Duration::from_secs(10)).await;
    }
}

fn auth_key(dir: &Path) -> Option<String> {
    let bytes = std::fs::read(dir.join("session.json")).ok()?;
    let v: Value = serde_json::from_slice(&bytes).ok()?;
    v["auth_key"].as_str().map(str::to_string)
}

async fn register(cfg: &Config, http: &reqwest::Client, url: &str) {
    if cfg.register.is_empty() {
        log(&cfg.dir, &format!("tunnel at {url}; set \"register\" in relay.json to the web app's /api/relay to publish it"));
        return;
    }
    let Some(key) = auth_key(&cfg.dir) else {
        log(&cfg.dir, "not registered: sign in to the WiS TV desktop app first");
        return;
    };
    let body = json!({ "authKey": key, "url": url, "token": cfg.token });
    match http.post(&cfg.register).json(&body).timeout(Duration::from_secs(20)).send().await {
        Ok(r) if r.status().is_success() => log(&cfg.dir, "registered with the web app"),
        Ok(r) => log(&cfg.dir, &format!("register failed: HTTP {}", r.status())),
        Err(e) => log(&cfg.dir, &format!("register failed: {e}")),
    }
}

async fn run_register(cfg: Arc<Config>, http: reqwest::Client, mut rx: watch::Receiver<Option<String>>) {
    loop {
        let current = rx.borrow_and_update().clone();
        if let Some(url) = current {
            register(&cfg, &http, &url).await;
        }
        tokio::select! {
            changed = rx.changed() => if changed.is_err() { return },
            _ = tokio::time::sleep(HEARTBEAT) => {}
        }
    }
}

#[tokio::main]
async fn main() {
    let cfg = Arc::new(load_config());
    let listener = match TcpListener::bind(LISTEN).await {
        Ok(l) => l,
        Err(e) => {
            log(&cfg.dir, &format!("cannot listen on {LISTEN} (already running?): {e}"));
            return;
        }
    };
    log(&cfg.dir, "relay started");
    let http = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .build()
        .expect("http client");
    ensure_stremio(&http, &cfg.dir).await;
    let (tx, rx) = watch::channel(None);
    tokio::spawn(run_tunnel(cfg.clone(), tx));
    tokio::spawn(run_register(cfg.clone(), http.clone(), rx));
    let shared = Arc::new(Shared { http, token: cfg.token.clone(), dir: cfg.dir.clone() });
    loop {
        let Ok((stream, _)) = listener.accept().await else { continue };
        let sh = shared.clone();
        tokio::spawn(async move {
            let svc = service_fn(move |req| handle(req, sh.clone()));
            let _ = http1::Builder::new().serve_connection(TokioIo::new(stream), svc).await;
        });
    }
}
