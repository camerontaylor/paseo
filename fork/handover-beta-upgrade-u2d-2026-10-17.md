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

Neptune private candidate, exclusive build token, pinned Node 22.20.0. `build:client`,
`build:server`, `typecheck`, `lint`, `format:check` at the integration SHA, then focused suites for
the queue, receipts, artifacts, Find, voice and audio, side-conversations, protocol compatibility and
the U1/U2a/U2b/U2c suites, then populated desktop and compact browser proof for the queue UI and the
artifacts view.

## Gaps

- Native Find is a native surface; the browser proof cannot reach it, so it stays an unverified
  device check rather than an implied pass.
- Device audio capture and playback, packaged Electron and nine-locale visual checks remain U7 work.
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
| Queue promotion and deletion with daemon and UI assertions; artifacts view and compact entry with outbound capture and capability-absent suppression | New cases | `packages/app/e2e/browser/agent-message-submission.spec.ts`, `packages/app/e2e/browser/agent-stream-ui.spec.ts` |
