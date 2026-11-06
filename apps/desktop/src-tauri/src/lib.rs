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
mod light;
mod runtime;
mod updater;

use fingerprint::Fingerprint;
use serde::Serialize;
use std::{
    path::PathBuf,
    process::Child,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Manager, RunEvent, State, Url};

// Short on purpose: a module bought online reaches the PC within minutes.
const RENEW_EVERY: Duration = Duration::from_secs(5 * 60);

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
    /// Activation waiting for the emailed code (two-factor / unconfirmed address). Memory only.
    pending_otp: Mutex<Option<PendingOtp>>,
}

struct PendingOtp {
    challenge_id: String,
    label: String,
    email: String,
    password: String,
}

/// What the activation screen needs to know after the password step.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ActivateOutcome {
    /// True when the server emailed a code that must be entered to go on.
    otp_required: bool,
    /// Masked address the code was sent to.
    email: Option<String>,
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

/// Launch screen: is there a newer version? (Installs a prefetched one at once.)
/// Errors and being offline are reported as "no update" by the caller.
#[tauri::command]
async fn update_check(app: AppHandle, s: State<'_, AppState>) -> Result<updater::UpdateInfo, String> {
    updater::check_at_launch(&app, &s.remote_origin, &s.data_dir, &s.runtime_dir).await
}

/// Downloads and installs the update; on success the app is replaced and relaunched.
#[tauri::command]
async fn update_install(app: AppHandle, s: State<'_, AppState>) -> Result<(), String> {
    updater::download_and_install(&app, &s.remote_origin, &s.data_dir, &s.runtime_dir).await
}

const UNREACHABLE: &str = "Connexion au serveur Stockily impossible. L'activation nécessite internet (une seule fois).";

#[tauri::command]
async fn activate(email: String, password: String, label: String, s: State<'_, AppState>) -> Result<ActivateOutcome, String> {
    let client = reqwest::Client::new();
    let r = client
        .post(format!("{}/api/auth/login", s.remote_origin))
        .json(&serde_json::json!({ "email": email, "password": password }))
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|_| UNREACHABLE.to_string())?;
    let status = r.status();
    let json: serde_json::Value = r.json().await.unwrap_or_default();
    if !status.is_success() {
        return Err(server_message(&json, "Connexion refusée."));
    }
    // The server may first ask for the code it just emailed (second factor, or a new address to confirm).
    if json["otpRequired"].as_bool() == Some(true) {
        let challenge_id = json["challengeId"].as_str().ok_or("Réponse du serveur inattendue.")?.to_string();
        let masked = json["email"].as_str().map(str::to_string);
        *s.pending_otp.lock().unwrap() = Some(PendingOtp { challenge_id, label, email, password });
        return Ok(ActivateOutcome { otp_required: true, email: masked });
    }
    let access = json["accessToken"].as_str().ok_or("Réponse du serveur inattendue.")?.to_string();
    finish_activation(&s, &client, access, &label, email, password).await?;
    Ok(ActivateOutcome { otp_required: false, email: None })
}

/// Second step: the emailed code turns into a session, then the device is activated as usual.
#[tauri::command]
async fn activate_verify(code: String, s: State<'_, AppState>) -> Result<(), String> {
    let (challenge_id, label, email, password) = {
        let g = s.pending_otp.lock().unwrap();
        let p = g.as_ref().ok_or("Session de vérification expirée. Recommencez la connexion.")?;
        (p.challenge_id.clone(), p.label.clone(), p.email.clone(), p.password.clone())
    };
    let client = reqwest::Client::new();
    let r = client
        .post(format!("{}/api/auth/otp/verify", s.remote_origin))
        .json(&serde_json::json!({ "challengeId": challenge_id, "code": code.trim() }))
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|_| UNREACHABLE.to_string())?;
    let status = r.status();
    let json: serde_json::Value = r.json().await.unwrap_or_default();
    if !status.is_success() {
        return Err(server_message(&json, "Code refusé."));
    }
    let access = json["accessToken"].as_str().ok_or("Réponse du serveur inattendue.")?.to_string();
    *s.pending_otp.lock().unwrap() = None;
    finish_activation(&s, &client, access, &label, email, password).await
}

/// Asks the server for a fresh code. Returns the seconds to wait before the next request.
#[tauri::command]
async fn activate_resend(s: State<'_, AppState>) -> Result<u64, String> {
    let challenge_id = s.pending_otp.lock().unwrap().as_ref().map(|p| p.challenge_id.clone()).ok_or("Session de vérification expirée. Recommencez la connexion.")?;
    let r = reqwest::Client::new()
        .post(format!("{}/api/auth/otp/resend", s.remote_origin))
        .json(&serde_json::json!({ "challengeId": challenge_id }))
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|_| UNREACHABLE.to_string())?;
    let status = r.status();
    let json: serde_json::Value = r.json().await.unwrap_or_default();
    if !status.is_success() {
        return Err(server_message(&json, "Envoi impossible."));
    }
    Ok(json["resendIn"].as_u64().unwrap_or(30))
}

#[tauri::command]
fn activate_cancel(s: State<'_, AppState>) {
    *s.pending_otp.lock().unwrap() = None;
}

/// Registers this PC on the account (seat + hardware-bound license) once the user is authenticated.
async fn finish_activation(s: &AppState, client: &reqwest::Client, access: String, label: &str, email: String, password: String) -> Result<(), String> {
    let fp = fingerprint(s)?;
    let mut body = serde_json::to_value(&fp).unwrap();
    body["deviceLabel"] = label.trim().chars().take(100).collect::<String>().into();
    let r = client
        .post(format!("{}/api/licensing/activate", s.remote_origin))
        .bearer_auth(access)
        .json(&body)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|_| UNREACHABLE.to_string())?;
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
        // A light update (newer api/web/migrations) runs on top of the installed base. If the app cannot
        // start with it, it is dropped and the installed version starts instead: an update must never
        // leave a shop without its software.
        let light_content = light::active(&s.data_dir, &s.runtime_dir);
        let mut attempts = if light_content.is_some() { vec![true, false] } else { vec![false] };
        let mut started = None;
        let mut last_err = String::new();
        while let Some(use_light) = (!attempts.is_empty()).then(|| attempts.remove(0)) {
            let content = if use_light { light_content.clone() } else { None };
            let cfg = runtime::RuntimeConfig {
                runtime_dir: s.runtime_dir.clone(),
                data_dir: s.data_dir.clone(),
                port: s.port,
                license_token: token.clone(),
                remote_origin: s.remote_origin.clone(),
                control_secret: s.control_secret.clone(),
                public_key_pem: license::PUBLIC_KEY_PEM.to_string(),
                fingerprint_json: fingerprint(&s).ok().and_then(|f| serde_json::to_string(&f).ok()).unwrap_or_default(),
                content_dir: content.as_ref().map(|(_, d)| d.clone()),
                app_version: content.as_ref().map(|(v, _)| v.clone()).unwrap_or_else(|| light::APP_VERSION.to_string()),
            };
            let mut child = match runtime::spawn(&cfg) {
                Ok(c) => c,
                Err(e) => {
                    last_err = e;
                    if use_light {
                        light::discard(&s.data_dir);
                    }
                    continue;
                }
            };
            // First start: database init + the whole organisation downloaded.
            match runtime::wait_ready(s.port, &s.control_secret, &mut child, Duration::from_secs(600)).await {
                Ok(()) => {
                    started = Some(child);
                    break;
                }
                Err(e) => {
                    runtime::stop(child);
                    last_err = e;
                    if use_light {
                        light::discard(&s.data_dir);
                    }
                }
            }
        }
        let Some(child) = started else { return Err(last_err) };
        *s.child.lock().unwrap() = Some(child);
        spawn_renewal(s.inner().clone());
        updater::spawn_prefetch(app.clone(), s.remote_origin.clone(), s.data_dir.clone(), s.runtime_dir.clone());
        updater::spawn_control(app.clone(), s.remote_origin.clone(), s.data_dir.clone(), s.runtime_dir.clone(), s.port, s.control_secret.clone());
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
        .plugin(tauri_plugin_updater::Builder::new().build())
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
                pending_otp: Mutex::new(None),
            });
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![boot, activate, activate_verify, activate_resend, activate_cancel, start, update_check, update_install])
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
