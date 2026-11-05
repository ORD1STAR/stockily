use std::{env, fs, path::PathBuf};

fn main() {
    // The license public key is compiled into the binary. Release builds pass
    // the production key (STOCKILY_LICENSE_PUBLIC_KEY_FILE); without it the
    // insecure dev key (matching apps/api's dev fallback) is embedded.
    println!("cargo:rerun-if-env-changed=STOCKILY_LICENSE_PUBLIC_KEY_FILE");
    println!("cargo:rerun-if-env-changed=STOCKILY_REMOTE_ORIGIN");
    println!("cargo:rerun-if-changed=keys/license_public_dev.pem");
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    let key = match env::var("STOCKILY_LICENSE_PUBLIC_KEY_FILE") {
        Ok(path) => {
            println!("cargo:rerun-if-changed={path}");
            fs::read_to_string(&path).expect("STOCKILY_LICENSE_PUBLIC_KEY_FILE unreadable")
        }
        Err(_) => fs::read_to_string("keys/license_public_dev.pem").unwrap(),
    };
    fs::write(out.join("license_public_key.pem"), key).unwrap();
    let origin = env::var("STOCKILY_REMOTE_ORIGIN").unwrap_or_else(|_| "https://stockily.ordi-tech.com".into());
    println!("cargo:rustc-env=STOCKILY_DEFAULT_REMOTE_ORIGIN={origin}");
    tauri_build::build()
}
