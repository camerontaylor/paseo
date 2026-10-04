# Native ZCode additional system instructions

The native plugin cannot deliver Paseo's appended system policy through the verified
native API. Keep `daemon.appendSystemPrompt` configured; select a provider that supports
it until ZCode exposes an additive system instruction API. Do not clear the policy to
make ZCode creation succeed.

## Verified source

- Plugin: `supermomonga/paseo-plugin-zcode-provider`, commit
  `fc66078de555a75745a8bf161812addbb2c3a073`.
- Native source: `zai-org/ZCode`, commit
  `872ad960de7ec172591f7e1952f7849229f94521`; Server 3.14.0 / Agent 0.16.9.
- Sources and secret-free reproduction results:
  Makemake `/home/ctaylor/.local/state/zcode-provider-test/{plugin,source,results.json}`.

## Policy trace

`packages/server/src/server/config.ts:resolveAppendSystemPrompt` reads
`daemon.appendSystemPrompt`. Bootstrap passes that value into `AgentManager`.
`AgentManager.applyDaemonAppendSystemPrompt` attaches it to the ephemeral provider
launch config as `daemonAppendSystemPrompt`, without persisting a stale policy on the
agent. `packages/server/src/server/agent/plugin-provider.ts:mapSessionConfig`
combines the per-agent prompt and daemon policy with a blank line into
`ProviderSessionConfig.systemPrompt`. Native plugin `server/provider.ts:openSession`
rejects a nonempty value with `INVALID_CONFIGURATION` and
"Custom system prompts are unsupported by the verified ZCode host".

## Native boundary

The pinned plugin's `packages/shared/src/zcode-protocol/index.ts` —
`zcodeSessionCreateParamsSchema` (line 1558 at plugin commit `fc66078`) — is
strict and has no system prompt or additional instruction field. That path is
in the plugin checkout, not this repo. The resume schema follows it and
likewise has no additive instruction field.
The plugin opens sessions through native `createSession` / `resumeSession` and then
reapplies mode, planning, model, and reasoning settings; keep that cold-resume
workaround intact.

ZCode's internal runtime has `RuntimeConfig.systemPrompt`
(`apps/zcode-cli/packages/core/src/runtime/types.ts:216`), but the verified external
session API does not carry it. `core/src/context/builder.ts:87-130` treats it as a
replacement for the built-in stable system body and skips the default prompt and
system context. Exposing that field alone would therefore not implement Paseo's
append semantics.

Native workspace/default `AGENTS.md` loading is a separate instruction mechanism.
`core/src/context/sections/request-user-context.ts:buildRequestUserContextSection`
sets `injectionTarget: "meta_user"`. It is not a system-level policy path. Writing
Paseo policy to project files or a global ZCode home would change scope and priority
and could affect unrelated sessions.

## Reviewable plugin declaration

`patches/zcode-provider-system-prompt-capability.patch` adds only
`supportsSystemPrompt: false` to the pinned native plugin registration. Apply it
when using this fork's SDK. Core preserves existing plugins' contract when the
optional declaration is omitted. The unmodified plugin keeps its own explicit `INVALID_CONFIGURATION` rejection.
A provider declaring `false` gets an actionable
failure before native session creation; the policy remains intact.

A supported implementation requires an upstream additive native system instruction
field, applied on both create and resume, while retaining ZCode's default prompt.
No user/assistant message substitute is included in this patch.

## Validation

On Pluto with Node 24.21.0, from `packages/server`:

```sh
npx vitest run src/server/agent/plugin-provider.test.ts --bail=1
```

40 tests passed. The regressions cover rejection of agent and daemon instructions,
cold resume rejection with `INVALID_CONFIGURATION`, no native `session.open` on
rejection, and preservation of the combined instructions for existing providers.
The separate patch passed `git apply --check` against the pinned native plugin on
Makemake without changing that checkout.
