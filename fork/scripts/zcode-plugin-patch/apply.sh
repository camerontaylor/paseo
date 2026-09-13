#!/bin/sh
# Re-apply the local paseo-plugin-zcode patches after `paseo plugin update`.
#
# The plugin's managed checkout (~/.paseo/plugins/paseo-plugin-zcode/*/checkout)
# is re-cloned on every update, which wipes both local fixes:
#
#   01  index.server.ts checkoutInstalls() misses the node_modules segment, so
#       the manifest-built bridge is never found and the provider fails with
#       "zcode-acp-server was not found" on hosts without a global install.
#       Upstream PR: lianxin255/paseo-plugin-zcode#1
#
#   02  zcode-acp-server launches zcode without --no-network-family-autoselection.
#       On this LAN (no IPv6 route, provider edge ~270ms) Node's 250ms Happy
#       Eyeballs attempt budget kills every connect and zcode fails all model
#       requests with "Cannot connect to API:". Upstream PR:
#       william0wang/zcode-acp#182
#
#   03  The manifest requires paseo >=0.8.0, which a 0.8.0-beta.1 daemon does
#       not satisfy (semver pre-release), so plugin reload fails with "daemon
#       version is unknown". Relaxed to >=0.8.0-beta.1; drop this step when
#       every fleet daemon is on a stable 0.8.0+.
#
# When both PRs ship (plugin update pulls a fixed zcode-acp-server), the
# matching patch stops applying — that is success, not a failure; the script
# says so instead of erroring.
#
# Usage:  apply.sh [--no-flag]      --no-flag skips patch 02 (hosts where Happy
#          Eyeballs is fine, or zcode is a wrapper script so the flag cannot be
#          injected here — set NODE_OPTIONS in the daemon env instead).
# Run from anywhere; patches must sit next to this script.

set -eu

PATCH_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
PLUGIN_ROOT=${PASEO_PLUGIN_ROOT:-$HOME/.paseo/plugins/paseo-plugin-zcode}

apply_flag=1
[ "${1:-}" = "--no-flag" ] && apply_flag=0

# Newest managed checkout wins, same rule the plugin itself uses.
checkout=$(
  ls -dt "$PLUGIN_ROOT"/*/checkout 2>/dev/null | head -1 || true
)
if [ -z "$checkout" ]; then
  echo "no managed checkout under $PLUGIN_ROOT — install the plugin first:" >&2
  echo "  paseo plugin install https://github.com/lianxin255/paseo-plugin-zcode" >&2
  exit 1
fi
echo "checkout: $checkout"

if grep -q '"checkout", "node_modules"' "$checkout/index.server.ts"; then
  echo "01: already applied"
else
  git -C "$checkout" apply "$PATCH_DIR/01-checkout-node-modules-path.patch"
  echo "01: applied (bridge path fix)"
fi

if [ "$apply_flag" -eq 0 ]; then
  echo "02: skipped (--no-flag)"
elif grep -q -- --no-network-family-autoselection \
  "$checkout/node_modules/zcode-acp-server/dist/backend/resolve.js" 2>/dev/null; then
  echo "02: already applied (or upstream shipped it)"
elif [ ! -f "$checkout/node_modules/zcode-acp-server/dist/backend/resolve.js" ]; then
  echo "02: bridge not installed under checkout/node_modules — manifest build missing?" >&2
  exit 1
else
  if patch -p1 -N -d "$checkout" \
    < "$PATCH_DIR/02-zcode-acp-no-happy-eyeballs.patch" > /dev/null; then
    echo "02: applied (Happy Eyeballs kill switch)"
  else
    echo "02: context mismatch — upstream resolve.js changed." >&2
    echo "    Check whether william0wang/zcode-acp#182 shipped in the installed" >&2
    echo "    zcode-acp-server (then delete this patch); otherwise refresh it." >&2
    exit 1
  fi
fi

manifest="$checkout/paseo-plugin.json"
if grep -q '"paseo": ">=0.8.0"' "$manifest" 2>/dev/null; then
  sed -i.bak 's/"paseo": ">=0.8.0"/"paseo": ">=0.8.0-beta.1"/' "$manifest" \
    && rm -f "$manifest.bak"
  echo "03: applied (manifest accepts beta daemons)"
else
  echo "03: already applied (or manifest shape changed)"
fi

if command -v paseo > /dev/null 2>&1; then
  # Non-fatal: right after a first install the plugin may not be registered
  # yet, and a reload is pointless until it is.
  paseo plugin reload paseo-plugin-zcode || true
else
  echo "paseo not on PATH — reload manually: paseo plugin reload paseo-plugin-zcode"
fi
