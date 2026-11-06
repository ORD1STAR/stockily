#!/usr/bin/env bash
# Builds the desktop installers ON THIS LINUX SERVER and publishes them.
#   apps/desktop/scripts/release-on-server.sh 0.2.0 "What's new" [all|windows|linux]     (default: all)
# - Windows installer: cross-compiled (apt: clang lld llvm nsis; rustup + target x86_64-pc-windows-msvc; cargo install cargo-xwin --locked).
# - Linux AppImage: native (apt: libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf libssl-dev libxdo-dev).
# Needs ~/.stockily-updater/{stockily-updater.key,password.txt} (the updater signing key) and LICENSE_PUBLIC_KEY in .env.
set -euo pipefail
VERSION="${1:?usage: release-on-server.sh X.Y.Z [notes] [all|windows|linux]}"
NOTES="${2:-}"
WHICH="${3:-all}"
case "$WHICH" in all|windows|linux) ;; *) echo "plateforme inconnue: $WHICH (all|windows|linux)" >&2; exit 1;; esac
cd "$(dirname "$0")/../../.."
ROOT="$PWD"
export PATH="$HOME/.cargo/bin:$PATH"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
python3 - "$TMP/license_public.pem" <<'PY'
import sys
for l in open('.env').read().splitlines():
    if l.startswith('LICENSE_PUBLIC_KEY='):
        open(sys.argv[1], 'w').write(l.split('=', 1)[1].strip().strip("'\"").replace('\\n', '\n') + '\n')
PY
[ -s "$TMP/license_public.pem" ] || { echo "LICENSE_PUBLIC_KEY introuvable dans .env" >&2; exit 1; }

node apps/desktop/scripts/set-version.mjs "$VERSION"
export CARGO_BUILD_JOBS=2 CARGO_PROFILE_RELEASE_LTO=off CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16 \
  STOCKILY_LICENSE_PUBLIC_KEY_FILE="$TMP/license_public.pem" \
  TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.stockily-updater/stockily-updater.key)" \
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat ~/.stockily-updater/password.txt)"

# The light update of the staged runtime (api, web, migrations: a few MB), signed with the same key as
# the installer and tied to the runtime's "base" fingerprint. Sets LIGHT_ZIP and BASE_ID.
make_light() { # $1 = windows|linux
  mkdir -p apps/desktop/src-tauri/target/light
  LIGHT_ZIP="$ROOT/apps/desktop/src-tauri/target/light/Stockily_${VERSION}_light-$1.zip"
  node apps/desktop/scripts/make-light.mjs "$VERSION" "$LIGHT_ZIP"
  ( cd apps/desktop && npx tauri signer sign "$LIGHT_ZIP" )
  BASE_ID="$(node -e "console.log(JSON.parse(require('fs').readFileSync('apps/desktop/src-tauri/resources/runtime/base.json','utf8')).baseId)")"
}

if [ "$WHICH" = all ] || [ "$WHICH" = windows ]; then
  node apps/desktop/scripts/build-runtime.mjs --target=windows
  make_light windows
  ( cd apps/desktop && XWIN_ACCEPT_LICENSE=1 npx tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis )
  node apps/desktop/scripts/publish-release.mjs "apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/Stockily_${VERSION}_x64-setup.exe" --notes "$NOTES" --light "$LIGHT_ZIP" --base-id "$BASE_ID"
fi

if [ "$WHICH" = all ] || [ "$WHICH" = linux ]; then
  node apps/desktop/scripts/build-runtime.mjs --target=linux
  make_light linux
  # Stale staging copies from a previous bundle would sneak old files into the AppImage.
  rm -rf apps/desktop/src-tauri/target/release/runtime apps/desktop/src-tauri/target/release/bundle/appimage apps/desktop/src-tauri/target/release/bundle/appimage_deb
  # The AppImage packer must find the bundled Postgres libraries when it inspects initdb & co.
  ( cd apps/desktop && NO_STRIP=true APPIMAGE_EXTRACT_AND_RUN=1 \
      LD_LIBRARY_PATH="$ROOT/apps/desktop/src-tauri/resources/runtime/node_modules/@embedded-postgres/linux-x64/native/lib" \
      npx tauri build --bundles appimage )
  node apps/desktop/scripts/publish-release.mjs "apps/desktop/src-tauri/target/release/bundle/appimage/Stockily_${VERSION}_amd64.AppImage" --notes "$NOTES" --light "$LIGHT_ZIP" --base-id "$BASE_ID"
fi
