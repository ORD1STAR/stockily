//! Stockily desktop shell.
//!
//! Boot: fingerprint this PC -> load the DPAPI-sealed license -> verify it
//! (RS256 signature with the compiled-in public key, and bound to this
//! hardware) -> if online, renew it (the server can refuse: deactivated,
//! revoked) -> start the local runtime -> show the app. No valid license
//! for this machine = only the activation screen, never the app.

mod dpapi;
mod fingerprint;
mod license;
mod runtime;

use fingerprint::Fingerprint;
use serde::Serialize;
use std::{
    path::PathBuf,
    process::Child,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Manager, RunEvent, State, Url};

const RENEW_EVERY: Duration = Duration::from_secs(6 * 60 * 60);

struct Shared {
    remote_origin: String,
    data_dir: PathBuf,
    runtime_dir: PathBuf,
    license_path: PathBuf,
    control_secret: String,
    port: u16,
    fingerprint: Mutex<Option<Fingerprint>>,
    license: Mutex<Option<String>>,
    child: Mutex<Option<Child>>,
    /// Credentials typed at activation, used once to sign the user straight
    /// into the app after the first start. Never written to disk.
    pending_credentials: Mutex<Option<(String, String)>>,
}

type AppState = Arc<Shared>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BootState {
    /// "activate" (show the sign-in form) or "start" (license OK).
    state: &'static str,
    message: Option<String>,
    device_label: String,
    offline: bool,
    read_only: bool,
}

fn device_label() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_else(|_| "Poste".into())
}

fn fingerprint(s: &Shared) -> Result<Fingerprint, String> {
    let mut cached = s.fingerprint.lock().unwrap();
    if cached.is_none() {
        *cached = Some(fingerprint::collect()?);
    }
    Ok(cached.clone().unwrap())
}

fn server_message(body: &serde_json::Value, fallback: &str) -> String {
    match &body["message"] {
        serde_json::Value::String(m) => m.clone(),
        serde_json::Value::Array(a) => a.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join(", "),
        _ => fallback.to_string(),
    }
}

enum RenewError {
    /// Server reachable and said no (deactivated, revoked, other machine).
    Rejected(String),
    Offline,
}

async fn renew(s: &Shared, token: &str, fp: &Fingerprint) -> Result<String, RenewError> {
    let mut body = serde_json::to_value(fp).unwrap();
    body["licenseToken"] = token.into();
    let r = reqwest::Client::new()
        .post(format!("{}/api/licensing/renew", s.remote_origin))
        .json(&body)
        .timeout(Duration::from_secs(8))
        .send()
        .await
        .map_err(|_| RenewError::Offline)?;
    let status = r.status();
    let json: serde_json::Value = r.json().await.unwrap_or_default();
    if status.is_success() {
        let new = json["licenseToken"].as_str().ok_or(RenewError::Offline)?.to_string();
        license::verify(&new, fp).map_err(RenewError::Rejected)?;
        return Ok(new);
    }
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return Err(RenewError::Rejected(server_message(&json, "Licence refusée par le serveur.")));
    }
    Err(RenewError::Offline) // 5xx, maintenance: keep working on the stored license
}

#[tauri::command]
async fn boot(s: State<'_, AppState>) -> Result<BootState, String> {
    let fp = fingerprint(&s)?;
    let activate = |message: Option<String>| BootState { state: "activate", message, device_label: device_label(), offline: false, read_only: false };

    let Some(token) = license::load(&s.license_path) else { return Ok(activate(None)) };
    let claims = match license::verify(&token, &fp) {
        Ok(c) => c,
        Err(e) => {
            license::remove(&s.license_path);
            return Ok(activate(Some(e)));
        }
    };
    match renew(&s, &token, &fp).await {
        Ok(new) => {
            license::save(&s.license_path, &new)?;
            *s.license.lock().unwrap() = Some(new);
            Ok(BootState { state: "start", message: None, device_label: device_label(), offline: false, read_only: false })
        }
        Err(RenewError::Rejected(msg)) => {
            license::remove(&s.license_path);
            Ok(activate(Some(msg)))
        }
        Err(RenewError::Offline) => {
            *s.license.lock().unwrap() = Some(token);
            Ok(BootState { state: "start", message: None, device_label: device_label(), offline: true, read_only: claims.expired() })
        }
    }
}

#[tauri::command]
async fn activate(email: String, password: String, label: String, s: State<'_, AppState>) -> Result<(), String> {
    let fp = fingerprint(&s)?;
    let client = reqwest::Client::new();
    let unreachable = |_| "Connexion au serveur Stockily impossible. L'activation nécessite internet (une seule fois).".to_string();

    let r = client
        .post(format!("{}/api/auth/login", s.remote_origin))
        .json(&serde_json::json!({ "email": email, "password": password }))
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(unreachable)?;
    let status = r.status();
    let json: serde_json::Value = r.json().await.unwrap_or_default();
    if !status.is_success() {
        return Err(server_message(&json, "Connexion refusée."));
    }
    let access = json["accessToken"].as_str().ok_or("Réponse du serveur inattendue.")?.to_string();

    let mut body = serde_json::to_value(&fp).unwrap();
    body["deviceLabel"] = label.trim().chars().take(100).collect::<String>().into();
    let r = client
        .post(format!("{}/api/licensing/activate", s.remote_origin))
        .bearer_auth(access)
        .json(&body)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(unreachable)?;
    let status = r.status();
    let json: serde_json::Value = r.json().await.unwrap_or_default();
    if !status.is_success() {
        return Err(server_message(&json, "Activation refusée."));
    }
    let token = json["licenseToken"].as_str().ok_or("Réponse du serveur inattendue.")?.to_string();
    license::verify(&token, &fp)?;
    license::save(&s.license_path, &token)?;
    *s.license.lock().unwrap() = Some(token);
    *s.pending_credentials.lock().unwrap() = Some((email, password));
    Ok(())
}

#[tauri::command]
async fn start(app: AppHandle, s: State<'_, AppState>) -> Result<(), String> {
    let token = s.license.lock().unwrap().clone().ok_or("Aucune licence.")?;
    let already = s.child.lock().unwrap().is_some();
    if !already {
        let cfg = runtime::RuntimeConfig {
            runtime_dir: s.runtime_dir.clone(),
            data_dir: s.data_dir.clone(),
            port: s.port,
            license_token: token,
            remote_origin: s.remote_origin.clone(),
            control_secret: s.control_secret.clone(),
            public_key_pem: license::PUBLIC_KEY_PEM.to_string(),
        };
        let mut child = runtime::spawn(&cfg)?;
        // First start: database init + the whole organisation downloaded.
        let ready = runtime::wait_ready(s.port, &s.control_secret, &mut child, Duration::from_secs(600)).await;
        if let Err(e) = ready {
            runtime::stop(child);
            return Err(e);
        }
        *s.child.lock().unwrap() = Some(child);
        spawn_renewal(s.inner().clone());
    }

    // Right after activation: sign in locally once and hand the session to the
    // web app in the URL fragment (never sent over the network; the app stores
    // it and clears the address bar before rendering — see apps/web main.tsx).
    let mut fragment = String::new();
    let creds = s.pending_credentials.lock().unwrap().take();
    if let Some((email, password)) = creds {
        let r = reqwest::Client::builder()
            .no_proxy()
            .build()
            .map_err(|e| e.to_string())?
            .post(format!("http://127.0.0.1:{}/api/auth/login", s.port))
            .json(&serde_json::json!({ "email": email, "password": password }))
            .send()
            .await;
        if let Ok(r) = r {
            let json: serde_json::Value = r.json().await.unwrap_or_default();
            if let Some(rt) = json["refreshToken"].as_str().filter(|t| t.chars().all(|c| c.is_ascii_hexdigit())) {
                fragment = format!("#stockily-rt={rt}");
            }
        }
    }

    let url = Url::parse(&format!("http://127.0.0.1:{}/dashboard{fragment}", s.port)).unwrap();
    app.get_webview_window("main").ok_or("Fenêtre introuvable.")?.navigate(url).map_err(|e| e.to_string())
}

/// Keeps the 45-day window rolling whenever the PC is online. A refusal
/// (device deactivated/revoked) is left to the local API, which already
/// switches to read-only when the server tells it so.
fn spawn_renewal(s: AppState) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(RENEW_EVERY).await;
            let (Some(token), Ok(fp)) = (s.license.lock().unwrap().clone(), fingerprint(&s)) else { continue };
            if let Ok(new) = renew(&s, &token, &fp).await {
                if license::save(&s.license_path, &new).is_ok() {
                    *s.license.lock().unwrap() = Some(new.clone());
                    runtime::push_license(s.port, &s.control_secret, &new).await;
                }
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // Two copies would fight over the same local database.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .setup(|app| {
            let data_dir = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let remote_origin = std::env::var("STOCKILY_REMOTE_ORIGIN")
                .unwrap_or_else(|_| env!("STOCKILY_DEFAULT_REMOTE_ORIGIN").to_string())
                .trim_end_matches('/')
                .to_string();
            let state: AppState = Arc::new(Shared {
                remote_origin,
                runtime_dir: app.path().resource_dir()?.join("runtime"),
                license_path: data_dir.join("license.bin"),
                control_secret: hex::encode(rand::random::<[u8; 24]>()),
                port: runtime::pick_port(&data_dir),
                data_dir,
                fingerprint: Mutex::new(None),
                license: Mutex::new(None),
                child: Mutex::new(None),
                pending_credentials: Mutex::new(None),
            });
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![boot, activate, start])
        .build(tauri::generate_context!())
        .expect("failed to build Stockily");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            let child = handle.state::<AppState>().child.lock().unwrap().take();
            if let Some(child) = child {
                runtime::stop(child);
            }
        }
    });
}
