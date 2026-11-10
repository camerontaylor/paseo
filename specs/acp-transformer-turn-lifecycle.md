# ACP transformer turn lifecycle hook

Status: Proposed (2026-11-04). Core change; candidate for upstream.

Let an ACP provider plugin report turns the agent ran without a Paseo
`session/prompt`, such as a turn started from another client attached to the
same agent session. Paseo then shows them as running and finished background
runs. A second fix delivers vendor notifications in wire order relative to
`session/update`, and a third shows live user messages that arrive outside a
prompt.

Consumer: `specs/jcode-provider-plugin.md`. Agent-side counterpart:
`docs/ACP_SHARED_SESSIONS.md` in the jcode repo.

## Background (verified against `custom` @ 0ed8cdfa5)

Everything downstream of the plugin ACP connection already supports turns Paseo
didn't start:

- `ProviderEvent` has `session.turn` with `started | completed | failed |
canceled` (`packages/plugin/src/server/provider.ts`).
- `plugin-provider.ts` `translateTurn` (:1530) keeps the provider's `turnId` and
  sets `currentTurnId`, and `translateTimeline` (:1557) attaches it to timeline
  items.
- The agent manager keeps an existing `turnId` (`attachManagedTurnIdentity`,
  `agent-manager.ts:531`). `onStreamTurnStarted` tracks a `turn_started` with no
  foreground turn as an autonomous run (`agent-manager.ts:5129`).

The plugin ACP connection (`packages/plugin/src/server/acp-internal/connection.ts`)
is the gap:

1. **No way to report a turn.** Turns are emitted only from `admitPrompt`
   (:583). A transformer's `notification()` can return `commands | config |
timeline | notice` (`AcpVendorUpdate`, `packages/plugin/src/server/acp.ts:87`),
   and none of these is a turn.
2. **Vendor notifications are handled out of order.** `routeVendorNotifications`
   (:1217) runs vendor transforms synchronously inside the inbound
   `TransformStream`. `session/update` notifications go through the SDK's
   asynchronous dispatch and then `enqueueNotification` (:1176). A vendor
   notification can therefore be applied **before** `session/update`s that came
   before it on the wire. Today that can misplace vendor `timeline` items. With
   turns, it would end a turn before its last chunks.
3. **Live user messages are dropped.** `reduceUpdate` (:925) discards a live
   `user_message_chunk`, on the assumption that Paseo's own prompt already
   echoed it (:932). A message that came from elsewhere while no Paseo prompt
   is active is lost. Only replay (`replayWindow === "replay"`) turns chunks
   into user messages.

## Changes

### A. `turn` vendor update

In `packages/plugin/src/server/acp.ts`:

```ts
export type AcpVendorUpdate =
  | { type: "commands"; commands: readonly ProviderCommand[] }
  | { type: "config"; config: ProviderConfigState }
  | { type: "timeline"; item: ProviderTimelineItem }
  | { type: "notice"; notice: ProviderNotice }
  | {
      type: "turn";
      /** Agent-scoped id; the shim namespaces it. */
      turnId: string;
      state: "started" | "completed" | "failed" | "canceled";
      error?: ProviderError;
    };
```

Semantics in `connection.ts` (the shim owns the following; transformers only
translate):

- **Namespacing.** Emit `session.turn` with `turnId = "acp-vendor:" + turnId`,
  so vendor turns can never collide with prompt turns (`acp:<clientMessageId>`).
- **At most one open vendor turn.** Track it as
  `vendorTurn: { turnId, settled: Promise<void>, resolve } | null`.
- **`started`:**
  - If a foreground prompt is active (`activePrompt`), drop it and log at
    debug. The agent shouldn't report its own prompts as vendor turns.
  - If another vendor turn is open, first end that one as `completed`, then log
    at warn. The agent runs turns one at a time, so a new start means the old
    turn is over.
  - Then emit `session.turn started`.
- **Terminal states:**
  - Ignore a terminal state that doesn't match the open vendor turn.
  - Otherwise clear `fallbackChunkIds`, call
    `terminalizeTransientItems(state)` (closes running vendor tool rows), emit
    `session.turn`, and resolve `settled`.
- **A prompt while a vendor turn is open.** In `admitPrompt`, if `vendorTurn`
  is open, **await `vendorTurn.settled` without interrupting**, then continue as
  today. This follows the existing `await active.settled` pattern. The vendor
  turn belongs to another client, and the agent would queue the prompt anyway.
  Waiting keeps the user's message after the peer output in the timeline and
  stops peer chunks from being attributed to the new foreground turn (the
  server's `currentTurnId` changes at foreground `started`).
- **Interrupt.** `interrupt()` is unchanged (`session/cancel`). Whether that
  stops a vendor turn is up to the agent; its terminal update arrives as usual.
- **Close or failure.** In `handleUnexpectedTransportClose` and
  `settlePendingWork`, end an open vendor turn as `failed`
  (`error.message = "ACP transport closed"`) and resolve `settled`.

### B. Vendor notifications in wire order

Vendor updates other than `config` must be applied after every `session/update`
that came before them on the wire.

Mechanism (SDK-agnostic):

- In the `routeVendorNotifications` transform, give every inbound
  `session/update` notification a FIFO slot: a deferred pushed onto
  `pendingUpdateSlots` before `controller.enqueue(message)`.
- In the client's `sessionUpdate` callback, take the oldest slot and resolve it
  once `enqueueNotification(...)` for that update has run.
- For a vendor notification, run the transformers synchronously as today. If
  the results contain any non-`config` update, add an operation to the
  notification lane that first awaits every slot that existed when the vendor
  message arrived, then applies those updates. `config` updates keep their
  synchronous path, which configuration transactions rely on.

Assumption to verify (the SDK isn't installed in this checkout): the ACP SDK
calls `Client.sessionUpdate` in arrival order, one call per inbound
`session/update`. If it can skip a notification (for example on a validation
failure), resolve the slot on that path too, or resolve slots by position on
the next delivered update. Without that, a single dropped update would stall
the lane.

### C. Live user messages outside a prompt

In `reduceUpdate`, if a live `user_message_chunk` arrives while
`activePrompt === null`, reduce it with `reduceUserMessageChunk` (emit a
`user_message` timeline item) instead of dropping it. While a prompt is active
the current behaviour stays, because the prompt already echoes its own message.

This fix is generic. Any ACP agent shared by several clients needs it, and the
jcode plugin then doesn't have to rebuild user messages from vendor payloads.

## Docs

- `public-docs/plugins/providers.md` (and `providers.zh-CN.md`): in the
  transformers section, document `notification()` returning `{ type: "turn" }`.
  Cover when to use it (turns the agent ran without a Paseo prompt), the
  one-open-turn rule, and that prompts wait for an open vendor turn.

## Tests (`packages/plugin/src/server/acp.test.ts`, scripted ACP stream)

1. A vendor `started` → `agent_message_chunk` → vendor `completed` produces
   `session.turn started`, a `timeline.item`, then `session.turn completed`, in
   that order. The `turnId` is namespaced.
2. **Ordering:** `agent_message_chunk` ×3 immediately followed by a vendor
   `completed` in one write. All three timeline items come before the terminal
   event. This test fails without change B.
3. A vendor `started` during an active prompt is dropped.
4. A prompt admitted during an open vendor turn sends `session/prompt` only
   after the vendor `completed`, and doesn't call `cancel`.
5. A live `user_message_chunk` with no active prompt produces a `user_message`
   item. With an active prompt it produces none.
6. A transport close with an open vendor turn produces `session.turn failed`
   and unblocks a waiting prompt.
7. Server integration (`plugin-provider` plus agent manager): a vendor turn
   with no foreground turn produces `trackAutonomousRun`, and the agent shows
   as running, then idle.

## Out of scope

- The server's generic ACP path (`providers/acp-agent.ts`, used by
  `extends: "acp"` config providers). It already shows content from turns
  Paseo didn't start, but it has no turn lifecycle. Leave it until plugin
  providers replace it.
- Any jcode-specific knowledge in core.

## Open questions

1. Should a vendor turn carry an origin label, such as "started in jcode TUI",
   that the UI could show? `session.turn` has no field for it. Option: an
   optional `notice` alongside `started`, which the plugin can already emit.
   Not proposed for core yet.
2. Waiting for a vendor turn in `admitPrompt` has no upper bound. If the agent
   never sends a terminal state, the prompt waits until cancel or transport
   close. Is a cap needed (for example a configurable
   `vendorTurnAdmissionTimeoutMs` that ends the turn as `failed`)? Proposed: no
   cap at first, since the agent reports cancels.

## Deviations

Recorded while implementing this spec on `ct/acp-turn-lifecycle-hook`. Citations re-checked
against the base (`origin/custom` @ `0ed8cdfa5`): `plugin-provider.ts:1530`, `:1557`,
`agent-manager.ts:531`, `:5129`, `connection.ts:583`, `:1176`, `:1217`, `acp.ts:87` and
`provider.ts:594` all match. `reduceUpdate` is at `connection.ts:926` (not `:925`) and the dropped
`user_message_chunk` at `:933` (not `:932`); the described behaviour is as written.

### 1. The vendor operation joins the lane after its slots resolve

"Add an operation to the notification lane that first awaits every slot that existed when the
vendor message arrived" deadlocks. The SDK dispatches each notification without awaiting the
previous one, and the operation queued on `notificationLane` is what the SDK's promise settles on,
so an operation that awaits a slot holds the lane while the update that would resolve the slot is
queued behind it. Implemented instead: the barrier resolves first, then the vendor operation joins
the lane (`vendorNotification`). Every update admitted before the vendor message is applied before
the barrier resolves. The inbound transform awaits the vendor operation before it passes on the
next message, so an update that arrives later cannot reach the SDK, and so the lane, until the
vendor operation has been applied. Without that await, a later update could overtake a vendor
operation still waiting on a dropped update's slot.

### 2. The SDK in use, and what it guarantees

The plugin resolves `@agentclientprotocol/sdk@1.4.0` from `packages/plugin/node_modules`, not the
0.17.1 copy at the workspace root that the spec was written against. In 1.4.0 a notification is
dispatched fire-and-forget: `Connection.receiveMessage` starts `processIncomingMessage` for each
message and does not await it, so notifications read in order interleave at their handler awaits.
Two consequences:

- A vendor update cannot be ordered by handing it to the SDK as an extension notification.
  Measured: an extension notification and the `session/update` that preceded it on the wire
  dispatch through different handler depths, and the update is applied first. The slot barrier is
  the mechanism that works.
- `sessionUpdate` is still invoked in arrival order, because consecutive updates run through the
  same handler chain, so a slot per update is well defined.

### 3. A skipped update

`session_update` params are validated before `Client.sessionUpdate` is called, so a notification
that fails validation never reaches the client and its slot would stay open. Slots are therefore
paired with deliveries rather than counted: each slot records the raw params it admitted, and a
delivery resolves every slot up to and including the one whose payload contains the validated
notification (`containsUpdate`). Zod strips unknown keys and fills defaults, so containment
(validated values are a subset of the raw payload) identifies the delivered slot and treats the
slots before it as dropped. A delivery that matches no slot resolves the oldest one so the queue
keeps moving.

Residual: a schema-invalid update that no later delivery follows leaves its slot unclaimed, and
nothing else ever reports it. The wait for such a slot is bounded (see 4), so the vendor batch is
applied after the bound rather than never; until then the vendor turn stays open, which holds the
prompt lane behind it.

### 4. A bounded wait, and no flush at prompt settle

An earlier revision flushed every open slot in `drainNotifications`. That can release a vendor
update ahead of an update that was admitted but not yet dispatched, which is the ordering this
change exists to guarantee, so the flush is gone. The full flush now happens only when the
transport closes.

The wait itself is bounded instead: `UpdateSlots.settled()` resolves when the last admitted slot
resolves or after `SLOT_SETTLE_TIMEOUT_MS` (250 ms), whichever comes first. The SDK dispatches a
notification in the same read iteration that reads it, so a slot is claimed within microtasks
whenever its update arrives at all; 250 ms is orders of magnitude above that and far below a
noticeable hang. Ordering stays acceptable because the timer only fires for a slot whose update
never arrived, or arrived later than the bound — in both cases the wire order the barrier was
protecting is already broken by the transport, and a late update is applied after the vendor
update instead of before it. A stalled vendor turn holds the prompt lane, so bounding the wait is
also what bounds `admitPrompt`.

When the bound fires, every slot up to the one it waited on expires, and later waits skip expired
slots. Otherwise each later vendor notification would wait out the bound again on the same dropped
update, and with the transform awaiting it, stall the whole inbound stream for that long. Expired
slots stay in the queue so a late delivery still pairs with its own slot.

### 5. No exported validator

Pre-validating each `session/update` in the transform was the preferred fix: slot only what the
SDK will deliver, and pairing becomes plain FIFO. It is not possible here.
`@agentclientprotocol/sdk@1.4.0` exports only `schema/schema.json` (plus the v2 schema), not
`zSessionNotification`; its `exports` map has no path to `dist/schema/zod.gen.js`, and deep
importing it is rejected by the map. The JSON schema is also not equivalent: the SDK parses with
`defaultOnError`/`vecSkipError`, so payloads the JSON schema calls invalid are still delivered with
the bad field defaulted or the bad element skipped. A validator derived from the JSON schema would
disagree with the SDK in both directions, which is worse than pairing. Pairing plus the bound
stays.

### 6. Test 2 shape

The literal scenario — three `agent_message_chunk`s and the terminal in one write — does not fail
without change B on this SDK. Measured with the vendor updates applied synchronously: `transform
c1, transform c2, apply c1, transform c3, apply c2, apply c3, transform terminal`. The transform
stream delivers one update at a time, so the terminal cannot overtake a queued chunk; the race
needs the update to be enqueued while the SDK is already waiting in `read()`, which is the state at
the start of a write. Test 2 therefore applies the first two updates, waits for them, then writes
the third update together with the terminal in one write. That fails without change B and passes
with it.

### 7. Review fixes after the Opus pass on #6

These depart from the text above, which assumed a provider whose vendor turns could only be
misreported prompts and a session that never attaches mid-turn.

- **A vendor turn during a prompt can be a peer turn.** With
  `acpOptions.vendorTurnsAreNeverForeground`, a vendor `started` that arrives while a prompt is
  active opens the vendor turn instead of being dropped, and a live `user_message_chunk` while a
  vendor turn is open is shown instead of being treated as the prompt's echo. A provider that only
  reports peer turns as vendor turns sets it; the default keeps the rule above.
- **Stop cancels every admission waiting behind the vendor turn.** A prompt waiting behind an open
  vendor turn has not reached the agent, so a session-wide cancel cannot stop it. `interrupt()`
  bumps a stop generation, and every prompt submitted before it — the parked one and any still
  queued in the prompt lane — is admitted and ended canceled instead of sent: the user message, a
  `turn` prompt result, a started turn and a canceled terminal, the same shape an interrupted
  prompt produces. A replacement interrupt, which `admitPrompt` issues for an active foreground
  prompt, does not count as a stop. The spec's "`interrupt()` is unchanged" holds only when no
  admission is waiting.
- **A cancelled vendor turn ends locally after a grace period, for peer-turn providers only.** The
  spec's Open question 2 decided against a cap. With `vendorTurnsAreNeverForeground` set, a cancel
  with no foreground prompt ends the turn as `canceled` after `VENDOR_TURN_CANCEL_GRACE_MS` (1 s)
  if the agent reports no terminal, so a lost terminal cannot block prompts forever. For any other
  agent a cancel may not stop the peer turn, so ending it locally would let the next prompt start
  during it; those agents keep waiting for the turn's own terminal. The agent's own terminal, if it
  arrives first, is kept and the timer cleared.
- **Held peer updates survive a `skip` load.** On attach the agent flushes the running turn's
  `started` and its held peer chunks before it answers `session/load`. Once a vendor turn is open,
  those updates are applied even in the `skip` window; replayed history that precedes the turn is
  still dropped. A `session/load` replay also clears the fallback chunk ids, and so does a vendor
  `started`, so a peer turn without user content starts its own items.
- **A close reports `canceled`, not `failed`.** A user-initiated close leaves the peer turn running
  on the agent's side; only an unexpected transport close fails it. The boundary ends the open turn
  before it stops delivering events, so the terminal reaches the server.
- **`session/list` follows `nextCursor`.** The shim used to read one page, so an import saw at most
  the agent's newest page of sessions for the cwd. It now pages until the requested limit or the end
  of the cursor chain.
