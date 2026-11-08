#[cfg(windows)]
use libloading::os::windows::{Library, LOAD_WITH_ALTERED_SEARCH_PATH};
#[cfg(target_os = "android")]
use libloading::Library;
use serde_json::{json, Value};
use std::ffi::{c_char, c_int, c_void, CStr, CString};
#[cfg(windows)]
use std::path::PathBuf;
use std::ptr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

const EVENT_SHUTDOWN: c_int = 1;
const EVENT_END_FILE: c_int = 7;
const EVENT_FILE_LOADED: c_int = 8;
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
    #[cfg(any(windows, target_os = "android"))]
    _lib: Library,
    create: unsafe extern "C" fn() -> Handle,
    initialize: unsafe extern "C" fn(Handle) -> c_int,
    set_option_string: unsafe extern "C" fn(Handle, *const c_char, *const c_char) -> c_int,
    set_property_string: unsafe extern "C" fn(Handle, *const c_char, *const c_char) -> c_int,
    command: unsafe extern "C" fn(Handle, *mut *const c_char) -> c_int,
    get_property_string: unsafe extern "C" fn(Handle, *const c_char) -> *mut c_char,
    free: unsafe extern "C" fn(*mut c_void),
    wait_event: unsafe extern "C" fn(Handle, f64) -> *mut MpvEvent,
    error_string: unsafe extern "C" fn(c_int) -> *const c_char,
    terminate_destroy: unsafe extern "C" fn(Handle),
}

#[cfg(windows)]
fn candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(p) = std::env::var("WISTV_LIBMPV") {
        out.push(PathBuf::from(p));
    }
    if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(PathBuf::from)) {
        out.push(dir.join("libmpv-2.dll"));
    }
    out
}

#[cfg(windows)]
fn open_lib() -> Result<Library, String> {
    let path = candidates()
        .into_iter()
        .find(|p| p.is_file())
        .ok_or("Không tìm thấy libmpv-2.dll cạnh WiS TV (cài lại ứng dụng hoặc đặt WISTV_LIBMPV)")?;
    unsafe {
        Library::load_with_flags(&path, LOAD_WITH_ALTERED_SEARCH_PATH)
            .map_err(|e| format!("Không nạp được {}: {e}", path.display()))
    }
}

#[cfg(target_os = "android")]
fn open_lib() -> Result<Library, String> {
    let vm = crate::android::java_vm();
    if vm == 0 {
        return Err("Java VM chưa sẵn sàng cho trình phát".into());
    }
    unsafe {
        let avcodec = Library::new("libavcodec.so").map_err(|e| format!("Không nạp được libavcodec: {e}"))?;
        let set_vm = *avcodec
            .get::<unsafe extern "C" fn(*mut c_void, *mut c_void) -> c_int>(b"av_jni_set_java_vm\0")
            .map_err(|e| format!("libavcodec thiếu av_jni_set_java_vm: {e}"))?;
        set_vm(vm as *mut c_void, ptr::null_mut());
        std::mem::forget(avcodec);
        Library::new("libmpv.so").map_err(|e| format!("Không nạp được libmpv: {e}"))
    }
}

#[cfg(not(any(windows, target_os = "android")))]
mod linked {
    use super::{Handle, MpvEvent};
    use std::ffi::{c_char, c_int, c_void};

    extern "C" {
        pub fn mpv_create() -> Handle;
        pub fn mpv_initialize(ctx: Handle) -> c_int;
        pub fn mpv_set_option_string(ctx: Handle, name: *const c_char, data: *const c_char) -> c_int;
        pub fn mpv_set_property_string(ctx: Handle, name: *const c_char, data: *const c_char) -> c_int;
        pub fn mpv_command(ctx: Handle, args: *mut *const c_char) -> c_int;
        pub fn mpv_get_property_string(ctx: Handle, name: *const c_char) -> *mut c_char;
        pub fn mpv_free(data: *mut c_void);
        pub fn mpv_wait_event(ctx: Handle, timeout: f64) -> *mut MpvEvent;
        pub fn mpv_error_string(error: c_int) -> *const c_char;
        pub fn mpv_terminate_destroy(ctx: Handle);
    }
}

impl Mpv {
    #[cfg(not(any(windows, target_os = "android")))]
    fn load() -> Result<Self, String> {
        Ok(Self {
            create: linked::mpv_create,
            initialize: linked::mpv_initialize,
            set_option_string: linked::mpv_set_option_string,
            set_property_string: linked::mpv_set_property_string,
            command: linked::mpv_command,
            get_property_string: linked::mpv_get_property_string,
            free: linked::mpv_free,
            wait_event: linked::mpv_wait_event,
            error_string: linked::mpv_error_string,
            terminate_destroy: linked::mpv_terminate_destroy,
        })
    }

    #[cfg(any(windows, target_os = "android"))]
    fn load() -> Result<Self, String> {
        let lib = open_lib()?;
        unsafe {
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
                set_property_string: sym!(
                    "mpv_set_property_string",
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

    unsafe fn set_option(&self, ctx: Handle, key: &str, value: &str) {
        let (Ok(k), Ok(v)) = (CString::new(key), CString::new(value)) else {
            return;
        };
        (self.set_option_string)(ctx, k.as_ptr(), v.as_ptr());
    }

    unsafe fn set_property(&self, ctx: Handle, key: &str, value: &str) -> c_int {
        let (Ok(k), Ok(v)) = (CString::new(key), CString::new(value)) else {
            return -4;
        };
        (self.set_property_string)(ctx, k.as_ptr(), v.as_ptr())
    }

    unsafe fn cmd(&self, ctx: Handle, args: &[&str]) -> c_int {
        let owned: Vec<CString> = args.iter().filter_map(|a| CString::new(*a).ok()).collect();
        if owned.len() != args.len() {
            return -4;
        }
        let mut ptrs: Vec<*const c_char> = owned.iter().map(|c| c.as_ptr()).collect();
        ptrs.push(ptr::null());
        (self.command)(ctx, ptrs.as_mut_ptr())
    }

    unsafe fn prop(&self, ctx: Handle, name: &str) -> Option<String> {
        let name = CString::new(name).ok()?;
        let raw = (self.get_property_string)(ctx, name.as_ptr());
        if raw.is_null() {
            return None;
        }
        let v = CStr::from_ptr(raw).to_string_lossy().into_owned();
        (self.free)(raw as *mut c_void);
        Some(v)
    }

    unsafe fn prop_f64(&self, ctx: Handle, name: &str) -> Option<f64> {
        self.prop(ctx, name).and_then(|s| s.parse::<f64>().ok())
    }

    unsafe fn prop_flag(&self, ctx: Handle, name: &str) -> bool {
        self.prop(ctx, name).as_deref() == Some("yes")
    }

    unsafe fn err(&self, code: c_int) -> String {
        let p = (self.error_string)(code);
        if p.is_null() {
            return format!("mpv lỗi {code}");
        }
        CStr::from_ptr(p).to_string_lossy().into_owned()
    }
}

fn mpv() -> Result<&'static Mpv, String> {
    static LIB: OnceLock<Result<Mpv, String>> = OnceLock::new();
    LIB.get_or_init(Mpv::load).as_ref().map_err(Clone::clone)
}

#[cfg(windows)]
mod win {
    type Hwnd = isize;
    type EnumProc = extern "system" fn(Hwnd, isize) -> i32;

    #[link(name = "user32")]
    extern "system" {
        fn EnumChildWindows(parent: Hwnd, proc_: EnumProc, lparam: isize) -> i32;
        fn GetClassNameW(hwnd: Hwnd, buf: *mut u16, max: i32) -> i32;
        fn SetWindowPos(hwnd: Hwnd, after: Hwnd, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
        fn GetWindow(hwnd: Hwnd, cmd: u32) -> Hwnd;
    }

    const HWND_BOTTOM: Hwnd = 1;
    const GW_HWNDNEXT: u32 = 2;
    const SWP_NOSIZE: u32 = 0x1;
    const SWP_NOMOVE: u32 = 0x2;
    const SWP_NOACTIVATE: u32 = 0x10;

    extern "system" fn sink(hwnd: Hwnd, _: isize) -> i32 {
        let mut buf = [0u16; 16];
        let n = unsafe { GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
        if n > 0 && String::from_utf16_lossy(&buf[..n as usize]) == "mpv" && unsafe { GetWindow(hwnd, GW_HWNDNEXT) } != 0 {
            unsafe { SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE) };
        }
        1
    }

    pub fn video_below_ui(parent: Hwnd) {
        unsafe { EnumChildWindows(parent, sink, 0) };
    }
}

#[cfg(windows)]
const PLATFORM_OPTIONS: &[(&str, &str)] = &[("hwdec", "auto-safe"), ("sub-font", "Segoe UI Semibold")];

#[cfg(target_os = "android")]
const PLATFORM_OPTIONS: &[(&str, &str)] = &[
    ("vo", "gpu"),
    ("gpu-context", "android"),
    ("opengl-es", "yes"),
    ("hwdec", "mediacodec-copy"),
    ("ao", "audiotrack,opensles"),
    ("sub-font", "Roboto"),
    ("config", "yes"),
];

#[cfg(not(any(windows, target_os = "android")))]
const PLATFORM_OPTIONS: &[(&str, &str)] = &[
    ("vo", "gpu-next"),
    ("gpu-api", "vulkan"),
    ("gpu-context", "moltenvk"),
    ("hwdec", "videotoolbox"),
    ("video-rotate", "no"),
    ("sub-font", "Helvetica Neue"),
    ("audio-exclusive", "no"),
];

pub struct Request {
    pub url: String,
    pub title: String,
    pub start_ms: u64,
    pub headers: Vec<String>,
    pub wid: i64,
    pub extra: Vec<(String, String)>,
}

pub struct Outcome {
    pub position_ms: u64,
    pub duration_ms: u64,
    pub error: Option<String>,
    pub ended: bool,
}

struct Live {
    ctx: usize,
    generation: u64,
}

pub struct Player {
    live: Arc<Mutex<Option<Live>>>,
    generation: AtomicU64,
}

fn checked(lib: &Mpv, rc: c_int) -> Result<(), String> {
    if rc < 0 {
        Err(unsafe { lib.err(rc) })
    } else {
        Ok(())
    }
}

impl Player {
    pub fn new() -> Self {
        Self {
            live: Arc::new(Mutex::new(None)),
            generation: AtomicU64::new(0),
        }
    }

    fn with(&self, f: impl FnOnce(&Mpv, Handle) -> c_int) -> Result<(), String> {
        let lib = mpv()?;
        let live = self.live.lock().unwrap();
        let live = live.as_ref().ok_or("Trình phát chưa chạy")?;
        checked(lib, f(lib, live.ctx as Handle))
    }

    pub fn command(&self, args: &[String]) -> Result<(), String> {
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        self.with(|m, ctx| unsafe { m.cmd(ctx, &refs) })
    }

    pub fn set(&self, name: &str, value: &str) -> Result<(), String> {
        self.with(|m, ctx| unsafe { m.set_property(ctx, name, value) })
    }

    pub fn stop(&self) {
        let _ = self.command(&["quit".to_string()]);
    }

    pub fn start(
        &self,
        req: Request,
        state: impl Fn(Value) + Send + 'static,
        done: impl FnOnce(Outcome) + Send + 'static,
    ) -> Result<(), String> {
        self.stop();
        let lib = mpv()?;
        let ctx = unsafe { (lib.create)() };
        if ctx.is_null() {
            return Err("Không tạo được trình phát mpv".into());
        }
        let wid = req.wid.to_string();
        unsafe {
            for (k, v) in [
                ("wid", wid.as_str()),
                ("force-window", "yes"),
                ("keepaspect", "yes"),
                ("osc", "no"),
                ("osd-level", "0"),
                ("input-default-bindings", "no"),
                ("input-vo-keyboard", "no"),
                ("input-cursor", "no"),
                ("cursor-autohide", "no"),
                ("ytdl", "no"),
                ("terminal", "no"),
                ("idle", "yes"),
                ("keep-open", "no"),
                ("cache", "yes"),
                ("demuxer-max-bytes", "400MiB"),
                ("demuxer-max-back-bytes", "100MiB"),
                ("sub-font-size", "44"),
                ("sub-border-size", "2.4"),
                ("sub-shadow-offset", "1"),
                ("sub-margin-y", "60"),
                ("slang", "vi,vie,vn,en,eng"),
                ("alang", "vi,vie,ja,jpn,en,eng"),
                ("volume-max", "150"),
            ] {
                lib.set_option(ctx, k, v);
            }
            for (k, v) in PLATFORM_OPTIONS {
                lib.set_option(ctx, k, v);
            }
            for (k, v) in &req.extra {
                lib.set_option(ctx, k, v);
            }
            lib.set_option(ctx, "title", &req.title);
            if req.start_ms > 0 {
                lib.set_option(ctx, "start", &format!("{:.3}", req.start_ms as f64 / 1000.0));
            }
            if !req.headers.is_empty() {
                lib.set_option(ctx, "http-header-fields", &req.headers.join(","));
            }
            let rc = (lib.initialize)(ctx);
            if rc < 0 {
                let e = lib.err(rc);
                (lib.terminate_destroy)(ctx);
                return Err(format!("mpv không khởi động được: {e}"));
            }
            let rc = lib.cmd(ctx, &["loadfile", &req.url]);
            if rc < 0 {
                let e = lib.err(rc);
                (lib.terminate_destroy)(ctx);
                return Err(format!("mpv không mở được nguồn: {e}"));
            }
        }
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        *self.live.lock().unwrap() = Some(Live {
            ctx: ctx as usize,
            generation,
        });
        let ctx_addr = ctx as usize;
        let start_ms = req.start_ms;
        let wid = req.wid;
        let shared = self.live.clone();
        std::thread::spawn(move || {
            let ctx = ctx_addr as Handle;
            let out = unsafe { run(lib, ctx, start_ms, wid, &state) };
            {
                let mut live = shared.lock().unwrap();
                if live.as_ref().map(|l| l.generation) == Some(generation) {
                    *live = None;
                }
            }
            unsafe { (lib.terminate_destroy)(ctx) };
            done(out);
        });
        Ok(())
    }
}

unsafe fn tracks(lib: &Mpv, ctx: Handle) -> Vec<Value> {
    let n = lib.prop(ctx, "track-list/count").and_then(|s| s.parse::<usize>().ok()).unwrap_or(0);
    (0..n)
        .map(|i| {
            let p = |k: &str| lib.prop(ctx, &format!("track-list/{i}/{k}"));
            json!({
                "id": p("id").and_then(|s| s.parse::<i64>().ok()),
                "type": p("type"),
                "title": p("title"),
                "lang": p("lang"),
                "codec": p("codec"),
                "channels": p("demux-channel-count"),
                "external": p("external").as_deref() == Some("yes"),
                "selected": p("selected").as_deref() == Some("yes"),
            })
        })
        .collect()
}

#[cfg(target_os = "android")]
unsafe fn follow_surface(lib: &Mpv, ctx: Handle, seen: &mut (u64, i64)) {
    let (generation, current) = crate::android::state();
    if generation == seen.0 {
        return;
    }
    seen.0 = generation;
    match current {
        Some(s) => {
            lib.set_property(ctx, "android-surface-size", &format!("{}x{}", s.width, s.height));
            if s.wid != seen.1 {
                seen.1 = s.wid;
                lib.set_property(ctx, "wid", &s.wid.to_string());
                lib.set_property(ctx, "force-window", "yes");
                lib.set_property(ctx, "vo", "gpu");
            }
        }
        None => {
            seen.1 = 0;
            lib.set_property(ctx, "vo", "null");
            lib.set_property(ctx, "force-window", "no");
            lib.set_property(ctx, "wid", "0");
        }
    }
}

unsafe fn run(lib: &Mpv, ctx: Handle, start_ms: u64, wid: i64, state: &dyn Fn(Value)) -> Outcome {
    let mut pos = start_ms as f64 / 1000.0;
    let mut dur = 0.0f64;
    let mut error = None;
    let mut ended = false;
    let mut last_emit = Instant::now() - Duration::from_secs(1);
    let mut last_tracks = String::new();
    let mut loaded = false;
    #[cfg(target_os = "android")]
    let mut surface = (u64::MAX, wid);
    loop {
        let ev = (lib.wait_event)(ctx, 0.2);
        #[cfg(windows)]
        win::video_below_ui(wid as isize);
        #[cfg(target_os = "android")]
        follow_surface(lib, ctx, &mut surface);
        #[cfg(not(any(windows, target_os = "android")))]
        let _ = wid;
        if let Some(p) = lib.prop_f64(ctx, "time-pos") {
            pos = p;
        }
        if let Some(d) = lib.prop_f64(ctx, "duration") {
            dur = d;
        }
        let mut stop = false;
        if !ev.is_null() {
            match (*ev).event_id {
                EVENT_SHUTDOWN => stop = true,
                EVENT_FILE_LOADED => loaded = true,
                EVENT_END_FILE => {
                    let data = (*ev).data as *const MpvEndFile;
                    if !data.is_null() {
                        match (*data).reason {
                            END_REASON_EOF => {
                                pos = dur;
                                ended = true;
                            }
                            END_REASON_ERROR => error = Some(lib.err((*data).error)),
                            _ => {}
                        }
                    }
                    stop = true;
                }
                _ => {}
            }
        }
        if stop {
            break;
        }
        if last_emit.elapsed() >= Duration::from_millis(240) {
            last_emit = Instant::now();
            let mut s = json!({
                "loaded": loaded,
                "time": pos,
                "duration": dur,
                "paused": lib.prop_flag(ctx, "pause"),
                "buffering": lib.prop_flag(ctx, "paused-for-cache") || lib.prop_flag(ctx, "seeking") || !loaded,
                "cache": lib.prop_f64(ctx, "demuxer-cache-time"),
                "cachePercent": lib.prop_f64(ctx, "cache-buffering-state"),
                "volume": lib.prop_f64(ctx, "volume"),
                "mute": lib.prop_flag(ctx, "mute"),
                "speed": lib.prop_f64(ctx, "speed"),
                "sid": lib.prop(ctx, "sid"),
                "aid": lib.prop(ctx, "aid"),
                "subDelay": lib.prop_f64(ctx, "sub-delay"),
            });
            let sig = format!(
                "{}|{}|{}",
                lib.prop(ctx, "track-list/count").unwrap_or_default(),
                lib.prop(ctx, "sid").unwrap_or_default(),
                lib.prop(ctx, "aid").unwrap_or_default()
            );
            if sig != last_tracks {
                last_tracks = sig;
                s["tracks"] = Value::Array(tracks(lib, ctx));
            }
            state(s);
        }
    }
    Outcome {
        position_ms: (pos.max(0.0) * 1000.0) as u64,
        duration_ms: (dur.max(0.0) * 1000.0) as u64,
        error,
        ended,
    }
}
