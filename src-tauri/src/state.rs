use crate::addons::Addon;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager};

#[derive(Clone, Serialize, Deserialize)]
pub struct Session {
    pub auth_key: String,
    pub user: Value,
}

pub fn slim_user(user: &Value) -> Value {
    let mut out = serde_json::Map::new();
    for key in ["_id", "email", "fullname", "avatar"] {
        if let Some(v) = user.get(key) {
            out.insert(key.to_string(), v.clone());
        }
    }
    Value::Object(out)
}

pub struct AppState {
    pub http: reqwest::Client,
    pub data_dir: PathBuf,
    pub session: Mutex<Option<Session>>,
    pub addons: Mutex<Vec<Addon>>,
    pub library: Mutex<Vec<Value>>,
    pub player_stop: Mutex<Option<Arc<AtomicBool>>>,
}

impl AppState {
    pub fn load(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let data_dir = app.path().app_data_dir()?;
        fs::create_dir_all(&data_dir)?;
        let session = fs::read(data_dir.join("session.json"))
            .ok()
            .and_then(|b| serde_json::from_slice::<Session>(&b).ok())
            .map(|s| Session {
                user: slim_user(&s.user),
                auth_key: s.auth_key,
            });
        if let Some(s) = &session {
            if let Ok(bytes) = serde_json::to_vec(s) {
                let _ = fs::write(data_dir.join("session.json"), bytes);
            }
        }
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(25))
            .user_agent("WiSTV/0.1")
            .build()?;
        Ok(Self {
            http,
            data_dir,
            session: Mutex::new(session),
            addons: Mutex::new(Vec::new()),
            library: Mutex::new(Vec::new()),
            player_stop: Mutex::new(None),
        })
    }

    pub fn auth_key(&self) -> Option<String> {
        self.session.lock().unwrap().as_ref().map(|s| s.auth_key.clone())
    }

    pub fn set_session(&self, s: Option<Session>) -> Result<(), String> {
        let s = s.map(|s| Session {
            user: slim_user(&s.user),
            auth_key: s.auth_key,
        });
        let file = self.data_dir.join("session.json");
        match &s {
            Some(s) => {
                let bytes = serde_json::to_vec(s).map_err(|e| e.to_string())?;
                fs::write(&file, bytes).map_err(|e| e.to_string())?;
            }
            None => {
                let _ = fs::remove_file(&file);
            }
        }
        *self.session.lock().unwrap() = s;
        self.addons.lock().unwrap().clear();
        self.library.lock().unwrap().clear();
        Ok(())
    }

    pub fn cache_library_item(&self, item: &Value) {
        let mut lib = self.library.lock().unwrap();
        match lib.iter_mut().find(|i| i["_id"] == item["_id"]) {
            Some(slot) => *slot = item.clone(),
            None => lib.push(item.clone()),
        }
    }
}
