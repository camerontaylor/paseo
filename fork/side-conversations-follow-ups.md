# Side conversations — follow-ups

Handover for the next person on the side-conversations feature. Written after a
code review of the working tree on `read/side-conversations-phase1-plan` and the
fix pass that closed all eight findings.

The feature: ask a one-off question of a running agent in a side thread that does
not pollute the main timeline. Claude and OpenCode implement the provider seam;
Codex, Copilot and Pi do not.

## State

Eight review findings are fixed in the working tree. Nothing is committed.

Verified across the combined tree after all fixes landed:

- Typecheck clean — server, client, app, protocol (run `npm run build:client` first).
- Lint clean — 0 warnings, 0 errors, 3763 files.
- Format clean, except four pre-existing `fork/*.md` files from `3a083f01d`.

**One verification gap.** The Claude and OpenCode `side-question.test.ts` suites
ran before `agent-sdk-types.ts` was widened with the `options?: { signal? }`
parameter. The change is type-only and the combined typecheck covers signature
mismatches, so exposure is low — but those two suites have not run against the
final tree. Run them before you trust a green board:

```bash
npx vitest run packages/server/src/server/agent/providers/claude/side-question.test.ts --bail=1
npx vitest run packages/server/src/server/agent/providers/opencode/side-question.test.ts --bail=1
```

## Follow-ups

Ordered by what bites first.

### 1. `ensureQuery()` has no `closed` guard

`packages/server/src/server/agent/providers/claude/agent.ts:3144`

The real root cause behind the review's "askSideQuestion can spawn a process tree
for a torn-down session". `ensureQuery()` awaits `buildOptions()` before calling
`claudeQuery(...)`. If `close()` lands in that gap, `ensureQuery()` assigns a fresh
query and child process to fields `close()` already nulled — a leaked CLI process
tree that nothing tracks and nothing will reap.

Eight call sites. Two are guarded: `startTurn` (2259, throws) and `askSideQuestion`
(2332, returns `unavailable` and reaps the orphan). Five public methods are not:

| Method             | Line |
| ------------------ | ---- |
| `setMode`          | 2461 |
| `setModel`         | 2476 |
| `listCommands`     | 2789 |
| `revertFiles`      | 2828 |
| `ensureFreshQuery` | 2976 |

`runQueryPump` (3763) is the internal pump and needs separate thought.

The fix is a `closed` guard inside `ensureQuery()` itself. It was deliberately
left out of the review fix pass: throwing there changes behaviour at every call
site, which is well outside a review-fix remit. Decide the contract first —
`askSideQuestion` wants a value (`unavailable`), `startTurn` wants a throw.

### 2. Docs are not updated

The feature adds a third subagent-track row kind, a new panel, a new tab target,
three RPCs and a capability gate. None of it is documented. All four fix agents
stayed inside their code-ownership boundaries, so this was never in scope.

| Doc                              | What is now wrong or missing                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| `docs/agent-lifecycle.md`        | "The subagents track" lists two row kinds; there are three. The new entry point is undocumented. |
| `docs/side-panel.md`             | `side_conversation` is a new tab placement target.                                               |
| `docs/rpc-namespacing.md`        | Three new dotted RPCs; confirm they read as intended examples.                                   |
| `docs/protocol-compatibility.md` | The `sideConversations` COMPAT gate is tagged `v0.5.x` — pin the real version before release.    |

Follow the writing rules in `CLAUDE.md`: integrate into the doc that owns the
subject, do not append.

### 3. `CLAUDE_SIDE_QUESTION_HISTORY_FLOOR` version compare is duplicated

`packages/server/src/server/agent/providers/claude/side-question.ts:43`

`isAtOrAboveVersion` is a six-line reimplementation of `compareVersions` at
`model-manifest.ts:240`, which is module-private. Export it and delete the
duplicate. One-line change plus the deletion.

### 4. `clearParent` has no production caller

`packages/app/src/side-conversations/store.ts:114`

The daemon emits one `agent.side_conversation.removed` per thread even for
parent-wide drops, because `SideConversationStore.deleteParent` returns one event
per record. The per-thread subscription already covers archive, reload and
history-clear, so `clearParent` is tested but unreachable.

Keep it if a bulk-removal broadcast is coming; delete it otherwise. Do not leave
it undecided — it reads like a wired-up path.

### 5. `unavailable` means two different things

`packages/server/src/server/agent/agent-sdk-types.ts:650`

`{ status: "unavailable" }` is returned both when the provider has no
`askSideQuestion` at all (`agent-manager.ts:1175`) and when a session is torn down
(`claude/agent.ts:2321`, `opencode-agent.ts:3490`). The app cannot tell "this
provider does not support side questions" from "your agent just closed", and shows
the same message for both.

Splitting the status is a protocol change — `SideAnswerPayloadSchema` is a
discriminated union on `status`, so a new member is additive and safe for old
clients, which will fail the union parse. Prefer a `reason` field on the existing
`unavailable` member instead.

### 6. Concurrent threads on one Claude agent share the version probe

`packages/server/src/server/agent/providers/claude/agent.ts:2360`

`activeSideQuestions` keys on `parentAgentId\0threadId`, so two side conversations
on _different_ threads of the same agent run concurrently. They share the memoized
`resolveVersionOnce` promise, and `AgentManager` aborts the signal in an
unconditional `finally` — so whichever finishes first kills the other's probe. The
loser falls back to `single_shot` and silently loses history threading.

Self-healing: the memo clears on rejection and the next ask re-probes. Quality
wobble, not a correctness bug. Fix by not passing the caller's signal into the
shared memo.

### 7. OpenCode cannot cancel an in-flight refetch

`packages/server/src/server/agent/providers/opencode/side-question.ts:150`

`OpenCodeSideQuestionClient.session.messages` takes no `AbortSignal`. An abort that
lands mid-request cannot cancel that one refetch; it completes, then the loop exits
at the next top-of-loop check. Bounded and correct, just not instant. Fixing it
means widening the client interface into SDK request options.

## Gotchas

Things that cost time during the fix pass. None are obvious from the code.

**`waitForAgentClose` must be stubbed in `session.test.ts`.** Any test reaching
`ensureUnarchivedAgentLoaded` needs it on the mock manager, or `asAgentManager`
throws `createStub: "waitForAgentClose" was called but not stubbed`. The handler
swallows that into its error arm and returns `answer: { status: "unavailable" }`,
which reads exactly like a routing bug.

**`workspace-tab-trailing-accessory.test.tsx` mocks `lucide-react-native` with an
explicit allowlist.** Add any new menu icon there or the suite fails at import.

**`parseClaudeCodeVersion` rejects a leading `v`.** Its `\b` anchor cannot match
between `v` and `2`, so `"v2.1.227"` returns `null` and falls back to
`single_shot`. Unreachable here — `resolveClaudeCodeVersion` always emits
normalized `x.y.z` — but a trap if you reuse the parser.

**`dispatch()` needs a filtering arm per event type.** Adding a variant to
`AgentManagerEvent` is half the job: `dispatch()` and `eventBelongsToInternalAgent()`
in `agent-manager.ts` each switch on event type. Miss them and an `agentId`-scoped
subscriber receives every parent's threads, and internal-agent threads leak to
global subscribers. `provider_subagent` has these arms; copy the whole pattern.

**`SubagentsTrack` returns `null` when it has no rows.** That is why the "New side
conversation" control lives in the agent tab menu (`workspace-tab-menu.ts`) rather
than the track header — a control in the header would be invisible for exactly the
agent that has no side conversations yet.

**A thread is named by its first question.** The server answers `timeline.get` for
an unknown thread with an empty snapshot, so a freshly minted thread stores an
`items: []` record. `selectSideConversationsForParent` skips empty records, or you
get a nameless track row stuck on "Loading…" forever.
