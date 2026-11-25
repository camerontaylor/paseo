APPROVE

# Review: TM-07 Native Find — `intake/tmad-native-find`

Reviewer: read-only audit on pluto. No files edited except this report. No builds,
tests, installs, commits, or ref modifications performed. All verification via
read-only `git -C /home/ctaylor/repos/paseo` commands (rev-parse, cat-file/show,
diff, log, merge-base, grep) plus reading source files and `/tmp/tmad-port/logs/`.

Inputs read first, in order: `/tmp/tmad-port/COMMON.md`, `/tmp/tmad-port/plan.md`
(Scope row "Native chat search wrapper", Branch/removal TM-07 row, Verification
"Native Find" row, P6), `/tmp/tmad-port/brief-TM07.md`,
`/tmp/tmad-port/evidence/TM-07.md`.

## Identity (verified)

- Branch: `intake/tmad-native-find`. Base: `6166a7aca` (v0.11.0-beta.3) — HEAD's
  sole parent is `6166a7aca` (`log --format='%H %P'` → `5f3634ad… 6166a7aca…`).
- HEAD `5f3634ad43256c18f9f41667348c65fe1b03d7f4` matches the claimed SHA exactly.
- Single commit (`log --oneline 6166a7aca..intake/tmad-native-find` → one line).
- Trailers present on the commit: `Source-Repo: tmad4000/paseo`,
  `Source-Commit: 51fb7693d`, `Port-Feature: TM-07`. (blocking-grade provenance OK)
- Diff stat matches the report: 21 files, +499 / -9, same file list.

## 1. Diff vs declared base — correctness (verified by reading the diff)

- Base stub confirmed no-op: `6166a7aca:…/chat-find/index.tsx` renders `children`
  directly and `useChatFindSelectedMessageId` returns null. The port replaces it
  with the real wrapper; no removed search scaffold resurrected (`model.ts`,
  `index.web.tsx`, `viewport.web.ts`, `ranges.web.ts`, both web tests, `types.ts`
  all have identical blobs across base→source→HEAD; rechecked `model.ts`,
  `index.web.tsx`, `viewport.web.ts`, `ranges.web.ts`, `types.ts` myself).
- History loading for out-of-window matches: `chat-find/index.tsx` `load()` calls
  `getHostRuntimeStore().fetchAgentTimeline(serverId, agentId,
  planTimelinePromptJump({epoch, seq}))` — the existing search model/RPC path,
  shared with web. Present as claimed.
- Selected-row reveal/highlight: `native-viewport.ts` `reveal()` polls
  `revealLoadedMessage` until mounted, then `viewportRef.current.scrollToMessage`,
  counts via `countTextMatches`; `strategy-native.tsx` implements
  `scrollToMessage` (history index → `scrollToIndex` viewPosition 0.5; live-head →
  `scrollToOffset` 0) plus `onScrollToIndexFailed` estimate-and-retry. Row tint via
  `ChatFindExpansion` in `index.tsx` + `strategy-native.tsx` wiring. Present.
- Tab-menu invocation (native): `workspace-tab-menu.ts` adds mobile-gated
  `find-in-chat` item (`search` icon, `onFindInChat` input); `workspace-screen.tsx`
  `handleFindInChat` sets `findOpen` then focuses the agent tab via
  `openWorkspaceTabFocused` + `navigateToTabId`, threaded through
  `MobileWorkspaceTabSwitcher → MobileWorkspaceTabOption → menu`. Present.
- Cleanup on hide/unmount: `useEffect(() => () => model.close(), [model])` and
  `useEffect(() => { if (!active) close(); }, [active, close])` with
  `useRetainedPanelActive()`. Present.
- No Stream code: full-branch `grep -in companion|selectedView|updateCompanionEntry|
  viewArtifacts|stream-feed|agent-queue|queue-outbox` over the touched chat-find,
  strategy, store, and tab-menu paths → no matches; full `diff base..HEAD` piped
  through the same patterns → clean. No protocol/server/authorization files in the
  diff (`--name-only | grep protocol|server/|authorization` → empty), so the
  report's "no new wire field/RPC/capability, authorization suite not implicated"
  claim holds structurally.
- Locales: all 9 locales (`ar en es fr ja ko pt-BR ru zh-CN` — the complete set in
  `packages/app/src/i18n/resources/` besides non-locale `plugin-settings.ts`) gain
  exactly the two keys `paneFind.updateHost` and `workspace.tabs.menu.findInChat`.
  Spot-checked `en`/`ar`: `updateHost`/`findInChat` values verbatim match source;
  `viewArtifacts` count is 0 in every local locale file. (Note: source `ar`
  `viewArtifacts` is untranslated English; correctly excluded regardless.)

## 2. Provenance (verified by recomputation)

All six claimed byte-identical blobs recomputed and MATCH:
`chat-find/index.tsx` ee2a2a5…, `matches.ts` ce070d6…, `matches.test.ts` 13fc311…,
`native-viewport.ts` 269fc7a…, `native-viewport.test.ts` 685a7c8…,
`strategy-native.tsx` 5256ffa… (`rev-parse 51fb7693d:<p>` == `rev-parse
intake/tmad-native-find:<p>` for each).
- Adapted-file exclusions spot-checked: source `agent-view-store.ts` owns
  `selectedViews/setSelectedView/getSelectedView`, local has `findOpen` only;
  source `workspace-tab-menu.ts` gates Find *inside* the `onViewArtifacts` block
  with a `view-artifacts-separator`, local gates Find independently on
  `onFindInChat` with its own `find-in-chat-separator` (disclosed adaptation, so
  Find works without the artifacts sibling); local `handleFindInChat` drops the
  source's `setSelectedView(…, "chat")` call and there is no `handleViewArtifacts`;
  no `viewArtifacts`/`FileCode2`/`selectedView`/`companion` strings on the branch
  in the touched screen files. The excluded-items table (MAX_CONTENT_WIDTH,
  NavigationBackButton, compact-time-ago rename, mermaid/presentation churn,
  chat-outline, panel-store restoreNavigationView, enabledOnMobile/onPressIn) is
  consistent with the observed diff, which contains none of them.

## 3. Ancestry and independence (verified)

- `merge-base --is-ancestor` → NOT ancestor for each of: custom (`cbd1210c7`),
  frozen mine (`4cc94e07e`), `origin/mine`, source integration (`51fb7693d`),
  PR#19 (`af247e4f4`). Base `6166a7aca` IS an ancestor. Release-based: PASS.
- Both directions vs `intake/tmad-stream-flow` and `intake/tmad-message-queue`:
  neither contains the other in any of the four checks. No companion/queue
  references on this branch (see §1 grep). No Stream dependency either direction:
  PASS. Removal group TM-07-alone is structurally sound (single commit, no
  descendants required).

## 4. Plan contracts (verified)

- Reuses existing search model/RPC (`ChatFindModel`, `searchAgentTimeline`,
  `fetchAgentTimeline`, `agentHistorySearch` host flag); no scaffold resurrected
  (web/model blobs untouched — §1). The `COMPAT(agentHistorySearch)` carry matches
  an existing upstream flag; no protocol files touched, so no authorization-map or
  capability entries were owed. PASS.
- Scope-row contract ("not a strict Stream dependency", Chat/Stream segments are
  TM-01 scope): honored — segmented-control/store-view and artifacts entries
  excluded, Find entry independently gated. PASS.
- Removal group Native Find alone: PASS (§3).

## 5. Evidence audit

Personally verified (method in §§1–4): identity/HEAD/trailers/diff-stat;
all six blob-parity claims; all adapted-file exclusion spot-checks; locale keys
in all 9 files + verbatim values + zero `viewArtifacts`; history-load,
reveal/highlight, menu-invocation, and cleanup code paths by reading the branch
content; no-Stream and no-protocol-touch by diff-wide grep; all five ancestry
non-ancestor results + base ancestry; four-direction independence from the Stream
and queue branches; base stub no-op status.
- Not verifiable read-only on this host: every test-run claim (vitest files,
  typecheck, lint, format, builds, pre-commit hooks). The cited logs
  `/tmp/tmad-port/tm07-*.log` do not exist here (`ls /tmp/tmad-port/tm07-*` →
  no such file) and `/tmp/tmad-port/logs/` contains no `tm07*` entries (implementer
  ran on neptune). This includes the "pre-existing failures" resolutions and the
  pi-lens advisory disposition. None is contradicted by the repo; the typecheck-
  before-build failure mode described is plausible for a fresh worktree.
- No claim found that contradicts the repo. Minor note (not a discrepancy): the
  report's per-locale "source blob → local blob" table lists 12-char prefixes that
  were not individually recomputed here; the substantive content (two keys added,
  `viewArtifacts` omitted, values verbatim) was verified directly and holds.

## Findings

No blocking findings. No non-blocking code findings either — the diff is
Find-scoped, the adaptations are disclosed and correct, and the bar (plan
contracts + brief, not style) is met.

Non-blocking follow-ups for promotion (already owned by the report's "Native
evidence still required" section; not gates on this review since the brief defers
device evidence to later):
1. (non-blocking) Run the report's 10-item native checklist (reachability,
   focus, loaded/historical/live-head matches, wrap-around, cleanup, older host,
   keyboard, rotation, non-Latin locales) on iOS simulator + Android before P6
   promotion.
2. (non-blocking) Expect the known adapted merge with TM-01 on
   `stores/agent-view-store.ts` + `workspace-tab-menu.ts` (`findOpen` vs
   `selectedViews`/`viewArtifacts`); integrator-owned, not a defect in this branch.
