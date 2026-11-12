# TMAD-derived code removal

The 0.16 basket carried a port of `tmad4000/paseo` work: a durable agent message queue, the companion-stream feed, stream artifacts, native Find, and optional voice input. This branch removes it and keeps the rest of the fork.

## Provenance

- Port commit `6b5d24312` ("feat(tmad): Port Pluto stream, queue, Find and voice work"), parent `b388a10a7`.
- Follow-ups on the same surface: `36f5b74fa`, `b0b92121b`, `139e0c81e`, `913689b2e`.
- Basket carries: `27daed7df` (0.12 baseline merge), `5198bd3a5` (0.14 adaptation). The TMAD delta itself is `84ba5a691..79422b485`.
- Source is Apache-2.0; no licence obligation outlives the code.

## How the removal was made

Reverse-apply `84ba5a691..79422b485` onto the released 0.16.0-beta.2 tree (`99e212869`, identical to `origin/custom` `1c46a58f6`), then resolve every conflict toward upstream 0.16 and the fork's own carries. `23bae6153` is the upstream line to compare against when a hunk is ambiguous.

Two resolutions are worth reading before touching this area again:

- **`speak` registration.** The carry registered the tool for every agent-scoped catalog (`scope === "agent"`), so agent sessions that never attached voice advertised a tool that then failed. Registration is back to `voiceOnly || enableVoiceTools || callerContext.enableVoiceTools`, and an unattached call throws instead of settling. App-level voice chat still works because `voice-session` registers the caller context with `enableVoiceTools: true`.
- **Protocol schemas.** The TMAD request/response pairs are gone from `packages/protocol` rather than retained behind per-RPC shims. A 0.16.0-beta.2 app that still sends one fails inbound validation and gets a structured `rpc_error` with `code: "unknown_schema"` and its `requestId` (`websocket-server.ts`, `handleInvalidInboundMessage`), which its pending request surfaces as a rejection. A re-port has to restore the schemas and the removed `CLIENT_CAPS` entries.

## What stays

Fork carries that are not TMAD: side conversations, retained panels, provider accounts and rename migration, checkout base refs, outbound-byte metrics, the turn timing footer, the pinned prompt, plan copy sources, shared-turn steering (`PeerTurnActiveError`), app-level voice (`voice-session`, `speak`, TTS playback), and upstream 0.16's own composer queue (`sendBehavior: "queue"`), which is unrelated to the removed durable queue.

## Evidence

- `rg 'AgentQueueService|companionEntries|AgentArtifactSchema|durableAgentQueueV1|companionStreamPortV1|durableVoiceInputV1|voiceOwner' packages` is empty.
- No removed module has an importer; the file-level check that found `agent-stream/native-message-scroll.ts` orphaned is why it is gone too.
- `websocket-server.relay-reconnect.test.ts` asserts the legacy-RPC `rpc_error` path.
