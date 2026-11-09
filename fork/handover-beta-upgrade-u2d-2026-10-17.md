# Beta upgrade, U2d TMAD baseline handover (2026-10-17)

Candidate branch `fork/tmad-baseline-0.12.0-beta.1` in the isolated worktree
`/home/ctaylor/repos/paseo-upgrade-tmad-baseline`. The U1, U2a, U2b and U2c branches and worktrees
were not touched. Checks run on Neptune in the shared private candidate.

## Inputs

| Input | SHA |
| --- | --- |
| U2c corrected head (base) | `84ba5a6916e9621f8975723ddee06626ca6a6546` |
| Pinned TMAD baseline carry | `139e0c81e8eb51b0f97551171b2217838c3ebab5` |
| Merge base | `94ca59a972a7842b67adfa454e6d0ba606f7cd71` |
| Merge | `27daed7df89a7a2ff06c0f6ce0194c1619034406` (parents `84ba5a691`, `139e0c81e`) |
| Client type and import fixes | `c3a78a49ad47e2e754b30fdb61ade29fa69573eb` |
| Beta-owner integration fixes | `f2ded6715ecae81680f80c53a218977ed315bf74` |

## What the carry is

`139e0c81e` is the head of `fork/tmad-0.11.1`, assembled on the 0.11.1 basket after `custom`,
`fork/carries`, `fork/infi-backend` and `fork/infi-ui` were merged. It therefore contains our own
earlier layers in their 0.11.1 form as well as the TMAD baseline: its own side-conversation repair,
its own wide-header branch pair, and its own copies of the pinned-prompt, plan-card and
project-pull-requests specs. That is why the overlap is 227 paths.

## Denominators

| Measure | Value |
| --- | --- |
| Ours versus base | 1000 paths |
| Carry versus base | 369 paths |
| Changed by both sides | 227 |
| Both-side auto-merged | 215 (121 byte-identical, 94 content-merged) |
| Conflicts (`merge-tree` and the real merge agree) | 12 (19 hunks) |
| Carry-only paths | 142 (49 `fork/plans/tmad-port`, 44 app, 32 server, 6 protocol, rest cli/client/scripts) |
| Content merges equal to the U2c head | 57 |
| Content merges that are unions | 33 |
| Content merges equal to the carry | 4 |

## Conflicts and resolutions

| Path | Hunks | Resolution |
| --- | --- | --- |
| `packages/protocol/src/messages.ts` | 2 | Ours' private `internal` marker and the side-conversation selectors kept; the carry's optional `artifacts`/`companionEntries` agent facts and the `agent.queue.update` selector added with its COMPAT tag |
| `packages/client/src/daemon-client.ts` | 1 | Ours' `EVENT_SELECTOR_FEATURES` map kept and `agent.queue.update` mapped to `durableAgentQueueV1`; the carry's duplicate `VoiceTransport` declaration dropped because the merged file already had it once |
| `packages/app/src/contexts/session-context.tsx` | 1 | Union of the side-conversation selectors and `agent.queue.update` |
| `packages/server/src/server/session.ts` | 2 | U1's subscription-based forwarder kept as the owner (the carry's same-named duplicate was removed); the wait path's liveness check became queue-aware so a queued-but-not-live agent is not reported missing |
| `packages/server/src/server/agent/agent-prompt.ts` | 1 | Ours' delivery/dispatch call kept and the carry's `replaceRunning: params.replaceRunning ?? true` admission control added |
| `packages/server/src/server/agent/agent-projections.ts` | 2 | Union of `internal` and the artifacts/companion facts |
| `packages/server/src/server/agent/agent-prompt.test.ts` | 2 | Import union reduced to `sendPromptToAgent` (the notification helpers moved to `agent-messages`); both test blocks kept |
| `packages/server/src/server/agent/mcp-server.test.ts` | 1 | Ours' aliased import plus the carry's tool-catalog and TTS imports |
| `packages/server/src/server/session.test.ts` | 1 | Both side-conversation test blocks kept |
| `packages/app/src/panels/agent-panel.tsx` | 2 | Beta's panel and composer hooks kept; the artifacts/chat switcher, `RetainedPanel` wrapper and `viewOptions` ported in, with beta's sheet facts row inside |
| `packages/app/src/screens/workspace/workspace-screen.tsx` | 3 | Beta's structure kept (the carry's inline switcher/menu copies retired); `handleViewArtifacts`/`handleFindInChat` restored and threaded into beta's compact tab switcher |
| `packages/app/src/components/message.tsx` | 1 | Beta's renderer kept; the import union of the icons the retained surfaces need |

Three fixes followed the merge, each found by an exact-SHA gate: `VoiceTransport` restored in the
client, the moved notification helpers dropped from the test's union import, and the duplicate
forwarder removed. Two more came from the integration pass: the companion feed now uses beta's
`MarkdownRenderer` (no `enableHtmlish` prop) and the stored-payload builder extracts its stream facts
to stay under the complexity limit.

Four more gate findings, each fixed without changing behavior: the client's `VoiceTransport` type was
restored, the test's union import no longer pulls helpers that moved to `agent-messages`, the
duplicate side-conversation forwarder was removed so U1's subscription lane stays the only one, and
`packages/server/src/server/session.ts`'s event-category switch moved its one-to-one cases into
`DIRECT_EVENT_CATEGORIES` to stay under the complexity limit. The composer memo at
`packages/app/src/composer/input/input.tsx` (the overlay container that renders the dictation and
realtime-voice overlays) was missing `isAgentRunning`, `isCancellingAgent` and `onCancelAgent` from
its dependency list; those are the dependencies added, not voice-overlay-only ones.

### Sign-off recorded before the test edits

The coordinator's sign-off authorizes, in this layer: the bounded test setup fix for the queue
enqueue case (explicit source, targeted response capture that keeps the payload expectations, and an
independent queue-update assertion), with no production reply-routing change; explicit
`delivery.permits` positive and negative proof in the queue ownership case; explicit
`subscription.release.request` coverage separate from `clearAgentTimelineSubscription`; and the
same-client capable, incapable, capable reconnect selector case. A new provider-mounting test file is
acceptable where no existing file fits, reusing the existing suites and jobs.

Final advisor review found that the queue case had not completed the authorized explicit
`delivery.permits` requirement: its earlier receipt established destination isolation and
`SessionAuthorization.allowsOutbound`, which is authorization evidence, not delivery-owner proof.
The side-conversation tests had separate permits assertions; they do not receipt the queue case.
Before this final test-only edit, the inspected design was sent to the advisor: retain the actual
emitted queue update object, assert its owner permitted and unsubscribed/incapable sources denied,
then assert the same object's owner denied after the real release request. Existing authorization,
delivery, release, later-source and downgrade/restoration assertions remain. No proof values or
permits outcomes are synthesized. The changed case alone is rerun with required static gates.

## Audit of all 94 content merges

**57 equal to the U2c head.** Every line the carry added is present in the merged file for 49 of them.
The 8 with differences are all U2b/U2c-owned adaptations, each checked by hand: `docs/expo-router.md`
(the U2c sentence now names the change request), `navigation/history/{model,recorder,model.test}.ts`
(the change request is recorded and replayed), `app/new.tsx` (same line at beta's indentation),
`pinned-prompt.spec.ts` (`LOADED_TURNS` is 14 after the U2c fixture repair),
`workspace-package-scripts.spec.ts` (the U2b compact-owner flow; the carry's compact search is not
adopted by the U2b scope ruling), and `terminal.test.ts` (the carry's CJK round-trip test is present,
the differences are formatting and import order). No unique required carry content is missing.

**33 unions**, reviewed for ownership, guards, ordering and cleanup. The load-bearing ones:
`websocket-server.ts` and `bootstrap.ts` carry the queue service and capability advertisement;
`stores/session-store.ts` carries the revision-guarded queue mirror plus artifact and companion facts;
`composer/index.tsx` and `composer/input/*` carry the queue admission semantics
(`SendBehavior = ActiveTurnBehavior | "queue"`, queue plus pending permission resolves to interrupt)
over beta's composer; `agent-stream/view.tsx` keeps U2c's pin and plan-source plumbing;
`protocol/agent-types.ts` adds only optional artifact types; `agent-manager.ts` honours
`requireNoPendingPermissions`; the nine locale files are unions whose parity suite compares every
locale's key set against English; the rest are docs and test-infrastructure unions.

**4 equal to the carry**, each ours plus additions, verified line by line:
`workspace-desktop-tabs-row.tsx` (+6: Search icon and the `viewArtifacts`/`findInChat` labels),
`agent-sdk-types.ts` (+2 optional admission guard), `agent-storage.ts` (+4/-1 optional artifact and
companion schemas on the stored record; the record schema is not strict, so old records parse and a
downgrade strips the new keys), `operation-permissions.ts` (+25 queue, artifact and voice operations
with read/write scopes; the daemon's own suite asserts every inbound and outbound operation is
authorized).

## The four seams the review asked about

**Queue receipt owner before activation.** `bootstrap.ts` constructs `AgentQueueService` with its
store, agent manager, agent storage and logger before the server accepts connections — the comment
records that loading and dispatching are separate phases — and activation happens after
`beginAcceptingConnections()`. Voice input and composer queueing reach the same service through
`sendOrQueuePromptToAgent`, so one admission and receipt path serves both.

**Selector filtering at reconnect.** The client re-evaluates `filterSupportedEventSelectors` on every
send, "including the restore after a reconnect, so a downgrade to a host without the feature never
sees the selector" (the comment at the call site). The daemon side broadcasts `agent.queue.update`
only to clients that advertise `CLIENT_CAPS.durableAgentQueue`, checked per source.

**Old-host zero send.** The app reads `serverInfo.features.durableAgentQueueV1` before enabling the
durable queue and before flushing the outbox on each server-info arrival; without the flag the client
keeps its local in-memory queue and sends no queue RPC. The selector is dropped for the same reason,
and the queue RPC block is documented as unreachable without the flag.

**Beta voice and Markdown owners.** The carry touches no file under `components/markdown/**`, so beta's
renderer, links, Find and native selection are untouched by construction; the companion feed now
calls beta's `MarkdownRenderer` with its supported props. The audio files take small additive carry
deltas on top of beta's files (base to ours is empty for `audio-engine.web.ts`,
`audio-engine.native.ts`, `playback.ts` and `voice-context.tsx`), so beta keeps the shared audio and
playback owner and gains cancellation-during-preparation and microphone-loss reporting.

## Accepted-layer contracts

Still present after the merge: U1's `forwardSideConversationUpdate` and
`hasSideConversationEventSubscription`; U2a's `providerRenameMigration` and
`enqueueProviderRenameMigration`; U2b's `useWorkspaceScriptsMenuPages` and
`supportsPackageJsonScripts`; U2c's `WorkspaceHeaderBranchesModel`, `PlanHandoffButton`, the pinned
prompt and the recorded `changeRequest`.

## Assembly fixes

Both are present: the session snapshot suite stubs async-storage in memory
(`packages/app/src/stores/session-store.test.ts`), and the queue service is loaded before it is
activated. The app's `pretypecheck` builds the native audio workspace first.

## Gates

All execution uses Neptune's exclusive private candidate, Node 22.20.0. Receipt paths below are
relative to `~/.paseo-fork/candidates/upgrade-0.12.0-beta.1/`. No build or test ran on Uranus.
The retained-file code and corrected browser contracts are committed at
`33e270f60987a29890039f1d619203e55ca27827`. The final browser adapters are
`a61591ddb285e8082591f165f66a068fdfcb86e1`; the delivery-proof test addition is
`87c8049f5985c1604ee864a78633ddb1e19dfd8e`. Neither changes product code. Later handover-only
commits do not retimestamp tests.

The sealed manifest `evidence/u2d/receipts-87c8049f5.sha256` inventories 139 receipt files,
including original failures, final logs, traces, images, videos and wire/snapshot observations.
Its SHA-256 is `f313a88ccb2e73db7b277b1851949ac24f5cd3867630de9e8e4382c385d02bed`.
All entries verify; `evidence/u2d/receipt-integrity-87c8049f5.txt` records the check. The later
advisor receipt, independent coordinator check (`evidence/u2d/coordinator-integrity-87c8049f5.txt`)
and handover-only static receipt are separate from this sealed inventory.

Persistent advisor `3f2c7ea5-1328-4cd7-85c3-8c3d3ddbe4ff` gave final **ACCEPT** for U2d source
and evidence at `87c8049f5985c1604ee864a78633ddb1e19dfd8e`, with no blocking finding in the
code, ownership-proof assertions or reviewed ledger draft. The exact verdict is retained in
`evidence/u2d/advisor-final-87c8049f5.txt`. Acceptance covers this bounded baseline only, with
the gaps below still open; it grants no ADVANCE or activation.

| Gate | Executed SHA | Result and receipt |
| --- | --- | --- |
| Client/server declaration stacks | `f2ded6715ecae81680f80c53a218977ed315bf74` | Both builds exit 0, `evidence/u2d/checks-f2ded6715.log`. Later server changes are the source-reviewed mechanical category extraction and whitespace; current retained-file repair is app-only. |
| App focused baseline | `e63d7fa98085c4b9fbc5ba09464f8651daa1c6a1` | 21 files / 332 tests pass, `evidence/u2d/tests-app-e63d7fa98.log`: composer actions/state, outbox/sync/mirror, voice/audio, Find, companion model, locale parity, U2b scripts and U2c handoff/history/pin. |
| Protocol queue and old/new parsing | `e63d7fa98085c4b9fbc5ba09464f8651daa1c6a1` | 2 files / 29 tests pass, `evidence/u2d/tests-protocol-e63d7fa98.log`. |
| Protocol artifacts/companion/voice | `71dcafa6dc75b0d9735fd7043440049d33ce4f79` | 3 files / 11 tests pass, `evidence/u2d/protocol-remaining-71dcafa6d.log`. |
| Server queue/receipts/collection | `71dcafa6dc75b0d9735fd7043440049d33ce4f79` | 7 files / 87 tests pass, `evidence/u2d/server-remaining-71dcafa6d.log`. This fills the suites not reached by the earlier bailed server batch. |
| Merged prompt and MCP behavior | `71dcafa6dc75b0d9735fd7043440049d33ce4f79` | 2 files / 158 tests pass, `evidence/u2d/merged-agent-tests-71dcafa6d.log`. |
| Session ownership and queue subscription suite | `17771efb2e6d2b1c109a2b86c6e0d46221ffdd81` | 170 tests pass, `evidence/u2d/session-final.log`; later ACK discriminant guard rerun alone at `71dcafa6d`, 1 pass / 169 skipped, `evidence/u2d/static-focused-71dcafa6d.log`. The production `session.ts` delta after this receipt is whitespace-only. |
| Actual queue delivery proof | `87c8049f5985c1604ee864a78633ddb1e19dfd8e` | Changed ownership case 1 pass / 169 skipped, `evidence/u2d/queue-proof-87c8049f5.log`: actual emitted message permits its owner, rejects unsubscribed/incapable sources and rejects its owner after release. Authorization checks remain distinct. This completes the earlier missing proof; earlier session greens alone did not establish it. |
| Registered reconnect handler | `71dcafa6dc75b0d9735fd7043440049d33ce4f79` | 3 tests pass after typed-mock correction, `evidence/u2d/handler-corrected-71dcafa6d.log`. Initial 3/3 at `9ec641052f6ab92314e94a64372f12c5d57216ce` remains in `evidence/u2d/status-handler.log`. |
| Strengthened reconnect selector | `f605c8dd0e49ab6a241cc634cd5a76e93bb94361` | Selector 1 pass and handler 3 pass, `evidence/u2d/reconnect-f605c8dd0.log`. Every incapable request excludes the selector; real completed flush precedes downgrade, exact pending item survives and dispatches once on restoration. Later static findings in that log were corrected separately. |
| Old-host voice adapter | `5d9d91d4337b8e88895dd81e44ec008357bb1a7a` | Changed case 1 pass / 31 skipped, `evidence/u2d/voice-absent-5d9d91d43.log`: exactly two adapter arguments, zero receipt reads and cleanup retained. |
| Unsupported retained-file rendering | `33e270f60987a29890039f1d619203e55ca27827` | New real-feed cases 2/2 pass, `evidence/u2d/retained-files-focused-33e270f60.log`: supplied card opens through workspace-file navigation; absent files use the ordinary empty state. Both keep the upgrade notice and avoid companion mutation calls. |
| Exact retained-file static gates | `33e270f60987a29890039f1d619203e55ca27827` | Typecheck, repository lint and format check all exit 0, `evidence/u2d/static-33e270f60.log`. Advisor source-cleared this exact commit; final receipt review remains separate. |
| Exact browser-adapter static gates | `a61591ddb285e8082591f165f66a068fdfcb86e1` | Typecheck, repository lint and format check all exit 0, `evidence/u2d/static-a61591ddb.log`. Advisor source-cleared both test adapters. |
| Exact final test/code static gates | `87c8049f5985c1604ee864a78633ddb1e19dfd8e` | Typecheck, repository lint and format check all exit 0, `evidence/u2d/static-87c8049f5.log`. The only test delta after the browser receipt is the independently receipted queue proof. |
| U2a provider rename | `46e14f12226658a669ba878170bd9736c736b8fd` | Accepted 4/4 in `evidence/u2a/final-rename-owner.log`; that receipt also contains the owner/config-store cases. |
| U2a mutable owner/config store | `05e01290fbde13058031d30775096bf950d8e042` | Accepted 4/4 and 40/40, `evidence/u2a/fix-owner.log`, `evidence/u2a/fix-config-store.log`. |

Reuse is deliberate: since `e63d7fa98`, app production changes are restricted to the three
retained-file rendering/plumbing files, now covered by the new focused cases and affected browser
flow. Protocol/client/server behavior tested above is unchanged; added or strengthened tests are
receipted separately. U2a test blobs are identical to their accepted heads, and beta's
`components/markdown/**` remains byte-identical to the U2c base. No unchanged green suite was rerun.
The earlier server batch `tests-server-e63d7fa98.log` stopped at its session failure; it is not a
green receipt for later files. The first root-config handler invocation at `71dcafa6d` failed before
collection (`__DEV__`); the app-workspace invocation above is the valid 3/3 receipt.

### Browser evidence and classification

| Flow | Executed SHA | Result and receipt |
| --- | --- | --- |
| Durable queue, desktop 1280 and compact 390 | `400dae50d694ab78a3571cb846f9cf1364c37a7d` | Both pass, `evidence/u2d/browser-adapters-400dae50d.log`: actual daemon/UI pending state, independent Send now and Delete items, promotion/deletion transitions and outbound capture. |
| Queue flag absent, desktop 1280 | `71dcafa6dc75b0d9735fd7043440049d33ce4f79` | Pass, `evidence/u2d/browser-71dcafa6d.log`: local queue path with no durable queue RPC or daemon item. |
| Queue flag absent, compact 390 | `400dae50d694ab78a3571cb846f9cf1364c37a7d` | Pass, `evidence/u2d/browser-adapters-400dae50d.log`, same local-path and zero-durable-RPC contract. |
| Companion flag absent, desktop 1280 | `33e270f60987a29890039f1d619203e55ca27827` | Pass, `evidence/u2d/artifacts-33e270f60.log`: delivered absent flag and supplied snapshot, upgrade notice, file card and HTML preview, exact draft retained, mutation controls absent and both feature RPC families zero throughout. |
| Supported artifacts, desktop 1280 and compact 390 | `a61591ddb285e8082591f165f66a068fdfcb86e1` | Both pass, `evidence/u2d/artifacts-a61591ddb.log`: populated all-items view, canonical entry (compact menu Find plus explicit dismissal), Chat/draft round trip, filter reselection, same card and real iframe preview, return and zero requests in both feature families. This is all-items coverage, not default file visibility or filter persistence. |
| Companion flag absent, compact 390 | `a61591ddb285e8082591f165f66a068fdfcb86e1` | Pass in the same 3/3 browser receipt: actual delivered absent flag and supplied snapshot, upgrade notice/card, no mutation controls, real preview, canonical file-sheet close and exact draft retained, both feature RPC families zero. |

Each browser output directory retains traces, screenshots and JSON attachments beside its named
log. `browser-observations-71dcafa6d.json` and `browser-observations-400dae50d.json` summarize actual
app outbound requests; they do not substitute fixture-client requests for browser traffic.
`artifact-observations-33e270f60.json`, `artifact-observations-a61591ddb.json` and
`artifact-snapshots-a61591ddb.json` preserve the retained-file flows' actual requests and snapshots.
The four final artifact gates are the one retained desktop absent-host pass plus three affected
passes; no single run is described as 4/4. Ordinary workspace-file reads/subscriptions occur during
preview and are allowed. Zero feature RPCs does not mean zero network traffic. Desktop/compact
retained-file and both queue pending screenshots were inspected. The supported desktop trace also
records a caught post-test WebSocket send ("Test ended"); the case and runner pass, with all acceptance
assertions complete. The diagnostic remains in the trace summary.

Superseded failures remain in `browser-71dcafa6d.log`, `browser-compact-9b5a69159.log` and
`browser-compact-5d9d91d43.log`, with their trace directories. They record the unhandled browser
confirm, compact setup expecting a desktop tab, Show All not selected, chooser/menu dismissal
interaction, and the explicitly retracted hidden-entry/no-compact-switcher expectations. The
strict two-backdrop failure is a locator ambiguity; the approved canonical locator selects the
first backdrop and retains its normal actionability and closed-state checks.

The independent pre-repair file-loss observation is `unsupported-observe-9b5a69159.log` (desktop
observation completed, compact observation blocked in dismissal), with
`unsupported-outbound-9b5a69159.json` and `unsupported-snapshots-9b5a69159.json`. Both widths received
real file snapshots; the completed desktop flow rendered zero cards and emitted zero feature RPCs.
This product defect remains distinct from the superseded layout contract. The old-host voice
third-argument failure remains in `voice-absent-9b5a69159.log`; its corrected receipt is above.

At `33e270f60`, the other three artifact cases failed in new test assumptions, after reaching real
cards. Both supported cases passed the first Show All/card and Chat/draft checks, then expected the
Stream filter to persist. The panel conditionally mounts `CompanionFeed`, whose local filter starts
pending-only, in both this integration and pinned `139e0c81e`; the owning doc promises Chat/draft
retention, not Stream-filter persistence. Before editing, advisor and coordinator approved checking
Show All on reentry, clicking it, checking Show Open Only and the same card, then preserving preview,
return, draft and full-flow zero-RPC checks. Classification: unsupported test assumption, separate
from the retained-file defect.

The compact absent-host case passed the actual supplied card and iframe heading, then tried the tab
chooser behind the file sheet's backdrop. Its page snapshot shows the preview dialog and preserved
draft underneath. Beta's `SheetTabs` and existing compact sheet suite own file opening in a sheet.
Before editing, advisor and coordinator approved the existing `closeSheet(page, "u2d-report.html")`
adapter after the unchanged preview assertions, verifying sheet/preview closed and the same
composer/draft/full-flow zero-RPC checks. Classification: harness file-tab assumption against beta
compact sheet ownership. The original 60-second timeout and traces remain in
`evidence/u2d/artifacts-33e270f60/`; no timeout or product change is made, and the green desktop
absent-host case is not rerun.

## Gaps

- Native Find is a native surface; the browser proof cannot reach it, so it stays an unverified
  device check rather than an implied pass.
- Device audio capture and playback, packaged Electron and nine-locale visual checks remain U7 work.
- Earlier upstream-beta environment failures involving the Claude provider/binary, packaged zsh
  prompt and missing `gh` remain open; this layer does not waive them.
- Capability flags (`durableAgentQueueV1`, `companionStreamPortV1`, `durableVoiceInputV1`) are
  recorded as source presence only. No activation is claimed, and C1, C2, A3 and the rest of T0-T10
  are out of this layer.

## Test-only changes, classified before editing

The replacement writer preserved clean `9ec641052` and its registered-handler 3/3 green receipt
(`evidence/u2d/status-handler.log`). Advisor review accepted the registered-handler architecture and
requested stronger reconnect proof. The coordinator explicitly approved these test-only refinements:
await the real first flush promise before resetting the enqueue spy; retain the exact pending
`item-2` through downgrade, then dispatch it exactly once when capability returns; and check every
incapable-transport subscription for absence of the queue selector. Existing assertions and product
code remain unchanged. Only the changed reconnect files are rerun after this strengthening.

At `f605c8dd0`, the strengthened handler passes 3/3 and the selector case passes 1/1. Exact-SHA
static checks found the mock's inferred empty argument tuple, an unsafe acknowledgement cast in the
existing queue subscription case, and formatter whitespace in `session.test.ts` and `session.ts`.
Before the carry-test edit, the advisor and coordinator approved: reuse the real enqueue signature;
find the acknowledgement by type and request ID and throw if missing; preserve every assertion;
format through npm with the `session.ts` change confirmed whitespace-only. These are test harness,
test safety and formatting corrections, with no production behavior change.

At `71dcafa6d`, the desktop durable browser case reached a real pending daemon item and its UI,
then failed because the test expected a DOM confirmation. The browser uses `window.confirm`,
which Playwright dismissed without a listener. Classification: unhandled browser-confirm
interaction. Before editing, the advisor and coordinator approved observing the actual dialog
(waiter before Delete, exact localized type/text, accept), preserving all deletion, independent
promotion, daemon and wire assertions. They also approved cleanup of only this helper's fixture on
setup failure, preserving the original error and handing cleanup to the caller only on success.

Both compact queue cases stopped in setup because the new helper expected an always-visible
desktop title tab. Both populated artifact cases reached Stream but expected files under its
default pending-only filter. Before editing, the advisor and coordinator approved two harness-only
adaptations: verify compact title/running in beta's canonical chooser, dismiss it, then verify Stop
and the working indicator; select Show All and verify Show Open Only before the same real artifact
card assertion. This proves the all-items view, not default visibility. Unsupported-host exposure
and the compact switcher's presence remain independent failing assertions; no product fix is
authorized by these adaptations.

At `400dae50d`, both durable queue widths, compact local queue and desktop all-items artifacts
pass. The compact artifact click is intercepted by the canonical chooser's bottom-sheet backdrop
after View artifacts selects the view. Before editing, the advisor and coordinator approved an
explicit chooser dismissal and closed-state assertion before the unchanged filter/card/wire steps.
Classification: access after explicit dismissal, not automatic dismissal. The independent compact
switcher failure remains. An isolated unsupported-destination observation is also authorized;
owning-doc policy tension requires an explicit ruling before any visibility or expectation change.

The `9b5a69159` focused run exposed a previously unreceipted old-host voice assertion: the real
adapter deliberately receives exactly `(true, "agent-1")`, with no durable options, whereas the new
test expected a third argument containing null. Advisor and coordinator approved the exact single
two-argument assertion with capture, zero receipt reads and cleanup retained. Classification:
absent durable options, not a transmitted null identity. The chooser's coordinate dismissal also
hit the menu overlay; the approved canonical backdrop locator and position replace that click,
preserving the closed-state assertion and every subsequent artifact assertion.

### Retained-file defect and explicit contract ruling

The pinned baseline's owning doc requires compact Chat/Stream navigation and an older-host
upgrade notice with existing files retained. The advisor explicitly retracted its earlier hidden
entry/no-compact-switcher requirements; the coordinator approved correcting those browser
contracts as baseline preservation. Original suppression/layout failures remain recorded as
superseded assertions, separately from the retained-file defect below.

Before repair, `9b5a69159` trace observations prove that actual app-bound agent snapshots at both
widths contain `README.md` and seeded `unsupported-report.html`. The completed desktop observation
collects two files but renders zero cards, with both the Stream upgrade notice ("Your file artifacts
are below") and an artifacts unsupported notice. Actual app outbound artifact and companion RPC
counts are zero. The absent companion flag is passed again as `ArtifactFeed` support, whose early
return suppresses supplied files. This contradiction also exists in the pinned carry; it is not an
integration regression or a waiver.

Before editing, advisor and coordinator approved removing that sole artifact support prop,
plumbing and early return. The companion gate and upgrade notice, connection/empty states,
supported-host mutations and file-opening behavior stay owned by their existing code. The
unsupported branch receives no mutation callbacks. Focused with-files/without-files cases and
corrected browser gates must prove supplied snapshots, upgrade notice, file card/open, retained
draft, absent companion mutation controls and zero artifact/companion RPCs through the whole flow.
Ordinary workspace-file reads and previews are allowed. No wider product change is authorized.

### The queue enqueue case: attribution corrected, not a product defect

The first gate run showed the carry's enqueue case failing, and an early reading called it a
swallowed reply. Observation-only spies on the delivery lanes disproved that: `delivery.reply`
returns true for the enqueue response and `sendOwned` delivers it to the targeted lane with the
requesting socket as its source, and the queue update is not delivered to that socket because it
advertises owned subscriptions, which means the modern lane and a subscription are required. The
case's failure was a lane-model mismatch plus a missing harness stub, not a product defect.

The instrumentation also proved the harness dependency: without `agentManager.getAgent` the enqueue
path answers `rpc_error: Request failed: createStub: "getAgent" was called but not stubbed`, so every
queue case that enqueues needs that stub. The spies were removed and the case now runs on the modern
model with its payload expectations unchanged, alongside a separate legacy capability case.

Recorded before any edit, per the sign-off. Every item below is a test or test-fixture change; no
product behavior changes and no expectation is relaxed. If a new case exposes a defect, the cause and
a repair design go to review before any product edit.

| Change | Kind | Where |
| --- | --- | --- |
| Side-conversation capability case subscribes all three sources, keeps its expectations, adds `allowsOutbound` assertions for update and removal, separates release suppression from capability removal, keeps the legacy capable case | Setup correction to match accepted U1 semantics | `packages/server/src/server/session.test.ts` |
| Queue subscription cases: capable and subscribed receives, capable and unsubscribed does not, release suppresses, mixed sources stay isolated, downgrade restores | New cases | `packages/server/src/server/session.test.ts` |
| Same client through capable, incapable and capable again, asserting the outbound selector list each time | New case | `packages/client/src/daemon-client.test.ts` |
| Registered status handler driven with a pending outbox through absent, capable and downgrade | New case in a new suite, because no existing suite mounts the session provider and a production extraction is not authorized | `packages/app/src/contexts/session-queue-resume.test.tsx` |
| Voice runtime with the durable-voice feature absent mints no transport generation and sends no receipts read | New case | `packages/app/src/voice/voice-runtime.test.ts` |
| Audio cancel-during-preparation, mic loss and stale-callback cases | Existing carry cases, run and cited, not duplicated | `packages/app/src/audio/*` |
| Queue promotion and deletion with daemon and UI assertions; artifacts view and compact entry with outbound capture; corrected old-host retained-file contract under the explicit ruling above | New cases and approved contract correction | `packages/app/e2e/browser/agent-message-submission.spec.ts`, `packages/app/e2e/browser/agent-stream-ui.spec.ts` |
