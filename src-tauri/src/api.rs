use crate::addons::Addon;
use serde_json::{json, Value};

const API: &str = "https://api.strem.io/api/";

async fn call(http: &reqwest::Client, method: &str, body: Value) -> Result<Value, String> {
    let resp = http
        .post(format!("{API}{method}"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Không kết nối được Stremio: {e}"))?;
    let v: Value = resp
        .json()
        .await
        .map_err(|e| format!("Phản hồi Stremio không hợp lệ: {e}"))?;
    if let Some(err) = v.get("error").filter(|e| !e.is_null()) {
        let msg = err["message"].as_str().unwrap_or("Lỗi API Stremio");
        return Err(msg.to_string());
    }
    v.get("result")
        .cloned()
        .ok_or_else(|| "Stremio trả về rỗng".to_string())
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
    serde_json::from_value(res["addons"].clone()).map_err(|e| format!("Danh sách addon lỗi: {e}"))
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

pub async fn library_get(http: &reqwest::Client, auth_key: &str) -> Result<Vec<Value>, String> {
    let res = call(
        http,
        "datastoreGet",
        json!({ "authKey": auth_key, "collection": "libraryItem", "ids": [], "all": true }),
    )
    .await?;
    Ok(res.as_array().cloned().unwrap_or_default())
}

pub async fn library_put(http: &reqwest::Client, auth_key: &str, item: &Value) -> Result<(), String> {
    call(
        http,
        "datastorePut",
        json!({ "authKey": auth_key, "collection": "libraryItem", "changes": [item] }),
    )
    .await
    .map(|_| ())
}
