//! Hardware fingerprint: three independent components, each hashed here —
//! raw identifiers never leave this machine. The server matches a device
//! on 2 of 3, so replacing one part (a disk, a network card) keeps the seat.

use serde::Serialize;
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fingerprint {
    pub motherboard_hash: String,
    pub disk_hash: String,
    pub mac_hash: String,
}

impl Fingerprint {
    /// Must match apps/api's `compositeFingerprint` exactly.
    pub fn composite(&self) -> String {
        sha(&format!("{}|{}|{}", self.motherboard_hash, self.disk_hash, self.mac_hash))
    }
}

fn sha(s: &str) -> String {
    hex::encode(Sha256::digest(s.as_bytes()))
}

/// Domain-separated so the same raw string in two components doesn't hash alike.
fn component(kind: &str, raw: &str) -> String {
    sha(&format!("stockily:{kind}:{}", raw.trim().to_uppercase()))
}

/// Values cheap boards report instead of a real serial — useless as identity.
fn is_junk(v: &str) -> bool {
    let v = v.trim().to_uppercase();
    v.is_empty()
        || v.chars().all(|c| c == '0' || c == '-' || c == 'F' || c == ' ')
        || ["TO BE FILLED BY O.E.M.", "DEFAULT STRING", "NONE", "NOT APPLICABLE", "SYSTEM SERIAL NUMBER", "N/A"]
            .iter()
            .any(|j| v.contains(j))
}

#[cfg(windows)]
pub fn collect() -> Result<Fingerprint, String> {
    // WMI needs its own COM apartment; the UI thread already has one.
    std::thread::spawn(collect_on_this_thread)
        .join()
        .map_err(|_| "Lecture du matériel impossible.".to_string())?
}

#[cfg(windows)]
fn collect_on_this_thread() -> Result<Fingerprint, String> {
    use std::collections::HashMap;
    use wmi::{COMLibrary, Variant, WMIConnection};

    let com = COMLibrary::new().map_err(|e| format!("COM: {e}"))?;
    let wmi = WMIConnection::new(com).map_err(|e| format!("WMI: {e}"))?;
    let first = |query: &str, field: &str| -> String {
        let rows: Vec<HashMap<String, Variant>> = wmi.raw_query(query).unwrap_or_default();
        rows.iter()
            .filter_map(|r| match r.get(field) {
                Some(Variant::String(s)) if !is_junk(s) => Some(s.trim().to_string()),
                _ => None,
            })
            .next()
            .unwrap_or_default()
    };

    let uuid = first("SELECT UUID FROM Win32_ComputerSystemProduct", "UUID");
    let board = first("SELECT SerialNumber FROM Win32_BaseBoard", "SerialNumber");
    let mut motherboard = format!("{uuid}|{board}");
    if uuid.is_empty() && board.is_empty() {
        // Board reports nothing usable: fall back to this Windows install's id.
        motherboard = machine_guid().unwrap_or_default();
    }

    // The system disk: the physical drive hosting the boot partition is
    // Index 0 on practically every shop PC; fall back to any serial.
    let mut disk = first("SELECT SerialNumber FROM Win32_DiskDrive WHERE Index = 0", "SerialNumber");
    if disk.is_empty() {
        disk = first("SELECT SerialNumber FROM Win32_DiskDrive", "SerialNumber");
    }
    if disk.is_empty() {
        disk = first("SELECT VolumeSerialNumber FROM Win32_LogicalDisk WHERE DeviceID = 'C:'", "VolumeSerialNumber");
    }

    let mac = mac_address::get_mac_address().ok().flatten().map(|m| m.to_string()).unwrap_or_default();

    if motherboard.trim_matches('|').is_empty() && disk.is_empty() && mac.is_empty() {
        return Err("Impossible d'identifier cet ordinateur.".into());
    }
    Ok(Fingerprint {
        motherboard_hash: component("mb", &motherboard),
        disk_hash: component("disk", &disk),
        mac_hash: component("mac", &mac),
    })
}

#[cfg(windows)]
fn machine_guid() -> Option<String> {
    use winreg::{enums::HKEY_LOCAL_MACHINE, RegKey};
    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey("SOFTWARE\\Microsoft\\Cryptography")
        .ok()?
        .get_value::<String, _>("MachineGuid")
        .ok()
}

#[cfg(not(windows))]
pub fn collect() -> Result<Fingerprint, String> {
    use std::fs;
    let read = |p: &str| fs::read_to_string(p).map(|s| s.trim().to_string()).unwrap_or_default();
    let clean = |v: String| if is_junk(&v) { String::new() } else { v };

    // Board identity. DMI serials are usually root-only, so the install's
    // machine-id is the dependable part (same fallback as the Windows build).
    let uuid = clean(read("/sys/class/dmi/id/product_uuid"));
    let board = clean(read("/sys/class/dmi/id/board_serial"));
    let mut motherboard = format!("{uuid}|{board}");
    if uuid.is_empty() && board.is_empty() {
        let id = read("/etc/machine-id");
        motherboard = if id.is_empty() { read("/var/lib/dbus/machine-id") } else { id };
    }

    // System disk serial: sysfs first, then the stable /dev/disk/by-id names
    // (they embed the serial and are world-readable), then the root fs UUID.
    let mut disk = String::new();
    if let Ok(entries) = fs::read_dir("/sys/block") {
        let mut names: Vec<String> = entries.flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
        names.sort();
        for n in names.iter().filter(|n| !n.starts_with("loop") && !n.starts_with("ram") && !n.starts_with("zram") && !n.starts_with("dm-")) {
            for f in ["device/serial", "serial", "device/wwid"] {
                let v = clean(read(&format!("/sys/block/{n}/{f}")));
                if !v.is_empty() {
                    disk = v;
                    break;
                }
            }
            if !disk.is_empty() {
                break;
            }
        }
    }
    if disk.is_empty() {
        if let Ok(entries) = fs::read_dir("/dev/disk/by-id") {
            let mut names: Vec<String> = entries.flatten().map(|e| e.file_name().to_string_lossy().to_string())
                .filter(|n| (n.starts_with("ata-") || n.starts_with("nvme-") || n.starts_with("scsi-")) && !n.contains("-part") && !n.starts_with("nvme-eui")).collect();
            names.sort();
            disk = names.into_iter().next().unwrap_or_default();
        }
    }
    if disk.is_empty() {
        if let Ok(entries) = fs::read_dir("/dev/disk/by-uuid") {
            let mut names: Vec<String> = entries.flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
            names.sort();
            disk = names.into_iter().next().unwrap_or_default();
        }
    }

    let mac = mac_address::get_mac_address().ok().flatten().map(|m| m.to_string()).unwrap_or_default();

    if motherboard.trim_matches('|').is_empty() && disk.is_empty() && mac.is_empty() {
        return Err("Impossible d'identifier cet ordinateur.".into());
    }
    Ok(Fingerprint {
        motherboard_hash: component("mb", &motherboard),
        disk_hash: component("disk", &disk),
        mac_hash: component("mac", &mac),
    })
}

#[cfg(all(test, not(windows)))]
mod tests {
    use super::*;

    #[test]
    fn collects_a_stable_fingerprint() {
        let a = collect().expect("a Linux box has at least a machine-id");
        let b = collect().unwrap();
        assert_eq!(a.composite(), b.composite());
        assert_eq!(a.composite().len(), 64);
        assert_ne!(a.motherboard_hash, a.disk_hash);
    }
}
