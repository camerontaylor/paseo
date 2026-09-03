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

Attestation evidence (2026-09-04, prep session on branch
ultragoal-prep/acp-cancellation-boundary at ec1d6387b): the consolidation
grep over the plan returned two hits, both cross-document disambiguation —
"Supersedes the handover's fix 5 rationale per correction 1" (the plan
declaring its authority over the handover) and the busy-turn plan "is
superseded … do not implement it" — zero amendment layers stacked on this
plan; it is the single consolidated layer that reconciles the handover and
review inline with evidence (corrections 1-3). Invariant audit: every
requirement below is cited from the plan's own sections; nothing normative
lives only in goal text. All seams named below exist in the tree at
ec1d6387b (both provider files and their tests, agent-manager.test.ts with
the restored terminator, provider-registry.test.ts, both docs files).

# Normative artifact

The sole home of every requirement is
fork/plans/plan-cancellation-boundary-fix-pass.md, audited at commit
ec1d6387b. Goals below summarize and point; they never carry a requirement
that the plan does not. Sections cited by heading: "Verification record",
"Correction 1", "Correction 2", "Correction 3", "Plan units" P1-P8,
"Sequencing", "Definition of done", "Traps".

Three files are frozen record and must not be modified by this run: the
plan itself, fork/handover-2026-09-04.md, and
fork/plans/review-gjc-acp-cancellation-boundary.md. Where the plan and the
handover disagree, the plan wins — its own header says so, with evidence.
The underlying ralplan plan
(fork/plans/ralplan-gjc-acp-cancellation-boundary.md) stays frozen for the
original scope; fork/plans/ralplan-gjc-acp-busy-turn.md is superseded in
its cancellation design and is history only — never implement it.

If the plan file has changed since ec1d6387b, stop and re-run
ultragoal-prep against the new text before create-goals.

# Status going in (operator-verified 2026-09-04)

P1 is COMPLETE and is not a goal. Commit 5b2e21d83 restored the dropped
test terminator alone, as prescribed, and the verification pass then ran
the gates: the manager suite passes 186/186 — including all nine numbered
cancellation-boundary plan tests plus the fenceOrder assertion (plan test
8), none of which had ever executed on this branch — with lint,
format:check, and full-workspace typecheck green. The fork record files
are committed at ec1d6387b.

Work on branch ultragoal-prep/acp-cancellation-boundary in this worktree.
No new branch, no rebases during the run.

# Context

Paseo fork (getpaseo/paseo), npm workspace monorepo. This run executes the
cancellation-boundary fix pass: closing the five acceptance gaps the
verification review measured against the finalized plan, plus docs. Five
units in dependency order: death settlement (P5), issue-and-return ownerless
interrupt (P2), terminal-reason precedence (P3), the deny router's GJC
branch and suppression log (P4), docs and final sweep (P6+P8). All code
work is in packages/server provider files and their tests; nothing in
packages/app or packages/protocol; fork-only, nothing upstream.

P7's deferrables are explicitly OUT of scope: the abort_result rename, the
provider.acp.\* assertion fold into generic tests 1-3/12-15, and the
Buffer.byteLength assertion. The single exception the plan carves out —
generic test 20 (reservation rollback) — lands with P5.

Live E2E acceptance (plan "Definition of done") needs a gjc host (ceres or
saturn) with the provider registered under GJC_ACP_ABORT_SCOPE=owned and a
`paseo daemon reload` (never restart). Owner-gated: it is NOT a goal
done-when.

# Repo rules (non-negotiable)

- NEVER restart the Paseo daemon on port 6767 — it manages all running
  agents, including yours.
- NEVER run the full test suite. Only targeted
  `npx vitest run <file> --bail=1`, output piped to a file when long
  (the manager suite always: `> /tmp/mgr.txt 2>&1`).
- Always run `npm run typecheck` and `npm run lint` after changes;
  `npm run format` (or `format:files -- <paths>`) before committing. Use
  npm scripts only, never npx eslint/oxfmt/oxlint or package-local
  binaries directly.
- Build before diagnosing cross-package type errors: `npm run build:server`
  when generated declarations may be stale.
- Read CLAUDE.md and the relevant docs/ files before editing; docs/ is the
  source of truth for system knowledge.
- Typecheck is blind to `*.test.ts` (the tsgo program excludes them) — run
  lint as the cheap gate that catches what typecheck cannot.
- If `npm install` runs for any reason: `git checkout -- package-lock.json`
  afterwards, before committing.
- One commit per plan unit, conventional commits matching the five
  implementation commits already on this branch; the body carries the why.
  The P5 consider-decision and the P4 wedge-decision are recorded in their
  respective commit messages.
- agent-manager.test.ts is the rebase hot zone; do not rebase, and re-run
  lint on it after any change that touches it.

# Escalation gates (stop and return to review; never resolve inline)

From the plan's "Traps":

- If gjc 0.15.5 emits a different successful terminal shape than the
  inspected source, stop and review. Do not broaden the validation matrix
  ad hoc.
- If fail-closed scope ever conflicts with a launch-config convention, back
  to review. No silent fallback.
- If evidence during G001 shows the death helper does not cover the
  observed death cases (the plan's "Consider" item), stop and record —
  do not change the ledger's contract inline.

# Verification commands

Per goal (targeted files only):

- npx vitest run packages/server/src/server/agent/providers/acp-agent.test.ts --bail=1
- npx vitest run packages/server/src/server/agent/providers/gjc-acp-agent.test.ts --bail=1
- npx vitest run packages/server/src/server/agent/agent-manager.test.ts --bail=1 > /tmp/mgr.txt 2>&1
- npx vitest run packages/server/src/server/agent/provider-registry.test.ts --bail=1

Then npm run typecheck, npm run lint, npm run format:check (and
npm run build:server first if cross-package declarations are stale).

# Evidence-run instrumentation

This run executes under the ultragoal-prep execution contract. Record
leader context size at every checkpoint (target <150K) and per-goal
wall-clock into checkpoint evidence. One known deviation to record rather
than hide: the fix-pass plan was hand-authored by the verification pass —
consolidating the review and handover into one executable layer with
evidence, not produced by `gjc ralplan --write` final-stage machinery. It
sits at the skip-ralplan boundary (bounded gap closure; every design
decision pre-made by the frozen ralplan plan and its review), which is why
re-planning was not run.

@goal: Settle ACP stop writes as failed on observed death (P5)

Plan authority: "Correction 1", "Correction 2", "Plan units" P5 (plan §2
A3), "Definition of done" AC 15.

One death helper on ACPAgentSession, called from three places so there is
exactly one death path: the child exit handler after the synthesized
foreground terminal (acp-agent.ts:3126-3140); `connection.signal`'s abort
(the SDK's ClientSideConnection exposes `get signal(): AbortSignal`,
acp.d.ts:444 — the only hook that covers transport death with no process
exit); and close() (acp-agent.ts:2797), which today drops the stop record
rather than settling it.

The helper is gated on stopIdentityMatches(stop) so a stop captured on an
older connection is untouched. It must:

- mark every attempt of the current stop settled with outcome `rejected`,
  INCLUDING attempts already marked `success` — correction 1 is why: the
  SDK implements connection.cancel() as a notification whose write errors
  are swallowed (acp.js:905-915), so on a dead pipe an undelivered cancel
  resolves as a settled success. Set the ledger's newest-succeeded state
  to false so isCancelLedgerSatisfied (acp-agent.ts:2023) cannot open;
- reject the staged successor immediately with a death-specific reason
  rather than leaving it to the admission deadline
  (expireStagedSuccessor, acp-agent.ts:1918, stays as backstop);
- for the GJC subclass, record a `reject` verdict on any unsettled
  ownerless abort attempt through the existing recordAbortResult
  (gjc-acp-agent.ts:574) so unresolvedGjcStopFacts reports the real reason
  instead of a bare gjc.abort_result at deadline. Newest-wins already
  protects this from a late real reply — correction 2 is why this matters:
  extMethod is a request whose pending responses are never rejected when
  the read loop ends (acp.js:760-789), so on death the response never
  lands and the successor would burn the full
  ACP_STOPPED_TURN_ADMISSION_TIMEOUT_MS.

Binding test trap (plan "Traps"): both provider suites stub the connection
with test-controlled deferreds, which encodes intended settlement
semantics rather than the SDK's — that is exactly why corrections 1 and 2
were invisible to 207 passing tests. A test for this goal that also stubs
the settlement re-hides the bug. Assert against the SDK's actual behavior.

Consider item (plan P5 — decide explicitly during implementation, do not
silently skip; record the decision in the commit message): whether to stop
trusting a resolved connection.cancel() as proof at all. Scope per the
plan: out of scope to change the ledger's contract in this run — the death
helper overrides the false success; note the weaker proof (settled
notification proves the write was attempted) and raise it if the death
helper turns out not to cover the observed cases (escalation gate).

Tests: generic test 21 (death during stopping settles in-flight writes as
failed and rejects the staged successor immediately); a NEW case for the
inverted mode — a cancel write that resolves because the SDK swallowed its
error must not satisfy the ledger once death is observed; generic test 20
(reservation rollback) lands in this batch per the handover's deferral.

Seams: packages/server/src/server/agent/providers/acp-agent.ts (edit),
packages/server/src/server/agent/providers/acp-agent.test.ts (edit),
packages/server/src/server/agent/providers/gjc-acp-agent.ts (edit),
packages/server/src/server/agent/providers/gjc-acp-agent.test.ts (edit).

Done when: AC 15 met; no path exists on which observed death leaves an
unsettled or falsely-successful attempt; all four targeted suites green;
typecheck and lint green.

@goal: Issue-and-return for the ownerless interrupt (P2)

Depends on G001 — the plan's correction 2 makes P2 dependent on P5: once
interrupt() stops awaiting, the forever-pending hang becomes silent unless
death settlement already exists.

Plan authority: "Plan units" P2 (plan §11 A6+C4), "Definition of done"
AC 17.

Keep the synchronous prefix of issueTerminalAbort (gjc-acp-agent.ts:530) —
identity check, revision bump, idempotency key, provider.gjc.abort_attempt
log — then issue extMethod WITHOUT awaiting, attaching both handlers to
the existing recordAbortResult (gjc-acp-agent.ts:574), which already does
newest-wins, validation and release. Stop awaiting in both interrupt()
branches (gjc-acp-agent.ts:329 and :361). A late rejection is logged and
never terminalizes.

Why (plan): gjc's abort budget and ACP_STOPPED_TURN_ADMISSION_TIMEOUT_MS
are both 10 s (acp-agent.ts:1412) while the manager's post-interrupt wait
is INTERRUPT_SESSION_TIMEOUT_MS = 2 s (agent-manager.ts:92) and
interruptSession (agent-manager.ts:2933) waits
rescueTimeouts.interruptSessionMs around the call itself — a legitimate
10 s abort always loses that race today and is reported as a failed Stop.

Tests: GJC test 32 — interrupt resolves before the control response
resolves; the response validates later; a late rejection never
terminalizes. Existing tests that resolve the control deferred after
`await interrupt()` will need reordering; the write is still issued
synchronously, so abortRequests length assertions hold.

Seams: packages/server/src/server/agent/providers/gjc-acp-agent.ts (edit),
packages/server/src/server/agent/providers/gjc-acp-agent.test.ts (edit).

Done when: AC 17 met; a 10 s healthy abort no longer produces a refused
Stop; targeted suites green; typecheck and lint green.

@goal: Terminal-reason precedence on ownerless release (P3)

Plan authority: "Plan units" P3 (plan §11 A4/C5), "Definition of done"
AC 6.

maybeReleaseOwnerlessStop emits turn_canceled unconditionally today
(gjc-acp-agent.ts:614). The validated disposition must pick the terminal
kind: verdict `safe` (dispositions stopped_left_running / stopped_stopped,
gjc-acp-agent.ts:156) → `turn_canceled`, even when the eligible idle
arrived first; verdict `conditional` (no_active_turn + terminal_no_effect,
:166) → `turn_completed` — nothing was left to stop, so the post-stop idle
is the natural completion edge. Exactly one terminal either way:
terminalDelivered (acp-agent.ts:3604-3607) already guarantees once.

Tests: GJC test 24, both halves.

Seams: packages/server/src/server/agent/providers/gjc-acp-agent.ts (edit),
packages/server/src/server/agent/providers/gjc-acp-agent.test.ts (edit).

Done when: AC 6 met; targeted suites green; typecheck and lint green.

@goal: Deny router GJC branch and suppression observability (P4)

Plan authority: "Plan units" P4 (plan §7 A1), "Definition of done" AC 11
and AC 12.

Entry is respondToPermission (acp-agent.ts:2762) → stopForegroundTurn
(acp-agent.ts:2156). The router has three branches; two exist, one is
missing:

1. Foreground → generic stop + ledger cancel: already implemented and
   tested (generic test 17). No change.
2. No stop-able turn → suppress the write (acp-agent.ts:2171):
   implemented but silent. Add provider.acp.deny_cancel_suppressed with
   the permission request id and correlation ids threaded from
   respondToPermission, and DISTINGUISH the no-connection/not-initialized
   early return from the no-stop-able-turn case — they share the branch
   today and would be indistinguishable in the log (review finding 3).
3. GJC ownerless mirror open → ownerless stop: MISSING. GjcACPAgentSession
   overrides neither respondToPermission nor stopForegroundTurn, so deny
   during a mirror falls into the suppress branch: no stop, no cancel, the
   mirror keeps running, the two-fact release never happens. Factor the
   ownerless install-and-issue out of interrupt() (gjc-acp-agent.ts:314-362)
   into a helper both paths call, and override the routing hook in the GJC
   session.

Executor decision to record in the commit message: the ownerless interrupt
deliberately skips the base pending-permission sweep
(gjc-acp-agent.ts:341-345; the comment explains why). Once deny shares the
helper, confirm a gjc-raised permission pending across an ownerless stop
cannot wedge — the deny path resolves its own permission; Stop does not
resolve theirs.

Tests: generic test 22, GJC test 33.

Seams: packages/server/src/server/agent/providers/acp-agent.ts (edit),
packages/server/src/server/agent/providers/acp-agent.test.ts (edit),
packages/server/src/server/agent/providers/gjc-acp-agent.ts (edit),
packages/server/src/server/agent/providers/gjc-acp-agent.test.ts (edit).

Done when: AC 11 and AC 12 met; targeted suites green; typecheck and lint
green.

@goal: Docs, record hygiene, and final verification sweep (P6 + P8)

Plan authority: "Plan units" P6, "Plan units" P8, "Definition of done".

Docs (CLAUDE.md "Writing docs" rules apply — integrate, don't append; one
fact, one doc):

1. docs/agent-lifecycle.md, Cancellation section (lines 36-51): add the
   plan's §5 sentence — the ten-second admission deadline equals gjc's own
   abort budget and anchors at successor staging, so expiry under a
   slow-but-healthy abort is the documented fail-closed outcome, not a
   defect. docs/providers.md:534 already names the constant and the
   fail-closed semantics; link, do not restate.
2. G004 lands before this goal, so the P6.2 condition is decidable:
   revisit docs/providers.md:530 ("ACP installs it in interrupt() and on
   permission denial") — with the router, the deny entry routes by stop
   kind rather than always installing.
3. P6.3 is an explicit decision to record in the commit message:
   docs/providers.md:526 says an ACP cancellation is "a notification whose
   completion proves the write settled and nothing else". Correction 1's
   fact holds regardless of the ledger-contract decision — the SDK
   swallows write errors, so completion proves the write was _attempted_.
   Tighten the clause; keep the ledger's contract unchanged.

Fork caveat (carried from the prior brief): docs/ is upstream-owned and
this is a fork — keep additions about the generic ACP boundary
(upstreamable) separate in kind from GJC-specific mentions (fork-local,
rebase-hazardous); prefer pointing at the fork plan over restating GJC
specifics.

P8 (operator note — mostly resolved pre-dispatch): the fork record files
and README index rows were committed at ec1d6387b; nothing further is
required unless drift appeared. Deleting the fix-pass record files after
the pass lands (their README rows say "delete when the pass lands") is
owner-gated and NOT part of this goal.

Final sweep: re-run all four targeted vitest files green; npm run
typecheck, npm run lint, npm run format:check green (npm run build:server
first if cross-package declarations are stale). Then push the branch and
dispatch CI — the fork's ci.yml does not fire on push:

git push origin ultragoal-prep/acp-cancellation-boundary
gh workflow run ci.yml --ref ultragoal-prep/acp-cancellation-boundary

Record the CI run URL in the final checkpoint. CI triage is owner-gated:
do not block the run on CI, do not fix CI failures inline; record and
report. The whole-suite verification the branch has never had is CI's job,
not localhost's.

Seams: docs/agent-lifecycle.md (edit), docs/providers.md (edit).

Done when: P6 items integrated into their owning docs; all four targeted
suites plus typecheck/lint/format:check green; branch pushed and CI
dispatched with the run URL recorded.

# DISPATCH (operator notes — not goal content)

Prepared 2026-09-04 by the ultragoal-prep dispatch session. Gating
satisfied: the verification pass is idle (it completed P1 at 5b2e21d83 and
committed nothing further), the record is pinned at ec1d6387b, and the
plan is approved for execution.

Dispatch sequence, from this worktree on branch
ultragoal-prep/acp-cancellation-boundary (ultragoal state is cwd-relative;
the whole run lives in this worktree's .gjc/):

```bash
paseo run -d \
  --title "ultragoal — acp-cancellation-boundary-fix-pass" \
  --provider gjc/zai/glm-5.3 \
  --mode default \
  --thinking high \
  --cwd /Users/ctaylor/.paseo/worktrees/22xk82t3/romantic-frog \
  --label task=ultragoal \
  --label spec=acp-cancellation-boundary-fix-pass \
  "$(cat <<'EOF'
Run the gjc built-in ultragoal skill. Read
fork/plans/brief-ultragoal-acp-cancellation-boundary-fix-pass.md and
execute its EXECUTION CONTRACT verbatim. First run:
gjc ultragoal create-goals --brief-file fork/plans/brief-ultragoal-acp-cancellation-boundary-fix-pass.md --validation-batch-json fork/plans/validation-batches-acp-cancellation-boundary-fix-pass.json
then drive the goals.
EOF
)"
```

`--mode default` is required (plan mode blocks state writes); the provider
string must be gjc/<model-id>. Goal order is load-bearing: G001 before
G002 (P5 gates P2 — correction 2); G002 and G003 share the ownerless
release surface and fixtures; G004 touches both classes and the generic
router; G005 is last and its P6.2 condition depends on G004 having landed.
