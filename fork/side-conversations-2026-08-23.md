# Side conversations (`/btw`) — research

Snapshot date: **2026-08-23**. Base commit: `3a083f01d`.

Research into the `/btw` side-question mechanism: what it is in Claude Code, what
the equivalents are in Codex and OpenCode, whether upstream or any fork has built
it, and what building it in Paseo would take.

Backs the **Side conversations** row in
[local-fork-candidates.md](local-fork-candidates.md).

## Upstream status: asked once, never evaluated

[#2056](https://github.com/getpaseo/paseo/issues/2056) — _"feat: add
non-interrupting `/btw` side questions during active turns"_ — filed 2026-07-14,
closed 2026-07-31 by `paseo-bot` on intake grounds ("issues are for bugs, take it
to Discussions"). No maintainer has ever commented on it. Nobody refiled it: all
125 Discussions were enumerated and no side-conversation thread exists. One "+1"
(`lucamzanon`: _"the only thing I miss from the CLI is btw"_).

No PR upstream. No branch in any of the ~45 divergent forks. The nearest
neighbours are different features: `team-harness/paseo`'s agent-to-agent Rooms
(263 ahead) and `AngusFu/paseo`'s ask-question MCP tool (the reverse direction —
the agent asks the human).

This is the intake pattern from research §3.1 and §3.11: mass redirect-to-Discussions
closures, near-zero maintainer engagement in Discussions. **The idea has not been
rejected. It has never been looked at.** That is what makes it a carry rather than
a refuse — it adds a capability upstream has no answer for, and contradicts no
answer upstream has given.

## `/btw` is two features, and only one is reachable

The common description — "a sidebar that answers a question the main session
eventually picks up" — merges two separate Claude Code mechanisms. The seam
between them is the whole design decision.

|                         | `/btw`                                    | `/subtask` (was `/fork`, v2.1.161–2.1.211) |
| ----------------------- | ----------------------------------------- | ------------------------------------------ |
| Context                 | fork of live transcript                   | fork of live transcript                    |
| Tools                   | **none** — `canUseTool` denies everything | full                                       |
| Turns                   | `maxTurns: 1`                             | background agent                           |
| Transcript              | `skipTranscript` — never written          | result folds back at turn start            |
| Reachable over the wire | **yes**                                   | **no**, in-process TUI only                |

Command definition in the bundled CLI (v2.1.239):

```js
{type:"local-jsx", name:"btw",
 description:"Ask a quick side question without interrupting the main conversation",
 immediate:!0, argumentHint:"[question]",
 thinClientDispatch:"control-request"}
```

`thinClientDispatch:"control-request"` is the load-bearing field: Anthropic
designed the command for third-party clients to dispatch over the control channel.

Internally `runSideQuestion` issues a query with `querySource:"side_question"`,
`forkLabel:"side_question"`, `maxTurns:1`, `skipCacheWrite`, `skipTranscript`, and
a `canUseTool` that denies everything. Context is the main transcript with any
trailing incomplete assistant message stripped.

**Verified by experiment.** Plant a codeword in a side question, then ask the main
session about it: the main session answers `NO`, and the on-disk JSONL contains
zero occurrences. `skipTranscript` is real.
[anthropics/claude-code#35940](https://github.com/anthropics/claude-code/issues/35940)
requested carry-back and was **closed as not planned**.

The carry-back people remember is pressing `f` in the panel, which calls
`spawnForkFromDirective(question, ctx, canUseTool, [question, response], "btw")` —
a tool-equipped background agent seeded with the main conversation **plus** the
btw exchange. No control-request equivalent exists.

### The wire call

```jsonc
{
  "type": "control_request",
  "request_id": "probe-1",
  "request": {
    "subtype": "side_question",
    "question": "…",
    "history": [{ "question": "…", "response": "…" }],
  },
}
```

Response: `{response: string|null, synthetic: boolean, refusal_fallback?: {...}}`.
`synthetic: true` means the model tried to call a tool or errored instead of
answering — surface it, do not cache it.

- Timeout is **600 s**. Every other control request gets 75 s.
- `side_question` is in the remote-bridge allow-set beside `interrupt`,
  `set_model` and `stop_task`, so it dispatches mid-turn by design.
- You get `system/control_request_progress` with `status:"started"`, then
  optionally `status:"api_retry"` carrying `attempt` / `max_retries` /
  `retry_delay_ms`.
- Cancel with the standard `{"type":"control_cancel_request","request_id":…}`.
- **`history` is the client's job.** The CLI handler passes `threadHistory:false`
  over the control path and replays only the array you send. Threaded follow-ups
  mean storing the exchanges yourself.
- Sending it before the first turn returns nothing — there is no transcript to fork.

## Provider coverage

| Provider                                         | Mechanism                                                                                    | Tools                     | Ephemeral                           |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------- |
| **Claude Code**                                  | `control_request` subtype `side_question`                                                    | no                        | yes, never persisted                |
| **Codex**                                        | `thread/fork {ephemeral:true, developerInstructions}` → `thread/inject_items` → `turn/start` | yes, restrained by prompt | yes                                 |
| **OpenCode**                                     | `POST /session/:id/fork` → `POST /message` → `DELETE`                                        | yes                       | **no** — persisted, must be deleted |
| **Copilot / Cursor / Kimi / Kiro / generic ACP** | none — `session/fork` is unstable-schema only                                                | —                         | —                                   |

**Codex ships the same feature under the same name.** `/side`, with `/btw`
registered as an alias ([openai/codex#23592](https://github.com/openai/codex/pull/23592),
2026-05-20; `/side` itself is [#18190](https://github.com/openai/codex/pull/18190),
2026-04-19). `codex-rs/tui/src/app/side.rs` — _"an ephemeral fork used for a quick
/side question while keeping the primary thread focused."_ Non-interruption is
asserted in a test that submits `/side` during an active task and requires no op
reaches the parent thread. Codex **discards** the side thread: `turn/interrupt` →
`thread/unsubscribe` → drop.

**OpenCode has nothing** — zero hits for `btw`, `/side` or `aside` in the tree.
The fork endpoint has no busy guard, so mid-turn forking works, but there are no
ephemeral sessions, so the throwaway must be deleted. `noReply: true` on a prompt
appends a user message without starting a turn — OpenCode's equivalent of
`thread/inject_items`.

**`codex proto` no longer exists.** The real surface is `codex app-server` (stdio
/ ws / unix socket). `turn/steer`, `thread/fork.beforeTurnId` and `thread/queue/*`
require `capabilities.experimentalApi: true` in `initialize`.

### The wider field

Four independent implementations in four months, agreeing on the name and not much
else. Claude Code ~2026-03-12 (v2.1.72) → Cursor CLI 2026-04-14 → Codex `/side`
2026-04-19 → Cursor IDE Side Chats 2026-07-10.

|                                         | side channel                | lands back           |
| --------------------------------------- | --------------------------- | -------------------- |
| Claude Code                             | `/btw`, no tools            | no — `/subtask` does |
| Cursor                                  | CLI `/btw`; IDE Side Chats  | manual `@`-mention   |
| Codex                                   | `/side` / `/btw`, has tools | no                   |
| Goose, Gemini CLI, Amp, Aider, OpenCode | none                        | —                    |

Gemini CLI was [asked for it explicitly](https://github.com/google-gemini/gemini-cli/issues/22478)
and the maintainer replied _"we don't have immediate plans."_ Amp went the other
way and deleted `amp threads fork` (2026-01-13) and `/handoff` (2026-05-06).

Two axes decide everything:

**Tools or not.** Claude Code and Cursor CLI deny them — a pure oracle over
existing context, cheap on a warm cache, unable to learn anything new. Codex grants
them and firewalls mutation _by prompt only_ (`SIDE_BOUNDARY_PROMPT`,
`SIDE_DEVELOPER_INSTRUCTIONS`: _"You may perform non-mutating inspection… Do not
modify files, source, git state"_). Those prompts exist because inherited history
reads to the model as live instructions. If you build the tool-bearing variant,
that is the failure mode to get right.

**Writeback is unsolved everywhere.** Nobody does it automatically except Claude
Code's `/subtask`, which is TUI-only. Codex discards; Cursor CLI discards; Cursor
Side Chats and Amp need a manual mention. The primitives exist unwired: Codex has
`thread/inject_items`, OpenCode has `noReply: true`, neither connects it to their
side surface.

**Steering and side channels are opposite operations** and keep getting conflated.
Steering pushes a message _into_ the running turn; a side channel pulls a question
_out_ into a read-only sibling. Paseo already shipped the first
([#3394](https://github.com/getpaseo/paseo/pull/3394), merged 2026-08-16), which is
why #2056 kept having to argue it was not asking for steering again.

## What Paseo already has

| Need                                                                      | Existing primitive                                                                                                                                                     |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mid-turn injection for exactly these three providers                      | `steerActiveTurn` — `providers/claude/agent.ts:2272`, `codex-app-server-agent.ts:4143`, `opencode-agent.ts:3408`                                                       |
| Work that emits timeline items with no turn allocated and no cancellation | `tryHandleOutOfBand` (`agent-sdk-types.ts:674`), `tryRunOutOfBand` (`agent-manager.ts:2071`). Codex/Pi/OMP implement it; Codex uses it for mid-turn `/compact`         |
| A separate per-thread timeline attached to an agent                       | `ProviderSubagentStore` (`provider-subagents/store.ts`) — own `InMemoryAgentTimelineStore` per child, three dotted RPCs, capability-gated, **zero disk-schema change** |
| Extracting the main session's context                                     | `buildAgentForkContextAttachment` (`activity-curator.ts:294`), already exposed as `agent.fork_context`                                                                 |
| A cheap ephemeral model call                                              | `generateStructuredAgentResponseWithFallback` (`agent-response-loop.ts:398`); production wiring at `checkout/git-metadata-generator.ts:176`                            |
| Putting a result in the parent pane, provider-independently               | `emitLiveTimelineItem` / `appendTimelineItem` (`agent-manager.ts:2129`, `:2108`)                                                                                       |
| Injecting content into a running turn as system-authored                  | the `<paseo-system>` envelope used by finish-notifications — `agent-prompt.ts:174`, `:434`                                                                             |
| A UI home anchored to one agent, popover on wide / sheet on compact       | the subagents track (`packages/app/src/subagents/track.tsx`)                                                                                                           |

There is **no server-side prompt queue**. `SendBehavior = "interrupt" | "steer" | "queue"`
(`composer/input/state.ts:6`) is client state; `queue` holds the message in a Map
and drains at the turn boundary via `drainQueuedAgentMessage`
(`runtime/host-runtime.ts:2160`). The daemon never learns a message is waiting.

## Three obstacles

1. **`sendPromptToAgent` (`agent-prompt.ts:263`) is declared the mandatory prompt
   funnel and hardcodes `replaceRunning: true`.** A side channel either extends its
   `PromptDispatchDisposition` union with a fourth member or contradicts its own
   doc comment. Pick one deliberately and update the comment.

2. **Claude's `side_question` is private API.** `askSideQuestion` exists in
   `sdk.mjs` but is absent from the 26-method `Query` interface in `sdk.d.ts`, and
   `side_question` is not in the `SDKControlRequestInner` union. Paseo's Claude
   adapter goes through the Agent SDK's `query()` (`providers/claude/query.ts:63`),
   not raw stream-json, so the access path is a `(query as any).askSideQuestion(...)`
   cast. Untyped means unversioned: it can vanish in a patch with no changelog
   entry. Probe `supportedCommands` for `btw` before offering the UI, and treat an
   error-subtype control response as "host does not support it".

3. **Coverage is 3 of 9 providers.** `docs/protocol-compatibility.md:35` forbids
   degraded fallback paths, so this ships capability-gated and visibly absent
   elsewhere. ACP is the structural gap: it has `session/fork` in the unstable
   schema but only `session/cancel` for a busy turn, which is why Goose invented
   the vendor-namespaced `_goose/unstable/session/steer`.

## Shape of the build

**Phase 1 — the aside.** One capability (`features.sideConversations`), three
provider implementations behind one `AgentSession` method. Runtime-only storage on
the `ProviderSubagentStore` pattern. Rendered as a third row kind in the subagents
track, which already merges two kinds of related conversation and already solves
compact form factor. No writeback — matching what all four upstream CLIs ship.
This is the version #2056 proposed.

**Phase 2 — writeback.** Wrap the exchange in the existing `<paseo-system>`
envelope and steer it into the running turn. That gives the `f`-key behaviour
uniformly across Claude, Codex and OpenCode, over the wire, which none of them
offer. Paseo already runs this exact mechanism in production for
finish-notifications.

The two phases are separable products. Phase 1 is a port; Phase 2 is not.

### Seams, ranked

New: a side-conversation store (copy `provider-subagents/store.ts`), a panel with
a composer (copy `panels/provider-subagent-panel.tsx`, which is read-only), and
dotted RPCs per `docs/rpc-namespacing.md` (`agent.side_conversation.start` /
`.send` / `.timeline.get`, plus a push `.update`).

Substantial edits: `agent-manager.ts` (`streamAgent:2162` **throws** if any run is
tracked, so naive reuse fails while busy; `runForegroundMutation:2478` serializes
foreground mutations and a side turn must stay outside it), `session.ts` dispatch
and forwarding, the composer entry affordance, the subagents track.

Mechanical: `workspace-tabs/model.ts` target union, `identity.ts` normalizer,
`register-panels.ts`, `client-capabilities.ts`, `server_info.features`,
`daemon-client.ts`.

### Joints this creates

Per the rot table in [local-fork-candidates.md](local-fork-candidates.md):

| Joint                                                         | Rots when                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| A new `AgentSession` method implemented across three adapters | upstream changes the `AgentSession` interface (`agent-sdk-types.ts:636`) |
| `PromptDispatchDisposition` extension                         | upstream adds a disposition                                              |
| A copy of `ProviderSubagentStore`                             | upstream refactors the timeline store                                    |
| `(query as any).askSideQuestion`                              | Anthropic renames or drops it, silently                                  |

The last one is not an upstream-churn joint, it is a vendor joint, and it is the
only one the typecheck gate will not catch.

## Watch items

- [#2898](https://github.com/getpaseo/paseo/pull/2898) — **open**, +774/−75.
  Native session forking (`supportsNativeFork`, `agent.fork_native.request`) over
  Claude's `forkSession` and Codex's `thread/fork`. If it lands, Phase 1's Claude
  and Codex paths get shorter. The single most reusable piece of prior art.
- [#3423](https://github.com/getpaseo/paseo/issues/3423) — open, unanswered.
  Agent-facing session spawning and cross-session messaging; the machine-side
  analogue.
- [Discussion #2701](https://github.com/getpaseo/paseo/discussions/2701) —
  `gentoosys` instrumented claude-code 2.1.220 and showed the engine releases
  queued messages at tool boundaries while Paseo cancels the turn ~1 s later.
  Best technical writeup in this space.

## Reproducing the reachability proof

Drive a real session over stream-json, take one normal turn first (the fork needs
a transcript), then write the control request to stdin:

```sh
claude --input-format stream-json --output-format stream-json --verbose
```

Read `control_response` off stdout. Confirm non-injection by grepping the session
JSONL under `~/.claude/projects/` for anything you planted in the side question —
it should not be there.

## Sources

[Claude Code commands](https://code.claude.com/docs/en/commands) ·
[interactive mode](https://code.claude.com/docs/en/interactive-mode) ·
[sub-agents](https://code.claude.com/docs/en/sub-agents) ·
[codex app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md) ·
[opencode server API](https://opencode.ai/docs/server/) ·
[ACP prompt lifecycle](https://agentclientprotocol.com/protocol/v2/prompt-lifecycle) ·
[ACP session-fork RFD](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/rfds/session-fork.mdx) ·
[Cursor Side Chats](https://cursor.com/help/ai-features/side-chats)
