//! Auto-update.
//!
//! The server (`GET /api/updates/{target}/{arch}/{current_version}`) announces
//! the newest installer; Tauri's updater plugin checks its minisign signature
//! against the public key compiled into this app (tauri.conf.json), so a
//! tampered or swapped installer is never run, whatever the network does.
//!
//! Two moments:
//!  - while the app is running, `spawn_prefetch` looks for a new version every
//!    few hours and downloads it quietly to `<data>/updates/pending.bin`
//!    (never interrupts work, never installs mid-session);
//!  - at the next launch, before the local runtime starts, a pending package
//!    is verified again and installed (the installer relaunches the app);
//!    if nothing was prefetched, the launch screen checks and downloads then.
//! Any failure here is swallowed by the callers: an update problem must never
//! stop someone from opening their shop's software.

use serde::Serialize;
use std::{path::PathBuf, time::Duration};
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::{Update, Updater, UpdaterExt};

use crate::light;

const CHECK_TIMEOUT: Duration = Duration::from_secs(8);
pub const PREFETCH_EVERY: Duration = Duration::from_secs(6 * 60 * 60);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub available: bool,
    pub version: Option<String>,
    pub notes: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

fn build(app: &AppHandle, remote_origin: &str) -> Result<Updater, String> {
    let endpoint = format!("{remote_origin}/api/updates/{{{{target}}}}/{{{{arch}}}}/{{{{current_version}}}}");
    app.updater_builder()
        .endpoints(vec![endpoint.parse().map_err(|e| format!("URL de mise à jour invalide : {e}"))?])
        .map_err(|e| e.to_string())?
        .timeout(CHECK_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())
}

fn pending_paths(data_dir: &std::path::Path) -> (PathBuf, PathBuf) {
    let dir = data_dir.join("updates");
    (dir.join("pending.bin"), dir.join("pending.json"))
}

fn clear_pending(data_dir: &std::path::Path) {
    let (bin, json) = pending_paths(data_dir);
    let _ = std::fs::remove_file(bin);
    let _ = std::fs::remove_file(json);
}

async fn check(app: &AppHandle, remote_origin: &str) -> Result<Option<Update>, String> {
    let update = build(app, remote_origin)?.check().await.map_err(|e| e.to_string())?;
    // The 8 s timeout is for the check; a download of several hundred MB must not inherit it.
    Ok(update.map(|mut u| {
        u.timeout = None;
        u
    }))
}

async fn download(update: &Update, mut on_progress: impl FnMut(u64, Option<u64>) + Send + 'static) -> Result<Vec<u8>, String> {
    let mut downloaded: u64 = 0;
    update
        .download(
            move |chunk, total| {
                downloaded += chunk as u64;
                on_progress(downloaded, total);
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())
}

/// Hands the verified package to the platform installer. Windows: the installer takes over and
/// relaunches the app (this process exits). Linux: the AppImage file is replaced in place, so the
/// app restarts itself to run the new one.
fn install_and_restart(app: &AppHandle, update: &Update, bytes: &[u8]) -> Result<(), String> {
    update.install(bytes).map_err(|e| e.to_string())?;
    #[cfg(not(windows))]
    {
        app.restart()
    }
    #[cfg(windows)]
    {
        let _ = app;
        Ok(())
    }
}

/// What to do about the newest version: nothing, a small signed zip (same base), or the full installer.
enum Next {
    UpToDate,
    Light(light::Descriptor),
    Full(Update),
}

async fn next_step(app: &AppHandle, remote_origin: &str, data_dir: &std::path::Path, runtime_dir: &std::path::Path) -> Result<Next, String> {
    if let Some(base) = light::base_id(runtime_dir) {
        let effective = light::effective_version(data_dir, runtime_dir);
        // A server that does not know light updates (or any hiccup here) just means: use the full path.
        if let Ok(plan) = light::plan(remote_origin, &base, &effective).await {
            match plan {
                light::Plan::None => return Ok(Next::UpToDate),
                light::Plan::Light(d) => return Ok(Next::Light(d)),
                light::Plan::Full => {}
            }
        }
    }
    Ok(match check(app, remote_origin).await? {
        Some(u) => Next::Full(u),
        None => Next::UpToDate,
    })
}

fn info_of(next: &Next) -> UpdateInfo {
    match next {
        Next::UpToDate => UpdateInfo { available: false, version: None, notes: None },
        Next::Light(d) => UpdateInfo { available: true, version: Some(d.version.clone()), notes: Some(d.notes.clone()) },
        Next::Full(u) => UpdateInfo { available: true, version: Some(u.version.clone()), notes: u.body.clone() },
    }
}

/// Downloads, verifies and activates a light update. `restart`: relaunch the app so the engine
/// runs the new content (not needed at launch, before the engine has started).
async fn apply_light(app: &AppHandle, data_dir: &std::path::Path, runtime_dir: &std::path::Path, desc: &light::Descriptor, restart: bool, mut on_progress: impl FnMut(u64, Option<u64>)) -> Result<(), String> {
    let bytes = light::download(desc, &mut on_progress).await?;
    light::verify(&bytes, desc)?;
    light::install(data_dir, runtime_dir, desc, &bytes)?;
    light::clear_pending(data_dir);
    if restart {
        app.restart();
    }
    Ok(())
}

/// Launch-time entry point. If a verified package was prefetched it is
/// installed straight away (this call then never returns: the installer takes
/// over and relaunches the app). Otherwise reports whether a download is needed.
pub async fn check_at_launch(app: &AppHandle, remote_origin: &str, data_dir: &std::path::Path, runtime_dir: &std::path::Path) -> Result<UpdateInfo, String> {
    // A light update fetched in the background is applied now, before the engine starts.
    let _ = light::apply_pending(data_dir, runtime_dir);
    let (bin, json) = pending_paths(data_dir);
    if bin.exists() && json.exists() {
        let restored = std::fs::read(&json)
            .ok()
            .and_then(|raw| serde_json::from_slice::<serde_json::Value>(&raw).ok())
            .and_then(|raw| build(app, remote_origin).ok()?.restore_update(raw).ok().flatten());
        match (restored, std::fs::read(&bin)) {
            (Some(update), Ok(bytes)) if update.verify(&bytes).is_ok() => {
                let _ = app.emit("update-progress", Progress { downloaded: bytes.len() as u64, total: Some(bytes.len() as u64) });
                if install_and_restart(app, &update, &bytes).is_err() {
                    clear_pending(data_dir);
                }
            }
            // Stale (already on this version), corrupted or tampered: drop it and look again.
            _ => clear_pending(data_dir),
        }
    }
    Ok(info_of(&next_step(app, remote_origin, data_dir, runtime_dir).await?))
}

/// Downloads (with progress events for the launch screen) and installs.
pub async fn download_and_install(app: &AppHandle, remote_origin: &str, data_dir: &std::path::Path, runtime_dir: &std::path::Path) -> Result<(), String> {
    let handle = app.clone();
    let emit = move |downloaded: u64, total: Option<u64>| {
        let _ = handle.emit("update-progress", Progress { downloaded, total });
    };
    match next_step(app, remote_origin, data_dir, runtime_dir).await? {
        Next::UpToDate => Ok(()),
        // Launch screen: the engine is not running yet, so no restart; the caller goes on to start it.
        Next::Light(d) => apply_light(app, data_dir, runtime_dir, &d, false, emit).await,
        Next::Full(update) => {
            let bytes = download(&update, emit).await?;
            clear_pending(data_dir);
            install_and_restart(app, &update, &bytes)
        }
    }
}

/// Quiet background download of the newest version, kept for the next launch.
pub fn spawn_prefetch(app: AppHandle, remote_origin: String, data_dir: PathBuf, runtime_dir: PathBuf) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(PREFETCH_EVERY).await;
            match next_step(&app, &remote_origin, &data_dir, &runtime_dir).await {
                Ok(Next::Light(d)) => {
                    if light::pending_version(&data_dir).as_deref() == Some(d.version.as_str()) {
                        continue;
                    }
                    let Ok(bytes) = light::download(&d, |_, _| {}).await else { continue };
                    if light::verify(&bytes, &d).is_ok() {
                        light::store_pending(&data_dir, &d, &bytes);
                    }
                }
                Ok(Next::Full(update)) => {
                    let (bin, json) = pending_paths(&data_dir);
                    // Already fetched this exact version?
                    let same = std::fs::read(&json)
                        .ok()
                        .and_then(|r| serde_json::from_slice::<serde_json::Value>(&r).ok())
                        .map(|v| v["version"] == update.version.as_str())
                        .unwrap_or(false);
                    if same && bin.exists() {
                        continue;
                    }
                    let Ok(bytes) = download(&update, |_, _| {}).await else { continue };
                    if let Some(dir) = bin.parent() {
                        let _ = std::fs::create_dir_all(dir);
                    }
                    // Write the package first, the descriptor last: a half-written pair is ignored at launch.
                    if std::fs::write(&bin, &bytes).is_ok() {
                        let _ = std::fs::write(&json, serde_json::to_vec(&update.raw_json).unwrap_or_default());
                    }
                }
                _ => {}
            }
        }
    });
}

// ---------------------------------------------------------------------------
// "Rechercher les mises à jour" button. The web UI (served by the local API)
// cannot call the updater itself, so it leaves a request with the local API
// and this loop — which lives in the shell — collects it every couple of
// seconds, does the work, and reports back (see apps/api/src/local/local-update.service.ts).
// ---------------------------------------------------------------------------

async fn report(http: &reqwest::Client, base: &str, secret: &str, body: serde_json::Value) {
    let _ = http
        .post(format!("{base}/update-status"))
        .header("x-stockily-control", secret)
        .json(&body)
        .timeout(Duration::from_secs(3))
        .send()
        .await;
}

/// Opens a page in the user's own browser. The local API already restricted the address to
/// Stockily's server and Chargily's payment page; https is re-checked here as a second wall.
/// No shell is involved (the address is passed as a single argument).
fn open_external(url: &str) {
    if !url.starts_with("https://") || url.len() > 2000 || url.chars().any(|c| c.is_control() || c == ' ') {
        return;
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", url]).creation_flags(0x0800_0000).spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    }
}

pub fn spawn_control(app: AppHandle, remote_origin: String, data_dir: PathBuf, runtime_dir: PathBuf, port: u16, secret: String) {
    tauri::async_runtime::spawn(async move {
        let Ok(http) = reqwest::Client::builder().no_proxy().build() else { return };
        let base = format!("http://127.0.0.1:{port}/api/local/control");
        let unreachable = serde_json::json!({ "phase": "error", "error": "Impossible de joindre le serveur de mises à jour. Vérifiez votre connexion internet." });
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            let Ok(r) = http.get(format!("{base}/update-request")).header("x-stockily-control", &secret).timeout(Duration::from_secs(3)).send().await else { continue };
            let Ok(json) = r.json::<serde_json::Value>().await else { continue };
            if let Some(url) = json["openUrl"].as_str() {
                open_external(url);
            }
            match json["request"].as_str() {
                Some("check") => {
                    let body = match next_step(&app, &remote_origin, &data_dir, &runtime_dir).await {
                        Ok(Next::UpToDate) => serde_json::json!({ "phase": "uptodate" }),
                        Ok(next) => {
                            let i = info_of(&next);
                            serde_json::json!({ "phase": "available", "version": i.version, "notes": i.notes.unwrap_or_default().chars().take(1500).collect::<String>() })
                        }
                        Err(_) => unreachable.clone(),
                    };
                    report(&http, &base, &secret, body).await;
                }
                Some("install") => {
                    report(&http, &base, &secret, serde_json::json!({ "phase": "downloading", "downloaded": 0 })).await;
                    let next = match next_step(&app, &remote_origin, &data_dir, &runtime_dir).await {
                        Ok(Next::UpToDate) => {
                            report(&http, &base, &secret, serde_json::json!({ "phase": "uptodate" })).await;
                            continue;
                        }
                        Ok(n) => n,
                        Err(_) => {
                            report(&http, &base, &secret, unreachable.clone()).await;
                            continue;
                        }
                    };
                    // Progress goes back to the UI at most every 0.7 s.
                    let (h2, b2, s2) = (http.clone(), base.clone(), secret.clone());
                    let mut last = std::time::Instant::now() - Duration::from_secs(5);
                    let progress = move |downloaded: u64, total: Option<u64>| {
                        if last.elapsed() < Duration::from_millis(700) {
                            return;
                        }
                        last = std::time::Instant::now();
                        let (h, b, s) = (h2.clone(), b2.clone(), s2.clone());
                        tauri::async_runtime::spawn(async move {
                            report(&h, &b, &s, serde_json::json!({ "phase": "downloading", "downloaded": downloaded, "total": total })).await;
                        });
                    };
                    let outcome: Result<(), String> = match next {
                        Next::UpToDate => Ok(()),
                        // The engine is running: relaunch the app so it starts on the new content.
                        Next::Light(d) => apply_light(&app, &data_dir, &runtime_dir, &d, true, progress).await,
                        Next::Full(update) => match download(&update, progress).await {
                            Ok(bytes) => {
                                clear_pending(&data_dir);
                                report(&http, &base, &secret, serde_json::json!({ "phase": "downloading", "downloaded": bytes.len(), "total": bytes.len() })).await;
                                install_and_restart(&app, &update, &bytes)
                            }
                            Err(e) => Err(e),
                        },
                    };
                    if let Err(e) = outcome {
                        report(&http, &base, &secret, serde_json::json!({ "phase": "error", "error": format!("La mise à jour a échoué : {e}") })).await;
                    }
                }
                _ => {}
            }
        }
    });
}
