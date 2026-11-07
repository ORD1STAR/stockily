//! Light updates.
//!
//! Most releases only change the API, the web app and the migrations (a few MB), while the heavy part
//! (Node, Postgres, dependencies, Prisma engine, runner.mjs) stays the same. That heavy part is the
//! "base", identified by `base.json` in the installed runtime. A light update is a small signed zip with
//! only the changing files; the server offers it when its base is the same as ours, otherwise the
//! complete installer is used (see updater.rs).
//!
//! Safety:
//!  - the zip must match the SHA-256 announced by the server AND carry a minisign signature that
//!    verifies against the public key compiled into this app (the same key as for installers);
//!  - extraction only accepts paths under api/, web/, migrations/ and node_modules/@org/ (no `..`,
//!    no absolute paths, no links), with caps on file count and total size;
//!  - the new content is extracted next to the old one and switched with one small file write;
//!  - if the app cannot start with the new content, lib.rs discards it and starts the installed one.

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Cursor, Read},
    path::{Path, PathBuf},
    time::Duration,
};

const ALLOWED: [&str; 4] = ["api/", "web/", "migrations/", "node_modules/@org/"];
const MAX_FILES: usize = 20_000;
const MAX_TOTAL: u64 = 300 * 1024 * 1024;

pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct Descriptor {
    pub version: String,
    #[serde(default)]
    pub notes: String,
    pub url: String,
    pub sha256: String,
    pub size: u64,
    pub signature: String,
}

pub enum Plan {
    None,
    Full,
    Light(Descriptor),
}

#[derive(Serialize, Deserialize)]
struct Current {
    version: String,
    base_id: String,
    dir: String,
}

fn content_root(data_dir: &Path) -> PathBuf {
    data_dir.join("content")
}

/// Fingerprint of the installed runtime's heavy part (written by build-runtime.mjs).
pub fn base_id(runtime_dir: &Path) -> Option<String> {
    let v: serde_json::Value = serde_json::from_slice(&fs::read(runtime_dir.join("base.json")).ok()?).ok()?;
    v["baseId"].as_str().filter(|s| s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())).map(str::to_string)
}

/// "1.2.3" -> (1,2,3); anything else -> None.
pub fn parse_version(v: &str) -> Option<(u32, u32, u32)> {
    let mut it = v.split('.').map(|p| p.parse::<u32>().ok());
    let t = (it.next()??, it.next()??, it.next()??);
    if it.next().is_some() {
        return None;
    }
    Some(t)
}

pub fn is_newer(candidate: &str, than: &str) -> bool {
    matches!((parse_version(candidate), parse_version(than)), (Some(a), Some(b)) if a > b)
}

/// The light content to run, if one is installed and still valid: same base as this install and
/// newer than the installed app (a full installer at least as new makes it obsolete: it is dropped).
pub fn active(data_dir: &Path, runtime_dir: &Path) -> Option<(String, PathBuf)> {
    let file = content_root(data_dir).join("current.json");
    let cur: Current = serde_json::from_slice(&fs::read(&file).ok()?).ok()?;
    let dir = content_root(data_dir).join(&cur.dir);
    let ok = base_id(runtime_dir).as_deref() == Some(cur.base_id.as_str()) && is_newer(&cur.version, APP_VERSION) && dir.join("api").join("main.js").exists();
    if !ok {
        discard(data_dir);
        return None;
    }
    Some((cur.version, dir))
}

/// Forget any light content: the installed app runs as it was installed.
pub fn discard(data_dir: &Path) {
    let _ = fs::remove_dir_all(content_root(data_dir));
}

/// The version the user effectively runs: the light content's, or the installed app's.
pub fn effective_version(data_dir: &Path, runtime_dir: &Path) -> String {
    active(data_dir, runtime_dir).map(|(v, _)| v).unwrap_or_else(|| APP_VERSION.to_string())
}

fn target() -> &'static str {
    if cfg!(windows) {
        "windows"
    } else {
        "linux"
    }
}

/// Asks the server what to do (same base -> light zip; otherwise full installer; or nothing).
pub async fn plan(remote_origin: &str, base: &str, effective: &str) -> Result<Plan, String> {
    let url = format!("{remote_origin}/api/updates/light/{}/x86_64/{base}/{effective}", target());
    let r = reqwest::Client::new().get(url).timeout(Duration::from_secs(8)).send().await.map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        return Err(format!("HTTP {}", r.status()));
    }
    let v: serde_json::Value = r.json().await.map_err(|e| e.to_string())?;
    Ok(match v["mode"].as_str() {
        Some("light") => Plan::Light(serde_json::from_value(v).map_err(|e| e.to_string())?),
        Some("full") => Plan::Full,
        _ => Plan::None,
    })
}

/// Downloads the zip, reporting progress (bytes so far, total).
pub async fn download(desc: &Descriptor, mut on_progress: impl FnMut(u64, Option<u64>)) -> Result<Vec<u8>, String> {
    if !desc.url.starts_with("https://") && !desc.url.starts_with("http://127.0.0.1") {
        return Err("Adresse de mise à jour refusée.".into());
    }
    let mut r = reqwest::Client::new().get(&desc.url).timeout(Duration::from_secs(600)).send().await.map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        return Err(format!("HTTP {}", r.status()));
    }
    let total = r.content_length();
    let mut out = Vec::with_capacity(total.unwrap_or(0).min(MAX_TOTAL) as usize);
    while let Some(chunk) = r.chunk().await.map_err(|e| e.to_string())? {
        out.extend_from_slice(&chunk);
        if out.len() as u64 > MAX_TOTAL {
            return Err("Mise à jour trop volumineuse.".into());
        }
        on_progress(out.len() as u64, total);
    }
    Ok(out)
}

fn updater_pubkey() -> Result<String, String> {
    let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).map_err(|e| e.to_string())?;
    let b64 = conf["plugins"]["updater"]["pubkey"].as_str().ok_or("Clé de mise à jour absente.")?;
    let raw = base64::engine::general_purpose::STANDARD.decode(b64.trim()).map_err(|e| e.to_string())?;
    String::from_utf8(raw).map_err(|e| e.to_string())
}

/// Checks size, SHA-256 and the minisign signature (same key as the installers). Nothing is
/// extracted or run before this passes.
pub fn verify(bytes: &[u8], desc: &Descriptor) -> Result<(), String> {
    verify_with_key(&updater_pubkey()?, bytes, desc)
}

fn verify_with_key(pubkey_text: &str, bytes: &[u8], desc: &Descriptor) -> Result<(), String> {
    if bytes.len() as u64 != desc.size {
        return Err("Taille de la mise à jour inattendue.".into());
    }
    if hex::encode(Sha256::digest(bytes)) != desc.sha256.to_lowercase() {
        return Err("Empreinte de la mise à jour incorrecte.".into());
    }
    let sig_text = String::from_utf8(
        base64::engine::general_purpose::STANDARD.decode(desc.signature.trim()).map_err(|_| "Signature illisible.".to_string())?,
    )
    .map_err(|_| "Signature illisible.".to_string())?;
    let key = minisign_verify::PublicKey::decode(pubkey_text).map_err(|_| "Clé de mise à jour invalide.".to_string())?;
    let sig = minisign_verify::Signature::decode(&sig_text).map_err(|_| "Signature illisible.".to_string())?;
    key.verify(bytes, &sig, false).map_err(|_| "Signature de la mise à jour invalide.".to_string())
}

/// Extracts the verified zip and makes it the active content.
pub fn install(data_dir: &Path, runtime_dir: &Path, desc: &Descriptor, bytes: &[u8]) -> Result<(), String> {
    let base = base_id(runtime_dir).ok_or("Base de l'application inconnue.")?;
    let root = content_root(data_dir);
    let staging = root.join(format!("{}.partial", desc.version));
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    if let Err(e) = extract(bytes, &staging, &base, &desc.version) {
        let _ = fs::remove_dir_all(&staging);
        return Err(e);
    }
    let final_dir = root.join(&desc.version);
    let _ = fs::remove_dir_all(&final_dir);
    fs::rename(&staging, &final_dir).map_err(|e| e.to_string())?;
    let cur = Current { version: desc.version.clone(), base_id: base, dir: desc.version.clone() };
    let tmp = root.join("current.json.tmp");
    fs::write(&tmp, serde_json::to_vec(&cur).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&tmp, root.join("current.json")).map_err(|e| e.to_string())?;
    // Older light content is no longer needed.
    if let Ok(entries) = fs::read_dir(&root) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if e.path().is_dir() && name != desc.version {
                let _ = fs::remove_dir_all(e.path());
            }
        }
    }
    Ok(())
}

fn extract(bytes: &[u8], into: &Path, base: &str, version: &str) -> Result<(), String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| "Mise à jour illisible.".to_string())?;
    if zip.len() == 0 || zip.len() > MAX_FILES {
        return Err("Mise à jour invalide.".into());
    }
    let mut total: u64 = 0;
    let mut manifest_ok = false;
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(|_| "Mise à jour illisible.".to_string())?;
        // Rejects `..`, absolute paths and drive letters.
        let rel = f.enclosed_name().ok_or("Chemin refusé dans la mise à jour.")?;
        let name = rel.to_string_lossy().replace('\\', "/");
        if f.is_dir() {
            continue;
        }
        if f.unix_mode().map(|m| m & 0o170000 == 0o120000).unwrap_or(false) {
            return Err("Lien refusé dans la mise à jour.".into());
        }
        let is_manifest = name == "light.json";
        if !is_manifest && !ALLOWED.iter().any(|p| name.starts_with(p)) {
            return Err(format!("Fichier hors périmètre refusé : {name}"));
        }
        total += f.size();
        if total > MAX_TOTAL {
            return Err("Mise à jour trop volumineuse.".into());
        }
        let mut data = Vec::with_capacity(f.size() as usize);
        f.by_ref().take(MAX_TOTAL + 1).read_to_end(&mut data).map_err(|_| "Mise à jour corrompue.".to_string())?;
        if is_manifest {
            let m: serde_json::Value = serde_json::from_slice(&data).map_err(|_| "Mise à jour invalide.".to_string())?;
            if m["baseId"].as_str() != Some(base) || m["version"].as_str() != Some(version) {
                return Err("Cette mise à jour ne correspond pas à cette installation.".into());
            }
            manifest_ok = true;
            continue;
        }
        let dest = into.join(&rel);
        if let Some(dir) = dest.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        fs::write(&dest, data).map_err(|e| e.to_string())?;
    }
    if !manifest_ok || !into.join("api").join("main.js").exists() {
        return Err("Mise à jour incomplète.".into());
    }
    Ok(())
}

// ---- Pre-downloaded package (kept for the next launch) -------------------------------------

fn pending_paths(data_dir: &Path) -> (PathBuf, PathBuf) {
    let dir = data_dir.join("updates");
    (dir.join("pending-light.zip"), dir.join("pending-light.json"))
}

pub fn store_pending(data_dir: &Path, desc: &Descriptor, bytes: &[u8]) {
    let (zip, json) = pending_paths(data_dir);
    if let Some(dir) = zip.parent() {
        let _ = fs::create_dir_all(dir);
    }
    // Package first, descriptor last: a half-written pair is ignored.
    if fs::write(&zip, bytes).is_ok() {
        let _ = fs::write(&json, serde_json::to_vec(desc).unwrap_or_default());
    }
}

pub fn pending_version(data_dir: &Path) -> Option<String> {
    let (zip, json) = pending_paths(data_dir);
    if !zip.exists() {
        return None;
    }
    serde_json::from_slice::<Descriptor>(&fs::read(json).ok()?).ok().map(|d| d.version)
}

pub fn clear_pending(data_dir: &Path) {
    let (zip, json) = pending_paths(data_dir);
    let _ = fs::remove_file(zip);
    let _ = fs::remove_file(json);
}

/// At launch, before the engine starts: applies a pre-downloaded light update if it is still valid.
/// Returns the version applied.
pub fn apply_pending(data_dir: &Path, runtime_dir: &Path) -> Option<String> {
    let (zip, json) = pending_paths(data_dir);
    let desc: Descriptor = serde_json::from_slice(&fs::read(&json).ok()?).ok()?;
    let bytes = fs::read(&zip).ok()?;
    let usable = is_newer(&desc.version, &effective_version(data_dir, runtime_dir)) && verify(&bytes, &desc).is_ok();
    let applied = usable && install(data_dir, runtime_dir, &desc, &bytes).is_ok();
    clear_pending(data_dir);
    applied.then_some(desc.version)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A tiny zip built by hand (stored entries) so tests need no tooling.
    fn zip_of(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut central = Vec::new();
        for (name, data) in entries {
            let crc = crc32(data);
            let off = out.len() as u32;
            out.extend_from_slice(&[0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
            out.extend_from_slice(&crc.to_le_bytes());
            out.extend_from_slice(&(data.len() as u32).to_le_bytes());
            out.extend_from_slice(&(data.len() as u32).to_le_bytes());
            out.extend_from_slice(&(name.len() as u16).to_le_bytes());
            out.extend_from_slice(&[0, 0]);
            out.extend_from_slice(name.as_bytes());
            out.extend_from_slice(data);
            central.extend_from_slice(&[0x50, 0x4b, 0x01, 0x02, 20, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
            central.extend_from_slice(&crc.to_le_bytes());
            central.extend_from_slice(&(data.len() as u32).to_le_bytes());
            central.extend_from_slice(&(data.len() as u32).to_le_bytes());
            central.extend_from_slice(&(name.len() as u16).to_le_bytes());
            central.extend_from_slice(&[0; 12]);
            central.extend_from_slice(&off.to_le_bytes());
            central.extend_from_slice(name.as_bytes());
        }
        let cd_off = out.len() as u32;
        out.extend_from_slice(&central);
        out.extend_from_slice(&[0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0]);
        out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
        out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
        out.extend_from_slice(&(central.len() as u32).to_le_bytes());
        out.extend_from_slice(&cd_off.to_le_bytes());
        out.extend_from_slice(&[0, 0]);
        out
    }

    fn crc32(data: &[u8]) -> u32 {
        let mut crc = 0xFFFF_FFFFu32;
        for b in data {
            crc ^= *b as u32;
            for _ in 0..8 {
                crc = if crc & 1 != 0 { (crc >> 1) ^ 0xEDB8_8320 } else { crc >> 1 };
            }
        }
        !crc
    }

    const BASE: &str = "a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4";

    fn light_json(version: &str, base: &str) -> Vec<u8> {
        format!("{{\"version\":\"{version}\",\"baseId\":\"{base}\"}}").into_bytes()
    }

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("stockily-light-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn versions_compare_numerically() {
        assert!(is_newer("0.1.10", "0.1.9"));
        assert!(is_newer("1.0.0", "0.9.9"));
        assert!(!is_newer("0.1.5", "0.1.5"));
        assert!(!is_newer("0.1.4", "0.1.5"));
        assert!(!is_newer("garbage", "0.1.5"));
    }

    #[test]
    fn extracts_only_allowed_content_and_switches_atomically() {
        let data = tmp("ok");
        let rt = tmp("ok-rt");
        fs::write(rt.join("base.json"), format!("{{\"baseId\":\"{BASE}\"}}")).unwrap();
        let zip = zip_of(&[
            ("api/main.js", b"console.log(1)"),
            ("web/index.html", b"<html></html>"),
            ("migrations/20260101_x/migration.sql", b"select 1;"),
            ("node_modules/@org/domain-stock/package.json", b"{}"),
            ("light.json", &light_json("9.9.9", BASE)),
        ]);
        let desc = Descriptor { version: "9.9.9".into(), notes: String::new(), url: String::new(), sha256: hex::encode(Sha256::digest(&zip)), size: zip.len() as u64, signature: String::new() };
        install(&data, &rt, &desc, &zip).unwrap();
        let (v, dir) = active(&data, &rt).expect("light content active");
        assert_eq!(v, "9.9.9");
        assert_eq!(fs::read_to_string(dir.join("api/main.js")).unwrap(), "console.log(1)");
        assert!(dir.join("migrations/20260101_x/migration.sql").exists());
        // A full reinstall with a different base (new Node, new dependencies...) makes it obsolete: it is dropped.
        fs::write(rt.join("base.json"), format!("{{\"baseId\":\"{}\"}}", "e".repeat(64))).unwrap();
        assert!(active(&data, &rt).is_none());
        assert!(!content_root(&data).exists());
    }

    #[test]
    fn refuses_hostile_or_foreign_packages() {
        let data = tmp("bad");
        let rt = tmp("bad-rt");
        fs::write(rt.join("base.json"), format!("{{\"baseId\":\"{BASE}\"}}")).unwrap();
        let mk = |entries: &[(&str, &[u8])]| {
            let zip = zip_of(entries);
            let d = Descriptor { version: "9.9.9".into(), notes: String::new(), url: String::new(), sha256: String::new(), size: 0, signature: String::new() };
            install(&data, &rt, &d, &zip)
        };
        // path traversal and absolute paths
        assert!(mk(&[("api/main.js", b"x"), ("../evil.js", b"x"), ("light.json", &light_json("9.9.9", BASE))]).is_err());
        assert!(mk(&[("/etc/passwd", b"x"), ("light.json", &light_json("9.9.9", BASE))]).is_err());
        // outside the allowed folders (e.g. replacing node.exe, runner.mjs or the Postgres binaries)
        assert!(mk(&[("api/main.js", b"x"), ("node.exe", b"x"), ("light.json", &light_json("9.9.9", BASE))]).is_err());
        assert!(mk(&[("api/main.js", b"x"), ("runner.mjs", b"x"), ("light.json", &light_json("9.9.9", BASE))]).is_err());
        assert!(mk(&[("api/main.js", b"x"), ("node_modules/pg/index.js", b"x"), ("light.json", &light_json("9.9.9", BASE))]).is_err());
        // built for another base / another version / without a manifest / without an API
        assert!(mk(&[("api/main.js", b"x"), ("light.json", &light_json("9.9.9", &"f".repeat(64)))]).is_err());
        assert!(mk(&[("api/main.js", b"x"), ("light.json", &light_json("1.1.1", BASE))]).is_err());
        assert!(mk(&[("api/main.js", b"x")]).is_err());
        assert!(mk(&[("web/index.html", b"x"), ("light.json", &light_json("9.9.9", BASE))]).is_err());
        // nothing became active
        assert!(active(&data, &rt).is_none());
    }

    #[test]
    fn verification_rejects_wrong_size_hash_and_signature() {
        let bytes = b"some zip bytes".to_vec();
        let good_hash = hex::encode(Sha256::digest(&bytes));
        let mut d = Descriptor { version: "9.9.9".into(), notes: String::new(), url: String::new(), sha256: good_hash.clone(), size: bytes.len() as u64, signature: String::new() };
        let key = updater_pubkey().expect("pubkey from tauri.conf.json");
        // wrong size
        d.size += 1;
        assert!(verify_with_key(&key, &bytes, &d).is_err());
        d.size = bytes.len() as u64;
        // wrong hash
        d.sha256 = "0".repeat(64);
        assert!(verify_with_key(&key, &bytes, &d).is_err());
        d.sha256 = good_hash;
        // right size and hash, but no valid signature
        assert!(verify_with_key(&key, &bytes, &d).is_err()); // empty signature
        d.signature = base64::engine::general_purpose::STANDARD.encode("untrusted comment: forged\nRWQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\ntrusted comment: x\nAAAA\n");
        assert!(verify_with_key(&key, &bytes, &d).is_err());
    }

    /// Real-world check with a package signed by the production key (skipped unless LIGHT_TEST_ZIP is set):
    /// LIGHT_TEST_ZIP=file.zip (with file.zip.sig next to it).
    #[test]
    fn real_signed_package_verifies() {
        let Ok(path) = std::env::var("LIGHT_TEST_ZIP") else { return };
        let bytes = fs::read(&path).unwrap();
        let sig = fs::read_to_string(format!("{path}.sig")).unwrap();
        let d = Descriptor { version: "0.0.0".into(), notes: String::new(), url: String::new(), sha256: hex::encode(Sha256::digest(&bytes)), size: bytes.len() as u64, signature: sig.trim().to_string() };
        verify(&bytes, &d).expect("production signature verifies");
        let mut tampered = bytes.clone();
        tampered[10] ^= 1;
        let d2 = Descriptor { sha256: hex::encode(Sha256::digest(&tampered)), ..d };
        assert!(verify(&tampered, &d2).is_err(), "a modified package must not verify");
    }
}
