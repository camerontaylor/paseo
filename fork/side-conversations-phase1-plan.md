# Side conversations — Phase 1 implementation plan

Status: **approved**, 2026-08-24. Base commit `3a083f01d`, branch `custom`.
Two adversarial critic passes: the first returned ITERATE, the second APPROVE
after revision. All findings from both are folded in; the open questions the
critic could not settle from this repo are carried at the end.

Research and rationale: [side-conversations-2026-08-23.md](side-conversations-2026-08-23.md).
Carry rationale and rot cost: [local-fork-candidates.md](local-fork-candidates.md).

Phase 1 is the aside: ask a question against a running agent's context, get an
answer, never touch the agent's turn or transcript. Writeback is Phase 2 and is
deliberately out of scope — the phases are separable products and Phase 1 must
ship without it.

## Corrections to the research

Verified against this checkout on 2026-08-24. Three things differ from the
research doc, which probed a newer SDK on a different HEAD.

| Research said                                        | Actually                                                                                                                                                                   |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SDK 0.3.241, `askSideQuestion(q, {history, signal})` | `packages/server/package.json:72` pins **`^0.3.220`**, where the signature is **`askSideQuestion(question)`** — one argument, no history, no signal, no `refusal_fallback` |
| `side_question` absent from `sdk.d.ts`               | The _request_ is absent, but `SDKControlRequestProgressMessage` at `sdk.d.ts:3732` names it in prose: _"currently only side_question"_. Semi-acknowledged, still untyped   |
| steer at `agent-manager.ts:2408`, throw at `:2162`   | steer at **`:2380`** / **`:2408`**, throw at **`:2175`**. Re-verify before citing; these drift with every rebase                                                           |

Everything else verified as reported: `steerActiveTurn` on exactly the three
adapters (`claude/agent.ts:2272`, `codex-app-server-agent.ts:4143`,
`opencode-agent.ts:3408`), `tryHandleOutOfBand` on Codex/Pi/OMP,
`provider-subagents/store.ts` at 186 lines with a 106-line test.

## The obstacle that dissolved

The research flagged `sendPromptToAgent` (`agent-prompt.ts:263`) hardcoding
`replaceRunning: true` as the main structural problem. **Phase 1 does not touch
it.**

That funnel's contract is that every _prompt_ goes through it. A side question is
not a prompt: it allocates no turn, writes no transcript, produces no timeline
item in the agent's stream, and cannot be interrupted by or interrupt anything.
It is closer to `setModel` than to a message. So it goes
session handler → `AgentManager` → `AgentSession.askSideQuestion`, beside the
existing control-style calls, and the funnel comment stays true.

Phase 2's writeback **does** go through the funnel, as a steer, which is exactly
what that funnel is for. Keeping the phases on opposite sides of this line is
most of why they're separable.

## Design decisions

All four are settled. Approved 2026-08-24.

**Settled — no tools, on every provider.** Claude forces this (`canUseTool` denies
everything). Codex and OpenCode allow tools and restrain by prompt. Matching
Claude's shape everywhere gives one predictable behaviour instead of three, and
avoids the failure mode Codex needed two prompt blocks to suppress: inherited
history reads to the model as live instructions, so a tool-bearing side fork will
try to resume the parent's task. Codex gets `developerInstructions` mirroring its
own `SIDE_DEVELOPER_INSTRUCTIONS`; OpenCode gets the prompt body's `tools` field
restricted.

**Settled — runtime-only storage.** Matches the main timeline, which is also not
persisted (`docs/architecture.md:330`). Zero disk-schema change, and
`docs/data-model.md:33` notes there is no migration framework, so adding a
persisted category for a feature whose main transcript is ephemeral would be
backwards.

**Settled — its own timeline store, not a new `AgentTimelineItem` variant.**
`AgentTimelineItemPayloadSchema` is a wire discriminated union; adding a variant
needs a `session.supports(...)` serialization gate. A separate store reusing
`user_message` / `assistant_message` avoids that entirely, which is precisely
what provider subagents do.

**Settled — history threads, gated on the spawned CLI version.** Consecutive side
questions in a thread see each other, matching Claude's TUI (`btwHistory`). The
call is the generic control request the SDK helper wraps, because the helper takes
only a question:

```ts
(query as any).request({ subtype: "side_question", question, history });
```

**The deciding variable is the CLI version, not the SDK version.** Paseo does not
run the SDK's bundled binary — `resolveClaudeBinary` (`claude/agent.ts:1677`)
resolves `"claude"` from the user's PATH. So whether `history` is honoured depends
on whatever CLI each user has installed, and it fails **silently**: the control
request succeeds, the answer comes back, and prior exchanges are simply ignored
while the UI presents a thread.

Confirmed by binary inspection: CLI **2.1.239** destructures
`{question, history} = request`. The 2.1.220 handler paired with the pinned SDK
destructures only `question` and passes `threadHistory: false`. The exact version
that added it is between the two and needs one bisect before the gate is written.

Therefore:

- Gate threading on the CLI version via the existing `resolveClaudeCodeVersion`
  (`claude/agent.ts:1691`, wired as an adapter hook at `:1494-1496`), reusing
  `compareVersions` / `parseClaudeCodeVersion` from `model-manifest.ts:240-260`.
  That is the real precedent — models already gate on `minimumClaudeCodeVersion`
  (`:42`, `:54`). `feature-definitions.ts` is model-gated and has no version logic;
  touch it only if the single-shot state is surfaced as an `AgentFeature`.
- **Invert the precedent's default for unresolved versions.**
  `isModelAvailableInClaudeCode` returns `true` when the version is `undefined`
  (`model-manifest.ts:234-235`), and version resolution failure is a warn-and-continue
  (`agent.ts:1555-1560`). Permissive is right for models and wrong here — it
  reproduces the exact silent degradation this gate exists to prevent. **Unresolved
  version means below-floor: single-shot.**
- **Below the floor, send no `history` and tell the UI the thread is single-shot.**
  Degrading silently is the one outcome this design must not have.
- 1a must include an e2e asserting a follow-up references content present only in
  the first exchange. Without it this ships undetected.

Rejected alternatives: **single-shot v1** (cheapest, but a side channel you cannot
ask a follow-up in is a worse product); **bumping the SDK** — rejected twice over,
once for pulling unrelated churn into a fork carry, and once because it addresses
the wrong axis entirely: the user's PATH binary executes the request regardless of
which SDK version is pinned.

## The provider seam

One optional method on `AgentSession` (`agent-sdk-types.ts:636`), shaped like the
`steerActiveTurn` sibling at `:643` — optional so absence _is_ the capability
signal, result union so "can't right now" is a value rather than a throw.

```ts
// agent-sdk-types.ts, beside steerActiveTurn
askSideQuestion?(
  input: { question: string; history: readonly SideExchange[] },
  options: { timeoutMs: number },
): Promise<SideAnswer>;

export interface SideExchange {
  question: string;
  response: string;
}

export type SideAnswer =
  | { status: "answered"; text: string; synthetic: boolean; threaded: boolean }
  | { status: "unavailable"; reason: string }
  | { status: "timed_out" }
  | { status: "failed"; reason: string };
```

`synthetic: true` means the model tried to call a tool or errored instead of
answering. Surface it in the UI as a degraded answer; never cache it as a real
one.

`unavailable` covers the states where the provider legitimately can't: no session
yet (there's no transcript to fork before the first turn), mid-compaction, or a
provider that has the method but is momentarily unable. Distinct from the method
being absent, which means the provider never supports it.

### Cancellation, timeout and failure

`options` carries a timeout, not an `AbortSignal`. SDK 0.3.220's generic
`request()` accepts no signal and imposes no timeout, and `control_cancel_request`
appears in `sdk.mjs` only as an _inbound_ handler — there is no outbound cancel on
the typed or untyped surface. A side question can therefore hang for the CLI's
600 s budget as an unkillable promise.

**v1 declares no cancellation.** The server wraps the call in its own timeout
(default well below 600 s) and resolves `timed_out`; the underlying request is
abandoned, not cancelled. The UI shows a bounded spinner and a retry, never an
indefinite one. Writing a raw `control_cancel_request` to the transport would work
but widens the untyped surface for a v1 affordance; revisit if hangs are real.

**Store write timing**, which also gives reconnect recovery for free:

| Moment            | Store action                                           |
| ----------------- | ------------------------------------------------------ |
| Dispatch          | append the question, mark the thread pending           |
| Answer            | append the answer, clear pending, push `.update`       |
| Timeout / failure | append a failure marker, clear pending, push `.update` |

**Late settlements are dropped.** Abandoning is not cancelling: the underlying
promise still settles when the CLI eventually responds (up to its 600 s budget) or
when the query closes. Attach a rejection handler to the abandoned promise and
discard any settlement arriving after the timeout marker — otherwise a ghost answer
appends after the failure marker, and a late rejection with no handler becomes an
unhandled promise rejection.

Because the question lands at dispatch rather than at completion, a client that
reconnects mid-question recovers the thread through
`agent.side_conversation.timeline.get` and sees a pending state, not a gap.

**Double-submit** while a question is pending is rejected in
`AgentManager.askSideQuestion`, not at the session handler — putting the
one-in-flight-per-thread invariant on the manager means future non-WS surfaces
(MCP, CLI) inherit it for free. **Agent close or interrupt** during a
pending question surfaces as `failed`; the SDK rejects pending control responses
with "Query closed before response received", so this arm is reachable and needs a
test.

**Loading.** The handler calls `ensureUnarchivedAgentLoaded` first, matching the
template at `session.ts:7007`, _before_ reaching the manager — `requireSessionAgent`
(`agent-manager.ts:4883`) throws a raw "Unknown agent" for any idle-unloaded or
post-restart agent. Archived agents return `unavailable` and are **never**
auto-unarchived. This is the honest completion of the funnel-bypass argument: the
one funnel behaviour a side question genuinely needs is loading, so the handler
re-provides it explicitly.

### Per provider

**Claude** (`providers/claude/agent.ts`). Isolate the untyped call behind a
narrow interface in a new `providers/claude/side-question.ts`, copying the
`ClaudeRewindSdk` pattern at `rewind.ts:3-12` exactly:

```ts
export interface ClaudeSideQuestionSdk {
  ask(
    query: Query,
    input: { question: string; history: readonly SideExchange[] },
  ): Promise<{ response: string | null; synthetic: boolean }>;
}

export const realClaudeSideQuestionSdk: ClaudeSideQuestionSdk = {
  /* the cast lives here, once */
};
```

The adapter calls `await this.ensureQuery()` (`agent.ts:2394` shows the pattern)
and passes the live `Query`. This is the file that breaks if Anthropic renames
the method, and it is the only one.

**Codex** (`codex-app-server-agent.ts`). `thread/fork` with `ephemeral: true` and
`developerInstructions`, then `turn/start`, then `turn/interrupt` +
`thread/unsubscribe` to discard. `capabilities.experimentalApi: true` is already
set (`codex-app-server-agent.ts:3132`) and `thread/fork` has prior art in
`codex/rewind.ts:30`.

**The adapter routes notifications by threadId, and a forked side thread is
neither `currentThreadId` nor a known subagent.** Left alone it falls into
subagent buffering (`:5038` `bufferPendingSubAgentNotification`, `:5147`, `:5225`,
`:5281`) and surfaces as a phantom subagent row. So 1c is not "one adapter method":
it needs a side-thread registry that intercepts notifications for side-thread ids
_before_ subagent routing, and the answer has to be collected from those
notifications rather than returned by a call. Size 1c accordingly.

**OpenCode** (`opencode-agent.ts`). `POST /session/:id/fork` → `POST /message`
with `tools` restricted → read → `DELETE`. The fork is persisted, so the delete
is mandatory and must run in a `finally`. A crashed daemon leaks a session; log
the id so it's reclaimable.

## Sequencing

Four PR-sized steps. Each is independently revertable, and 1a is the only one
that can invalidate the design.

**1a — seam + Claude, server only, no UI.** `AgentSession` method,
`SideConversationStore` (copy `provider-subagents/store.ts`, 186 lines), Claude
adapter + the isolated SDK wrapper, `AgentManager.askSideQuestion`. Exercise it
through the existing ad-hoc daemon harness (`docs/ad-hoc-daemon-testing.md`).
**Ship nothing user-visible.** If the vendor surface is going to betray us, it
does so here, at the cost of one PR.

**1b — protocol + app.** Dotted RPCs per `docs/rpc-namespacing.md`:
`agent.side_conversation.ask.request` / `.response`,
`agent.side_conversation.timeline.get.request` / `.response`, push
`agent.side_conversation.update`. Capability `sideConversations` in
`CLIENT_CAPS` with a `COMPAT(...)` tag and removal date — copy the shape of the
`providerSubagents` entry at `client-capabilities.ts:19-21`, but add the removal
date that entry omits.
`features.sideConversations` on `server_info`. Panel copied from
`panels/provider-subagent-panel.tsx` but with a composer, since that one is
read-only. Row kind in the subagents track. Tab target + normalizer + registry.
The template panel uses `react-i18next` (`provider-subagent-panel.tsx:18,70`), so
every panel, composer and error string needs a key — including the
below-the-floor "single-shot" notice. 1b is a new interactive surface, so
`docs/qa.md`'s platform matrix applies: evidence on compact and wide, web and
native.

**1c — Codex.** Larger than it looks: an adapter method _plus_ the side-thread
notification registry described above, plus a provider test asserting no phantom
subagent rows. **1d — OpenCode.** One adapter method plus a provider test. The capability gate means shipping 1b with only Claude wired is correct
behaviour, not a partial state.

## Testing

Per `docs/testing.md` and the repo rule: run only the file you changed, with
`npx vitest run <file> --bail=1`. Never the workspace suite. Push to CI for
breadth.

- `side-conversation/store.test.ts` — copy `provider-subagents/store.test.ts`
  (106 lines): keying, per-thread isolation, parent deletion.
- `providers/claude/side-question.test.ts` — a fake `ClaudeSideQuestionSdk`
  covering answered / `synthetic: true` / `response: null`. The fake is the
  point of the interface.
- One real-provider e2e behind the existing gating, asserting the **invariant**:
  ask a side question mid-turn, then confirm the agent's turn completed
  uninterrupted and the side content appears nowhere in its timeline. That
  invariant is the feature; everything else is plumbing.
- **A threading e2e, in 1a.** Ask a question, then a follow-up that can only be
  answered from the first exchange. This is the test that catches the silent
  degradation above, and it is the reason the CLI-version gate exists.
- A failure-arm test: close the agent with a question pending and assert `failed`
  rather than a hang or an unhandled rejection.
- A manager-seam test and a protocol-schema test in 1b — the RPC pairs must
  round-trip and the capability must gate.
- Never add auth checks (critical rule).

Run `npm run typecheck` and `npm run lint` after each step, and `npm run format`
before committing. Toolchain verified working on 2026-08-24: `npm ci` installed
2685 packages, all three patch-package patches applied, and `oxfmt` / `oxlint` /
`vitest` / `tsc` resolve. `npm run lint -- packages/protocol/src` is clean across
105 files.

Two toolchain notes. **`oxfmt` does format markdown** — it pads table cells to the
widest column and rewrites `*italic*` to `_italic_`, so hand-aligned tables will
be rewritten; it does not reflow prose. And **npm 11.17 gates install scripts**
behind an allowlist, leaving 12 packages' scripts unrun. That does not block this
work: `node-pty` ships prebuilt binaries (`prebuilds/linux-x64/pty.node` under
`packages/server/node_modules/`) and spawns a working PTY without compiling.
`lefthook`'s postinstall is skipped, so git hooks are not installed — run the
format and lint gates by hand.

## Rot joints

Recorded for the manifest comment, per the table in
[local-fork-candidates.md](local-fork-candidates.md):

| Joint                                   | Rots when                                | Caught by   |
| --------------------------------------- | ---------------------------------------- | ----------- |
| New optional `AgentSession` method      | upstream restructures the interface      | typecheck   |
| Copy of `ProviderSubagentStore`         | upstream refactors the timeline store    | typecheck   |
| `CLIENT_CAPS` / `features` additions    | upstream reorganizes capability plumbing | typecheck   |
| **`(query as any)` side-question call** | **Anthropic renames or drops it**        | **nothing** |

The last one is a vendor joint, not an upstream-churn joint, and it is the only
one no gate catches. Mitigations: it lives in one file; the method is optional so
its absence degrades to "provider doesn't support it"; and a runtime probe should
treat a thrown/error-subtype response as `unavailable` rather than a bug. Paseo already accepts vendor risk
at `rewind.ts:1`, but **not on the same terms** — `forkSession` is a typed,
exported SDK function. An untyped cast to an undocumented control subtype is a
strictly weaker guarantee, and the isolation pattern is the only thing the two
share.

## Open questions

Carried from the 2026-08-24 critic pass; none block starting 1a, all block
finishing it.

- **Which CLI version added `history` to the `side_question` handler?** Between
  2.1.220 and 2.1.239. One binary bisect writes the version floor.
- Does `thread/unsubscribe` exist in the Codex app-server at the version Paseo
  targets? The transport is generic so the call is sendable; server-side support
  is unverified from this repo.
- Does OpenCode's `session.prompt` on a forked session block for the full
  generation? If so 1d needs `promptAsync` instead, for answers long enough to
  matter.

## Out of scope for Phase 1

Writeback into the main session. Multiple concurrent side threads per agent.
Persistence across daemon restart. Attachments or images in a side question. Any
ACP provider — the protocol gap is structural, not an omission.
