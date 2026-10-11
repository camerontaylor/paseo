# Stream durability: retention and tracked asks (C2, fork-specific)

This overlay carries the TMAD durable-Stream work (`51a57be66`, `0aded86cd`) onto
`fork/tmad-0.11.1`. The source register row for it lives in TMAD's own
`docs/fork-features.md`, which this fork does not carry; it is relocated here.

| Feature | Register entry | Removal boundary |
| --- | --- | --- |
| `durable-stream-asks` | Preserve all captured Stream history; page reads; explicit stable-ID asks show unresolved work, blockers, evidence and delegated session links; done/reopen never follows turn lifecycle. | Remove with `fork/tmad-refresh-stream-durability-0.11.1`. Contract: [Stream](../docs/companion-stream.md#durable-ask-checklist). |

Two fork-side divergences from upstream are deliberate and load-bearing:

- **Retention is unbounded.** Upstream kept the most recent 50 captured entries.
  This overlay persists all captured history; the 50-item bound survives only as a
  wire/read-page bound. Disk growth is intentional, and an `ENOSPC`/`EIO` write
  failure never evicts, never acknowledges, and never stops the session — capture
  is marked degraded and shown to the user. Earlier pruned history is not
  recoverable by this change.
- **Asks are explicit.** `set_ask`/`expectedRevision` gate once on
  `server_info.features.trackedAsks`; without it, ask mutations are refused before
  any frame (no revision-less fallback) and the checklist submit is fenced with the
  draft retained. The question `kind`/`status` enums are unchanged; richer state
  lives only in the nested optional `ask` object.

The coalescing capture path is unchanged: capture stays post-coalescer and
fire-and-forget, so this overlay does not widen the collector's turn-time work.
