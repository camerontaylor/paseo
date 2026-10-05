# Find and route to existing chats

The project sidebar combines its immediate project/title filter with deliberate intelligent Find
and Send prompt actions. Find and Open chat never deliver the query. Use this chat pins an exact
host/session, switches to Send, and restores the independent, persisted send draft. The destination
chat owns all replies; sending does not navigate away or create a session.

Choose All projects, Current project, or a named project in the scope menu. A project scope is a
sidebar project view identity, including its host/clone grouping. Search sends only that scope's
workspace IDs to each host. Changing scope clears a selected recipient outside it; changing the query,
send draft, scope, or selected hosts ignores stale matching successes and failures. Host changes
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
expected workspace/project IDs; a new enqueue rejects a moved or archived destination. The queue
checks accepted item IDs and durable receipts before that guard, so retries after an accepted send
remain idempotent even if the destination subsequently moves. A definitive rejection releases the
pending submission and preserves its editable draft; a missing acknowledgement retains the durable
item and shows an uncertain delivery state. Background reconnect publishes actual acknowledgements
or definitive rejections to the composer. Queued for means the host acknowledged an item still in its
queue; Routed to means the acknowledgement no longer lists it. Neither confirms task completion.
The composer waits for both persisted drafts and the outbox before enabling Send. Pending recovery
does not require a loaded host/chat directory. Routing keeps durable outbox ownership until the draft
checkpoint succeeds, including after a failed storage write. Draft clearing is guarded by the submitted
draft revision and update timestamp, so a late
acknowledgement cannot erase a newly edited identical prompt. See [queue mirroring](queue-mirroring.md)
for the shared outbox and delivery-receipt contract.
