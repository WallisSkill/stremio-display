use crate::addons::Addon;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
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
    #[cfg_attr(not(target_os = "ios"), allow(dead_code))]
    pub cache_dir: PathBuf,
    pub session: Mutex<Option<Session>>,
    pub addons: Mutex<Vec<Addon>>,
    pub library: Mutex<Vec<Value>>,
    pub profile: Mutex<crate::api::Profile>,
    pub player: crate::player::Player,
}

impl AppState {
    pub fn load(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let data_dir = app.path().app_data_dir()?;
        fs::create_dir_all(&data_dir)?;
        let cache_dir = app.path().app_cache_dir().unwrap_or_else(|_| data_dir.join("cache"));
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
        let profile = session
            .as_ref()
            .and_then(|s| {
                let saved: Value = serde_json::from_slice(&fs::read(data_dir.join("profile.json")).ok()?).ok()?;
                let id = saved["id"].as_str()?.to_string();
                let token = saved["token"].as_str().unwrap_or_default().to_string();
                (saved["user"] == s.user["_id"]).then_some(crate::api::Profile { id, token })
            })
            .unwrap_or_else(crate::api::Profile::main);
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(25))
            .user_agent("WiSTV/0.1")
            .build()?;
        Ok(Self {
            http,
            data_dir,
            cache_dir,
            session: Mutex::new(session),
            addons: Mutex::new(Vec::new()),
            library: Mutex::new(Vec::new()),
            profile: Mutex::new(profile),
            player: crate::player::Player::new(),
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
        *self.profile.lock().unwrap() = crate::api::Profile::main();
        let _ = fs::remove_file(self.data_dir.join("profile.json"));
        Ok(())
    }

    pub fn profile(&self) -> crate::api::Profile {
        self.profile.lock().unwrap().clone()
    }

    pub fn set_profile(&self, p: crate::api::Profile) -> Result<(), String> {
        let user = self.session.lock().unwrap().as_ref().map(|s| s.user["_id"].clone()).ok_or("Chưa đăng nhập")?;
        let bytes = serde_json::to_vec(&serde_json::json!({ "user": user, "id": p.id, "token": p.token })).map_err(|e| e.to_string())?;
        fs::write(self.data_dir.join("profile.json"), bytes).map_err(|e| e.to_string())?;
        *self.profile.lock().unwrap() = p;
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
