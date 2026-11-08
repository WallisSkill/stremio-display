use crate::state::AppState;

pub async fn torrent_url(st: &AppState, info_hash: &str, file_idx: Option<i64>, sources: Vec<String>) -> Result<String, String> {
    crate::torrent::engine(st.cache_dir.join("torrents"))
        .await?
        .open(info_hash, file_idx, &sources)
        .await
}
