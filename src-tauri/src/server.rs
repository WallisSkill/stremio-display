use serde_json::{json, Value};
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

pub const SERVER: &str = "http://127.0.0.1:11470";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn stremio_dirs() -> Vec<PathBuf> {
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

async fn alive(http: &reqwest::Client) -> bool {
    http.get(format!("{SERVER}/settings"))
        .timeout(Duration::from_secs(2))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

fn spawn_server() -> Result<(), String> {
    for dir in stremio_dirs() {
        let runtime = dir.join("stremio-runtime.exe");
        let script = dir.join("server.js");
        if runtime.is_file() && script.is_file() {
            Command::new(runtime)
                .arg(script)
                .current_dir(&dir)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map_err(|e| format!("Không chạy được máy chủ Stremio: {e}"))?;
            return Ok(());
        }
    }
    Err("Không tìm thấy Stremio (cần stremio-runtime.exe và server.js) để phát torrent".into())
}

pub async fn ensure(http: &reqwest::Client) -> Result<(), String> {
    if alive(http).await {
        return Ok(());
    }
    spawn_server()?;
    for _ in 0..40 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        if alive(http).await {
            return Ok(());
        }
    }
    Err("Máy chủ phát torrent của Stremio không phản hồi".into())
}

fn largest_file(files: &Value) -> Option<i64> {
    files
        .as_array()?
        .iter()
        .enumerate()
        .max_by_key(|(_, f)| f["length"].as_u64().unwrap_or(0))
        .map(|(i, _)| i as i64)
}

pub async fn torrent_url(
    http: &reqwest::Client,
    info_hash: &str,
    file_idx: Option<i64>,
    sources: Vec<String>,
) -> Result<String, String> {
    ensure(http).await?;
    let hash = info_hash.to_lowercase();
    let sources = if sources.is_empty() {
        vec![format!("dht:{hash}")]
    } else {
        sources
    };
    let mut body = json!({
        "torrent": { "infoHash": hash },
        "peerSearch": { "sources": sources, "min": 40, "max": 150 }
    });
    if file_idx.is_none() {
        body["guessFileIdx"] = json!({});
    }
    let created: Value = http
        .post(format!("{SERVER}/{hash}/create"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Không mở được torrent: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Máy chủ torrent trả lời lỗi: {e}"))?;
    let idx = file_idx
        .or_else(|| created["guessedFileIdx"].as_i64())
        .or_else(|| largest_file(&created["files"]))
        .ok_or("Không tìm thấy tệp video trong torrent")?;
    Ok(format!("{SERVER}/{hash}/{idx}"))
}
