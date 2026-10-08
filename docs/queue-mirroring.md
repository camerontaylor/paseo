# Queue mirroring

The durable agent message queue holds prompts that a client admitted with an explicit delivery intent: `queue` (deliver when the agent is free) or `steer_strict` (deliver into the running turn without interrupting it). One daemon owns one queue per agent. Every connected device reads and mutates the same queue through the `agent.queue.*` RPCs, so a prompt queued from a phone is visible and editable everywhere, and it drains even when nothing is connected.

The queue is daemon-only infrastructure (`packages/server/src/server/agent-queue/`). The composer UI that calls it is a separate feature.

## Gating

- A client may send `agent.queue.*` only when `server_info.features.durableAgentQueueV1` is set; the delivery-intent enum postdates every released daemon.
- The daemon mirrors `agent.queue.update` broadcasts only to clients advertising `CLIENT_CAPS.durableAgentQueue`, so an old client never receives an event its outbound union cannot parse.
- Legacy `send_agent_message_request` keeps its released receipt-backed path. It never enqueues, and admission is never inferred from a message the daemon did not classify.

## Delivery lifecycle

```
pending ──claim──▶ dispatching ──receipt completed──▶ removed (drainedIds)
                      │            └─ known failure ──▶ pending (attempts < 8)
                      │                             └──▶ failed  (attempts = 8)
                      └─ startup recovery finds an unresolved claim ──▶ uncertain
```

- The claim keeps the item in the queue in `dispatching` state, so a crash leaves recoverable state instead of a lost or duplicated prompt. Removal happens only after the receipt confirms the run started.
- Each attempt gets its own receipt keyed by a monotonic `attemptSeq`, so a retry can never collide with the previous attempt's receipt. `attempts` is the user-visible streak and resets on retry or edit.
- An `uncertain` item is never dispatched again automatically. `agent.queue.retry` is the only path that resends it. A `failed` item waits for an explicit retry or discard.
- The queue is strictly FIFO: an item that is not `pending` holds the line, because later prompts are follow-ups to the ones ahead of them.
- `steer_strict` goes through the shared steer admission and never replaces a turn. Refusal un-claims without burning an attempt; when the turn later ends the item is delivered as a normal run.

## Images

Image bytes are stored in the queue file and are never broadcast — snapshots carry descriptors (`id`, `mimeType`, `byteSize`). A device that did not queue the item fetches the bytes with `agent.queue.get_item_images.request` before pulling it back into its composer. Per-item image payload is bounded (16 MiB base64) along with queue length (50 items).

## Persistence and crash points

One JSON file per agent under `$PASEO_HOME/queues/`, written atomically at mode 0600. Every mutation appends a before/after journal entry (also 0600) before the queue file is replaced; the journal rotates under a byte bound keeping one previous generation, and elides image bytes to descriptors so it never becomes a second copy of user data.

| Crash between                      | State on disk                                 | Recovery (`activate()`)                                                                                                                 |
| ---------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| admission and claim                | item `pending`                                | queued normally                                                                                                                         |
| claim and receipt write            | item `dispatching`, attempt receipt may exist | receipt missing: `queue` intent resumes as `pending`; `steer_strict` holds as `uncertain` (the admission may have reached the provider) |
| receipt write and dispatch outcome | receipt `pending`                             | item held as `uncertain`, never auto-resent                                                                                             |
| dispatch and removal               | receipt `completed`                           | treated as delivered: item removed, id recorded in `drainedIds` so a late enqueue retry is a no-op                                      |

`activate()` runs once after the server accepts connections, never during daemon initialization. It resolves claims, then resumes only never-dispatched items for agents that are already loaded and idle; agents that load on demand drain through their own running-to-idle transition. Archived agents keep their queue and never auto-run. Deleting an agent removes its queue through the normal delete lifecycle.

## What the daemon never does

- Never queues a prompt that arrived without an explicit intent.
- Never interrupts a turn to deliver a queue item.
- Never resends an item whose provider acceptance is unknown without an explicit retry.
- Never silently deletes an undelivered prompt; removal is a receipt or a user decision.
