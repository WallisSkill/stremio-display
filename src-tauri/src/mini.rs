use std::sync::Mutex;
use tauri::{LogicalSize, PhysicalPosition, PhysicalSize, WebviewWindow};

struct Saved {
    pos: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    max: bool,
    full: bool,
}

static SAVED: Mutex<Option<Saved>> = Mutex::new(None);

const MINI_WIDTH: f64 = 480.0;
const MINI_MARGIN: f64 = 24.0;

pub fn active() -> bool {
    SAVED.lock().map(|s| s.is_some()).unwrap_or(false)
}

pub fn set(w: &WebviewWindow, on: bool) -> Result<bool, String> {
    let e = |x: tauri::Error| x.to_string();
    let mut saved = SAVED.lock().map_err(|x| x.to_string())?;
    if on == saved.is_some() {
        return Ok(on);
    }
    if on {
        let keep = Saved {
            pos: w.outer_position().map_err(e)?,
            size: w.inner_size().map_err(e)?,
            max: w.is_maximized().map_err(e)?,
            full: w.is_fullscreen().map_err(e)?,
        };
        if keep.full {
            w.set_fullscreen(false).map_err(e)?;
        }
        if keep.max {
            w.unmaximize().map_err(e)?;
        }
        let monitor = match w.current_monitor().map_err(e)? {
            Some(m) => Some(m),
            None => w.primary_monitor().map_err(e)?,
        };
        let scale = monitor.as_ref().map(|m| m.scale_factor()).unwrap_or(1.0);
        let width = (MINI_WIDTH * scale).round() as u32;
        let height = width * 9 / 16;
        w.set_decorations(false).map_err(e)?;
        w.set_always_on_top(true).map_err(e)?;
        w.set_min_size(Some(LogicalSize::new(MINI_WIDTH / 2.0, MINI_WIDTH * 9.0 / 32.0))).map_err(e)?;
        w.set_size(PhysicalSize::new(width, height)).map_err(e)?;
        if let Some(m) = monitor {
            let area = m.work_area();
            let margin = (MINI_MARGIN * scale).round() as i32;
            let x = area.position.x + area.size.width as i32 - width as i32 - margin;
            let y = area.position.y + area.size.height as i32 - height as i32 - margin;
            w.set_position(PhysicalPosition::new(x, y)).map_err(e)?;
        }
        *saved = Some(keep);
    } else if let Some(keep) = saved.take() {
        w.set_always_on_top(false).map_err(e)?;
        w.set_decorations(true).map_err(e)?;
        w.set_min_size(Some(LogicalSize::new(960.0, 600.0))).map_err(e)?;
        w.set_size(keep.size).map_err(e)?;
        w.set_position(keep.pos).map_err(e)?;
        if keep.max {
            w.maximize().map_err(e)?;
        }
        if keep.full {
            w.set_fullscreen(true).map_err(e)?;
        }
    }
    Ok(on)
}
