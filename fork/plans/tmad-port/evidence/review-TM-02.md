APPROVE

# Review: TM-02 durable queue daemon — `intake/tmad-message-queue`

Reviewer: read-only audit. No files edited, nothing built or run, no commits,
no pushes, no ref changes. All verification by read-only git inspection
(`rev-parse`, `show`, `diff`, `merge-base --is-ancestor`, `grep`, `log`) and
reading logs under `/tmp/tmad-port/logs/`. Branch HEAD at review time:
`91392d6beed3fc49f9be7496a70b8d5822957d4c` (matches the report's claimed HEAD).
Declared base (custom floor): `cbd1210c7d15fbdaac02cab8375cdcf2dd6bd234`.
Six commits base..HEAD, matching the report's `git log`.

Read first, in order: `COMMON.md`, `plan.md` (Queue and composer, Voice and
lifecycle, Branch and removal contract, P3), `brief-TM02.md`, `evidence/TM-02.md`.
All section references below are to those documents.

## 1. Ancestry — PASS

| Ref | Check | Result |
| --- | --- | --- |
| custom `cbd1210c7` | `merge-base --is-ancestor` vs branch | ANCESTOR — expected floor ✓ |
| mine `4cc94e07e` (= `origin/mine`, same SHA) | `merge-base --is-ancestor` vs branch | NOT ancestor ✓ |
| source integration `51fb7693d` | `merge-base --is-ancestor` vs branch | NOT ancestor ✓ |
| source head `f0d5507d2` | `merge-base --is-ancestor` vs branch | NOT ancestor ✓ |
| commit count `cbd1210c7..HEAD` | `rev-list --count` | 6 ✓ |

Minor report stale-note (non-blocking, §6.2): the report says the `mine` ref
"does not exist on this host". It does — `4cc94e07e` and `origin/mine`
resolve to the same SHA — and the conclusion still holds (NOT ancestor).
No action needed beyond the correction recorded here.

## 2. Legacy send contract (plan's hardest line) — PASS

- Extracted `handleSendAgentMessageRequest` from base (`cbd1210c7`) and branch
  and diffed: **IDENTICAL**. Old `send_agent_message_request` with no queue
  intent keeps exactly the receipt-backed interrupt path including dedup
  (`messageReceipts.send` with `prepare` + `send`, `activeTurnBehavior ??
  "interrupt"` defaulting, `messageId`-less direct send fallback).
- The source's two moves are both absent:
  (a) no queuing on omitted `activeTurnBehavior` — the handler never consults
  the queue; (b) no receipt bypass — the receipt service call is untouched.
- `send-or-queue.ts` (the helper the source wired the legacy path through)
  requires explicit `intent: QueuedAgentDeliveryIntent`; without it the helper
  is a plain send. The legacy handler is NOT routed through it (report's
  exclusion claim confirmed: `dispatchAgentQueueMessage` handles only
  `agent.queue.*`; `send_agent_message_request` dispatches to the unchanged
  legacy handler). The branch's `sendOrQueuePromptToAgent` correctly inverts
  the source default (source queues any busy prompt; branch queues only with
  explicit intent).
- Corroborating test exists on the branch:
  `session.test.ts:6055 "a legacy send_agent_message_request never reaches
  the queue service"`.

## 3. Wire / authorization — PASS

- Dotted `agent.queue.*` `.request`/`.response` names: enqueue, update,
  reorder, delete, retry, send_now, list, get_item_images (+ `agent.queue.update`
  subscribable event). No flat source names; source `agent.queue.remove` was
  renamed to `agent.queue.delete` per `docs/rpc-namespacing.md` as claimed.
- Feature flag `durableAgentQueueV1` in `server_info.features`; distinct
  capability `durableAgentQueue` (`durable_agent_queue`) in
  `client-capabilities.ts`; client default present
  (`packages/client/src/connection/index.ts:150` → `true`).
- `expectedRevision` on all five mutations via shared base
  `AgentQueueMutationRequestSchema` (update/reorder/delete/retry/send_now
  all `.extend` it); stale revision rejected with `queue_revision_conflict`,
  never overwritten (`store.mutateWithExpectedRevision` throws
  `QueueRevisionConflictError`, queue untouched).
- Authorization maps exhaustive: all 8 inbound requests in
  `INBOUND_PERMISSION` (mutations `workspace.write`, list/get_item_images
  `workspace.read`) and all 8 responses plus the `agent.queue.update` event
  in `OUTBOUND_PERMISSION` (event is `workspace.read`).
- No `.transform`/`.catch`/`.preprocess` in the new queue schemas. The only
  `.transform` lines in the protocol diff are a wire-purity refactor of the
  pre-existing `TextAttachmentSchema` (pure `TextAttachmentWireSchema` split
  out; queue attachment fields use `AgentAttachmentWireSchema`), consistent
  with `docs/protocol-validation.md` — not a violation.
- New enum values (`queue`/`steer_strict` intents, delivery states) gated:
  wire comment requires clients to gate on `server_info.features.
  durableAgentQueueV1`; daemon only emits `agent.queue.update` to sources
  advertising the capability (`canDeliverEventToSource`, both subscribed and
  implicit-legacy paths); old-shaped requests parse and take the legacy path
  (covered by `messages.agent-queue.test.ts` parse-compat + capability tests).
- No image bytes in snapshots: `QueuedAgentMessageImageSchema` is
  descriptor-only (id/mimeType/fileName/byteSize); bytes fetched per-item via
  `agent.queue.get_item_images.request` (`service.getItemImages`).

## 4. Queue semantics (service/store) — PASS

- Stable identity + accept-once incl. `drainedIds` (bounded
  `MAX_REMEMBERED_DRAINED_IDS = 100`); enqueue rejects duplicate ids
  including post-delivery.
- Revision-checked edit/reorder/delete (stale rejected, §3); dispatching items
  refuse edit/delete; uncertain items require explicit retry/discard first.
- Claim→dispatch→correlated receipt→removal: claim persists `dispatching`
  with bumped `attempts`/`attemptSeq` before any send; per-attempt receipt ids
  (`itemId#attemptSeq`) through the real `MessageReceipts.send`; removal only
  after success, recording `drainedIds`.
- Uncertain vs failed: `activate()` recovery resolves `dispatching` claims
  against receipt outcomes (completed→remove; pending→`uncertain`
  `agent_request_outcome_unknown`; no receipt→`pending` for `queue` intent,
  `uncertain` `queue_claim_interrupted` for `steer_strict`). Never auto-resent:
  only explicit `retry` resends uncertain/failed. After
  `DELIVERY_ATTEMPT_LIMIT = 8` known failures the item parks in visible
  `failed` with `lastError`, explicit retry/discard only.
- Refused steer: `QueueSteerRefusedError` un-claims (`dispatching`→`pending`,
  attempt unbumped), never interrupts, never deletes; strict steer goes
  through existing `steerAgentRun` admission.
- FIFO hold-the-line: non-head/non-pending items block the drain; `send_now`
  cross-head delivery is an explicit revision-checked user action carrying the
  post-attempt queue (report flags it as a design call — accepted, inside the
  plan's fences).
- Startup: `bootstrap.ts` constructs the service at init but calls
  `activate()` only after `beginAcceptingConnections()`; recovery loads
  without dispatching, resumes only never-dispatched items on already-idle
  agents, holds ambiguous claims; on-demand agents drain on their next
  running→idle transition (deliberate, documented).
- Archive/delete: `dispatchPendingItem`/`scheduleDrain` fence on
  `isArchived` (archived agents keep queue, never auto-run); agent deletion
  calls `agentQueueService?.deleteForAgent` through the normal lifecycle.
- Persistence: atomic writes via `writeJsonFileAtomic(..., { mode: 0o600 })`
  (mode applied at temp-file creation, additive `atomic-file.ts` change);
  journal before/after with image bytes elided, 64 MiB bound with
  previous-generation rotation; queue bound 50 items; image payload bound
  16 MiB; images by reference in journal and snapshots.

## 5. Custom fences — PASS

- `agent-manager`/ACP/GJC diff base..HEAD: **untouched** (only
  `agent-prompt.ts` changed, +7/−1, additive `replaceRunning?` param defaulting
  to `true` = current behavior). Provider-wrapper forwarding intact.
- Queue delivery passes `replaceRunning: false` (losing a busy race fails the
  attempt instead of replacing the turn); legacy path keeps the default
  (`true`). Fence-preserving by construction.
- Cited fence tests present in logs with claimed counts (§7).

## 6. Provenance and evidence

### 6.1 Trailers — PASS with one non-blocking note
- Import commit `eefbfc134`, adaptation `68f863134` (cites both `51fb7693d`
  and `f0d5507d2` — correctly records the head journal model), protocol-event
  `21b80e206`, wiring `ee8c0d84b`: all carry `Source-Repo: tmad4000/paseo`,
  `Source-Commit`, `Port-Feature: TM-02`. Local-only docs commit `91392d6be`
  carries `Port-Feature: TM-02` only — acceptable for a local file.
- (Non-blocking) The protocol wire commit `6f76c621e` (landed by the previous
  worker) carries **no trailers**. History rewrite to fix one prior commit is
  not warranted; record the wire contract's source derivation here instead:
  adapted from the `51fb7693d` protocol block with renames per
  `docs/rpc-namespacing.md` (`remove`→`delete`, plus new `retry`/`send_now`)
  and a distinct capability/flag. Future imports should trailer every commit.

### 6.2 Blob ledger — recomputed, claims hold
Source blobs at `51fb7693d` vs branch blobs for the five ledger rows all
differ (adapted, as claimed — the report claims no byte-identical files):
`store.ts 7039d635…→5134cea2…`, `service.ts` `ba9ff72e…`→`f0bee779…`,
`send-or-queue.ts 95561c9f…→af81c749…`, `service.test.ts d60a755d…→062944a3…`,
`send-or-queue.test.ts ec208522…→b7b21ee6…`. `store.test.ts` absent at
`51fb7693d` (confirmed) and present at head as `3c6f5446…` (confirmed) —
adapted-from-head claim holds. Deliberate exclusions verified present-as-absent:
no `voiceOwner`/`wrapSpokenInput`/`waitForPendingDispatch` in agent-queue, no
`create-agent` queue plumbing, no `finish-notification` queueing, no
paseo-tools queue integration, no async-`QueueMutator` (local mutator is the
intended sync type under the per-agent lock/tail).

### 6.3 Logs — cited results confirmed in `/tmp/tmad-port/logs/`
| Claim | Log tail |
| --- | --- |
| 49 queue tests | `tm02-test-all-queue6.log`: 3 files, 49 passed |
| auth 7 | `tm02-test-auth.log`: 7 passed |
| agent-manager 210 | `tm02-test-agent-manager.log`: 210 passed |
| ACP 130 | `tm02-test-acp.log`: 130 passed |
| GJC 43 | `tm02-test-gjc.log`: 43 passed |
| session 157 + 1 pre-existing | `tm02-test-session-full2.log`: 157 passed, 1 failed (`side conversation manager events reach every capable client`), same failure reproduced at base in `tm02-test-sideconversation-base.log` |
| protocol 9, shared 17, queue-session 4 | `tm02-test-protocol-sub`, `tm02-test-shared-files`, `tm02-test-session-queue2` tails match |

### 6.4 Not verifiable read-only
Test execution itself (relied on the logs above — no `npm`/`vitest` run per
the read-only constraint); daemon e2e behavior (not ported — needs real
provider auth, documented as deferred to TM-03/P4); live crash-recovery and
live mixed-version daemon↔client interop; the side-conversation failure's
root cause below the base commit (report honestly scopes it to the custom
floor and requests a neptune owner — endorsed).

## 7. Plan contracts — PASS
- Native Find / Stream independence: no `companion` references added; no
  stream-file changes in the diff (only pre-existing generic "stream" words);
  removal group is additive queue files + narrow seams (`session.ts`
  dispatch/delegate, `bootstrap.ts` construct/activate/stop, `websocket-server`
  plumb-through, `agent-prompt.ts` optional param, `atomic-file.ts` mode
  option, `message-receipts` outcome reader, auth maps, protocol block, docs).
- No removed scaffold resurrected; no Stream dependency in either direction.
- Known gaps (e2e deferral, split mixed-version coverage, send_now cross-head,
  strict-steer idle fallback, on-demand resume) are all documented in the
  report with rationale inside the plan's fences — no hidden gaps found.

## Findings
No blocking findings. Non-blocking notes: §6.1 (prior protocol commit
trailers), §1 table (mine-ref wording staleness), both corrected/recorded
above with no code action required.
