use librqbit::dht::DhtPersistenceConfig;
use librqbit::{
    AddTorrent, AddTorrentOptions, AddTorrentResponse, ConnectionOptions, DhtSessionConfig, ManagedTorrent, ManagedTorrentState,
    PeerConnectionOptions, Session, SessionOptions,
};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::OnceCell;

const TRACKERS: &[&str] = &[
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://open.demonii.com:1337/announce",
];
const CONNECT_TIMEOUT: Duration = Duration::from_secs(4);
const INIT_TIMEOUT: Duration = Duration::from_secs(60);
const PAUSE_AFTER: Duration = Duration::from_secs(8);
const DROP_AFTER: Duration = Duration::from_secs(180);

struct Current {
    hash: String,
    handle: Arc<ManagedTorrent>,
    file: usize,
}

pub struct Engine {
    session: Arc<Session>,
    port: u16,
    current: Mutex<Option<Current>>,
    opening: tokio::sync::Mutex<()>,
    ticket: AtomicU64,
}

static ENGINE: OnceCell<Arc<Engine>> = OnceCell::const_new();

pub async fn engine(cache: PathBuf) -> Result<Arc<Engine>, String> {
    ENGINE
        .get_or_try_init(|| async move {
            let dir = cache.join("torrents");
            let _ = tokio::fs::remove_dir_all(&dir).await;
            tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
            let opts = SessionOptions {
                dht: Some(DhtSessionConfig {
                    persistence: Some(DhtPersistenceConfig { config_filename: Some(cache.join("dht.json")), ..Default::default() }),
                    ..Default::default()
                }),
                connect: Some(ConnectionOptions {
                    peer_opts: Some(PeerConnectionOptions { connect_timeout: Some(CONNECT_TIMEOUT), ..Default::default() }),
                    ..Default::default()
                }),
                trackers: TRACKERS.iter().filter_map(|t| t.parse::<tauri::Url>().ok()).collect(),
                ..Default::default()
            };
            let session = Session::new_with_opts(dir, opts)
                .await
                .map_err(|e| crate::util::msg_with("err.torrentServer", &[("e", e.to_string())]))?;
            let listener = TcpListener::bind(("127.0.0.1", 0)).await.map_err(|e| e.to_string())?;
            let port = listener.local_addr().map_err(|e| e.to_string())?.port();
            let engine = Arc::new(Engine {
                session,
                port,
                current: Mutex::new(None),
                opening: tokio::sync::Mutex::new(()),
                ticket: AtomicU64::new(0),
            });
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

pub fn release() {
    let Some(e) = ENGINE.get().cloned() else { return };
    let ticket = e.ticket.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn(linger(e, ticket));
}

async fn linger(e: Arc<Engine>, ticket: u64) {
    tokio::time::sleep(PAUSE_AFTER).await;
    {
        let _guard = e.opening.lock().await;
        if e.ticket.load(Ordering::SeqCst) != ticket {
            return;
        }
        let handle = e.current.lock().unwrap().as_ref().map(|c| c.handle.clone());
        if let Some(h) = handle.filter(|h| !h.is_paused()) {
            let _ = e.session.pause(&h).await;
        }
    }
    tokio::time::sleep(DROP_AFTER).await;
    let _guard = e.opening.lock().await;
    if e.ticket.load(Ordering::SeqCst) == ticket {
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

fn largest(lengths: impl Iterator<Item = u64>) -> Result<usize, String> {
    lengths
        .enumerate()
        .max_by_key(|(_, len)| *len)
        .map(|(i, _)| i)
        .ok_or_else(|| crate::util::msg("err.torrentNoVideo"))
}

impl Engine {
    async fn clear(&self) {
        let old = self.current.lock().unwrap().take();
        if let Some(c) = old {
            let _ = self.session.delete(c.handle.id().into(), true).await;
        }
    }

    fn url(&self, hash: &str, file: usize) -> String {
        format!("http://127.0.0.1:{}/{hash}-{file}", self.port)
    }

    pub async fn open(&self, hash: &str, file_idx: Option<i64>, sources: &[String]) -> Result<String, String> {
        let hash = hash.to_lowercase();
        if !hash.chars().all(|c| c.is_ascii_hexdigit()) || hash.len() != 40 {
            return Err(crate::util::msg("err.torrentHash"));
        }
        let wanted = file_idx.filter(|i| *i >= 0).map(|i| i as usize);
        let _guard = self.opening.lock().await;
        self.ticket.fetch_add(1, Ordering::SeqCst);
        let kept = self
            .current
            .lock()
            .unwrap()
            .as_ref()
            .filter(|c| c.hash == hash)
            .map(|c| c.handle.clone());
        let kept = kept.filter(|h| !h.with_state(|s| matches!(s, ManagedTorrentState::Error(_))));
        if let Some(handle) = kept {
            let file = match wanted {
                Some(i) => i,
                None => handle
                    .with_metadata(|m| largest(m.info.iter_file_lengths()))
                    .map_err(|e| crate::util::msg_with("err.torrentRead", &[("e", e.to_string())]))??,
            };
            if handle.only_files().as_deref() != Some(&[file][..]) {
                self.session
                    .update_only_files(&handle, &HashSet::from([file]))
                    .await
                    .map_err(|e| crate::util::msg_with("err.torrentOpenE", &[("e", e.to_string())]))?;
            }
            if handle.is_paused() {
                self.session
                    .unpause(&handle)
                    .await
                    .map_err(|e| crate::util::msg_with("err.torrentOpenE", &[("e", e.to_string())]))?;
            }
            *self.current.lock().unwrap() = Some(Current { hash: hash.clone(), handle, file });
            return Ok(self.url(&hash, file));
        }
        self.clear().await;
        let link = magnet(&hash, sources);
        let (source, file, peers) = match wanted {
            Some(i) => (AddTorrent::from_url(link), i, None),
            None => {
                let listed = self
                    .session
                    .add_torrent(AddTorrent::from_url(&link), Some(AddTorrentOptions { list_only: true, ..Default::default() }))
                    .await
                    .map_err(|e| crate::util::msg_with("err.torrentRead", &[("e", e.to_string())]))?;
                let AddTorrentResponse::ListOnly(list) = listed else {
                    return Err(crate::util::msg("err.torrentFiles"));
                };
                let file = largest(list.info.iter_file_lengths())?;
                (AddTorrent::from_bytes(list.torrent_bytes), file, Some(list.seen_peers))
            }
        };
        let added = self
            .session
            .add_torrent(
                source,
                Some(AddTorrentOptions { only_files: Some(vec![file]), overwrite: true, initial_peers: peers, ..Default::default() }),
            )
            .await
            .map_err(|e| crate::util::msg_with("err.torrentOpenE", &[("e", e.to_string())]))?;
        let handle = added.into_handle().ok_or_else(|| crate::util::msg("err.torrentOpen"))?;
        *self.current.lock().unwrap() = Some(Current { hash: hash.clone(), handle: handle.clone(), file });
        let failed = match tokio::time::timeout(INIT_TIMEOUT, handle.wait_until_initialized()).await {
            Ok(Ok(_)) => None,
            Ok(Err(e)) => Some(e.to_string()),
            Err(_) => Some(crate::util::msg("err.torrentPeers")),
        };
        if let Some(e) = failed {
            self.clear().await;
            return Err(e);
        }
        Ok(self.url(&hash, file))
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
        let found = self
            .current
            .lock()
            .unwrap()
            .as_ref()
            .filter(|c| path == format!("{}-{}", c.hash, c.file))
            .map(|c| (c.handle.clone(), c.file));
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
