# Find and route to existing chats

The project sidebar combines its immediate project/title filter with deliberate intelligent Find
and Send prompt actions. Find and Open chat never deliver the query. Use this chat pins an exact
host/session, switches to Send, and restores the independent, persisted send draft. The destination
chat owns all replies; sending does not navigate away or create a session. Press Enter/Search in the
filter field or choose Find to submit intelligent matching; typing alone keeps the ordinary filter.

Choose All projects, Current project, or a named project in the scope menu. A project scope is a
sidebar project view identity, including its host/clone grouping. Search sends only that scope's
workspace IDs to each host. Changing scope clears a selected recipient outside it. Scope and selected
host changes invalidate matching successes and failures in either mode. Find matching depends on its
search query; Send matching depends on its draft and durable ownership revision and update timestamp.
Changing the independent draft or query leaves the other mode's lookup intact. Cancellation
releases only the canceled request's loading state, even if a newer lookup has started. Host changes
also clear excluded results and editable recipients; a pending delivery keeps its original destination
and item ID until acknowledgement or rejection. Explicit recipient selection
bypasses matching. Automatic Send requires one clear high-confidence result and complete coverage
of all scoped hosts; ambiguity,
no matches, unavailable hosts, or incomplete shortlist coverage require manual selection first.
In Find results, Open chat navigates and Use this chat selects without sending. In Send results,
Send here delivers the saved prompt to the chosen chat. Choose an existing chat opens the manual
picker when matching returns no results. Routing requires a host advertising `sessionSearch`;
delivery also requires `agentMessageQueue`. Update an older host when prompted.

`session.search.request` reuses existing agent/project/workspace metadata and the latest conversation
context. Each host shortlists at most 100 sessions before reading timelines; results expose
searched/total counts. Evidence snippets come verbatim from supplied context, and returned IDs and
evidence indexes are validated. Archived and child/internal agents are excluded. No maintained index
is required.

Semantic matching currently requires an already configured Claude provider. Other providers remain
valid destination sessions. If matching is unavailable, the sidebar shows the reason and preserves
ordinary filtering and the manual recipient picker. The internal matcher session is nonpersisted,
uses a plain classification system prompt, and disables tools, MCP, setting sources, hooks, subagents,
and provider tool grants at the final Claude SDK options boundary. A connection supersedes its prior
matcher and aborts inference after 45 seconds. Live provider inference and native-device interaction
need separate validation; fixture tests never send tasks to real agents.
Routing copy remains English across locales in v1.

Delivery uses the daemon queue and the existing durable device outbox, preserving the original text
and a stable item ID for retries. Active tasks are queued without interruption. Routing supplies
expected workspace/project IDs; a new enqueue rejects a moved, archived, or deleted destination.
Workspace moves cannot interleave with destination validation and durable new-item admission. The queue
checks accepted item IDs and durable receipts before that guard, so retries after an accepted send
remain idempotent even if the destination subsequently moves or is deleted. Pending receipts retain
uncertain ownership. Fresh device items stay held out of reconnect delivery through draft/outbox
checkpoints; the current host selection is checked again before direct delivery. Every routed enqueue,
including reconnect retries, requires `sessionSearch` and `agentMessageQueue` from the current
connection at the serialized dispatch boundary, after any awaited durable writes. A saved routed
item stays pending after a host rollback until that host can validate its expected destination again;
this capability hold preserves ownership without acknowledging the item or increasing retry attempts.
Ordinary queue items and cancellation remain usable.
A definitive rejection releases the
pending submission only after durable outbox removal succeeds and preserves its editable draft; a missing acknowledgement retains the durable
item and shows an uncertain delivery state. A failed dispatch-marker write preserves a real host
acknowledgement. Without one, explicit Retry recovers the same item; reloading alone never makes held
items eligible for reconnect delivery. Background reconnect publishes actual acknowledgements
or definitive rejections to the composer. A cancellation stays pending until the host confirms
removal and the device checkpoints it. Cancellation requested during a draft-clear checkpoint
suppresses success and checkpoints restoration of that owned draft before releasing the outbox.
A later draft stays intact. If the cancellation checkpoint fails after success was suppressed,
acknowledgement cleanup retains the original outbox item for recovery with the same ID. Flush and
snapshot reconciliation honor suppression without replaying the accepted snapshot into another
acknowledgement.
Completion reports queue removal and preserves the editable draft; Retry requires the original uncanceled outbox item and cannot recreate a removed one.
Held enqueue entries still allow durable cancellation on older hosts. Queued for means the host acknowledged an item still in its
queue; Routed to means the acknowledgement no longer lists it. Neither confirms task completion.
The composer waits for both persisted drafts and the outbox before enabling Send. Pending recovery
does not require a loaded host/chat directory. Routing keeps durable outbox ownership until the draft
checkpoint succeeds, including after a failed storage write. Acknowledgement waits for persisted draft
hydration before comparing ownership. Checkpoint writes serialize with background draft writes;
failure restores matching in-memory draft ownership and retains the same outbox item for retry.
A tentative clear persists its item identity with the cleared revision in the same draft record.
On reload, that identity lets the retained outbox recover the original ownership before the composer
unlocks; a later user draft has no matching clear identity and stays intact.
Draft clearing is guarded by the submitted
draft revision and update timestamp, so a late
acknowledgement cannot erase a newly edited identical prompt. See [queue mirroring](queue-mirroring.md)
for the shared outbox and delivery-receipt contract.
