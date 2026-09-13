EXECUTION CONTRACT (explicit directives; these outrank skill-default routing
heuristics, including the "work within a single domain stays with the leader"
inline default):

1. Delegation: each story's implementation goes to a FRESH executor subagent
   spawned via the NATIVE task tool, discarded at that story's checkpoint.
   Never spawn external agents for goal work — external spawns bypass
   task.agentModelOverrides role routing and token-log.jsonl accounting.
2. Slices: drive each story as a SEQUENCE of task invocations of <=3-5
   explicit files each, resuming the same executor within the story
   (resume, don't respawn) per the subagent reuse contract.
3. Compaction: issue /compact or /handoff at EVERY story and batch boundary.
   Do not rely on auto-compaction — with default thresholds a 1M-context
   leader model auto-compacts only near 850K tokens.
4. Leader ceiling: leader context stays UNDER 150K tokens at every
   checkpoint; read the number from the session context report at checkpoint
   time and record it in the checkpoint evidence. The leader does
   orchestration, checkpoints, integration, and verification only.
5. Model routing: role->model routing comes from task.agentModelOverrides in
   the user config, engaged automatically by native task spawns. Do not
   hardcode models in this brief.
6. Attestations (must be true before create-goals ran; leave them in the
   brief as evidence):
   Attest: consolidation check run — artifact is as-amended, zero supersession layers.
   Attest: invariant audit run — nothing normative lives only in goal text.
   Attest: per-goal file-target seams named.

Attestation evidence (2026-08-31, prep session on branch
ultragoal-prep/acp-cancellation-boundary): consolidation grep over the plan
returned zero hits (no supersede/amendment markers); the steering and mirror
contracts are restated in full inside plan sections "Steering" and "GJC
ownerless mirror identity and phase tracking", so the prior plan
fork/plans/ralplan-gjc-acp-busy-turn.md is history-only and is not an input;
all seams below were verified to exist in the tree (gjc-acp-agent.ts and its
test are new files).

# Normative artifact

The sole home of every requirement is
fork/plans/ralplan-gjc-acp-cancellation-boundary.md, audited at commit
57f69e56a. Goals below summarize and point; they never carry a requirement
that the plan does not. Sections cited by heading: "Detailed design" items
1-14, "Implementation plan" Steps 1-5, "Test plan", "Observability",
"Acceptance criteria" 1-14, "Unresolved decisions and escalation gates".

If the plan file has been rewritten since 57f69e56a (the pending ralplan
re-run in brief-ralplan-gjc-acp-cancellation-boundary.md overwrites it), stop
and re-run ultragoal-prep against the new text before create-goals.

Evidence: specs/gjc-acp-foreground-turn-trace.md is the authoritative incident
record (2,004 ms force-settlement / 5 s prompt-pending race). There is no
specs/\*-spec.md; no FR/SC identifiers exist.

# Context

Paseo fork (getpaseo/paseo), npm workspace monorepo. This run implements the
GJC ACP cancellation-boundary fix: a generic ACP session stop fence installed
before session/cancel, atomic successor admission gated on authoritative
prompt terminalization plus settlement of every session-scoped cancel write,
and a GJC fork-only provider subclass whose ownerless stop requires both a
validated terminal-safe turn.abort result and a post-stop authoritative idle,
in either order. The work is fork-only; nothing goes upstream. No packages/app
or packages/protocol changes.

# Repo rules (non-negotiable)

- NEVER restart the Paseo daemon on port 6767 — it manages all running
  agents, including yours.
- NEVER run the full test suite. Only targeted
  `npx vitest run <file> --bail=1`, piped to a file if output is long.
- Always run `npm run typecheck` and `npm run lint` after changes;
  `npm run format` before committing. Use npm scripts only, never npx eslint
  or package-local binaries directly.
- Build before diagnosing cross-package type errors: `npm run build:server`
  when generated declarations may be stale.
- Read CLAUDE.md and the relevant docs/ files before editing; docs/ is the
  source of truth for system knowledge.
- Live E2E acceptance (plan "Live E2E acceptance") runs only against the
  checkout-local dev daemon and .dev/paseo-home, and is owner-gated: it is
  NOT a goal done-when.

# Escalation gates (stop and return to review; never resolve inline)

From the plan's "Unresolved decisions and escalation gates":

- If GJC 0.15.5 emits a different successful terminal shape than the
  inspected source, stop and return the captured non-sensitive result. Do not
  broaden the validation matrix ad hoc.
- If failing invalid GJC_ACP_ABORT_SCOPE at initialization conflicts with an
  established launch-config convention, stop and return. Do not silently fall
  back.
- If generic ACP cannot expose an atomic provider-gate commit without
  widening mutable internals, stop and return for architecture review rather
  than duplicating start-side effects in the GJC subclass.

# Verification commands

Per goal (targeted files only):

- npx vitest run packages/server/src/server/agent/providers/acp-agent.test.ts --bail=1
- npx vitest run packages/server/src/server/agent/providers/gjc-acp-agent.test.ts --bail=1
- npx vitest run packages/server/src/server/agent/agent-manager.test.ts --bail=1
- npx vitest run packages/server/src/server/agent/provider-registry.test.ts --bail=1

Then npm run typecheck, npm run lint, npm run format:check (and
npm run build:server first if cross-package declarations are stale).

# Evidence-run instrumentation

This run executes under the ultragoal-prep execution contract. Record leader
context size at every checkpoint (target <150K) and the per-goal wall-clock
into checkpoint evidence. One known deviation to record rather than hide: the
plan was recovered from a crashed planner (commit 57f69e56a), so it was not
produced by `gjc ralplan --write` final-stage machinery; if the pending
ralplan re-run completes before dispatch, that deviation is resolved and the
plan header should carry stage byte-counts.

@goal: Generic ACP session stop boundary and atomic admission

Implement Step 1 of the plan: the generic, provider-neutral stop/admission
machinery inside ACPAgentSession. No gjc identifier or GJC response shape
enters this file.

Plan authority: "Detailed design" 1-7 (stop state idle/reserved/running/
stopping with immutable stop identity; session-scoped cancel ledger;
identity-checked finishTurn terminal proof; one staged successor with an
invalidation token distinct from stop identity and attempt revision;
ACP_STOPPED_TURN_ADMISSION_TIMEOUT_MS = 10_000 fail-closed admission deadline
following OPENCODE_PENDING_ABORT_START_TIMEOUT_MS; the synchronous-commit
startTurnWithAdmission helper with no await between final recheck and
reservation; close and permission-denial routing through the same boundary);
"Implementation plan" Step 1; "Test plan" generic ACP unit tests 1-19;
"Acceptance criteria" 2, 3, 4, 5, 10, 11, 13; "Observability" provider.acp.\*
events.

Seams: packages/server/src/server/agent/providers/acp-agent.ts (edit — also
export ACPAgentSessionOptions and add the protected accessors the GJC
subclass needs: session handle, foreground state, event delivery, logger,
one-key read-only launch-env lookup), packages/server/src/server/agent/
providers/acp-agent.test.ts (edit).

Done when: all 19 generic ACP unit tests pass via the targeted vitest
command; direct concurrent starts still throw the existing foreground-active
error; behavior with no stop installed is unchanged; typecheck and lint green.

@goal: GJC ownerless mirror, two-fact stop, scope handling, and dispatch

Implement Steps 2 and 3: the fork-only GJC provider and its registry
dispatch. Merged into one goal because the dispatch test asserts construction
of the client built here (validation-coupled).

Plan authority: "Detailed design" 8-13 (stable gjc-autonomous-<uuid> mirror
id with explicit-id terminals; phase revisions and post-stop idle eligibility
with working-edge invalidation; GJC_ACP_ABORT_SCOPE resolution that fails
closed on invalid values; the exact GJC 0.15.5 terminal-result validation
matrix including the no_active_turn/terminal_no_effect conditional case; the
two-fact ownerless stop release in either order; repeated-Stop identity
separation; turn.steer returning accepted/unavailable without interrupt or
retry); "Implementation plan" Steps 2-3; "Test plan" GJC unit tests 1-32 and
provider registry tests 1-2; "Acceptance criteria" 6, 7, 8, 9, 10, 14;
"Observability" provider.gjc.\* events.

Seams: packages/server/src/server/agent/providers/gjc-acp-agent.ts (new),
packages/server/src/server/agent/providers/gjc-acp-agent.test.ts (new),
packages/server/src/server/agent/provider-registry.ts (edit — providerId
"gjc" with extends "acp" constructs GjcACPAgentClient before the generic
fallback), packages/server/src/server/agent/provider-registry.test.ts (edit).

Depends on goal 1's protected seams. Foreground GJC stops use ACP
session/cancel through the generic boundary only; terminal turn.abort control
is ownerless-only.

Done when: all 32 GJC unit tests and both registry tests pass; acp-agent.ts
still contains no gjc identifiers; typecheck and lint green.

@goal: Manager log ownership and replace-race fixtures

Implement Step 4: manager-owned log wording and the race reproductions. No
timeout changes, no manager readiness state, no waiting on provider
readiness.

Plan authority: "Detailed design" 14 (manager logs state only manager-owned
facts with shared session/turn/stop correlation ids; "cancellation
acknowledged" becomes "cancellation notification write settled"; the
existing no-terminal-event fixture stays green only because its fake provider
is already terminal/fenced at the adapter when interrupt() returns — rename
and comment it to make that contract explicit); "Implementation plan" Step 4;
"Test plan" manager integration tests 1-10; "Acceptance criteria" 1, 12, 13.

Seams: packages/server/src/server/agent/agent-manager.ts (edit — wording and
correlation fields only), packages/server/src/server/agent/agent-manager.test.ts
(edit — add the 1,500/5,000 ms and 2,000/5,000 ms reproductions and the
staged-replacement Stop coverage).

Done when: all manager integration tests pass, including both timing
reproductions with zero replacement prompts while the original prompt is
unresolved; INTERRUPT_SESSION_TIMEOUT_MS unchanged; typecheck and lint green.

@goal: Documentation integration and final verification

Implement Step 5 and the run's final verification sweep.

Plan authority: "Implementation plan" Step 5 (integrate the stop-boundary
rule into the existing Cancellation section of docs/agent-lifecycle.md;
update the session-scoped cancellation boundary in docs/providers.md using
OpenCode as the existing precedent and ACP/GJC as the second implementation;
do not append duplicate lifecycle prose elsewhere); CLAUDE.md "Writing docs"
rules (integrate, don't append; one fact, one doc).

Seams: docs/agent-lifecycle.md (edit), docs/providers.md (edit).

Fork caveat: docs/ is upstream-owned and this is a fork — keep the additions
about the generic ACP boundary (upstreamable) separate in kind from
GJC-specific mentions (fork-local, rebase-hazardous); prefer pointing at the
fork plan over restating GJC specifics.

Done when: all four targeted vitest files re-run green; npm run typecheck,
npm run lint, npm run format:check green; docs changes reviewed at the final
validation boundary.

# DISPATCH (operator notes — not goal content)

Prepared 2026-08-31 by ultragoal-prep. Gating: the plan's own status is
"pending fresh Architect/Critic review and owner approval", and
brief-ralplan-gjc-acp-cancellation-boundary.md (on custom, commit 0c00406e0)
prepares exactly that fresh ralplan consensus run — which will overwrite the
plan file. Do not dispatch create-goals until the owner either approves the
plan as-is or the ralplan re-run lands and ultragoal-prep is re-run against
the new text.

Dispatch sequence, from a worktree off custom on branch
plan/gjc-acp-cancellation-boundary (ultragoal state is cwd-relative; the
whole run lives in that worktree's .gjc/):

```bash
paseo run -d \
  --title "ultragoal — gjc-acp-cancellation-boundary" \
  --provider gjc/zai/glm-5.3 \
  --mode default \
  --thinking high \
  --cwd <worktree-root> \
  --label task=ultragoal \
  --label spec=gjc-acp-cancellation-boundary \
  "$(cat <<'EOF'
Run the gjc built-in ultragoal skill. Read
fork/plans/brief-ultragoal-gjc-acp-cancellation-boundary.md and execute its
EXECUTION CONTRACT verbatim. First run:
gjc ultragoal create-goals --brief-file fork/plans/brief-ultragoal-gjc-acp-cancellation-boundary.md --validation-batch-json fork/plans/validation-batches-gjc-acp-cancellation-boundary.json
then drive the goals.
EOF
)"
```

`--mode default` is required (plan mode blocks state writes); the provider
string must be gjc/<model-id>. Goal order is load-bearing: G001 before G002
(protected seams), G002 before G003 (race reproductions need the provider),
G004 last.
