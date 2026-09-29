# Dispatch brief — ralplan for `gjc-acp-busy-turn`

Prepared 2026-08-29, never dispatched (the daemon's Gajae Code provider refresh was
wedged; see `fork/handover-2026-08-29.md`). Paste the body below as `initialPrompt`.

**Agent settings (verified):** provider `gjc/zai/glm-5.3`, `modeId: default`,
`thinkingOptionId: high`, `features.auto_accept: true`, `notifyOnFinish: true`,
workspace = a worktree off `custom` on branch `plan/gjc-acp-busy-turn`.

`modeId: plan` would block the plan write itself. Bare `gjc` as a provider is a hard
error — it must be `gjc/<model-id>`.

---

Run the gjc built-in **ralplan** skill (/skill:ralplan), deliberate mode, using your native role subagents.

CONTEXT — this is a fork of Paseo (getpaseo/paseo). You are in a git worktree on branch `plan/gjc-acp-busy-turn`, branched off `custom`, which is rebased onto upstream/main at version 0.7.0-beta.1. Read `CLAUDE.md` and `CLAUDE.local.md` in the repo root first; `docs/` is the source of truth for this codebase.

PROBLEM (diagnosed 2026-08-29; every anchor below was verified against this tree):
Paseo runs gjc as a generic ACP provider. A gjc session in ultragoal/goal mode keeps running agent-initiated turns after its ACP turn has ended. Paseo believes the agent is idle, so the next user message is dispatched as a fresh ACP `session/prompt`, and gjc rejects it with JSON-RPC -32603, data `{"code":"busy","details":"turn.prompt is unavailable while the agent is busy; use turn.steer explicitly."}`. Observed live: agent e9d0cdc1 unusable for ~1h, four occurrences in ~/.paseo/daemon.log between 13:25 and 13:45.

The root cause is missing turn STATE, not missing steering:

- `agent-manager.ts:2437` steerOrReplaceActiveTurn → `:2444` `if (!expectedTurnId) return { status: "inactive" }`. With no known turn the existing interrupt-and-replace fallback at `:2465-2478` never runs, so the prompt goes out as a plain session/prompt.
- Paseo ALREADY models agent-initiated turns: `agent-manager.ts:466-470` mints `autonomous-<uuid>` for a turn_started arriving with no active turn; `onStreamTurnStarted` at `:4225` calls trackAutonomousRun + openActiveTurn; `hasInFlightRun` at `:862` counts activeTurnId.
- Precedent to copy: `codex-app-server-agent.ts:5806` emits `{type:"turn_started", provider}` with NO turnId on every native turn start, including turns Paseo did not initiate.
- gjc already publishes the truth over ACP. In the gjc source (~/.cache/.bun/install/global/node_modules/@gajae-code/coding-agent) `modes/acp/acp-agent.ts:2784` stamps session_info_update with `_meta {gjcPhase:"working"|"idle", gjcRunning:bool}`, and its update pump has an ownerless branch, so agent-initiated activity streams to the client. Paseo ignores `_meta` entirely (zero repo-wide hits for gjcPhase).
- Paseo's hook point: `acp-agent.ts:2834 handleSessionInfoUpdate()` currently reads only title and updatedAt off exactly that update.
- Tier 1 reachability: `@agentclientprotocol/sdk` `acp.d.ts:95` exposes `extMethod(method, params)`; gjc routes `_gjc/sdk/control` at `sdk/acp/adapter.ts:506` into `control()` at `:372`; `turn.steer` is registered at `sdk/protocol/operation-registry.ts:76` and excluded from no surface-policy denylist.
- No app change needed: `packages/app/src/composer/actions.ts:198` already sends activeTurnBehavior "steer" whenever it has an activeTurnId.

PRE-RESOLVED DECISIONS — do not re-open these:

- Scope is Tier 0 + Tier 1 only.
  Tier 0: new `packages/server/src/server/agent/providers/gjc-acp-agent.ts`, `class GjcACPAgentClient extends GenericACPAgentClient`, mirroring gjc's phase into turn_started/turn_completed; registered at `provider-registry.ts:794-805` beside cursor/kimi/kiro/traecli.
  Tier 1: `steerActiveTurn` (interface `agent-sdk-types.ts:643`, returns `{status:"accepted"} | {status:"unavailable"}`) implemented via `extMethod("_gjc/sdk/control", {sessionId, operation:"turn.steer", input:{text, clientRef}})`, returning "unavailable" on ANY adapter error — never interrupt, never retry (`docs/providers.md:84`).
- Fork-only. This is NOT an upstream PR. Do not put the logic in GenericACPAgentClient.
- Tier T2 internal. Appetite ~2h of implementation.
- Done: "Sending a message to a gjc agent that is running its own turn lands in that turn instead of failing with `busy` — proved live against a wedged ultragoal session and pinned by ACP provider tests."
- OUT OF SCOPE: modelling agent-initiated turns properly in Paseo's lifecycle (timeline rendering of ownerless activity, notifyOnFinish semantics, get_agent_status reporting); raising gjc's `sdk.promptDeadlineMs`; the 256 KiB ACP prompt-size limit; the deployment/release mechanism (a separate plan owns that).
- Known risk to plan around: mirroring autonomous turns may destabilise run tracking, since hasInFlightRun counts activeTurnId and gjc's own loop could look like a user turn and fire notifyOnFinish. Documented fallback if it does: keep the busy state private to the provider and have its prompt path interrupt-then-send.

REPO RULES from CLAUDE.md — non-negotiable:

- NEVER restart the Paseo daemon on port 6767. It manages every running agent, including you.
- NEVER run the full test suite. Only targeted `npx vitest run <file> --bail=1`.
- Always `npm run typecheck` and `npm run lint` after changes; `npm run format` before committing.
- Build workspace packages before diagnosing cross-package type errors.

OUTPUT: write the final plan to `fork/plans/ralplan-gjc-acp-busy-turn.md`, marked "pending approval", including the ADR. Fork-local material belongs under `fork/` — never `docs/`, which is upstream's and breaks on rebase.

PLANNING ONLY: no source changes, no installs, no commits, no implementation. If you hit ralplan's 5-iteration cap (PLANNING-STUCK), stop and report it; do not blind-retry.
