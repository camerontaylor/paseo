#!/bin/bash
set -euo pipefail
# launchd supplies HOME and PATH; never depend on a login shell or its cwd.
SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
export DESVIO_CONFIG_FILE="${DESVIO_CONFIG_FILE:-$HOME/.paseo-fork/desvio.conf}"
# The config owns shell hooks, so read it with bash rather than parsing assignments.
source "$DESVIO_CONFIG_FILE"
export DESVIO_BASE RELEASE_WATCH_LEVEL="${RELEASE_WATCH_LEVEL:-canary}"
export RELEASE_WATCH_NTFY_URL="${RELEASE_WATCH_NTFY_URL:-https://ntfy.wedrifid.dev/paseo}"
exec node "$SCRIPT_DIR/release-watch.mjs" "$@"
