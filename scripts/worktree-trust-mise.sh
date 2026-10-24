#!/usr/bin/env bash
# Trust this worktree's mise config, before any setup step resolves a tool.
#
# mise records trust per absolute config path, so a fresh worktree is untrusted
# even though its .mise.toml is byte-identical to the checkout it was cut from.
# Until it is trusted, every mise entry point in the worktree fails — including
# the shims in ~/.local/share/mise/shims, which is how a systemd-launched daemon
# resolves node. `npm ci` then exits 1 before it installs anything.
#
# Exits 0 when mise is absent or the worktree has no mise config: most
# contributors do not use mise, and this must never be the step that fails.
set -euo pipefail

worktree_root="${PASEO_WORKTREE_PATH:-$PWD}"

mise_bin=""
if command -v mise >/dev/null 2>&1; then
  mise_bin="$(command -v mise)"
elif [ -x "${MISE_INSTALL_PATH:-}" ]; then
  mise_bin="$MISE_INSTALL_PATH"
elif [ -x "$HOME/.local/bin/mise" ]; then
  # Not on PATH under a bare systemd unit, but the daemon still inherits HOME.
  mise_bin="$HOME/.local/bin/mise"
fi

if [ -z "$mise_bin" ]; then
  exit 0
fi

# Only the toml configs carry env vars and templates, so only they need trust;
# a bare .tool-versions parses untrusted. Trusting is per-directory, so one call
# covers every config mise finds in the worktree root.
has_config=0
for config in mise.toml .mise.toml mise.local.toml .mise.local.toml; do
  if [ -f "$worktree_root/$config" ]; then
    has_config=1
    break
  fi
done

if [ "$has_config" -eq 0 ]; then
  exit 0
fi

"$mise_bin" trust --cd "$worktree_root"
