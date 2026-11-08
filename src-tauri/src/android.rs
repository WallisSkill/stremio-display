use jni::objects::{GlobalRef, JObject};
use jni::sys::jint;
use jni::JNIEnv;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Mutex;

#[derive(Clone, Copy, PartialEq, Eq)]
pub struct Surface {
    pub wid: i64,
    pub width: i32,
    pub height: i32,
}

struct Current {
    global: GlobalRef,
    surface: Surface,
}

static CURRENT: Mutex<Option<Current>> = Mutex::new(None);
static GENERATION: AtomicU64 = AtomicU64::new(0);
static VM: AtomicUsize = AtomicUsize::new(0);

#[no_mangle]
pub extern "system" fn Java_tv_wis_video_Native_surface(
    env: JNIEnv,
    _this: JObject,
    surface: JObject,
    width: jint,
    height: jint,
) {
    if let Ok(vm) = env.get_java_vm() {
        VM.store(vm.get_java_vm_pointer() as usize, Ordering::SeqCst);
    }
    let mut cur = CURRENT.lock().unwrap();
    if surface.is_null() {
        if let Some(old) = cur.take() {
            std::mem::forget(old.global);
        }
        GENERATION.fetch_add(1, Ordering::SeqCst);
        return;
    }
    if let Some(c) = cur.as_mut() {
        if env.is_same_object(c.global.as_obj(), &surface).unwrap_or(false) {
            if c.surface.width != width || c.surface.height != height {
                c.surface.width = width;
                c.surface.height = height;
                GENERATION.fetch_add(1, Ordering::SeqCst);
            }
            return;
        }
    }
    let Ok(global) = env.new_global_ref(&surface) else {
        return;
    };
    let wid = global.as_obj().as_raw() as i64;
    if let Some(old) = cur.replace(Current { global, surface: Surface { wid, width, height } }) {
        std::mem::forget(old.global);
    }
    GENERATION.fetch_add(1, Ordering::SeqCst);
}

pub fn java_vm() -> usize {
    VM.load(Ordering::SeqCst)
}

pub fn state() -> (u64, Option<Surface>) {
    let cur = CURRENT.lock().unwrap();
    (GENERATION.load(Ordering::SeqCst), cur.as_ref().map(|c| c.surface))
}
