APPROVE

# Review: TM-01 Stream/artifact vertical slice — `intake/tmad-stream-flow`

Reviewer: read-only audit on pluto. No files edited except this report. No npm ci,
installs, builds, or tests executed. No commits, pushes, or ref modifications.
All verification via read-only `git -C /home/ctaylor/repos/paseo` commands
(rev-parse, show, diff, log, merge-base, grep), reading source files at pinned
refs, and reading implementer logs under `/tmp/tmad-port/logs/`. Anything that
would require executing code is marked "not verifiable read-only".

Inputs read first, in order: `/tmp/tmad-port/COMMON.md`, `/tmp/tmad-port/plan.md`
(Compatibility contracts > Stream, Source tracking incl. PR19->#21 rehearsal
requirement, Update loop, P1, Branch and removal contract), `/tmp/tmad-port/brief-TM01.md`,
`/tmp/tmad-port/evidence/TM-01.md` (report under audit).

## Identity (verified)

- Branch: `intake/tmad-stream-flow`. Declared base `6166a7aca` (v0.11.0-beta.3).
- Claimed HEAD `2197619bc` resolves to `2197619bc4a656104e5ab5738de026e1c8353c0e` — matches.
- Nine commits, `git log --oneline 6166a7aca..HEAD`, in order (oldest first):
  `b7672631a` (PR#19 import) → `717b87b18` (rehearsal) → `d39fc66e2`, `1c1f3a196`,
  `86d268768`, `9edd6260d`, `cdf819820`, `b78389b8c`, `2197619bc` — matches the report.
- Diff stat `6166a7aca..HEAD`: 53 files, +4132/-51 (report says +4129/-51; trivial
  recount delta, same file list). No push performed (read-only; refs verified local-only
  by inspection — not verifiable read-only beyond the implementer's claim, accepted).

## 1. Ancestry — PASS

`git merge-base --is-ancestor` against HEAD, all FALSE (not ancestors):
- `cbd1210c7` (custom, also `origin/custom` — same SHA) → not-ancestor ✔
- `4cc94e07e` (also `origin/mine` — same SHA) → not-ancestor ✔
- `51fb7693d` (source integration) → not-ancestor ✔
- Cross-branch: `intake/tmad-stream-flow` and `intake/tmad-native-find` are
  ancestors of each other in neither direction ✔ (independent in both directions).

## 2. Commit structure and trailers — PASS

- Commit 1 (`b7672631a`): trailers `Source-Repo: tmad4000/paseo`,
  `Source-Commit: af247e4f4805e0de4736b07aebf2592d9c2e7b39`, `Port-Feature: TM-01` ✔
- Commit 2 (`717b87b18`): trailers `Source-Repo: tmad4000/paseo`,
  `Source-Commit: 51fb7693d`, `Port-Feature: TM-01` ✔
- Commits 3–9: each carries only `Port-Feature: TM-01`, no `Source-Commit` trailer ✔
  (separate local-fix commits per COMMON.md). Commit subjects map 1:1 to brief step 4
  contracts (wire rename, failure surfacing, bounds, localization, capability gate,
  store narrowing, doc flag rename) ✔.

## 3. Rehearsal claims — PASS with one non-blocking doc nit

Blob parity recomputed (`git rev-parse <ref>:<path>`, source `51fb7693d`):

At rehearsal commit `717b87b18`: 14 of 15 core files byte-identical to source;
only `stores/agent-view-store.ts` differs (intentional: `findOpen` excluded as TM-07
scope — verified in file content, seam comment documents it). `docs/artifact-feed.png`
identical. This confirms the rehearsal genuinely converged on the reconciled snapshot.

At HEAD `2197619bc`: 8 of 15 identical (artifacts/feed, companion model + test,
protocol companion-stream, messages.artifacts.test, backfill.test, artifacts-scan, png).
7 intentional deltas, each matching its stated reason (verified by reading the diffs):
- `docs/companion-stream.md`: single-word `companionStream` → `companionStreamPortV1`
  prose rename (commit `2197619bc`; disclosed in report) ✔
- `companion-stream/feed.tsx`: i18n-ified card titles/triage/empty states/toggle +
  "Stream pin" glossary + toast on `accepted:false` ✔
- `agent-view-store.ts`: `selectedViews: chat|artifacts`, no `findOpen` ✔
- `server/.../companion-stream.ts` + `.test.ts`: sticky pin/Q&A eviction,
  `appendManualCompanionEntry` 100-cap with refusal, 4000-char clipping ✔
- `artifacts/collector.ts` + `.test.ts`: turn collection capped at
  `MAX_RETAINED_ARTIFACTS=200` (source passed `null` for turns), constant renamed
  `DEFAULT_BACKFILL_LIMIT` → `MAX_RETAINED_ARTIFACTS` ✔

Rehearsal-commit scope (`git show --stat 717b87b18`): 21 files, all Stream-scope
(feed, collector, companion-stream + test, backfill test, scan RPC pair +
authorization + session handler + daemon-client + CLI + i18n keys). No upstream-sync
noise: `message.tsx` ActivityLog→Notification flip absent (message.tsx diff at HEAD
is pin/Q&A-only, +95), no `findInChat`, no `agentMessageQueue` flag (websocket-server
diff is the single `companionStreamPortV1` advertisement hunk only) ✔.

Non-blocking nit (N1): the report's rehearsal-metrics prose says "11 of 15 core files
byte-identical" at end-state — this number matches neither the rehearsal commit (14/15)
nor HEAD (8/15). The per-file ledger table itself is accurate and every delta is
justified; only the summary sentence is stale. Fix: restate as "14/15 at rehearsal
commit; 8/15 at HEAD after contract fixes" if the report is ever revised.

## 4. Wire contract — PASS (all verified in file content)

- Flat `update_companion_entry_request` GONE as a wire op: the only remaining mention
  is a code comment explaining the rename (`messages.ts:955`). Dotted pair
  `agent.companion.update_entry.request/.response` present with `accepted/error`
  payload enabling failure surfacing ✔
- Authorization exhaustive with correct permissions:
  `agent.companion.update_entry.request/.response` = `workspace.write`,
  `agent.artifacts.scan.request/.response` = `workspace.read` (responses match their
  requests per plan) ✔
- Single feature flag `companionStreamPortV1` in `server_info.features` (session.ts +
  websocket-server advertisement, dated COMPAT tags `v0.11.0-beta.3-fork / 2027-04-01`);
  source `companionStream`/`artifactFeed` names appear nowhere in schema, advertisement,
  or client registry except an explanatory comment ✔
- Client capability default `companion_stream_port_v1` present
  (protocol client-capabilities + client connection defaults); app declares it at connect;
  capability-absent gate covered by new `host-features.test.ts` ✔
- No `.transform/.catch/.preprocess` in `companion-stream.ts` or the new message schemas ✔;
  all new fields optional (`limit?`, `entryId?`, `status?`, `text?`, feature flag optional);
  both new outbound types are request-correlated responses (`payload.requestId`),
  no pushed top-level events — old clients receive nothing unknown ✔

## 5. Behavior contracts — PASS (all verified in file content)

- Capture after coalescing: `agent-manager.ts` capture guards on `fromHistory`
  (`handleStreamEvent` line ~4318 excludes `fromHistory` and `timeline` events;
  `attachManagedTurnIdentity`/`collectArtifactsForTurn` placement matches the source seam) —
  no second timeline owner, no invented history ✔
- Bounds: `COMPANION_ENTRY_LIMIT=50` × `COMPANION_TEXT_LIMIT=4000` (source) +
  `COMPANION_MANUAL_ENTRY_LIMIT=100` with explicit refusal + pins/Q&A exempt from moment
  eviction + `MAX_RETAINED_ARTIFACTS=200` for turns and backfill +
  `MAX_SCANNED_ENTRIES=20,000` end-turn scan ceiling ✔
- NO recursive `fs.watch` anywhere: sole match is a comment citing
  docs/file-observation.md for why the scan is bounded ✔
- Chat stays mounted: `RetainedPanel` wraps chat content, composer stays mounted via
  `RetainedPanelActivity` + `hiddenPane` in `agent-panel.tsx` ✔; feed contains no
  `sendAgentMessage`/`dispatchComposer`/`cancelTurn`/`grantPermission` path —
  selecting a moment navigates/triages only ✔
- Failed pin/triage mutations surface via panel toast (`toast?.error(t(...mutationFailed))`;
  client throws on `accepted:false`) ✔
- Locales: all 9 files (ar en es fr ja ko pt-BR ru zh-CN) contain the full Stream key set
  incl. `streamPin`; ko is port-authored as disclosed (source has no ko parity source) ✔
- Vocabulary: "Stream pin(s)" throughout; "Pinned prompt" absent from this branch —
  no IP-11 collision ✔
- Tab menu: mobile `view-artifacts` entry (`file-code-2` icon, `onViewArtifacts` input)
  alongside existing items; needs no custom/infi code — TM-01B correctly not needed ✔

## 6. Scope exclusions — PASS

- No TM-07 content: `findInChat`/`find-in-chat`/`findOpen` appear on this branch only in
  the store seam's explanatory comment; no chat-find code, no search RPC changes ✔
- No queue/composer changes: diff file list contains no composer/queue/outbox paths;
  legacy `send_agent_message` path untouched ✔
- No `viewArtifacts`-vs-`viewStream` confusion beyond the disclosed mapping (menu label
  `workspace.tabs.menu.viewArtifacts` = "View artifacts"; in-feed `agentPanel.stream.viewStream`
  = "View stream") — both present, correctly separated ✔

## 7. Evidence audit — logs exist; spot-checked

- `/tmp/tmad-port/logs/tm01-*` present (60+ files): baseline lint/typecheck, per-commit
  build/typecheck/test logs, final app/proto/srv test logs, scoped lint logs ✔
- Spot checks: `tm01-final-app-tests.log` 3 files/41 tests (matches 2 model + 36 i18n +
  3 host-features); `tm01-final-proto-tests.log` 2 files/6 tests (matches 1 artifacts +
  5 update-entry); `tm01-final-srv-tests.log` 4 files/27 tests green;
  `tm01-baseline-lint.log` shows the claimed pre-existing failures in untouched files
  (`composer/index.tsx` refs/purity, `agent-panel.tsx`, `overlay-root.ts`, stores) ✔
- Non-blocking nit (N2): `tm01-final-srv-tests.log` records only the vitest summary, not
  the invoked command/file list, and 27 does not obviously reconcile with the report's
  per-file counts (12 companion + 3 collector + 4 backfill + 7 auth = 26). Future logs
  should echo the exact command. The one-test gap is unaccounted for but immaterial
  (all green either way).

Not verifiable read-only: that the logged test/typecheck runs reflect the exact HEAD
tree (logs could in principle be stale); that UI/layout/focus behavior is preserved
(matched source/port screenshots + native evidence are deferred per brief step 6 and
plan P1.6 — correctly flagged as outstanding, not blocking this code review);
device/host-interop behavior (old-client parse-compat, capability gating across forks)
beyond the unit-tested schemas.

## Findings

No blocking findings. Two non-blocking documentation nits:
- (N1, non-blocking) Stale "11 of 15" parity summary sentence — ledger table is correct;
  fix only if revising the report.
- (N2, non-blocking) Srv-test log lacks command echo; 27 vs 26 count reconciliation —
  process improvement for future evidence logs.

## Verdict rationale

Ancestry clean, provenance trailers correct, rehearsal converged then intentionally
diverged only for contracted reasons, every Stream wire/behavior contract verified in
file content, scope exclusions hold, TM-01B correctly unneeded, removal group is TM-01
alone per the Branch and removal contract. UI/native evidence remains deferred work
owned by P1.6, explicitly not part of this branch's acceptance. → APPROVE.
