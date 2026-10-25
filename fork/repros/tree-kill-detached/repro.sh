#!/usr/bin/env bash
# Usage: repro.sh <tree> <label>. Runs a side daemon on 127.0.0.1:6870 with a
# throwaway home, never touching ~/.paseo or the :6767 daemon. See README.md.
set -u
TREE=$1; LABEL=$2
HERE=$(cd "$(dirname "$0")" && pwd)
export PATH=$HOME/.local/share/mise/shims:$HOME/.local/bin:/run/current-system/sw/bin:$PATH
NODE=$(mise which node)
ROOT=$HOME/.cache/tk-repro/$LABEL; HOME_DIR=$ROOT/home; STATE=$ROOT/fake
rm -rf "$ROOT"; mkdir -p "$HOME_DIR" "$STATE" "$ROOT/ws"
SDK=$TREE/node_modules/@agentclientprotocol/sdk/dist/acp.js
cat > "$HOME_DIR/config.json" <<JSON
{
  "version": 1,
  "daemon": { "listen": "127.0.0.1:6870", "relay": { "enabled": false } },
  "features": { "webUi": { "enabled": false }, "dictation": { "enabled": false }, "voiceMode": { "enabled": false } },
  "agents": { "providers": { "fakejcode": {
    "extends": "acp", "label": "Fake Jcode",
    "command": ["$NODE", "$HERE/fake-acp.mjs"],
    "env": { "FAKE_JCODE_DIR": "$STATE", "FAKE_ACP_SDK": "$SDK" },
    "models": [{ "id": "fake", "label": "Fake", "isDefault": true }]
  } } }
}
JSON
P() { "$NODE" "$TREE/packages/cli/bin/paseo" --home "$HOME_DIR" "$@"; }
say() { echo "[$(date +%T)] $*"; }

say "== $LABEL: $(git -C "$TREE" log -1 --format='%h %s')"
( cd "$TREE" && PASEO_HOME=$HOME_DIR "$NODE" packages/cli/bin/paseo daemon run --home "$HOME_DIR" > "$ROOT/daemon.out" 2>&1 ) &
DPID=$!
for i in $(seq 1 60); do P status >/dev/null 2>&1 && break; sleep 1; done
P status 2>&1 | head -3

cd "$ROOT/ws"
A=$(P run --provider fakejcode --cwd "$ROOT/ws" --title spawner -q "sleep=1" 2>&1 | tail -1); say "agent A (spawns shared server): $A"
P wait "$A" --timeout 60 >/dev/null 2>&1
B=$(P run --provider fakejcode --cwd "$ROOT/ws" --title bystander-1 -q --no-wait "sleep=20" 2>&1 | tail -1)
C=$(P run --provider fakejcode --cwd "$ROOT/ws" --title bystander-2 -q --no-wait "sleep=20" 2>&1 | tail -1)
say "agents B=$B C=$C started 20s turns"; sleep 4
SP=$(cat "$STATE/server.pid")
say "shared server: $(ps -o pid=,ppid=,pgid=,sid=,stat=,args= -p "$SP" | cut -c1-90)"
say "its parent:    $(ps -o pid=,ppid=,pgid=,sid=,stat=,args= -p "$(ps -o ppid= -p "$SP" | tr -d ' ')" | cut -c1-90)"
say "archiving agent A (closes its jcode-acp adapter)"; P archive "$A" 2>&1 | tail -1
sleep 2
if kill -0 "$SP" 2>/dev/null; then say "shared server $SP: ALIVE"; else say "shared server $SP: DEAD"; fi
P wait "$B" --timeout 60 >/dev/null 2>&1; P wait "$C" --timeout 60 >/dev/null 2>&1
for id in "$B" "$C"; do say "agent $id last output:"; P logs "$id" 2>&1 | grep -E "done after|disconnected|rror" | tail -2 | sed 's/^/    /'; done
say "server log:"; sed 's/^/    /' "$STATE/server.log"
say "adapter log:"; sed 's/^/    /' "$STATE/adapter.log"
say "daemon log ACP stop lines:"; grep -h -o '"msg":"provider.acp[^"]*"\|Prompt failed[^"]*' "$HOME_DIR"/daemon.log 2>/dev/null | sort | uniq -c | sed 's/^/    /' | head
P daemon stop >/dev/null 2>&1; sleep 2; kill "$DPID" 2>/dev/null
kill "$SP" 2>/dev/null; pkill -f "$HERE/fake-acp.mjs" 2>/dev/null; true
say "== $LABEL done"
