use librqbit::{AddTorrent, AddTorrentOptions, AddTorrentResponse, ManagedTorrent, Session, SessionOptions};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::OnceCell;

struct Entry {
    handle: Arc<ManagedTorrent>,
    file: usize,
}

pub struct Engine {
    session: Arc<Session>,
    port: u16,
    streams: Mutex<HashMap<String, Entry>>,
}

static ENGINE: OnceCell<Arc<Engine>> = OnceCell::const_new();

pub async fn engine(dir: PathBuf) -> Result<Arc<Engine>, String> {
    ENGINE
        .get_or_try_init(|| async move {
            let _ = tokio::fs::remove_dir_all(&dir).await;
            tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
            let session = Session::new_with_opts(dir, SessionOptions::default())
                .await
                .map_err(|e| format!("Không khởi động được máy chủ torrent: {e}"))?;
            let listener = TcpListener::bind(("127.0.0.1", 0)).await.map_err(|e| e.to_string())?;
            let port = listener.local_addr().map_err(|e| e.to_string())?.port();
            let engine = Arc::new(Engine { session, port, streams: Mutex::new(HashMap::new()) });
            let serve = engine.clone();
            tokio::spawn(async move {
                while let Ok((sock, _)) = listener.accept().await {
                    let e = serve.clone();
                    tokio::spawn(async move {
                        let _ = e.serve(sock).await;
                    });
                }
            });
            Ok(engine)
        })
        .await
        .cloned()
}

pub async fn release() {
    if let Some(e) = ENGINE.get() {
        e.clear().await;
    }
}

fn magnet(hash: &str, sources: &[String]) -> String {
    let mut m = format!("magnet:?xt=urn:btih:{hash}");
    for s in sources {
        if let Some(t) = s.strip_prefix("tracker:") {
            m.push_str("&tr=");
            m.push_str(&urlencode(t));
        }
    }
    m
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

impl Engine {
    async fn clear(&self) {
        let old: Vec<Arc<ManagedTorrent>> = self.streams.lock().unwrap().drain().map(|(_, e)| e.handle).collect();
        for h in old {
            let _ = self.session.delete(h.id().into(), true).await;
        }
    }

    pub async fn open(&self, hash: &str, file_idx: Option<i64>, sources: &[String]) -> Result<String, String> {
        let hash = hash.to_lowercase();
        if !hash.chars().all(|c| c.is_ascii_hexdigit()) || hash.len() != 40 {
            return Err("Mã torrent không hợp lệ".into());
        }
        let key = format!("{hash}-{}", file_idx.unwrap_or(-1));
        if self.streams.lock().unwrap().contains_key(&key) {
            return Ok(format!("http://127.0.0.1:{}/{key}", self.port));
        }
        self.clear().await;
        let link = magnet(&hash, sources);
        let file = match file_idx {
            Some(i) if i >= 0 => i as usize,
            _ => {
                let listed = self
                    .session
                    .add_torrent(AddTorrent::from_url(&link), Some(AddTorrentOptions { list_only: true, ..Default::default() }))
                    .await
                    .map_err(|e| format!("Không đọc được torrent: {e}"))?;
                let AddTorrentResponse::ListOnly(list) = listed else {
                    return Err("Không đọc được danh sách tệp của torrent".into());
                };
                list.info
                    .iter_file_lengths()
                    .enumerate()
                    .max_by_key(|(_, len)| *len)
                    .map(|(i, _)| i)
                    .ok_or("Không tìm thấy tệp video trong torrent")?
            }
        };
        let added = self
            .session
            .add_torrent(
                AddTorrent::from_url(&link),
                Some(AddTorrentOptions { only_files: Some(vec![file]), overwrite: true, ..Default::default() }),
            )
            .await
            .map_err(|e| format!("Không mở được torrent: {e}"))?;
        let handle = added.into_handle().ok_or("Không mở được torrent")?;
        tokio::time::timeout(Duration::from_secs(60), handle.wait_until_initialized())
            .await
            .map_err(|_| "Không tìm được nguồn cho torrent này".to_string())?
            .map_err(|e| e.to_string())?;
        self.streams.lock().unwrap().insert(key.clone(), Entry { handle, file });
        Ok(format!("http://127.0.0.1:{}/{key}", self.port))
    }

    async fn serve(&self, mut sock: TcpStream) -> std::io::Result<()> {
        let mut buf = Vec::with_capacity(2048);
        let mut chunk = [0u8; 1024];
        while !buf.windows(4).any(|w| w == b"\r\n\r\n") {
            let n = sock.read(&mut chunk).await?;
            if n == 0 || buf.len() > 16384 {
                return Ok(());
            }
            buf.extend_from_slice(&chunk[..n]);
        }
        let head = String::from_utf8_lossy(&buf).into_owned();
        let mut lines = head.split("\r\n");
        let mut first = lines.next().unwrap_or_default().split(' ');
        let method = first.next().unwrap_or_default().to_string();
        let path = first.next().unwrap_or_default().trim_start_matches('/').to_string();
        let range = lines
            .filter_map(|l| l.split_once(':'))
            .find(|(k, _)| k.trim().eq_ignore_ascii_case("range"))
            .map(|(_, v)| v.trim().to_string());
        let found = self.streams.lock().unwrap().get(&path).map(|e| (e.handle.clone(), e.file));
        let Some((handle, file)) = found else {
            sock.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await?;
            return Ok(());
        };
        let mut stream = match handle.stream(file).await {
            Ok(s) => s,
            Err(_) => {
                sock.write_all(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await?;
                return Ok(());
            }
        };
        let total = stream.len();
        let (start, end) = match range.as_deref().and_then(|r| r.strip_prefix("bytes=")).and_then(|r| r.split_once('-')) {
            Some((a, b)) => {
                let start = a.trim().parse::<u64>().unwrap_or(0);
                let end = b.trim().parse::<u64>().ok().unwrap_or(total.saturating_sub(1)).min(total.saturating_sub(1));
                (start, end)
            }
            None => (0, total.saturating_sub(1)),
        };
        if total == 0 || start > end {
            let msg = format!("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{total}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            sock.write_all(msg.as_bytes()).await?;
            return Ok(());
        }
        let len = end - start + 1;
        let status = if range.is_some() { "206 Partial Content" } else { "200 OK" };
        let mut reply = format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/octet-stream\r\nAccept-Ranges: bytes\r\nContent-Length: {len}\r\nConnection: close\r\n"
        );
        if range.is_some() {
            reply.push_str(&format!("Content-Range: bytes {start}-{end}/{total}\r\n"));
        }
        reply.push_str("\r\n");
        sock.write_all(reply.as_bytes()).await?;
        if method == "HEAD" {
            return Ok(());
        }
        stream.seek(std::io::SeekFrom::Start(start)).await?;
        let mut body = stream.take(len);
        tokio::io::copy(&mut body, &mut sock).await?;
        Ok(())
    }
}
