use crate::addons::Addon;
use serde_json::{json, Value};

const API: &str = "https://api.strem.io/api/";
const PROFILE_API: &str = "https://film.wis237.online/api/profile/";
const ROOM_API: &str = "https://film.wis237.online/api/room/";
pub const MAIN_PROFILE: &str = "main";

#[derive(Clone, Default)]
pub struct Profile {
    pub id: String,
    pub token: String,
}

impl Profile {
    pub fn main() -> Self {
        Profile { id: MAIN_PROFILE.to_string(), token: String::new() }
    }
}

async fn call(http: &reqwest::Client, method: &str, body: Value) -> Result<Value, String> {
    call_at(http, API, "who.stremio", method, body).await
}

async fn call_at(http: &reqwest::Client, base: &str, who: &str, method: &str, body: Value) -> Result<Value, String> {
    let resp = http
        .post(format!("{base}{method}"))
        .json(&body)
        .send()
        .await
        .map_err(|e| crate::util::msg_with("err.connect", &[("who", who.to_string()), ("e", e.to_string())]))?;
    let v: Value = resp
        .json()
        .await
        .map_err(|e| crate::util::msg_with("err.badReply", &[("who", who.to_string()), ("e", e.to_string())]))?;
    if let Some(err) = v.get("error").filter(|e| !e.is_null()) {
        return Err(err["message"].as_str().or_else(|| err.as_str()).map(String::from).unwrap_or_else(|| crate::util::msg("err.server")));
    }
    v.get("result")
        .cloned()
        .ok_or_else(|| crate::util::msg_with("err.empty", &[("who", who.to_string())]))
}

async fn datastore(http: &reqwest::Client, profile: &Profile, method: &str, mut body: Value) -> Result<Value, String> {
    if profile.id == MAIN_PROFILE {
        return call(http, method, body).await;
    }
    body["profile"] = json!(profile.id);
    body["token"] = json!(profile.token);
    call_at(http, PROFILE_API, "who.profiles", method, body).await
}

pub async fn profiles_get(http: &reqwest::Client, auth_key: &str) -> Result<Vec<Value>, String> {
    let res = call_at(http, PROFILE_API, "who.profiles", "profilesGet", json!({ "authKey": auth_key })).await?;
    Ok(res.as_array().cloned().unwrap_or_default())
}

pub async fn profiles_set(http: &reqwest::Client, auth_key: &str, profiles: &Value, tokens: &Value) -> Result<Vec<Value>, String> {
    let body = json!({ "authKey": auth_key, "profiles": profiles, "tokens": tokens });
    let res = call_at(http, PROFILE_API, "who.profiles", "profilesSet", body).await?;
    Ok(res.as_array().cloned().unwrap_or_default())
}

pub async fn prefs_get(http: &reqwest::Client, auth_key: &str, profile: &Profile) -> Result<Value, String> {
    let body = json!({ "authKey": auth_key, "profile": profile.id, "token": profile.token });
    call_at(http, PROFILE_API, "who.profiles", "prefsGet", body).await
}

pub async fn prefs_set(http: &reqwest::Client, auth_key: &str, profile: &Profile, prefs: &Value) -> Result<(), String> {
    let body = json!({ "authKey": auth_key, "profile": profile.id, "token": profile.token, "prefs": prefs });
    call_at(http, PROFILE_API, "who.profiles", "prefsSet", body).await.map(|_| ())
}

pub async fn room_create(http: &reqwest::Client, auth_key: &str) -> Result<Value, String> {
    call_at(http, ROOM_API, "who.rooms", "create", json!({ "authKey": auth_key })).await
}

pub async fn profile_unlock(http: &reqwest::Client, auth_key: &str, id: &str, pin: &str) -> Result<String, String> {
    let body = json!({ "authKey": auth_key, "profile": id, "pin": pin });
    let res = call_at(http, PROFILE_API, "who.profiles", "profileUnlock", body).await?;
    Ok(res["token"].as_str().unwrap_or_default().to_string())
}

pub async fn login(http: &reqwest::Client, email: &str, password: &str) -> Result<Value, String> {
    call(
        http,
        "login",
        json!({ "type": "Login", "email": email, "password": password, "facebook": false }),
    )
    .await
}

pub async fn logout(http: &reqwest::Client, auth_key: &str) -> Result<Value, String> {
    call(http, "logout", json!({ "type": "Logout", "authKey": auth_key })).await
}

pub async fn addon_collection(http: &reqwest::Client, auth_key: &str) -> Result<Vec<Addon>, String> {
    let res = call(
        http,
        "addonCollectionGet",
        json!({ "type": "AddonCollectionGet", "authKey": auth_key, "update": true }),
    )
    .await?;
    serde_json::from_value(res["addons"].clone()).map_err(|e| crate::util::msg_with("err.addonList", &[("e", e.to_string())]))
}

pub async fn addon_collection_raw(http: &reqwest::Client, auth_key: &str) -> Result<Vec<Value>, String> {
    let res = call(
        http,
        "addonCollectionGet",
        json!({ "type": "AddonCollectionGet", "authKey": auth_key, "update": true }),
    )
    .await?;
    Ok(res["addons"].as_array().cloned().unwrap_or_default())
}

pub async fn addon_collection_set(http: &reqwest::Client, auth_key: &str, addons: &[Value]) -> Result<(), String> {
    call(
        http,
        "addonCollectionSet",
        json!({ "type": "AddonCollectionSet", "authKey": auth_key, "addons": addons }),
    )
    .await
    .map(|_| ())
}

pub async fn library_get(http: &reqwest::Client, auth_key: &str, profile: &Profile) -> Result<Vec<Value>, String> {
    let res = datastore(
        http,
        profile,
        "datastoreGet",
        json!({ "authKey": auth_key, "collection": "libraryItem", "ids": [], "all": true }),
    )
    .await?;
    Ok(res.as_array().cloned().unwrap_or_default())
}

pub async fn library_get_one(http: &reqwest::Client, auth_key: &str, profile: &Profile, id: &str) -> Result<Option<Value>, String> {
    let res = datastore(
        http,
        profile,
        "datastoreGet",
        json!({ "authKey": auth_key, "collection": "libraryItem", "ids": [id], "all": false }),
    )
    .await?;
    Ok(res
        .as_array()
        .and_then(|a| a.iter().find(|i| i["_id"].as_str() == Some(id)).cloned()))
}

pub async fn library_put(http: &reqwest::Client, auth_key: &str, profile: &Profile, item: &Value) -> Result<(), String> {
    datastore(
        http,
        profile,
        "datastorePut",
        json!({ "authKey": auth_key, "collection": "libraryItem", "changes": [item] }),
    )
    .await
    .map(|_| ())
}
