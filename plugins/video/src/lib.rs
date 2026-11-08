use serde::Deserialize;
use serde_json::{json, Value};
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{Manager, Runtime};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_wistv_video);

pub struct Video<R: Runtime>(PluginHandle<R>);

#[cfg_attr(not(target_os = "ios"), allow(dead_code))]
#[derive(Deserialize)]
struct Layer {
    pointer: i64,
}

impl<R: Runtime> Video<R> {
    #[cfg(target_os = "ios")]
    pub fn layer(&self) -> Result<i64, String> {
        let layer: Layer = self.0.run_mobile_plugin("layer", json!({})).map_err(|e| e.to_string())?;
        if layer.pointer == 0 {
            return Err("Chưa có vùng hiển thị video".into());
        }
        Ok(layer.pointer)
    }

    pub fn awake(&self, on: bool) -> Result<(), String> {
        self.0
            .run_mobile_plugin::<Value>("awake", json!({ "on": on }))
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    #[cfg(target_os = "android")]
    pub fn startup_url(&self) -> Option<String> {
        let v: Value = self.0.run_mobile_plugin("startupUrl", json!({})).ok()?;
        v["url"].as_str().map(str::to_string)
    }

    pub fn landscape(&self, on: bool) -> Result<(), String> {
        self.0
            .run_mobile_plugin::<Value>("landscape", json!({ "on": on }))
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    pub fn fullscreen(&self, on: bool) -> Result<(), String> {
        self.0
            .run_mobile_plugin::<Value>("fullscreen", json!({ "on": on }))
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    pub fn layer_size(&self) -> Result<(f64, f64), String> {
        let v: Value = self.0.run_mobile_plugin("layerSize", json!({})).map_err(|e| e.to_string())?;
        Ok((v["width"].as_f64().unwrap_or(0.0), v["height"].as_f64().unwrap_or(0.0)))
    }

    pub fn battery(&self) -> Result<Value, String> {
        self.0.run_mobile_plugin::<Value>("battery", json!({})).map_err(|e| e.to_string())
    }

    pub fn open(&self, url: &str) -> Result<(), String> {
        self.0
            .run_mobile_plugin::<Value>("open", json!({ "url": url }))
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

pub trait VideoExt<R: Runtime> {
    fn video(&self) -> &Video<R>;
}

impl<R: Runtime, T: Manager<R>> VideoExt<R> for T {
    fn video(&self) -> &Video<R> {
        self.state::<Video<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("wistv-video")
        .setup(|app, api| {
            #[cfg(target_os = "ios")]
            {
                let handle = api.register_ios_plugin(init_plugin_wistv_video)?;
                app.manage(Video(handle));
            }
            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin("tv.wis.video", "VideoPlugin")?;
                app.manage(Video(handle));
            }
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            let _ = (app, api);
            Ok(())
        })
        .build()
}
