# P6 copied pending-state reproduction

These are audit attachments, not production source or a new test suite. The two harness copies
come from the integrator's scratch scripts; only the hardcoded home was replaced with
`TMAD_AUDIT_HOME`. They import the repository's existing in-process daemon and fake-provider
helpers. The fixture contains synthetic data only. No live-home contents or credentials are copied.

The original runtime outputs and final focused-test summaries are retained alongside the harnesses.
The fixture is stored as `.json.txt` to preserve its exact bytes and SHA-256
`eb0fbafe6d8e339f6bf3d8fdc2f206328935e0405d570827560a6ec3a68b2ae3`.
This proves dormant preservation only, not provider dispatch. Both phases observed that hash before/during/after shutdown and zero fake-provider turns;
the enabled phase recovered revision 1 and `pending-copy-1`.

Run from a checkout with the recorded local refs available. Commands below create disposable
worktrees and a synthetic home; they were not rerun by the docs worker. Keep the same home between
phases. Each harness starts an ephemeral loopback daemon in-process; it never contacts port 6767.
Do not point `TMAD_AUDIT_HOME` at a live home.

```bash
coordination_checkout="$PWD"
audit_root="$(mktemp -d)"
export TMAD_AUDIT_HOME="$audit_root/copied-home"
evidence="$coordination_checkout/fork/plans/tmad-port/evidence/P6-runtime"
mkdir -p "$TMAD_AUDIT_HOME/.paseo/queues"
cp "$evidence/pending-fixture.json.txt" "$TMAD_AUDIT_HOME/.paseo/queues/12345678-1234-4123-8123-123456789abc.json"
sha256sum "$TMAD_AUDIT_HOME/.paseo/queues/12345678-1234-4123-8123-123456789abc.json"
git worktree add --detach "$audit_root/queue-free" 365cd7a1c17d8e1511d2a5cd59a13417598edaf3
git worktree add --detach "$audit_root/enabled" 9584b2a669ce90a5df8c9eac66073e85124e90bb
cp "$evidence/queue-removal-runtime-check.ts.txt" "$audit_root/queue-free/packages/server/src/p6-audit-runtime.ts"
cp "$evidence/queue-removal-enabled-runtime-check.ts.txt" "$audit_root/enabled/packages/server/src/p6-audit-runtime.ts"
cd "$audit_root/queue-free"
npm ci
npm run build:server
npx tsx packages/server/src/p6-audit-runtime.ts > "$audit_root/queue-free-runtime.log" 2>&1
cat "$audit_root/queue-free-runtime.log"
cd "$audit_root/enabled"
npm ci
npm run build:server
npm run build:app-deps
npm run typecheck
npm run lint
npx tsx packages/server/src/p6-audit-runtime.ts > "$audit_root/enabled-runtime.log" 2>&1
cat "$audit_root/enabled-runtime.log"
```

Reproduce focused tests individually from the enabled checkout, using `--bail=1` on each command.
The four client/server files are `packages/client/src/daemon-client.test.ts`,
`packages/server/src/server/agent-queue/service.test.ts`,
`packages/server/src/server/message-receipts/index.test.ts`, and
`packages/server/src/server/session.test.ts`. The three app files are
`packages/app/src/composer/input/state.test.ts`, `packages/app/src/voice/voice-runtime.test.ts`, and
`packages/app/src/stores/session-store.test.ts`. Use `npx vitest run <file> --bail=1` and capture
output to a file. Do not run a workspace-wide suite.

For the frozen-only comparison, repeat package setup and the session test in a separate disposable
checkout of `0169f9a839fcdc01d4df04da02872ef3167c6dc9`. Its known side-conversation failure is
expected because the separate side repair is absent; no passing release claim follows from it.

Remove the two audit harness files before removing disposable worktrees with `git worktree remove`.
Retain reproduction outputs as needed before deleting the synthetic home. These checks do not
establish device behavior, credentialed provider behavior, or live-home migration.
