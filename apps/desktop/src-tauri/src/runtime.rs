//! The local runtime: bundled node.exe running runner.mjs (embedded Postgres
//! + the Stockily API in local mode). Started only after the license gate
//! passes; stopped by closing its stdin, which makes it shut Postgres down
//! cleanly (killing it outright would leave the database locked).

use std::{
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub struct RuntimeConfig {
    pub runtime_dir: PathBuf,
    pub data_dir: PathBuf,
    pub port: u16,
    pub license_token: String,
    pub remote_origin: String,
    pub control_secret: String,
    pub public_key_pem: String,
}

/// Tauri's resource/data paths come back in Windows extended-length form
/// (`\\?\C:\...`), which Node's module loader can't open — the runtime then
/// dies before its first line. Hand Node plain paths.
fn plain(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    PathBuf::from(s.strip_prefix(r"\\?\").unwrap_or(&s).to_string())
}

/// Postgres processes left running from this install after a crash/forced
/// kill hold its files and data dir. Only one app instance can exist
/// (single-instance plugin), so anything running from *our* runtime folder
/// at startup is an orphan. Matched strictly by executable path — a
/// separately installed Postgres on the same PC is never touched.
#[cfg(windows)]
pub fn kill_orphans(runtime_dir: &Path) {
    // Postgres runs with a restricted token on Windows, which hides its
    // ExecutablePath from WMI — so match the command line (it starts with
    // the full exe path; postgres writes it with forward slashes).
    let dir = plain(runtime_dir).to_string_lossy().to_lowercase().replace('/', "\\").replace('\'', "''");
    let script = format!(
        "Get-CimInstance Win32_Process | Where-Object {{ $_.ProcessId -ne $PID -and (($_.ExecutablePath + ' ' + $_.CommandLine) -replace '/', '\\').ToLower().Contains('{dir}\\') }} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }}"
    );
    let _ = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .creation_flags(0x0800_0000)
        .status();
}

#[cfg(not(windows))]
pub fn kill_orphans(_: &Path) {}

pub fn spawn(cfg: &RuntimeConfig) -> Result<Child, String> {
    kill_orphans(&cfg.runtime_dir);
    let runtime_dir = plain(&cfg.runtime_dir);
    let data_dir = plain(&cfg.data_dir);
    let node = runtime_dir.join("node.exe");
    let runner = runtime_dir.join("runner.mjs");
    if !node.exists() || !runner.exists() {
        return Err("Installation incomplète : réinstallez Stockily.".into());
    }
    // Anything the runtime prints before its own logging is up (a crash at
    // load time) would otherwise vanish with the hidden console.
    let logs = data_dir.join("logs");
    let _ = std::fs::create_dir_all(&logs);
    let stderr = std::fs::File::create(logs.join("runtime-stderr.log")).map(Stdio::from).unwrap_or_else(|_| Stdio::null());
    let mut cmd = Command::new(node);
    cmd.arg(runner)
        .current_dir(&runtime_dir)
        .env("STOCKILY_DATA_DIR", &data_dir)
        .env("PORT", cfg.port.to_string())
        .env("STOCKILY_LICENSE_TOKEN", &cfg.license_token)
        .env("STOCKILY_REMOTE_ORIGIN", &cfg.remote_origin)
        .env("STOCKILY_CONTROL_SECRET", &cfg.control_secret)
        .env("LICENSE_PUBLIC_KEY", &cfg.public_key_pem)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(stderr);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flashing up
    cmd.spawn().map_err(|e| format!("Démarrage du moteur local impossible : {e}"))
}

/// Polls the runtime's control endpoint until it answers (first start
/// includes database initialisation and the initial data download).
pub async fn wait_ready(port: u16, secret: &str, child: &mut Child, timeout: Duration) -> Result<(), String> {
    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{port}/api/local/control/ready");
    let start = Instant::now();
    while start.elapsed() < timeout {
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!(
                "Le moteur local s'est arrêté ({status}). Journaux : %LOCALAPPDATA%\\dz.ordi-tech.stockily\\logs (runtime.log, runtime-stderr.log)."
            ));
        }
        if let Ok(r) = client.get(&url).header("x-stockily-control", secret).timeout(Duration::from_secs(2)).send().await {
            if r.status().is_success() {
                return Ok(());
            }
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    Err("Le moteur local ne répond pas.".into())
}

pub fn stop(mut child: Child) {
    drop(child.stdin.take()); // runner sees stdin close -> stops Postgres, exits
    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline {
        if matches!(child.try_wait(), Ok(Some(_))) {
            return;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    let _ = child.kill();
}

/// A stable port per install: the web app's saved session (localStorage)
/// is per-origin, so a new port every launch would log everyone out.
pub fn pick_port(data_dir: &Path) -> u16 {
    let file = data_dir.join("port");
    if let Some(p) = std::fs::read_to_string(&file).ok().and_then(|s| s.trim().parse::<u16>().ok()) {
        if TcpListener::bind(("127.0.0.1", p)).is_ok() {
            return p;
        }
    }
    let p = (0..50)
        .map(|_| 20000 + (rand::random::<u16>() % 20000))
        .find(|p| TcpListener::bind(("127.0.0.1", *p)).is_ok())
        .unwrap_or(38917);
    let _ = std::fs::create_dir_all(data_dir);
    let _ = std::fs::write(file, p.to_string());
    p
}

/// Hands a renewed license to the running local API (it re-verifies it).
pub async fn push_license(port: u16, secret: &str, token: &str) {
    let _ = reqwest::Client::new()
        .post(format!("http://127.0.0.1:{port}/api/local/control/license"))
        .header("x-stockily-control", secret)
        .json(&serde_json::json!({ "licenseToken": token }))
        .timeout(Duration::from_secs(10))
        .send()
        .await;
}
