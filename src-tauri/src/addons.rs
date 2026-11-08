use serde::{Deserialize, Serialize};
use serde_json::Value;
use urlencoding::encode;

const CINEMETA: &str = "https://v3-cinemeta.strem.io/manifest.json";

#[derive(Clone, Serialize, Deserialize)]
pub struct Addon {
    #[serde(rename = "transportUrl")]
    pub transport_url: String,
    #[serde(default)]
    pub manifest: Value,
    #[serde(default)]
    pub flags: Value,
}

fn strs(v: &Value) -> Option<Vec<&str>> {
    v.as_array().map(|a| a.iter().filter_map(|x| x.as_str()).collect())
}

impl Addon {
    pub fn base(&self) -> String {
        let url = self.transport_url.trim();
        url.strip_suffix("/manifest.json")
            .unwrap_or(url)
            .trim_end_matches('/')
            .to_string()
    }

    pub fn name(&self) -> String {
        self.manifest["name"]
            .as_str()
            .map(str::to_string)
            .unwrap_or_else(|| self.base())
    }

    pub fn supports(&self, resource: &str, kind: &str, id: &str) -> bool {
        let m = &self.manifest;
        let Some(resources) = m["resources"].as_array() else {
            return false;
        };
        for r in resources {
            let (name, types, prefixes) = match r {
                Value::String(s) => (s.as_str(), strs(&m["types"]), strs(&m["idPrefixes"])),
                Value::Object(o) => (
                    o.get("name").and_then(|n| n.as_str()).unwrap_or(""),
                    o.get("types").and_then(strs).or_else(|| strs(&m["types"])),
                    o.get("idPrefixes").and_then(strs).or_else(|| strs(&m["idPrefixes"])),
                ),
                _ => continue,
            };
            if name != resource {
                continue;
            }
            let type_ok = types.map(|t| t.contains(&kind)).unwrap_or(false);
            let id_ok = prefixes
                .map(|p| p.iter().any(|pre| id.starts_with(pre)))
                .unwrap_or(true);
            if type_ok && id_ok {
                return true;
            }
        }
        false
    }

    pub fn resource_url(&self, resource: &str, kind: &str, id: &str, extra: &[(String, String)]) -> String {
        format!(
            "{}/{}/{}/{}{}.json",
            self.base(),
            resource,
            encode(kind),
            encode(id),
            extra_path(extra)
        )
    }
}

pub fn extra_path(extra: &[(String, String)]) -> String {
    if extra.is_empty() {
        return String::new();
    }
    let parts: Vec<String> = extra
        .iter()
        .map(|(k, v)| format!("{}={}", encode(k), encode(v)))
        .collect();
    format!("/{}", parts.join("&"))
}

pub async fn get_json(http: &reqwest::Client, url: &str) -> Result<Value, String> {
    let resp = http.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.json().await.map_err(|e| e.to_string())
}

pub async fn guest(http: &reqwest::Client) -> Result<Vec<Addon>, String> {
    let manifest = get_json(http, CINEMETA).await?;
    Ok(vec![Addon {
        transport_url: CINEMETA.to_string(),
        manifest,
        flags: serde_json::json!({ "official": true, "protected": true }),
    }])
}
