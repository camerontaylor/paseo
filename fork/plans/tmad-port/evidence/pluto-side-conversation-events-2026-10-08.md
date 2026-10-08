# Pluto side-conversation event blocker — 2026-10-08

Worktree: `/home/ctaylor/.paseo/worktrees/3rzqjhby/pluto-side-conversation-events`
Branch: `fix/pluto-side-conversation-events`
Reproduced base SHA: `24f134618cd8a7143615debf927c1ac60b9ba813`
Reported Fork CI: https://github.com/camerontaylor/paseo/actions/runs/37187135673
Local environment: Linux 6.12.63, Node v22.20.0, npm 10.9.3.

## Reproduction

Initialized the worktree with `node fork/scripts/init-worktree.mjs --no-seed`
and rebuilt declarations with `npm run build:server`. Both passed. Initialization
verified that workspace packages resolve inside this worktree. No daemon or live
state was started, stopped, restarted, or edited.

On the unchanged base SHA, from `packages/server`:

```sh
npx vitest run src/server/session.test.ts --bail=1 > /tmp/paseo-side-baseline.log 2>&1
```

Exit 1: three tests passed, then `side conversation manager events reach every
capable client` failed at `src/server/session.test.ts:259`. Expected update and
removed messages; received `[]`. This reproduces the reported public CI symptom
without provider authentication or an environment workaround.

## Cause and fix

Session manager observation became demand-driven. The constructor no longer
subscribes eagerly. `updateClientCapabilities()` refreshed producers only when
given a source, and the manager demand calculation omitted side-conversation
capability. The existing test advertises that capability without a source, so
there was no manager subscription to receive its dispatched events. A modern
source advertising only side conversations had the same missing-demand problem.

The old forwarding arm also used the session's most recently negotiated
capabilities, then broadcast through `emit()`. In a shared session this could
suppress capable clients when an incapable client connected last, or broadcast
to incapable clients when a capable client connected last.

The two-file fix refreshes observation after capability updates, includes
side-conversation demand, and forwards update/removal events to each capable
source. Source-free demand is tracked separately so the last detached source's
stale capability snapshot cannot reactivate delivery. The existing outbound
authorization check remains in the forwarding path: these observations still
require `workspace.read`; asking still requires `workspace.write`. No permission
map, protocol schema, capability name, or assertion was weakened. No auth checks
were added to tests.

The original failing assertion remains intact. Added cases cover modern sources
with mixed capabilities in both connection orders, multiple capable sources,
individual and complete detach, and capability removal. The existing event
adapter now actually removes unsubscribed listeners.

## Validation

Commands ran serially within this worktree; output was captured to files.

| Command | Result | Output |
| --- | --- | --- |
| `node fork/scripts/init-worktree.mjs --no-seed` | passed | `/tmp/paseo-side-init.log` |
| `npm run build:server` | passed | `/tmp/paseo-side-build.log` |
| baseline session file, `--bail=1` | reproduced failure | `/tmp/paseo-side-baseline.log` |
| final session file, `--bail=1` | 157 passed | `/tmp/paseo-side-final-session.log` |
| `npx vitest run src/server/authorization/index.test.ts --bail=1` from server | 7 passed | `/tmp/paseo-side-authorization.log` |
| `npm run format` | passed | `/tmp/paseo-side-format.log` |
| `npm run typecheck` | passed across workspaces | `/tmp/paseo-side-typecheck.log` |
| `npm run lint` | 0 warnings, 0 errors | `/tmp/paseo-side-lint.log` |
| `git diff --check` | passed | no diagnostics |

The exact authorization file was justified by the fork/upstream-sync guard for
carried message permissions and the retained outbound permission boundary. No
full suite ran. Local execution proves Linux behavior; Windows and macOS remain
for the parent's CI/integration pass. Parent owns review and assembly. No push,
deployment, custom/mine edit, or live manifest/config change was performed.

## Local commit

Commit: `fddb4fa8587ae377286ffbea3137df4c53bdc7a9`
Subject: `fix(server): Restore side conversation event delivery`
Normal pre-commit format, lint, and workspace typecheck all passed.
Hook output: `/tmp/paseo-side-commit.log`.

Tracked working tree is clean. Worktree initialization created seven untracked
per-package `node_modules` symlinks (app, cli, desktop, expo-two-way-audio, plugin,
protocol, website); the repository's directory-only ignore pattern does not
hide these symlinks. They are dependency setup artifacts and are not committed.
