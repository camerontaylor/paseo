# Native ZCode instructions

Use native ZCode with an explicit provider exclusion only after materializing the
owner's daemon policy in `~/.zcode/AGENTS.md`. ZCode injects this file and workspace
`AGENTS.md` as `meta_user` context. This changes instruction priority and also
applies the global file to ZCode sessions opened outside Paseo.

Keep `daemon.appendSystemPrompt` for other providers. Set
`daemon.appendSystemPromptExcludedProviders: ["zcode"]` to omit that daemon policy
from native ZCode launches. The exclusion is runtime-safe through `paseo reload`
and applies to create, cold resume and session refresh. Explicit per-agent
`systemPrompt` is still passed through and rejected by native ZCode. The fork's
`supportsSystemPrompt: false` refusal remains available to other unsupported providers.

## Prepare the cutover

Run `fork/scripts/migrate-zcode-native.mjs` with `--source` pointing to the live
config and `--output` pointing to a fresh candidate config. Supply `--agents`
for both `~/.zcode/AGENTS.md` and the repository `AGENTS.md`, `--backup` for a fresh
private backup directory, and absolute `--plugin`, `--runtime`, `--node` paths.
The script preserves the root `AGENTS.md` symlink by editing its resolved target.
It merges the exact current policy, checks the native 100KiB file limit and
re-reads every destination before writing the exclusion into the candidate.
Existing instructions, provider models and environment are preserved. Backups
and candidate config contain credentials and are private; do not print them.

Before installing on Intel macOS, run `fork/scripts/prepare-zcode-native-entry.mjs`
with the same plugin/runtime/node paths. It verifies the pinned entry and runtime
bundle hashes, relocates the upstream entry inside `server/`, and creates a thin
entry that supplies runtime defaults before calling upstream contributions.
This covers Diagnostics and Account RPCs as well as provider status; per-agent
environment overrides alone do not reach those paths. Existing operator runtime
variables win. Re-run this preparation after an upstream source update.

The candidate removes ZCode's `extends: "acp"` and ACP `command`, since those
shadow the native provider. It installs `zcode-provider` as the runtime plugin
ID; the selectable provider remains `zcode`. It retains the disabled old plugin
entry as a rollback reference. Keep the `zcode-network-policy` environment hook:
native `createHost` merges the session environment into the Server and Agent.

Root plugin source edits are lifecycle-owned; copying the candidate and running
`paseo reload` does not install its new plugin entry. Use the plugin install
operation on the target daemon, then verify `running` and native provider
availability. Do not restart the production daemon to perform this cutover.

## Pinned runtime

Plugin `paseo-plugin-zcode-provider@0.2.0` is commit
`ca87c2b023338420f9e50f0a3a62dad2e28ed16f` in
`supermomonga/paseo-plugin-zcode-provider`. Runtime is Server 3.14.3 / Agent 0.16.9,
with ordinary Node 24.21.0. Its platform-independent runtime archive SHA-256 is
`a2af414592362d226f92c105d91211e5c4f138cf985b0c86da0eb9163cb9aee7`.

The managed installer excludes Intel macOS. On Neptune use explicit
`PASEO_ZCODE_RUNTIME` and `PASEO_ZCODE_NODE` environment overrides for the verified
archive and local Node executable. No ACP bridge or launcher patch is involved.
The native API still has no additive system instruction field; do not claim that
AGENTS loading preserves system-level priority.

## Evidence

On Neptune (Intel macOS), the pinned native stdio runner passed catalog, draft,
Bash, ACK/completion, cold resume with saved mode/Plan, history, question,
permission, targeted stop/restart, slash completion, session listing, EOF cleanup
and Agent cleanup after Server SIGKILL. It used an isolated home and deterministic
local model; no real credentials or shared user data were accessed.
A copied runner also asserted that global and workspace AGENTS sentinels occur
in native model request messages throughout these scenarios.

Sources and secret-free logs live in
`~/.local/state/zcode-native-upgrade/` and `/tmp/zcode-native-{stdio,policy}.log`.
These prove native transport and instruction loading; they do not substitute for
the final daemon/plugin cutover canary.
