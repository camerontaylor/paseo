#!/usr/bin/env bash
#
# Build the build tree into a real Paseo.app that carries its own daemon.
#
# This produces the bundle and stops. `desvio run install` puts it in place —
# separate because the two fail for unrelated reasons, and retrying a two-second
# copy should not cost a five-minute rebuild.
#
# Usage:  desvio run package
# Env:    PASEO_PACKAGE_VERSION=<shared fork build version>
#         PASEO_PRODUCT_NAME="Paseo Mine"   name the bundle, to sit beside a stock
#                                           install rather than replace it
#
# Run `desvio build` FIRST. This packages whatever is in the tree; it does not
# assemble branches, and it does not check whether your gate ever passed.
#
set -euo pipefail

: "${DESVIO_WORKTREE:?run this with: desvio run package}"
BUILD_DIR="$DESVIO_WORKTREE"

# Paseo's own settings live beside this script, not in desvio.conf: desvio is a
# generic tool and what the bundle is called is none of its business. `if`, not
# `&&`, because under `set -e` a false test as the last command kills the script.
PASEO_CONF="${PASEO_CONF:-$(dirname "$DESVIO_CONFIG_FILE")/paseo.conf}"
if [ -f "$PASEO_CONF" ]; then
  # shellcheck disable=SC1090
  . "$PASEO_CONF"
fi

# Naming the bundle is what lets it live in /Applications next to a stock Paseo.
# It renames the BUNDLE ONLY. The app's data does not follow it, and that is on
# purpose here: packages/desktop/src/main.ts hardcodes
#
#   const APP_NAME = process.env.PASEO_TEST_APP_NAME?.trim() || "Paseo";
#   app.setName(APP_NAME);
#
# and userData is derived from that name, not from productName. So both bundles
# read ~/Library/Application Support/Paseo — same hosts, same settings, same
# conversations, whichever icon you click.
#
# The flip side, and the reason this is not a way to run two at once: that
# directory also holds Electron's SingletonLock. Launch the second app while the
# first is running and it hands off to the running instance and quits. One at a
# time. Separating them would mean patching APP_NAME too, and then they would no
# longer share data.
PRODUCT_NAME="${PASEO_PRODUCT_NAME:-Paseo}"
APP_NAME="$PRODUCT_NAME.app"
# DIVERGES FROM CERES. ceres is x86_64 Linux and never runs this mac path, but
# the two copies are otherwise kept byte-identical, so the divergence is marked
# here rather than left to be discovered by a diff. neptune is an Intel Mac
# (i5-8500), and this script hardcoded release/mac-arm64 plus an arm64-only
# guard. Recorded 2026-09-10.
# electron-builder names the mac output directory after the arch it built for, and
# only arm64 gets a suffix: x86_64 lands in release/mac, Apple silicon in
# release/mac-arm64. Derive it rather than hardcoding, because the wrong guess
# fails late — after the whole Expo export and electron-builder run — with
# "produced no app at", which reads like a build failure and is not one.
case "$(uname -m)" in
  arm64)  MAC_RELEASE_DIR="mac-arm64" ;;
  x86_64) MAC_RELEASE_DIR="mac" ;;
  *)      MAC_RELEASE_DIR="" ;;
esac
BUILT_APP="$BUILD_DIR/packages/desktop/release/$MAC_RELEASE_DIR/$APP_NAME"

# A renamed bundle gets its own appId as well. Two bundles claiming
# sh.paseo.desktop leaves LaunchServices to pick between them for `open -b` and
# for the paseo:// scheme, and it picks the one it feels like. Nothing about the
# app's data is keyed on this — the desktop stores nothing under the bundle id
# and uses no keychain — but macOS grants permissions per bundle id, so the
# renamed app may ask for notifications and the like on its own account.
BUILDER_NAME_ARGS=()
if [ "$PRODUCT_NAME" != "Paseo" ]; then
  slug=$(printf '%s' "$PRODUCT_NAME" | tr '[:upper:]' '[:lower:]' \
         | sed 's/[^a-z0-9]\{1,\}/-/g; s/^-//; s/-$//; s/^paseo-//')
  APP_ID="${PASEO_APP_ID:-sh.paseo.desktop.$slug}"
  BUILDER_NAME_ARGS=(-c.productName="$PRODUCT_NAME" -c.appId="$APP_ID")
fi

# Re-enter with every workspace stamped before Metro or electron-builder runs.
if [ "${PASEO_BUILD_VERSION_STAMPED:-}" != 1 ]; then
  exec node "$BUILD_DIR/fork/scripts/build-version.mjs" -- bash "$0" "$@"
fi
VERSION="$PASEO_PACKAGE_VERSION"
UPSTREAM_VERSION=$(node -p "require('$BUILD_DIR/packages/app/native-release-version.js').getNativeReleaseVersion('$VERSION').appVersion")

for arg in "$@"; do
  case "$arg" in
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) printf 'unknown option: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

log(){  printf '\n\033[1;34m[pkg]\033[0m %s\n' "$*"; }
die(){  printf '\n\033[1;31m[pkg] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# The product name becomes a path component, and further down it becomes the
# target of an `rm -rf`. It is your own config value rather than anything
# hostile, so this is a typo guard — but a slash in it silently aims that rm at
# a directory you did not mean, which is worth one case statement.
case "$PRODUCT_NAME" in
  ""|.|..) die "PASEO_PRODUCT_NAME cannot be '$PRODUCT_NAME'" ;;
  */*)     die "PASEO_PRODUCT_NAME cannot contain a slash: '$PRODUCT_NAME'
  It names one bundle, so it becomes one path component." ;;
  -*)      die "PASEO_PRODUCT_NAME cannot start with a dash: '$PRODUCT_NAME'
  It would be read as an option by the tools that receive it." ;;
  *..*)    die "PASEO_PRODUCT_NAME cannot contain '..': '$PRODUCT_NAME'" ;;
esac

[ -d "$BUILD_DIR" ] || die "no build tree at $BUILD_DIR — run desvio build first"
# The mac: section of electron-builder.yml pins no arch, so electron-builder
# builds for the host and both x86_64 and arm64 work. Reject only an arch whose
# output directory we cannot name.
[ -n "$MAC_RELEASE_DIR" ] || die "unsupported architecture $(uname -m) — this script builds x86_64 and arm64"

# ---------- build ----------
# The root `npm run build:desktop` wrapper is not usable: its `cd packages/app`
# runs in a shell whose cwd npm does not leave at the repo root, so it dies with
# "cd: packages/app: No such file or directory". Run the three stages directly.
log "1/3 app deps (clean)"
npm --prefix "$BUILD_DIR" run build:app-deps:clean

log "2/3 expo web export"
( cd "$BUILD_DIR/packages/app" && PASEO_WEB_PLATFORM=electron npx expo export --platform web )

log "3/3 electron-builder (unsigned, no notarization, v$VERSION, $APP_NAME)"
# CSC_IDENTITY_AUTO_DISCOVERY=false: no Developer ID needed.
# -c.mac.target=dir: the .app only. Add dmg/zip if you want to hand it out.
# The ${...[@]+...} guard is for bash 3.2, where expanding an empty array under
# `set -u` is an error rather than nothing.
( cd "$BUILD_DIR" && CSC_IDENTITY_AUTO_DISCOVERY=false npm run build --workspace=@getpaseo/desktop -- \
    -c.mac.notarize=false \
    -c.mac.target=dir \
    -c.extraMetadata.version="$VERSION" \
    ${BUILDER_NAME_ARGS[@]+"${BUILDER_NAME_ARGS[@]}"} )

# electron-builder names the .app directory after executableName, which the
# config pins to "Paseo" and -c.productName does not touch. Do not override that
# too: after-pack.js and after-sign.js both hardcode
#
#   const EXECUTABLE_NAME = "Paseo";  ... path.join(appOutDir, `${EXECUTABLE_NAME}.app`)
#
# and after-pack uses it to find the Resources to prune, which is ~210 MB of
# native modules. Rename it here instead, once the build and its hooks are done.
# Nothing inside cares: the bundle's identity is in Info.plist, where
# -c.productName already set CFBundleName and CFBundleDisplayName, and the
# executable stays Contents/MacOS/Paseo. Rename before the re-sign below, so the
# signature is taken on the bundle as it will be installed.
PACKED_APP="$BUILD_DIR/packages/desktop/release/$MAC_RELEASE_DIR/Paseo.app"
[ -d "$PACKED_APP" ] || die "electron-builder produced no app at $PACKED_APP"
if [ "$PACKED_APP" != "$BUILT_APP" ]; then
  log "renaming the bundle to $APP_NAME"
  rm -rf "${BUILT_APP:?}"
  mv "$PACKED_APP" "$BUILT_APP"
fi

# ---------- disarm the updater ----------
# electron-builder.yml publishes to getpaseo/paseo and auto-updater.ts sets
# autoDownload = true, so a working updater would replace this build with stock
# Paseo — and it WOULD, because the version above is a prerelease of upstream's
# and therefore ranks below it. What stops it is that electron-updater needs
# app-update.yml from the bundle's resources, and `-c.mac.target=dir` publishes
# nothing, so none is written. Assert that rather than assume it: add a dmg or
# zip target one day and this fires instead of silently arming the updater.
UPDATER_CFG=$(find "$BUILT_APP" -name "app-update.yml" 2>/dev/null | head -1 || true)
if [ -n "$UPDATER_CFG" ]; then
  die "the bundle ships an updater config:
    $UPDATER_CFG
  With a prerelease version, upstream's stable release outranks this build and
  the updater would overwrite it. Delete that file, or set PASEO_PACKAGE_VERSION
  to something that outranks upstream, before installing this."
fi

# ---------- re-sign ----------
# electron-builder's ad-hoc fallback signs ONLY the outer binary. The bundled
# Electron Framework keeps Electron's team ID, and dyld refuses to map a binary
# with a different Team ID into an ad-hoc process:
#   Library not loaded: @rpath/Electron Framework.framework/Electron Framework
#   ... mapping process and mapped file (non-platform) have different Team IDs
# The app dies at launch, before any of its own code runs. Re-sign everything.
log "re-signing the whole bundle ad-hoc"
codesign --force --deep --sign - "$BUILT_APP"
codesign --verify --deep --strict "$BUILT_APP" || die "the bundle does not verify after re-signing"

BUILT_FROM=$(git -C "$BUILD_DIR" log -1 --format='%h %s' 2>/dev/null || echo unknown)

cat <<EOF

$(printf '\033[1;34m[pkg]\033[0m') built $BUILT_APP
       version:    $VERSION   (upstream $UPSTREAM_VERSION)
       built from: $BUILT_FROM

The bundle survives a rebuild — release/ is gitignored, and desvio's clean does
not use -x — so installing is a separate decision you can take whenever:

  desvio run install

Or the whole path in one go next time:

  desvio build && desvio run package install
EOF
