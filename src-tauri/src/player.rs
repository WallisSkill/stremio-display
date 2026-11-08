use crate::server::stremio_dirs;
use libloading::os::windows::{Library, LOAD_WITH_ALTERED_SEARCH_PATH};
use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::path::PathBuf;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

const EVENT_SHUTDOWN: c_int = 1;
const EVENT_END_FILE: c_int = 7;
const END_REASON_EOF: c_int = 0;
const END_REASON_ERROR: c_int = 4;

#[repr(C)]
struct MpvEvent {
    event_id: c_int,
    error: c_int,
    reply_userdata: u64,
    data: *mut c_void,
}

#[repr(C)]
struct MpvEndFile {
    reason: c_int,
    error: c_int,
}

type Handle = *mut c_void;

struct Mpv {
    _lib: Library,
    create: unsafe extern "C" fn() -> Handle,
    initialize: unsafe extern "C" fn(Handle) -> c_int,
    set_option_string: unsafe extern "C" fn(Handle, *const c_char, *const c_char) -> c_int,
    command: unsafe extern "C" fn(Handle, *mut *const c_char) -> c_int,
    get_property_string: unsafe extern "C" fn(Handle, *const c_char) -> *mut c_char,
    free: unsafe extern "C" fn(*mut c_void),
    wait_event: unsafe extern "C" fn(Handle, f64) -> *mut MpvEvent,
    error_string: unsafe extern "C" fn(c_int) -> *const c_char,
    terminate_destroy: unsafe extern "C" fn(Handle),
}

fn candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(p) = std::env::var("WISTV_LIBMPV") {
        out.push(PathBuf::from(p));
    }
    if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(PathBuf::from)) {
        out.push(dir.join("libmpv-2.dll"));
    }
    out.extend(stremio_dirs().into_iter().map(|d| d.join("libmpv-2.dll")));
    out
}

impl Mpv {
    fn load() -> Result<Self, String> {
        let path = candidates()
            .into_iter()
            .find(|p| p.is_file())
            .ok_or("Không tìm thấy libmpv-2.dll (cài Stremio hoặc đặt WISTV_LIBMPV)")?;
        unsafe {
            let lib = Library::load_with_flags(&path, LOAD_WITH_ALTERED_SEARCH_PATH)
                .map_err(|e| format!("Không nạp được {}: {e}", path.display()))?;
            macro_rules! sym {
                ($name:literal, $t:ty) => {
                    *lib.get::<$t>(concat!($name, "\0").as_bytes())
                        .map_err(|e| format!("libmpv thiếu {}: {e}", $name))?
                };
            }
            Ok(Self {
                create: sym!("mpv_create", unsafe extern "C" fn() -> Handle),
                initialize: sym!("mpv_initialize", unsafe extern "C" fn(Handle) -> c_int),
                set_option_string: sym!(
                    "mpv_set_option_string",
                    unsafe extern "C" fn(Handle, *const c_char, *const c_char) -> c_int
                ),
                command: sym!("mpv_command", unsafe extern "C" fn(Handle, *mut *const c_char) -> c_int),
                get_property_string: sym!(
                    "mpv_get_property_string",
                    unsafe extern "C" fn(Handle, *const c_char) -> *mut c_char
                ),
                free: sym!("mpv_free", unsafe extern "C" fn(*mut c_void)),
                wait_event: sym!("mpv_wait_event", unsafe extern "C" fn(Handle, f64) -> *mut MpvEvent),
                error_string: sym!("mpv_error_string", unsafe extern "C" fn(c_int) -> *const c_char),
                terminate_destroy: sym!("mpv_terminate_destroy", unsafe extern "C" fn(Handle)),
                _lib: lib,
            })
        }
    }

    unsafe fn set(&self, ctx: Handle, key: &str, value: &str) {
        let (Ok(k), Ok(v)) = (CString::new(key), CString::new(value)) else {
            return;
        };
        (self.set_option_string)(ctx, k.as_ptr(), v.as_ptr());
    }

    unsafe fn cmd(&self, ctx: Handle, args: &[&str]) -> c_int {
        let owned: Vec<CString> = args.iter().filter_map(|a| CString::new(*a).ok()).collect();
        let mut ptrs: Vec<*const c_char> = owned.iter().map(|c| c.as_ptr()).collect();
        ptrs.push(ptr::null());
        (self.command)(ctx, ptrs.as_mut_ptr())
    }

    unsafe fn prop_f64(&self, ctx: Handle, name: &CStr) -> Option<f64> {
        let raw = (self.get_property_string)(ctx, name.as_ptr());
        if raw.is_null() {
            return None;
        }
        let v = CStr::from_ptr(raw).to_str().ok().and_then(|s| s.parse::<f64>().ok());
        (self.free)(raw as *mut c_void);
        v
    }

    unsafe fn err(&self, code: c_int) -> String {
        let p = (self.error_string)(code);
        if p.is_null() {
            return format!("mpv lỗi {code}");
        }
        CStr::from_ptr(p).to_string_lossy().into_owned()
    }
}

pub struct Request {
    pub url: String,
    pub title: String,
    pub start_ms: u64,
    pub headers: Vec<String>,
}

pub struct Outcome {
    pub position_ms: u64,
    pub duration_ms: u64,
    pub error: Option<String>,
}

pub fn play(req: Request, stop: Arc<AtomicBool>, done: impl FnOnce(Outcome) + Send + 'static) {
    std::thread::spawn(move || {
        let out = run(&req, &stop).unwrap_or_else(|e| Outcome {
            position_ms: 0,
            duration_ms: 0,
            error: Some(e),
        });
        done(out);
    });
}

fn run(req: &Request, stop: &AtomicBool) -> Result<Outcome, String> {
    let mpv = Mpv::load()?;
    unsafe {
        let ctx = (mpv.create)();
        if ctx.is_null() {
            return Err("Không tạo được trình phát mpv".into());
        }
        for (k, v) in [
            ("force-window", "yes"),
            ("fullscreen", "yes"),
            ("osc", "yes"),
            ("input-default-bindings", "yes"),
            ("input-vo-keyboard", "yes"),
            ("hwdec", "auto-safe"),
            ("ytdl", "no"),
            ("terminal", "no"),
            ("idle", "yes"),
            ("keep-open", "no"),
            ("cache", "yes"),
            ("demuxer-max-bytes", "400MiB"),
            ("osd-font", "Segoe UI"),
            ("sub-font", "Segoe UI"),
            ("slang", "vi,vie,en,eng"),
        ] {
            mpv.set(ctx, k, v);
        }
        mpv.set(ctx, "title", &format!("{} — WiS TV", req.title));
        if req.start_ms > 0 {
            mpv.set(ctx, "start", &format!("{:.3}", req.start_ms as f64 / 1000.0));
        }
        if !req.headers.is_empty() {
            mpv.set(ctx, "http-header-fields", &req.headers.join(","));
        }
        let rc = (mpv.initialize)(ctx);
        if rc < 0 {
            let e = mpv.err(rc);
            (mpv.terminate_destroy)(ctx);
            return Err(format!("mpv không khởi động được: {e}"));
        }
        let rc = mpv.cmd(ctx, &["loadfile", &req.url]);
        if rc < 0 {
            let e = mpv.err(rc);
            (mpv.terminate_destroy)(ctx);
            return Err(format!("mpv không mở được nguồn: {e}"));
        }
        let time_pos = c"time-pos";
        let duration = c"duration";
        let mut pos = req.start_ms as f64 / 1000.0;
        let mut dur = 0.0f64;
        let mut error = None;
        let mut quitting = false;
        loop {
            if !quitting && stop.load(Ordering::SeqCst) {
                quitting = true;
                mpv.cmd(ctx, &["quit"]);
            }
            let ev = (mpv.wait_event)(ctx, 0.5);
            if let Some(p) = mpv.prop_f64(ctx, time_pos) {
                pos = p;
            }
            if let Some(d) = mpv.prop_f64(ctx, duration) {
                dur = d;
            }
            if ev.is_null() {
                continue;
            }
            match (*ev).event_id {
                EVENT_SHUTDOWN => break,
                EVENT_END_FILE => {
                    let data = (*ev).data as *const MpvEndFile;
                    if !data.is_null() {
                        match (*data).reason {
                            END_REASON_EOF => pos = dur,
                            END_REASON_ERROR => error = Some(mpv.err((*data).error)),
                            _ => {}
                        }
                    }
                    break;
                }
                _ => {}
            }
        }
        (mpv.terminate_destroy)(ctx);
        Ok(Outcome {
            position_ms: (pos.max(0.0) * 1000.0) as u64,
            duration_ms: (dur.max(0.0) * 1000.0) as u64,
            error,
        })
    }
}
