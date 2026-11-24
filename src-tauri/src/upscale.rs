use std::path::{Path, PathBuf};

macro_rules! shader {
    ($name:literal) => {
        ($name, include_str!(concat!("../shaders/anime4k/", $name)))
    };
}

const SHADERS: &[(&str, &str)] = &[
    shader!("Anime4K_Clamp_Highlights.glsl"),
    shader!("Anime4K_Restore_CNN_M.glsl"),
    shader!("Anime4K_Restore_CNN_VL.glsl"),
    shader!("Anime4K_Upscale_CNN_x2_S.glsl"),
    shader!("Anime4K_Upscale_CNN_x2_M.glsl"),
    shader!("Anime4K_Upscale_CNN_x2_VL.glsl"),
    shader!("Anime4K_AutoDownscalePre_x2.glsl"),
    shader!("Anime4K_AutoDownscalePre_x4.glsl"),
];

const FAST: &[&str] = &[
    "Anime4K_Clamp_Highlights.glsl",
    "Anime4K_Restore_CNN_M.glsl",
    "Anime4K_Upscale_CNN_x2_M.glsl",
    "Anime4K_AutoDownscalePre_x2.glsl",
    "Anime4K_AutoDownscalePre_x4.glsl",
    "Anime4K_Upscale_CNN_x2_S.glsl",
];

const BEST: &[&str] = &[
    "Anime4K_Clamp_Highlights.glsl",
    "Anime4K_Restore_CNN_VL.glsl",
    "Anime4K_Upscale_CNN_x2_VL.glsl",
    "Anime4K_AutoDownscalePre_x2.glsl",
    "Anime4K_AutoDownscalePre_x4.glsl",
    "Anime4K_Upscale_CNN_x2_M.glsl",
];

pub const MODES: &[&str] = &["off", "fast", "best"];

const SEPARATOR: &str = if cfg!(windows) { ";" } else { ":" };

fn write_shader(dir: &Path, name: &str, body: &str) -> Result<PathBuf, String> {
    let path = dir.join(name);
    let same = std::fs::metadata(&path).map(|m| m.len() == body.len() as u64).unwrap_or(false);
    if !same {
        std::fs::write(&path, body).map_err(|e| e.to_string())?;
    }
    Ok(path)
}

pub fn chain(cache_dir: &Path, mode: &str) -> Result<String, String> {
    let names = match mode {
        "off" => return Ok(String::new()),
        "fast" => FAST,
        "best" => BEST,
        _ => return Err(crate::util::msg("err.badUpscale")),
    };
    let dir = cache_dir.join("anime4k");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut paths = Vec::with_capacity(names.len());
    for name in names {
        let body = SHADERS
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, b)| *b)
            .ok_or_else(|| crate::util::msg("err.badUpscale"))?;
        paths.push(write_shader(&dir, name, body)?.to_string_lossy().into_owned());
    }
    Ok(paths.join(SEPARATOR))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_mode_lists_only_bundled_shaders() {
        for list in [FAST, BEST] {
            for name in list {
                assert!(SHADERS.iter().any(|(n, _)| n == name), "{name} is not bundled");
            }
        }
    }

    #[test]
    fn chain_writes_the_files_and_joins_them_in_order() {
        let dir = std::env::temp_dir().join(format!("wistv-upscale-{}", std::process::id()));
        let list = chain(&dir, "best").unwrap();
        let parts: Vec<&str> = list.split(SEPARATOR).collect();
        assert_eq!(parts.len(), BEST.len());
        for (part, name) in parts.iter().zip(BEST) {
            assert!(part.ends_with(name));
            assert!(std::fs::metadata(part).unwrap().len() > 0);
        }
        assert_eq!(chain(&dir, "off").unwrap(), "");
        assert!(chain(&dir, "huge").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
