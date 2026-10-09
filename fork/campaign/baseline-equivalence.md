# Baseline / equivalence records — plan §5.3 + A1 s0

Recorded 2026-10-10 by the campaign coordinator. All commands run against the shared repo from the control worktree; evidence quoted verbatim. Plan §5.3 items closed below; A3 s2 re-derives its own equivalence evidence at package time.

## 1. Carries #2237 / #2664 / #3545 / #3950 / #3369 — unchanged vs `refs/research/fork-refresh-*`

Upstream (getpaseo/paseo) PR heads pinned locally, none an ancestor of `custom` (they are upstream refs, our carries are adapted ports): #2237 `c56829d51`, #2664 `750c19dd9` (merge; byte-bound carry), #3369 `cd55ef7b9`, #3545 `439719d9b` (merge; fix commit `c9cd2c6a5` "a stray coalesced timeline flush for a torn-down agent crashes the daemon"), #3950 `e7d556ef8`.

Source snapshots do not contain the carries (grep over `packages/server/src`, both `695c48fed` TMAD and `886a869031…` infi):

- `toolSurface`: absent in both → #2237 carry not superseded.
- `TIMELINE_PAGE_BYTE_BUDGET`: absent in both → #2664 carry not superseded.
- `decisionReason`: absent in both → #3950 carry not superseded.
- `waitForInitialCommands`: 9 hits in both `acp-agent.ts` — upstream-native lineage (upstream #5411), not our carry; the carry's distinctive part is argument hints, and TMAD still sets `argumentHint: ""` at `acp-agent.ts:2978` → #3369 carry not superseded.

Where the carries live today:

| PR | `custom` | `mine` (`95c31f6a9`) |
| --- | --- | --- |
| #2237 toolSurface | absent | `providers/codex/tool-call-mapper.ts` (2 hits) |
| #2664 byte-bounded timeline | absent | `server/session.ts`, `websocket/physical-socket.ts`, `daemon-e2e/timeline-byte-bound.e2e.test.ts` |
| #3369 ACP async commands + argument hints | `providers/acp-agent.ts:483`, `:519` | present (⊂ mine) |
| #3545 coalesced-flush guard | absent (throw sites `agent-manager.ts:5523`, `:5539` unguarded at onFlush) | guard present at `agent-manager.ts:832` (narrow-catch comment) |
| #3950 permission decisionReason | absent | `providers/claude/agent.ts:4959` |

Verdict: **unchanged vs the research refs — the refresh sources neither carry nor supersede any of the five; no adoption package; carries stand where they live.** Tmad-based overlays inherit the old custom and never edit these; the custom/mine divergence above is pre-existing release-channel state, not campaign work.

## 2. CJK #4101 — upstream merge only

`refs/research/fork-refresh-cjk-20261008` = `701bf00d7` = merge of `origin/main` into `fix/cjk-terminal-switch-spacing`; fix commits `f8fda54aa` (restore terminal surface after tab hide so CJK cells redraw), `c65bcb001` (keep wide-char continuation cells out of terminal snapshots), `5a7474c90` (restore retained terminals on presentation). Not an ancestor of baseline `ab10a6694`; the branch is upstream-side work captured at intake.

Verdict: **upstream merge only — no fork adoption in this campaign; no package.**

## 3. Accounts — no-op

`refs/research/fork-refresh-accounts-20261008` = `f9ee6713b` ("Keep provider account usage independent of the banked reset topic" topic branch; 83 files, +4018/−231 vs baseline, dominated by upstream drift).

Verdict: **no-op — research outcome recorded, nothing to adopt, no package.**

## 4. infi fork PR lookup — ours

infi's Linear+PR-header source commit `a3497a660` (B6's source) touches fork-PR topics only in `docs/fork.md` (+13), which relocates to `fork/` or drops per §2.12. No fork-PR-lookup code enters any package allowlist.

Verdict: **our fork PR lookup stands; nothing adopted; B6 excludes it.**

## 5. Release updater — ours; source updater excluded

The refresh deltas touch `packages/desktop/src/diagnostics/updater{,.test}.ts` and `packages/desktop/src/features/auto-updater{,.test}.ts` — none of these paths appear in any §6 package allowlist (B9's bundled-extraction allowlists name only diff-stat paths; B8's name only sleep paths).

Verdict: **our release updater stands; the source updater is excluded from every package.**

## 6. #33 unread vs upstream `mark-unread.ts` — delta list for A3 s3

Upstream `ab10a6694:packages/app/src/workspace/mark-unread.ts` exports only `markWorkspaceUnread(serverId, workspaceId)` (:5). TMAD `fe9086a39` (#33, 17 files, +386/−23) does **not** touch `mark-unread.ts`; it builds its own `unreadTabIds` display state plus an activity sort.

Delta A3 s3 adopts (sort/activity half): `workspace-tab-activity.ts` (+ its test), `workspace-desktop-tabs-row.tsx`, `workspace-tab-presentation.tsx`, `split-container.tsx`, sort wiring in `workspace-screen.tsx`, one line in `explorer-sidebar.tsx`, one locale line × 9, e2e `workspace-tab-activity.spec.ts`. The unread-display half is reconciled against upstream `mark-unread.ts` in A3 s2's equivalence record before any adoption.

## 7. A1 s0 — ACP diagnostics prerequisite (recorded now per execution order)

On the A1 base `custom`:

- Helper exists: `packages/server/src/server/agent/providers/diagnostic-utils.ts:124` — `export function toDiagnosticErrorMessage(error: unknown): string`.
- Used on `custom` only at request-error sites: `acp-agent.ts:128` (import), `:1571`, `:1587`, `:1626`, `:1654`. The startup path has **no** diagnostic normalization — the source's wrapper (`acp-agent.ts:200-205` in the source repos) is missing.
- `creation/index.ts` failure publication (~`:195-215` on `custom`) publishes raw `error.message` with no `toDiagnosticErrorMessage` use — the source's use at `creation/index.ts:208` is missing.
- Source commits verified present: `0bdb40e48` (startup errors; acp-agent.ts +4/−2, creation/index.ts +3/−1, both with tests), `2fd4c4778` (mode rejection; acp-agent.ts +16/−6 + test).

Verdict: **A1 is a real port, matching plan module facts; A1's worker re-verifies at its s0 and reuses `diagnostic-utils.ts` — no second helper.**
