#!/usr/bin/env bash
set -euo pipefail

# Runs the compact side-conversations flow on a connected Android device.
#
# A `.ad` script cannot seed its own parent agent, and the flow only proves anything against a
# provider that actually answers side questions, so the fixture is created out of band here and its
# tab id is injected as ${AGENT_TAB_ID}. The parent must be a mock agent with `mockSideQuestions`;
# without it the daemon answers `unavailable` and the flow asserts nothing.
#
# Prerequisites, same as every other Android `.ad` flow: the dev client is installed and has loaded
# a bundle from Metro at least once, so the Expo dev launcher does not take the deep link.
#
#   npm run dev:server                                     # daemon on 6768 (needs an isolated PASEO_HOME)
#   cd packages/app && EXPO_PUBLIC_LOCAL_DAEMON=localhost:6768 npx expo start --dev-client --clear
#   bash packages/app/e2e/mobile/run-side-conversation-android.sh
#
# `--clear` is not optional when EXPO_PUBLIC_LOCAL_DAEMON changes: it is inlined at Metro bundle
# time, and a warm transform cache silently keeps the previous value. The failure looks like a
# workspace that never loads, because the app is talking to whichever daemon the stale value names.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DAEMON_PORT="${PASEO_MOBILE_E2E_DAEMON_PORT:-6768}"
METRO_PORT="${PASEO_MOBILE_E2E_METRO_PORT:-8081}"
PASEO_HOME_DIR="${PASEO_MOBILE_E2E_HOME:-${REPO_ROOT}/.dev/paseo-home}"
FLOW="${SCRIPT_DIR}/agent-device/side-conversation-basic.android.ad"
ARTIFACTS_DIR="${PASEO_MOBILE_E2E_ARTIFACTS_DIR:-${REPO_ROOT}/.dev/agent-device-artifacts}"
APP_ID="sh.paseo.debug"

if [[ "${DAEMON_PORT}" == "6767" ]]; then
  echo "Refusing to run against the developer daemon on 6767." >&2
  exit 1
fi

if [[ -z "${ANDROID_HOME:-}" ]]; then
  ANDROID_HOME="${HOME}/.local/share/mise/installs/android-sdk/$(awk '/^android-sdk/ {print $2}' "${REPO_ROOT}/.tool-versions")"
fi
export ANDROID_HOME
export PATH="${ANDROID_HOME}/platform-tools:${PATH}"

fail() {
  echo "$1" >&2
  exit 1
}

command -v adb >/dev/null 2>&1 || fail "adb not found. Run 'mise install' and see docs/android.md."
command -v agent-device >/dev/null 2>&1 || fail "agent-device not found. Run 'npm install -g agent-device'."

DEVICE="${PASEO_MOBILE_E2E_DEVICE:-$(adb devices | awk '/\tdevice$/ {print $1; exit}')}"
[[ -n "${DEVICE}" ]] || fail "No Android device attached. Start an emulator (see docs/android.md)."

nc -z 127.0.0.1 "${DAEMON_PORT}" 2>/dev/null || fail "No daemon on 127.0.0.1:${DAEMON_PORT}. Start it with 'npm run dev:server'."
nc -z 127.0.0.1 "${METRO_PORT}" 2>/dev/null || fail "No Metro on 127.0.0.1:${METRO_PORT}. See the header of this script."

[[ -f "${PASEO_HOME_DIR}/server-id" ]] || fail "No server id at ${PASEO_HOME_DIR}/server-id."
SERVER_ID="$(tr -d '[:space:]' < "${PASEO_HOME_DIR}/server-id")"

# The emulator's own loopback is the emulator. Reverse tunnels give it the host's Metro and daemon
# on the same localhost the bundle was built against, and keep the daemon bound to loopback instead
# of exposing it on the LAN for a test run.
adb -s "${DEVICE}" reverse "tcp:${METRO_PORT}" "tcp:${METRO_PORT}" >/dev/null
adb -s "${DEVICE}" reverse "tcp:${DAEMON_PORT}" "tcp:${DAEMON_PORT}" >/dev/null
# Granted up front so the first-run system dialog never lands on top of the flow.
adb -s "${DEVICE}" shell pm grant "${APP_ID}" android.permission.POST_NOTIFICATIONS >/dev/null 2>&1 || true

FIXTURE="$(PASEO_MOBILE_E2E_DAEMON_PORT="${DAEMON_PORT}" node "${SCRIPT_DIR}/support/seed-side-conversation-fixture.mjs")"
cleanup() {
  PASEO_MOBILE_E2E_DAEMON_PORT="${DAEMON_PORT}" \
    node "${SCRIPT_DIR}/support/remove-side-conversation-fixture.mjs" "${FIXTURE}" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

read_fixture() {
  printf '%s' "${FIXTURE}" | node -e '
    let input = "";
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      process.stdout.write(String(JSON.parse(input)[process.argv[1]]));
    });
  ' "$1"
}

AGENT_ID="$(read_fixture agentId)"
AGENT_TAB_ID="$(read_fixture agentTabId)"
WORKSPACE_ID="$(read_fixture workspaceId)"
DEEP_LINK="paseo:///h/${SERVER_ID}/workspace/${WORKSPACE_ID}?open=agent%3A${AGENT_ID}"

echo "device=${DEVICE} agent=${AGENT_ID} workspace=${WORKSPACE_ID}"

# The flow starts on the parent agent tab. Routing there by deep link keeps the script free of
# sidebar navigation that has nothing to do with side conversations.
adb -s "${DEVICE}" shell am start -a android.intent.action.VIEW -d "'${DEEP_LINK}'" "${APP_ID}" >/dev/null

# No --device: agent-device names Android targets by AVD, not by adb serial, and the script's
# `context platform=android` header already binds the target. Pass PASEO_MOBILE_E2E_AD_DEVICE (an
# `agent-device devices` name) only when more than one Android target is attached.
agent-device test "${FLOW}" \
  ${PASEO_MOBILE_E2E_AD_DEVICE:+--device "${PASEO_MOBILE_E2E_AD_DEVICE}"} \
  --metro-port "${METRO_PORT}" \
  --timeout 180000 \
  --fail-fast \
  --artifacts-dir "${ARTIFACTS_DIR}" \
  -e "AGENT_TAB_ID=${AGENT_TAB_ID}"
