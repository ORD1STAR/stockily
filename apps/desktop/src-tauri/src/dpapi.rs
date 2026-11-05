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
pub fn protect(_: &[u8]) -> Result<Vec<u8>, String> {
    Err("Windows uniquement".into())
}
#[cfg(not(windows))]
pub fn unprotect(_: &[u8]) -> Result<Vec<u8>, String> {
    Err("Windows uniquement".into())
}
