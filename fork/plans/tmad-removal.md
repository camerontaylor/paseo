# TMAD-derived code removal

The fork carried a port of tmad4000/paseo work from the Pluto basket: stream
artifacts, durable agent queue, native Find, optional voice input, and the
companion-stream feed. The 0.16 rollout retained that code deliberately
(`../paseo-016-rollout/tmad-successor-provenance.json` in the operator data).
This branch removes it.

## Provenance

- Port commit: `6b5d24312` "feat(tmad): Port Pluto stream, queue, Find and voice work".
  Parent `b388a10a7`; the removal is a revert of this commit plus the residue
  that later fork commits built on it.
- Follow-ups: `36f5b74fa` (native audio build), `b0b92121b` (fixtures),
  `139e0c81e` (stream switcher fix), `913689b2e` (durable voice receipts test).
- Carries: `27daed7df` (baseline merge) and `5198bd3a5` (0.14 adaptation).
- Source is Apache-2.0; no licence obligation outlives the code.

## What stays

The protocol contract in `docs/protocol-compatibility.md` still applies: an app
and a daemon ship separately, so wire schemas and message types stay. The
daemon answers the removed TMAD requests with one explicit error
(`DURABLE_QUEUE_REMOVED_ERROR`) or empty result instead of leaving them
unanswered:

- `agent.queue.*` request/response pairs
- `agent.companion.update_entry.request`
- `agent.artifacts.scan.request`
- `voice.input.receipts.read.request`

Client capability names and `server_info.features` fields remain parsed, so an
older client still connects; the daemon no longer advertises them.

Removed app surfaces: Chat/Artifacts view switcher, companion feed, artifact
cards, native chat find viewport, durable queue outbox and controls, pin/Q&A
message actions, and durable voice receipts.

## Evidence

- `git merge-base --is-ancestor 6b5d24312 origin/custom` is true.
- Removed modules have no importers: `agent-queue/`, `companion-stream/`,
  `agent/artifacts/`, `stores/queue-outbox-store/`, `composer/queue-sync`,
  `stores/agent-view-store`, `voice/voice-failure*`, `voice/input-receipt-cue`.
- `npm run typecheck`, `npm run lint`, `npm run format:check` pass.
- Targeted suites: server session, agent prompt, voice session, client daemon
  client, app composer actions, protocol messages.
