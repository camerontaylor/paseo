# Find and route to existing chats

The project sidebar combines its immediate project/title filter with deliberate intelligent Find
and Send prompt actions. Find and Open chat never deliver the query. Use this chat pins an exact
host/session, switches to Send, and restores the independent, persisted send draft. The destination
chat owns all replies; sending does not navigate away or create a session.

The scope is a sidebar project view identity, including its host/clone grouping. Search sends only
that scope's workspace IDs to each host. Explicit recipient selection bypasses matching. Automatic
Send requires one clear high-confidence result and complete coverage of all scoped hosts; ambiguity,
no matches, unavailable hosts, or a bounded shortlist require manual selection first.

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

Delivery uses the daemon queue and the existing durable device outbox, preserving the original text
and a stable item ID for retries. Active tasks are queued without interruption. Routing supplies
expected workspace/project IDs; a new enqueue rejects a moved or archived destination. The queue
checks accepted item IDs and durable receipts before that guard, so retries after an accepted send
remain idempotent even if the destination subsequently moves. A definitive rejection releases the
pending submission and preserves its editable draft; a missing acknowledgement retains the durable
item and shows an uncertain delivery state. Background reconnect publishes actual acknowledgements
or definitive rejections to the composer. Draft clearing is guarded by the submitted draft revision and update timestamp,
so a late acknowledgement cannot erase a newly edited identical prompt.
