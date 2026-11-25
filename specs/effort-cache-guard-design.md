# Pi effort changes and prompt-cache cost

Status: implemented. Decision date: 2026-09-29.

## Decision

Keep immediate effort updates. When an established Pi conversation on `opencode-go`
changes its effective effort, return a provider warning with the latest matching
request's observed cached input tokens. Unknown telemetry produces an unquantified
warning. The existing app toast, CLI notice column, and `update_agent` tool output
carry the warning. No wire contract changes are needed.

This makes the cost visible when applying a change, before the next request when
the agent is idle. During an active turn, Pi owns when the new level takes effect;
the warning cannot prevent another request that has already started. It does not
claim a dollar cost, a guaranteed miss, or a still-warm cache. The sample is a past
request, not a forecast or a cumulative session total. Cache expiry, compaction,
backend routing, and switching back to an older effort can change the outcome.

Detect the backend through Pi's selected model metadata. A Paseo provider name such
as `pi-opencode` is a configurable alias. The evidence supports a risk warning for
`opencode-go`; it does not establish that every model on that backend behaves alike
or that other backends are cache-safe.

The measured 2026-09-27 experiment on `opencode-go/space-bunny-free` found:

| Second request | Uncached input | Cache read |
| -------------- | -------------: | ---------: |
| high → low     |         18,202 |        140 |
| high → high    |             32 |     18,340 |

That experiment had one session per condition and no reported cache writes.
Changing the out-of-band effort parameter is consistent with distinct cache
identities or cache pools; Paseo cannot repair the backend's cache key.

## State ownership

Pi's effective level remains authoritative, including per-model clamping from
[PR #4413](https://github.com/getpaseo/paseo/pull/4413). Propagate Pi's
`thinking_level_changed` events and state refresh changes through the existing
manager event so the app and persisted launch settings agree. This addresses
the stale state/resume mechanism in
[#2663](https://github.com/getpaseo/paseo/issues/2663). Invalid events are ignored;
duplicate effective levels do not emit changes. Failed effort RPCs remain failures;
failure to read optional cache telemetry does not undo a successful update.
Changes made externally while the Paseo runtime is closed remain outside this
guarantee; saved resume settings still own that launch.

## Alternatives

- **Confirm or pin by default:** prevents accidental changes, but changes the
  existing settings contract and needs a cross-client acknowledgement flow. The
  evidence is one model/experiment. Prefer visible risk while honoring explicit
  settings updates; add an opt-in pin policy only with a separate product decision.
- **Defer until the next user turn:** does not preserve a backend cache partitioned
  by effort, and makes displayed and applied effort diverge.
- **Inject prefix-preserving configuration updates:** opencode-go exposes no such
  mechanism. Do not translate Codex-specific conversation items into this backend
  or change Pi's request serialization. No service-tier injection from declined
  [#4437](https://github.com/getpaseo/paseo/issues/4437) /
  [#4449](https://github.com/getpaseo/paseo/pull/4449).
- **Revive a general warm-cache UI:** [PR #4305](https://github.com/getpaseo/paseo/pull/4305)
  and [discussion #4623](https://github.com/getpaseo/paseo/discussions/4623) address
  a broader question. Pi already emits cumulative usage here. A past hit cannot
  establish future warmth, and a new cache dashboard is unnecessary for this
  settings-specific warning.

## Verification

Unit coverage exercises backend identity, effective no-ops/clamping, fresh sessions,
latest matching per-request usage, invalid/missing telemetry, telemetry failure,
state event deduplication, persistence/resume, and MCP notice delivery. Existing
adapter and tool tests remain the owning suites. Run from `packages/server`:

```sh
npx vitest run src/server/agent/providers/pi/agent.test.ts --bail=1
npx vitest run src/server/agent/providers/pi/effort-cache-notice.test.ts --bail=1
npx vitest run src/server/agent/mcp-server.test.ts --bail=1
```

For a manual reproduction using this branch, build with `npm run build:server`,
then start `npm run dev` (checkout-local home, port 6768). Do not restart the
production daemon on 6767. Use `npm run cli -- provider models pi --thinking` to
confirm the local model and effort IDs. Create two agents using
`npm run cli -- run --provider pi --model opencode-go/space-bunny-free --thinking high`
with the same prompt: "Write a 500-word essay about how coastal cities adapt to
climate change. Do not use tools." After each completes, run
`npm run cli -- update <test-id> --thinking low` and keep the control at high.
Verify the update reports a warning and low effort. Send both "Summarize your essay
in 50 words. Do not use tools." through `npm run cli -- send <id> <prompt>`.
Read each agent's `persistence.nativeHandle` using `npm run cli -- inspect <id> --format json`;
compare assistant `message.usage.{input,cacheRead,cacheWrite}` in those JSONL files.
Repeat low on the test agent: it must return no cache warning. Close and resume it:
the effective and persisted effort must remain low. Archive the two test agents
and stop only the isolated dev daemon afterward.

## Results on this branch

An isolated in-process source daemon on an OS-assigned port ran real Pi against
`opencode-go/space-bunny-free`. Both agents used the same temporary cwd and prompts:
"Write a 500-word essay about how local coding agents help software developers.
Do not use any tools. Write only the essay." then "Summarize your essay in exactly
50 words. Do not use tools. Write only the summary."

| Condition | Request | Effort |  Input | Cache read | Cache write |
| --------- | ------: | ------ | -----: | ---------: | ----------: |
| Switch    |       1 | high   | 15,393 |        225 |           0 |
| Switch    |       2 | low    | 16,190 |        140 |           0 |
| Control   |       1 | high   |      2 |     15,616 |           0 |
| Control   |       2 | high   |     32 |     16,336 |           0 |

The switch returned a warning containing the observed 225 cached input tokens.
The unchanged control returned no notice. Resume and runtime reload retained low
in requested/effective state and flushed `AgentStorage.config.thinkingOptionId`.
Repeating low before and after reload returned no notice, with no additional
inference requests. Test daemons, agents, processes, and temporary cwd were cleaned
up. The main daemon was untouched. The repeat still has one session per condition;
cache writes are not observable and generated answers differ.

The complete Pi adapter suite passed 111 tests; the cache-notice suite passed 14;
the complete MCP suite passed 121; targeted manager persistence/clamping cases
passed 4. Workspace typecheck, lint, server-stack build, and formatting passed.
The initial MCP file run hit the existing title test's 30-second timeout; that
test passed alone in 28.32 seconds. The complete owning file passed in 185.36
seconds with a 120-second per-test deadline on this loaded host. Full monorepo
and platform suites are left to CI,
following the repository's local test restrictions; nothing is pushed by this task.
