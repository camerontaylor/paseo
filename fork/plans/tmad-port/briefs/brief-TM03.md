You are the queue UI porter (P4, feature TM-03). Read /tmp/tmad-port/COMMON.md and obey it, then /tmp/tmad-port/plan.md ("Queue and composer" contract, P4) and /tmp/tmad-port/evidence/TM-02.md (the daemon API you build on). Your worktree is on branch `intake/tmad-queue-ui`, branched from intake/tmad-message-queue (TM-02). Do not merge anything else.
Report ID: TM-03.

Source: packages/app/src/stores/queue-outbox-store/{index,model,model.test}.ts and composer/queue UI hunks in 51fb7693d from source PRs #23-26, #30-32 (`gh pr view <N> -R tmad4000/paseo --json files,commits,body`; `git diff cbd1210c7 51fb7693d -- packages/app/src | grep`-guided). Port with provenance trailers.
Requirements:
- Canonical submission owner stays `dispatchComposerAgentMessage`; add a queue admission action that does not create a submitted timeline row early; drain/send-now acknowledgement reconciles into the existing identity system so the server's accepted prompt yields exactly one canonical user row.
- Gate on the TM-02 capability flag; against old hosts existing local queues keep their existing meaning and are not portrayed as durable. COMPAT-tag any transition path.
- Edit / reorder / delete / send-now controls with revision handling (stale revision -> visible conflict, not silent overwrite). Preserve draft attachments and edit recovery.
- Outbox: after the source's 8-attempt limit, keep the item visible as failed with explicit Retry / Discard. Uncertain delivery visible as pending reconciliation.
- Explicit Steer, Queue and Interrupt affordances. KEEP our current typed-send default; write a short comparison of source default vs ours in the report for the human to decide (product decision, do not change it).
- Localize all strings in every locale; follow docs/design.md, docs/hover.md, docs/unistyles.md, docs/menus.md.
Tests: carry queue-outbox model tests; add tests for admission without early row, receipt reconciliation to one row, stale revision, retry exhaustion visible state, capability-absent behavior; run existing composer actions/submit/queue-sync tests individually. typecheck, lint, format. If feasible, a two-client daemon e2e (in-process daemon harness per docs/ad-hoc-daemon-testing.md) for enqueue/edit/reorder/delete/reconnect mirroring; otherwise document exactly what remains.
Report per COMMON.md.
