# Beta upgrade, U2a common carries handover (2026-10-17)

Candidate branch `fork/carries-0.12.0-beta.1` in the isolated worktree
`/home/ctaylor/repos/paseo-upgrade-carries`. The U1 branch `upgrade/custom-0.12.0-beta.1` and its
worktree were not touched. Checks ran on Neptune in the shared private candidate with pinned Node
`22.20.0` and redirected git hooks.

## Inputs

| Input | SHA |
| --- | --- |
| U1 head (base) | `81831be87bfad35802f0a0bf0a90fc7183c4fc1c` |
| Common carries (manifest `fork/carries-0.11.1`) | `36fdadba65369dc41feb756d5b2c6004dc2a17e8` |
| Merge | `85830573a36216889faccca17124c39f4acfe7f3` (parents `81831be87`, `36fdadba`) |
| Non-Latin coverage | `d92c42b11246955c6fbb990546b9a9ba725ceca0` |
| Capability-absent coverage | `f219e61842fb3b125d9e4065b9e9426ae39296e5` |
| Rename ordering fix | `24dddacd4315f5a3ae5e4090444a2b14c1623063` |
| Final source SHA | `05e01290fbde13058031d30775096bf950d8e042` |

The carry manifest line owns accounts #2785, screenshots #2237, bounded byte hydration #2664,
terminal flush #3545, structured finish reasons #3950, CJK #4101 and argument hints #3369 only.
Merge base with the carry branch is `b56d6ef3c`. The carry changed 94 paths; 40 of them were also
changed by beta.

## Conflicts

Fresh count is 6, confirmed before resolving by `git merge-tree --write-tree` (tree
`2e0105f32`) and by the real merge. Resolutions:

| Path | Resolution |
| --- | --- |
| `packages/protocol/src/messages.ts` | Keep beta `hopliteProvider`; add the carry's optional `providerConfigReplace` and `providerConfigRename` |
| `packages/server/src/server/websocket-server.ts` | Keep the dynamic `hopliteProvider` advertisement; add the two carry flags as `true` |
| `packages/server/src/server/session.ts` | Import union: `AgentDirectory` plus `TIMELINE_PAGE_BYTE_BUDGET` |
| `packages/app/src/provider-selection/provider-selection.test.ts` | Import union: `resolveEffectiveComposerModeId` plus the carry's `resolveProviderIconId` |
| `packages/app/src/screens/settings/providers-section.tsx` | Keep beta's `isConfigOwnedProvider(def.id)` removal guard; add the carry's account add/edit/icon props |
| `packages/server/src/terminal/terminal.test.ts` | Keep beta's CJK round-trip test (try/finally plus continuation-cell assertions); drop the duplicate carry copy |

## Retirements

| Topic | Decision and evidence |
| --- | --- |
| #3369 argument hints | Retired by source equivalence. Beta `acp-agent.ts` already maps `command.input?.hint ?? ""` into `argumentHint`; the merged file holds one copy and the carry contributes no unique production code. The carry's fixture case (`input: { hint: "query" }`, expectation `"query"`) is compatible with beta production and stays as coverage. |
| #4101 CJK server and protocol | Retired by source equivalence. Beta `protocol/terminal-snapshot.ts` and `server/terminal/terminal.ts` already contain the byte-identical `cell.getWidth() === 0` continuation handling from upstream #6452. |
| #4101 CJK app emulator | Retained. The emulator contract, native grids, webview, terminal pane and runtime changes are unique to the carry and merged cleanly. |
| #3950 structured finish reasons | No carry delta. The branch carries the same code as the baseline; the baseline already owns it. |

The carry COMPAT tags were kept as written. The stale `v0.2.X` placeholder versions are recorded
here rather than rewritten into release provenance.

## Semantic audit of the auto-merges

The 34 files changed by both sides that merged without a conflict were reviewed for call sites,
guards, ordering and error paths. Mechanical presence of carry-added lines was used only as an
inventory. The only carry-added lines absent from the result are the three lines of the duplicate
CJK test copy that beta's version re-expresses inside try/finally with a `dispose()`.

- **Accounts transactions.** `daemon-config-store.ts` holds both `removeProviders` and
  `replaceProviders`/`renameProviders` with the apply-and-rollback transaction and a joined
  rollback error. Beta's config-owned removal restriction is preserved in the UI guard while the
  account props come from the carry.
- **Rename ordering and persisted-agent migration.** `websocket-server.ts` repoints live agents
  first (`renameProviderOnLiveAgents`), then broadcasts the config change, then runs
  `agentStorage.renameProvider` per rename, isolating a per-rename failure and broadcasting a
  second config change only when records moved. The live-agent step runs before storage so a
  persistence flush cannot write the old provider id back over a migrated record. The comment on
  `renameProviderOnLiveAgents` states that ordering.
- **Provider-home routing and scoped usage.** Credential-home routing lives in the usage-source
  plugins (`CLAUDE_CONFIG_DIR` then `CLAUDE_HOME` then `~/.claude`, keychain routes, Codex
  `codexHome`), and `plugins/index.ts` invalidates account usage sources on a `providers` config
  change. The app's usage model carries per-account pins and the snapshot manager adds
  `baseProviderId` for grouping and icon inheritance.
- **Capability-absent behavior.** `providers-section.tsx` reads `providerConfigReplace` and
  `providerConfigRename` through `useHostFeature`; account editing is hidden without the former
  and the rename control is hidden without the latter. `f219e6184` adds the negative case to the
  section suite. Adding an account stays offered on a host without the flags. That is the shipped
  carry behavior, recorded here rather than changed.
- **Hydration.** `TIMELINE_PAGE_BYTE_BUDGET` (4 MiB) is added to `websocket/physical-socket.ts`
  and wired into the projected timeline page selection in `session.ts`. Beta never changed that
  module, so the constant is carry-only. The daemon e2e suite asserts bounded projected page bytes
  through real fetches, non-empty pages, cursors that strictly advance, a stall guard, and
  complete coverage of 400 entries.
- **Screenshots.** `codex/tool-call-mapper.ts` materializes `_meta["codex/toolSurface"]`
  screenshots out of timeline entries and keeps the explanation of the 0.6 MB inline payload.
- **Flush guard.** `agent-manager.ts` wraps the coalescer `onFlush` in try/catch and warns
  instead of letting a torn-down agent's deferred flush reach the process as an uncaught throw.
- **CJK emulator.** The retained app-side changes merged without conflict; the server and protocol
  sides are beta's.

## Receipts

All evidence paths are under
`/Users/ctaylor/.paseo-fork/candidates/upgrade-0.12.0-beta.1/evidence/u2a/` on Neptune.

Static gates at `f219e6184`: `build:server`, `typecheck`, `lint`, `format:check` all exit 0, tree
clean.

Focused suites, `npx vitest run <file> --bail=1`, run per file:

| Suite | Result |
| --- | --- |
| server provider-snapshot-manager, daemon-config-store, acp-agent, codex tool-call-mapper, agent-manager, timeline-page-bounds, usage provider-accounts, usage provider-account-discovery, usage-session | 0 |
| server daemon-e2e timeline-byte-bound | 0 |
| protocol terminal-snapshot | 0 |
| app providers-section (with the new negative case), provider-selection, terminal-emulator-runtime, provider-account-form-model, terminal-input.native | 0 |
| app browser chat-find ranges (new wide-character case), assistant-selection-copy content (new non-Latin case) | 0 |
| server claude agent, server terminal, cli 15-provider | 1, attributed below |

Baseline attribution at `81831be87` runs the same three files with the same commands:

- `server/src/server/agent/providers/claude/agent.test.ts` fails on "resolves the installed
  Claude Code version" with `Claude binary not found while resolving`; the binary is not
  provisioned in this environment.
- `server/src/terminal/terminal.test.ts` fails one case, "loads the user's zsh prompt when the
  integration dir is packaged", expecting `PASEO_CUSTOM_PROMPT> `; 41 pass and 3 skip.
- `packages/cli/tests/15-provider.test.ts` fails "provider models claude should exit 0" because
  the daemon reports the claude provider unavailable.

All three fail identically at the U1 head, so they are inherited environment failures, not carry
regressions. No assertion was weakened.

## Rename ordering correction

The first audit of the rename path checked ordering inside one migration and missed ordering
between migrations. Two config changes could overlap: an A to B migration that was still writing
when the B to C change ran found no B records, and the first migration then persisted B while
configuration already said C. The same change published the config captured at change time, so a
completion could republish a superseded config.

`24dddacd4` fixes both. Each change's rename batch is queued on one promise tail, so migration
order follows config order. The stored tail is re-settled after a failure, keeping one bad batch
from wedging the ones behind it while per-rename isolation stays inside the migration. Completion
broadcasts `daemonConfigStore.get()` instead of the captured config. `close()` awaits the tail
after the config subscription is released, so a pending migration cannot write storage after
teardown. The live-agent repoint stays synchronous and first, and beta's transactional owner is
untouched.

The regression lives in `websocket-server.provider-rename.test.ts`: a delayed first storage
migration with a second rename landing while it is blocked, asserting `provider`,
`runtimeInfo.provider` and `persistence.provider` all end at the final id and that nothing
republishes the superseded config once the final one is live; a close-drain case; and a failed
batch that leaves its record alone while the next change still migrates. Run against the pre-fix
source, the ordering and drain cases fail (2 failed, 2 passed); with the fix all four pass.

Receipts at the fix head `05e01290f`: `build:server`, `typecheck`, `lint`, `format:check` all exit
0; the rename suite (4 tests), `mutable-provider-config-owner.test.ts` and
`daemon-config-store.test.ts` pass.

## Gaps

- The claude binary and a usable claude provider are absent here; provider-facing integration
  checks that need them stay open.
- Physical iOS and Android, packaged Electron and nine-locale sweeps remain U7 work.
