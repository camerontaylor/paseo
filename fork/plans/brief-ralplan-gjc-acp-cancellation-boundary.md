# Brief — ralplan: gjc ACP cancellation boundary

Ready-to-paste gjc dispatch. Fresh scoped run, not a continuation of run
`43609706-b2f7-47f1-a093-26cf966f0aa9`.

## Why this is a fresh run

The original ralplan (`43609706`) reached consensus and produced
`fork/plans/ralplan-gjc-acp-busy-turn.md`. New production evidence then
invalidated its cancellation design. A codex `gpt-5.6-sol` session reopened it,
produced a Planner revision 2, got one Architect WATCH verdict, and died on a
provider usage limit before any Critic pass. That draft was recovered from the
transcript and committed as
`fork/plans/ralplan-gjc-acp-cancellation-boundary.md`.

Per the planning-lane policy, a reopened plan does not get hand-appended
amendment layers — it gets a fresh scoped run with a fresh `--run-id`
consuming the converged remainder as frozen input.

## Prompt

```
Run the gjc built-in ralplan skill (/skill:ralplan) in --deliberate mode.

Scope: finish consensus on the GJC ACP cancellation-boundary fix. The draft is
already at Planner revision 2 with one Architect WATCH verdict incorporated and
NO Critic pass ever run. Your job is a fresh Architect steelman and a fresh
Critic gated verdict, revising until consensus or the 5-iteration cap.

This is a FRESH ralplan run with a fresh --run-id. Do not resume or extend run
43609706-b2f7-47f1-a093-26cf966f0aa9.

Inputs (read all four before planning):
- fork/plans/ralplan-gjc-acp-cancellation-boundary.md — the recovered Planner
  revision 2. Treat as the incoming draft, not as approved.
- specs/gjc-acp-foreground-turn-trace.md — the production evidence trace. This
  is the authoritative incident record; there is no specs/*-spec.md, so there
  are no FR/SC identifiers.
- fork/plans/ralplan-gjc-acp-busy-turn.md — the superseded prior plan, retained
  for history. Its mirror and steer design survives; its cancellation design
  does not.
- ~/.paseo-fork/ralplan-receipts/ — archived stage receipts from both prior
  runs, if you want the earlier consensus trail.

Pre-resolved decisions. Do NOT re-open these; they are settled and the ask-gate
has nobody to answer it:
1. Do not raise Paseo's 2s INTERRUPT_SESSION_TIMEOUT_MS or gjc's 5s prompt
   settlement grace. A timeout increase is explicitly rejected, not deferred.
2. The foreground path keeps standard ACP session/cancel. Direct
   _gjc/sdk/control turn.abort is correct ONLY for ownerless gjc work —
   bypassing session/cancel would also bypass gjc's own cancelRequested and
   5s settlement machinery.
3. An ownerless stop opens only after BOTH a validated terminal-safe abort
   result AND an authoritative gjcPhase:"idle" observation. Either order.
   Neither fact alone terminalizes the mirror or admits a successor.
4. Preserve the configured GJC_ACP_ABORT_SCOPE (turn vs owned). Do not
   hard-code scope:"owned" — production uses it but the default is turn.
5. Fork-local provider subclass. No gjc identifiers in the generic ACP base;
   keep the rebase checklist in the ADR.
6. No packages/app or packages/protocol changes. No release or deployment work.
7. Manager force-settlement is presentation/orchestration only and never
   authorizes provider admission. Adapter readiness is independent and
   fail-closed.

Hard constraints:
- PLANNING ONLY. No source changes, no installs, no commits, no PRs, no
  implementation, no delegation to execution skills.
- NEVER restart the Paseo daemon on port 6767 — it manages running agents
  including your own. Any live verification belongs to the implementation
  phase and uses the checkout-local dev daemon and .dev/paseo-home only.
- Do not run the full test suite. Name targeted vitest files in the test plan.
- Use `gjc ralplan --write` with native role subagents and stage artifacts, so
  caps and receipts are enforced rather than convention. Record the stage
  byte-counts into the plan header:
  `wc -c .gjc/_session-*/plans/ralplan/<run-id>/*`.

Output: overwrite fork/plans/ralplan-gjc-acp-cancellation-boundary.md with the
final plan, marked "pending approval". One normative layer — do not append a
revision section to the existing draft. Git holds the prior version at commit
57f69e56a, so replacing the file loses nothing.

If you hit PLANNING-STUCK at the 5-iteration cap, stop and report the contested
domain. Do not resolve residual findings as inline amendments.
```

## Dispatch

````bash
paseo run -d \
  --title "ralplan — gjc-acp-cancellation-boundary" \
  --provider gjc/zai/glm-5.3 \
  --mode default \
  --thinking high \
  --cwd /Users/ctaylor/repos/paseo \
  --label task=ralplan \
  --label spec=gjc-acp-cancellation-boundary \
  "$(cat fork/plans/brief-ralplan-gjc-acp-cancellation-boundary.md | sed -n '/^```$/,/^```$/p')"
````

`--mode default` is required: `plan` mode blocks the plan writes themselves.
The provider string must be `gjc/<model-id>`; bare `gjc` is a hard error.
