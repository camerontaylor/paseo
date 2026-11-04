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
