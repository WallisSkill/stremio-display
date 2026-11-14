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

## Giấy phép

WiS TV là phần mềm mã nguồn mở theo giấy phép [GNU GPL v3](LICENSE).

## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

The Windows installer (`WiSTV-setup.exe`) and the app (`wistv.exe`) are built from this repository by the [Windows workflow](.github/workflows/windows.yml) on GitHub-hosted runners and signed through SignPath. Each signing request is approved by hand. `libmpv-2.dll` comes unchanged from [shinchiro/mpv-winbuild-cmake](https://github.com/shinchiro/mpv-winbuild-cmake) and is not signed by this project.

Team roles:

- Committers and reviewers: [WallisSkill](https://github.com/WallisSkill), the owner of this repository
- Approvers: [WallisSkill](https://github.com/WallisSkill)

Every team member uses multi-factor authentication on GitHub and SignPath.

### Privacy

WiS TV sends no information to SignPath or to the people who sign it. When you use it, the app connects to:

- Stremio (`api.strem.io`) with your Stremio account, to sign in and sync your library, add-ons and progress.
- The add-ons you installed, to load catalogs, sources and subtitles.
- `film.wis237.online`, run by the WiS TV author: to sync your WiS TV profiles and settings, which are stored under your Stremio account ID, to run watch-together rooms you create or join, and to download interface updates.
- GitHub (`github.com`), to check for and download app updates.
- The streams you choose to play.

Nothing else is collected. Room data is deleted when the room closes. Profiles and settings stay on the server so they follow you between devices; to have them removed, open an issue in this repository.
