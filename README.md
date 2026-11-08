# WiS TV

Giao diện xem phim riêng cho Stremio, viết bằng Rust (Tauri 2). Dùng tài khoản, addon và thư viện Stremio như bình thường, chỉ thay phần giao diện.

- Lõi Rust (`src-tauri/src`): đăng nhập Stremio, đồng bộ addon, catalog, meta, nguồn phát, thư viện và tiến độ xem.
- Phát phim: `libmpv-2.dll` của Stremio, tăng tốc phần cứng (`hwdec=auto-safe`).
- Torrent: máy chủ phát của Stremio ở `127.0.0.1:11470`, tự bật nếu chưa chạy.
- Giao diện (`ui/`): HTML/CSS/JS thuần, điều khiển được bằng phím mũi tên.

## Build

```
cd src-tauri
cargo build --release -j 3
```

File chạy: `src-tauri/target/release/wistv.exe`. Cần Stremio đã cài, hoặc đặt `WISTV_LIBMPV` và `WISTV_STREMIO_DIR`.
