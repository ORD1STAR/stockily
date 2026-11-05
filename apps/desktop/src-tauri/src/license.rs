//! The license gate. A license is an RS256 token issued by the Stockily
//! server; only the public key is compiled in here, so a license can be
//! checked offline but never forged. It is bound to this machine (the `fp`
//! claim is the hardware fingerprint) and stored DPAPI-encrypted.

use crate::{dpapi, fingerprint::Fingerprint};
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use std::{fs, path::Path};

pub const PUBLIC_KEY_PEM: &str = include_str!(concat!(env!("OUT_DIR"), "/license_public_key.pem"));

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)] // sub/org_id/ent: decoded for completeness, the shell only needs fp/exp
pub struct Claims {
    pub sub: String,
    #[serde(rename = "orgId")]
    pub org_id: String,
    pub fp: String,
    // Signed module entitlements — the local API trusts these over its DB.
    #[serde(default)]
    pub ent: Option<Vec<String>>,
    pub typ: String,
    pub exp: u64,
}

impl Claims {
    pub fn expired(&self) -> bool {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        self.exp <= now
    }
}

/// Signature + type + "this license is for THIS machine". Expiry is
/// reported, not rejected: an expired license still opens the app, read-only.
pub fn verify(token: &str, fp: &Fingerprint) -> Result<Claims, String> {
    let key = DecodingKey::from_rsa_pem(PUBLIC_KEY_PEM.as_bytes()).map_err(|_| "Clé de licence invalide.".to_string())?;
    let mut v = Validation::new(Algorithm::RS256);
    v.validate_exp = false;
    v.required_spec_claims.clear();
    let claims = decode::<Claims>(token, &key, &v).map_err(|_| "Licence invalide.".to_string())?.claims;
    if claims.typ != "stockily-license" {
        return Err("Licence invalide.".into());
    }
    if claims.fp != fp.composite() {
        return Err("Cette licence appartient à un autre ordinateur.".into());
    }
    Ok(claims)
}

pub fn save(path: &Path, token: &str) -> Result<(), String> {
    let sealed = dpapi::protect(token.as_bytes())?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(path, sealed).map_err(|e| e.to_string())
}

pub fn load(path: &Path) -> Option<String> {
    let sealed = fs::read(path).ok()?;
    String::from_utf8(dpapi::unprotect(&sealed).ok()?).ok()
}

pub fn remove(path: &Path) {
    let _ = fs::remove_file(path);
}
