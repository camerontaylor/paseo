# TMAD intake execution — 2026-10-24

Status: in progress. User authorized execution of the full intake plan with
Sol medium or Luna high selected by task. No publication, production restart,
force-push or production-state repair has occurred.

## Baseline

- Coordinator checkout: uranus `/home/ctaylor/repos/paseo`, stale planning HEAD
  `7ce6fca98`; source implementation and builds happen on triton.
- Published baseline: `568972505113179d03cc6e2c2c899ba16243cc42`, tag
  `fork/v0.12.0-fork.1`.
- Live neptune manifest: `origin/custom` then
  `origin/upgrade/basket-0.12.0`; the latter currently resolves to the published
  assembly itself. Preserve this provenance distinction when replacing carries.
- Custom: `d9a9dfa063d8115b6f574f531a9d1d518488ae8a`.
- Base: annotated `v0.12.0` peels to
  `cafe4b01c8522ff39560241c5deb01427dc8dc5b`.
- Source main: `cf39560a31793641f8cb25e2a75435fa4b660325`, unchanged from plan.

## Isolated execution paths on triton

| Purpose | Path / branch |
| --- | --- |
| Baseline and shared dependency seed | `/home/ctaylor/repos/paseo-tmad-intake`, `fork/tmad-2026-10-24-baseline` |
| Trusted Desvio tool and isolated config/state | `/home/ctaylor/repos/paseo-tmad-desvio/` |
| Reproduction assembly | `/home/ctaylor/repos/paseo-tmad-desvio/build-tree` |
| D1 queue executor | `/home/ctaylor/repos/paseo-tmad-d1`, `fork/tmad-2026-10-24-d1-queue` |
| D3 navigation executor | `/home/ctaylor/repos/paseo-tmad-d3`, `fork/tmad-2026-10-24-d3-navigation` |
| D2 Stream executor | `/home/ctaylor/repos/paseo-tmad-d2`, `fork/tmad-2026-10-24-d2-stream` |
| D4 Views executor | `/home/ctaylor/repos/paseo-tmad-d4`, `fork/tmad-2026-10-24-d4-views` |
| D5 routing executor | `/home/ctaylor/repos/paseo-tmad-d5`, `fork/tmad-2026-10-24-d5-routing` |
| D6 diagnostics executor | `/home/ctaylor/repos/paseo-tmad-d6`, `fork/tmad-2026-10-24-d6-diagnostics` |
| D7 voice executor | `/home/ctaylor/repos/paseo-tmad-d7`, `fork/tmad-2026-10-24-d7-voice` |
| D8 thread executor | `/home/ctaylor/repos/paseo-tmad-d8`, `fork/tmad-2026-10-24-d8-threads` |
| D9 integration executor | `/home/ctaylor/repos/paseo-tmad-integration`, `fork/tmad-2026-10-24-integration` |

The Desvio tool was copied from neptune's existing trusted source at
`/Users/ctaylor/src/desvio@db401c5c6cd0e3be15fab9d05a2bb8d5e7a51871`.
No live configuration was changed. An isolated assemble-only run produced
`a3d7a4f02048f176a704c86dc324a5680622f9c8`, whose tree
`1dff9184a4305d15b861a278023e43d7d776f7f7` equals the published baseline tree.
This establishes source reproduction, not runtime acceptance.

Dependencies installed successfully in the isolated baseline. Baseline
`build:server`, full typecheck and lint passed; source editing is released.
All 215 focused baseline tests passed. The receipt is committed at
`ee6c16a7f0b187abaa810ce1d80f0156dfae7a81`; its only committed file is
[`tmad-2026-10-24-baseline.md`](tmad-2026-10-24-baseline.md).
Heavy checks on triton share
`/tmp/paseo-tmad-heavy-checks.lock`; no full local suite is permitted.

D0 corrected one planning assumption: advanced infi B9 is absent from the
published release. Preserve the existing basic diff-stat and accepted infi
history/menu behavior; do not add that separate overlay to this TMAD scope.

## Task ownership

- D0: Sol medium, immutable inputs, isolated assembly, baseline checks/receipt.
- D1: Sol medium, stronger queue/outbox reconciliation and delivery marks.
- D3: Sol medium, navigation/unread/compact controls and deep links.
- D2: Sol medium, durable Stream/global API and pin controls; integration awaits D1.
- D6: Sol medium, diagnostics/CLI; queue inspection integrates after D1.
- D7: Sol medium, native/realtime voice; integration awaits creation/diagnostic seams.
- D4: Sol medium, Views and side surfaces, preserving current panel lifecycle.
- D5: Sol medium, search/routing/Quick launch with explicitly configured API matching.
- D8: Luna high, threaded replies using current side-conversation ownership.
- Source mapping: Luna high, bounded read-only extraction maps (complete).
- Integration: D0 executor continues as Sol medium in a separate candidate checkout.
- Coordinator: package dispatch, review, evidence matrix and release gate.

Next: review feature commits and integrate them in dependency
order. Independent source preparation is permitted in isolated worktrees;
acceptance still waits for reviewed prerequisites. Missing physical-device or
release evidence must stay visible in the matrix.

## Review checkpoints

- D3 keeps current route/panel ownership and applies compact Find through narrow
  hunks. Explicit send preferences and legacy tool-detail choices survive default
  changes; storage write-failure and migration-marker tests remain required.
- D5 requires explicit matcher feature configuration before sending excerpts. It
  uses the supported Responses endpoint and the existing OpenAI credential
  resolver; absent setup retains manual selection and ID lookup.
- D8 keeps the current side-conversation identity and lifecycle. Origin metadata
  must remain host-scoped, survive close/reopen and late hydration, and show an
  unavailable source honestly. Send to main uses the queue-only interface.
- User authorized fleet device-tooling setup and supplied Android access.
  Android platform-tools 37.0.1 are installed on triton and neptune; triton also
  has JDK 21.0.13+9 and Android command-line tools 21.0. Neptune now sees an
  authorized Samsung SM-S921B running Android 16/API 36, over USB and modern
  TLS wireless ADB using an existing pairing. No legacy network ADB was enabled.
  Triton cannot directly reach the discovered wireless endpoint; build there
  and test from neptune. No candidate app was installed or native flow run.
  Triton also has Android API 36, build-tools 36.0.0 and NDK 27.1.12297006;
  build the isolated `APP_VARIANT=development` package `sh.paseo.debug` after
  integration, without replacing production `sh.paseo`.
  Neptune has only Command Line
  Tools, with no Xcode app, simctl or xctrace. User clarified that no iPhone is
  available; proceed with Android and skip Xcode setup. Physical iOS behavior
  remains unverified. Native acceptance still requires observed tests on the
  supplied Android device.
  The documented mobile runner CLI, `agent-device@0.21.31`, is installed and its
  version/help verified on both hosts. No device flow ran. Inspect the repository
  runner before use: it stops the automation daemon, can start Metro, and prewarms
  the iOS runner.

## Source commits awaiting candidate acceptance

D1 is committed at `9582d0f8fb423b5f56339af67808e2eb139f9550`. Its owning
builds, typecheck, lint, format and mandatory commit hook passed. Focused checks
cover queue actions, direct-send reconciliation, service bounds, receipts and
outbox/reconnect/delivery behavior. Candidate acceptance still needs the app
outbox-report sender and idle broadcast direct-outbox preparation, followed by
combined workflow evidence.

D1's routed-destination guard is committed at
`c3756000a9ab050b1cce122d33eedf956a41090a`, integrated by D9 as `e0161fe7a`.
Owning builds, 68 focused tests and full commit-hook checks passed. Expected
destination IDs persist through reconnect and are checked under the agent
lifecycle lane and queue mutation before append. Workspace/project registry
archival uses a separate lane, so simultaneous archival remains a concurrency
limitation. D5's combined daemon regression remains pending.

D2 is committed at `d8be771a4a95b70875a277699fe6506d100b7553`. Owning builds,
full typecheck, lint and format passed. Reviewed corrections include host-scoped
global rows and totals, partial-host coverage, pagination reset on query changes,
and searching retained text/answers before bounding response excerpts. Its
isolated daemon durability suite passed all five cases at that commit, including
restart reads without provider launches and capability gating
(`/tmp/paseo-tmad-d2-stream-durability.log` on triton). Both browser attempts timed
out during Metro warmup before assertions. Read-only fixture diagnosis is in
progress; no browser pass is claimed. The separate fixture follow-up
`813d19da9c58a4ad4f644e69e8c94012381bcc73` adds a bounded timeout override and
streamed bundle draining. Its three focused tests, format and lint passed;
D9 should run the composed browser flow with
`E2E_METRO_WARMUP_TIMEOUT_MS=600000`. The existing POSIX teardown helper only
signals the direct child, so verify isolated Metro cleanup after a failed run.

D7 is committed at `3ffc21ef6acc3d7ffdb88b295026088e73e8407a`. Server build,
format, lint and full typecheck passed; focused voice/runtime/transport tests
passed. Integration must reconcile D5's workspace-creation helper and connect
D6 host diagnostics. Configured-provider roundtrip and Android observations are
still pending; physical iOS remains unavailable.

The user supplied a voice-restricted OpenAI key on triton. D7 stored its
canonical ciphertext in the fleet secrets repository and a private rendered
file at `/home/ctaylor/.local/state/paseo/voice/openai-realtime-api-key` (0600;
parent directories 0700), verified byte equality and moved the temporary input.
Storage/render commits remain local. Use only
`PASEO_OPENAI_REALTIME_API_KEY_FILE` on the isolated voice daemon; this key is
not configured for session matching or global provider use. One bounded live
readiness check on D7 commit `299ef94eace943fa354e8739dea7675902c5d107` passed:
the existing transport connected to the official GPT Realtime endpoint and
received a session-update acknowledgement, then closed without audio or a
prompt (`/tmp/paseo-d7-realtime-readiness.log`). This establishes credential and
session setup only, not speech, mute, native or combined-candidate behavior.

D3's first vertical slice is `81682bb14485b233b20df6da496a1068aeb74130`.
Its formatter, lint and focused checks passed. D9 cherry-picked it as
`b26871cf1` into the clean candidate; build:client, full typecheck and lint passed
on that snapshot. The source checkout's earlier queued typecheck encountered
second-slice edits and is not acceptance evidence. It covers settings/defaults,
favorites, footer, keyboard,
compact Find, tab counts, rename, deep links and message clamp. The second slice,
`b902befab`, adds unread, message clocks, sorting and workspace activity. Its
server build, full commit-hook checks and focused tests passed; D9 integrated it
as `1074e353a`.
The third checkpoint, `f4fe7557959a114c0e04335a3daf1fa1f5cb8928`, adds
history/recents/tab activity and live owning-workspace resolution. Its 71
focused tests, format and lint passed; the authorized hook bypass leaves final
combined build/typecheck pending. These source commits are not evidence of
installed behavior.

D8 carries a cherry-picked D3 dependency at `103c2f458`; integrate D3 once and
select D8-owned commits separately. D8's own provisional checkpoint is
`78b0262b085e32268a5adab70807527af0540a33`, followed by the typing correction
`9abe7adcdcc9267a2cf020d20d853ee4db25abaa`. Client build, exact-tree app
typecheck, 20 focused model/store tests, format and targeted lint passed. The new
side-conversations browser flow remains pending. The existing broad layout-store
file hung during hydration and is not claimed green. D6 supplies the app outbox
report sender; D9 must validate that lifecycle on the combined candidate.

D4's provisional source checkpoint is
`77d22a54c23a531338e6f8f717194e30c45e0c8d`. Format, lint and scoped checks passed;
its isolated typecheck lacks D1/D6 dependencies, so the authorized hook bypass
does not establish acceptance. Review follow-ups cover broadcast draft recovery
and resubscribing visible View chats when a host sync owner is replaced, plus
scope-aware context actions for identical session IDs on different hosts.
The follow-up is committed at `910e7e051fa8b451bb039adb4e26702cd7f28182`;
scoped regressions, format and lint passed. A final one-line typing correction
awaits D9's combined typecheck.

D5's source checkpoints are `498032b3a15c1f19914e5528f93b04ba06df3d58`,
`da15a861` and `882e81f85dc7bf37c593d020b8603fc9d61a69e9`. The last mounts
passive sidebar Find. Its final delta,
`6a8ceaa329045a0873cf8654df1adb17f14e39ae`, mounts explicit guarded routing and
persists the draft until host queue admission is acknowledged. Format, lint,
13 outbox tests and the isolated moved/archived/missing-destination daemon
regression passed. Combined dependency checks and observed workflows remain
pending. Wrong-chat recovery copies the prompt; the original admission may
already run.

D6 is committed at `6ccf07f6778ddaff2acd0736d05333a4dfb83a23` and integrated
as `1423b6602`. Focused server tests passed (44), as did the offline alias
utility (12), app toast test, format and lint. Review fixes include persisted
diagnostic acknowledgement, redaction, principal/capability-scoped UI commands
and counting successful physical sends. D9 connected host voice diagnostics.
Its provisional hook bypass leaves final combined build/typecheck pending.

## Frozen combined candidate

All source deltas are assembled at
`dab56262f019084773157fef0e0f306ed533ad07` in the D9 worktree. Format and lint
passed, and tracked source is clean. Exact-SHA owning builds and full typecheck
are running. Browser, native, Desvio reproduction and release-artifact evidence
remain pending; this is not a release acceptance claim.

Freeze source during validation, or validate a committed isolated snapshot.
The pre-commit hook runs full typecheck; run commits under the shared heavy-check
lock and avoid a second pending typecheck for the same built snapshot. D4's app
UI-command receiver requires D6 protocol/client/daemon delivery, so integrate
that dependency before checking Views and side-placement behavior.

## D9 combined-candidate evidence — 2026-10-24 evening / 2026-10-25

Candidate tip moved from `76013e49d` through three reviewed commits:

- `c18c61b93` fix(app): restore the missing `sidebar.display.sort.assistant`
  label in all nine locales. The D3 port added the new display-preferences sort
  block without the assistant entry, so the "AI's last reply" option rendered a
  raw i18n key whenever every visible host advertised
  `conversationMessageActivity`. Found by label inventory; fixed with the
  legacy block's own wording. Hook typecheck passed (265s).
- `6518b92ad` docs(fork): usage guide, changelog entry, ledger note, README
  link. `fork/usage-guide.md` documents Stream, Views, navigation, Find and
  routing, threads, delivery marks, CLI inspection and voice by their installed
  labels with host-capability requirements.
- `0b02dfada` test(e2e): align the intake browser specs with the shipped Stream
  UI (detail below). Hook typecheck passed (127s).

Environment repairs on triton (both first-surfaced by the first browser run
that reached assertions):

- The integration worktree's per-package `node_modules` symlinks into the
  intake seed are invisible to Metro, so the web bundle failed
  `lucide-react-native` resolution (HTTP 500). Replaced with a real
  `npm ci`; seeded `dist` trees survived.
- `E2E_METRO_WARMUP_TIMEOUT_MS=600000` (fixture fix `813d19da9`) converted
  the earlier warmup timeouts into real results.

Browser evidence (composed runs, isolated daemon per test, triton): all nine
intake-owned tests pass at `0b02dfada` — pins x2, cross-project links x2,
Load more paging, durable checklist, and five side-conversation flows. Seven
first-run failures were triaged; none was a daemon crash:

- Four were ghost selectors for source UX that never shipped: sidebar
  `sidebar-stream` (shipped `sidebar-global-stream`), "Show unresolved
  only"/"Show completed too" (shipped Status segmented All/Open/Done),
  "Pinned" vs the per-chat "Stream pins" tab, and the checklist
  noExplicitAsks empty state. Specs now assert shipped equivalents.
- Per-block pinning does not exist (the context menu pins the whole message);
  the duplicate block-pin step was removed.
- The compact drawer stays open over the destination after a row tap and its
  toggles sit beneath the scrim; the 390px links test enters through the route
  while the desktop sidebar-row path stays asserted. Drawer dismissal on
  navigate is baseline UX worth a product look, not intake code.
- One real flake: the first Load-more transition can flash the empty state
  while the depth-2 query resolves (query key includes depth; 1 pass / 1 fail
  across runs, green on rerun). Recorded as a known issue; not a release gate.

Desvio reproduction at the final tip: assembly `ada9bedb6` merges base
`cafe4b01c` → `origin/custom` → `origin/upgrade/basket-0.12.0` (both
unchanged) → `fork/tmad-2026-10-24-carry`; usage guide and the i18n fix
verified in the assembled tree.

Android: disposable build produces `sh.paseo.debug` (versionName 0.12.0,
versionCode 12000), APK sha256 `a68cc3be…`. Dev-variant shells load app JS
from Metro at runtime, so the APK is byte-stable across docs/JS-only tip moves;
device QA runs Metro from the exact candidate tree. The Samsung device was not
reachable from neptune during this window, so installed Android observations
remain open. Physical iOS remains unverified (no iPhone).
