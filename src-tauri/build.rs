fn main() {
    println!("cargo:rerun-if-changed=../ui");
    let stamp = std::process::Command::new("git")
        .args(["log", "-1", "--format=%ct", "--", "../ui"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
        .unwrap_or_else(|| "0".to_string());
    println!("cargo:rustc-env=WISTV_UI_V={stamp}");
    tauri_build::build()
}
