use serde::Deserialize;
use serde_json::{json, Value};
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{Manager, Runtime};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_wistv_video);

pub struct Video<R: Runtime>(PluginHandle<R>);

#[derive(Deserialize)]
struct Layer {
    pointer: i64,
}

impl<R: Runtime> Video<R> {
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
            #[cfg(not(target_os = "ios"))]
            let _ = (app, api);
            Ok(())
        })
        .build()
}
