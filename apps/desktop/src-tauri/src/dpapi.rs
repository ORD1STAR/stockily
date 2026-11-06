//! Windows DPAPI: the stored license is encrypted with a key tied to this
//! Windows user on this machine, so the file is useless if copied elsewhere
//! (on top of the license itself being bound to the hardware fingerprint).

#[cfg(windows)]
mod imp {
    use std::ptr;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB};

    // Extra entropy so another app using DPAPI for this user can't trivially decrypt it.
    const ENTROPY: &[u8] = b"stockily-desktop-license-v1";

    fn run(data: &[u8], protect: bool) -> Result<Vec<u8>, String> {
        let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
        let entropy = CRYPT_INTEGER_BLOB { cbData: ENTROPY.len() as u32, pbData: ENTROPY.as_ptr() as *mut u8 };
        let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: ptr::null_mut() };
        let ok = unsafe {
            if protect {
                CryptProtectData(&input, ptr::null(), &entropy, ptr::null(), ptr::null(), 0, &mut output)
            } else {
                CryptUnprotectData(&input, ptr::null_mut(), &entropy, ptr::null(), ptr::null(), 0, &mut output)
            }
        };
        if ok == 0 {
            return Err("Chiffrement de la licence impossible.".into());
        }
        let bytes = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
        unsafe { LocalFree(output.pbData as _) };
        Ok(bytes)
    }

    pub fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
        run(data, true)
    }

    pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
        run(data, false)
    }
}

#[cfg(windows)]
pub use imp::{protect, unprotect};

#[cfg(not(windows))]
mod imp_unix {
    //! Linux: no DPAPI, so the license is sealed with AES-256-GCM under a key
    //! derived from this machine's id and the current user. Same intent as
    //! DPAPI: the file is useless if copied to another machine or account.
    use aes_gcm::{aead::{Aead, KeyInit}, Aes256Gcm, Nonce};
    use sha2::{Digest, Sha256};

    fn key() -> Result<[u8; 32], String> {
        let id = ["/etc/machine-id", "/var/lib/dbus/machine-id"]
            .iter()
            .find_map(|p| std::fs::read_to_string(p).ok())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .ok_or("Identifiant de la machine introuvable.")?;
        let uid = std::env::var("USER").unwrap_or_default();
        let mut h = Sha256::new();
        h.update(b"stockily-desktop-license-v1|linux|");
        h.update(id.as_bytes());
        h.update(b"|");
        h.update(uid.as_bytes());
        Ok(h.finalize().into())
    }

    pub fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
        let cipher = Aes256Gcm::new_from_slice(&key()?).map_err(|_| "Chiffrement impossible.".to_string())?;
        let nonce: [u8; 12] = rand::random();
        let mut out = nonce.to_vec();
        out.extend(cipher.encrypt(Nonce::from_slice(&nonce), data).map_err(|_| "Chiffrement de la licence impossible.".to_string())?);
        Ok(out)
    }

    pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
        if data.len() < 13 {
            return Err("Licence illisible.".into());
        }
        let cipher = Aes256Gcm::new_from_slice(&key()?).map_err(|_| "Déchiffrement impossible.".to_string())?;
        cipher.decrypt(Nonce::from_slice(&data[..12]), &data[12..]).map_err(|_| "Licence illisible.".to_string())
    }
}

#[cfg(not(windows))]
pub use imp_unix::{protect, unprotect};

#[cfg(all(test, not(windows)))]
mod tests {
    use super::*;

    #[test]
    fn seals_and_opens_a_license() {
        let sealed = protect(b"header.payload.signature").unwrap();
        assert!(!sealed.windows(7).any(|w| w == b"payload"), "the token must not appear in clear");
        assert_eq!(unprotect(&sealed).unwrap(), b"header.payload.signature");
    }

    #[test]
    fn refuses_tampered_or_truncated_data() {
        let mut sealed = protect(b"secret").unwrap();
        let last = sealed.len() - 1;
        sealed[last] ^= 1;
        assert!(unprotect(&sealed).is_err());
        assert!(unprotect(&[1, 2, 3]).is_err());
    }
}
