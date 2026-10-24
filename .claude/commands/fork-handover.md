---
description: Resume the Paseo fork work from this checkout — verify state, then pick up the side-conversations port or a pending plan review.
---

You are picking up fork work in this checkout. Orient, verify, then act.

## 1. Orient

Read, in this order:

- `fork/README.md` — the `fork/` namespace, branch discipline, the PR grab basket.
- `fork/handover-2026-08-29.md` — the migration record and the gjc ACP diagnosis.
- `CLAUDE.local.md` (symlink to `fork/claude-local.md`) — origin/upstream remotes.

Do not re-derive the gjc ACP diagnosis; it is written up with file:line anchors in the
handover and in `specs/gjc-acp-foreground-turn-trace.md`. Verify any anchor before
acting on it — upstream moves fast and this branch gets rebased.

`custom` is worked from more than one host. Fetch before you commit and rebase before
you push; a plain `git push` will be rejected if another host got there first.

## 2. Verify this checkout

```bash
git status --short && git log --oneline -1
git fetch origin && git status -sb | head -1
```

Then make the checkout buildable. Two separate failures present identically, and the
lefthook pre-commit hook runs a full workspace typecheck, so either one blocks **every**
commit including docs-only ones:

```bash
ls -d packages/protocol/dist >/dev/null 2>&1 || npm run build:server
ls -d node_modules/expo-sqlite >/dev/null 2>&1 || npm install
```

The build fixes missing declarations (`Cannot find module '@getpaseo/protocol/...'`).
Only the install fixes `packages/app`, whose `expo-sqlite` and `fake-indexeddb` arrived
with the upstream rebase — a `node_modules` that predates it is missing them. After
`npm install`, `git checkout -- package-lock.json`: npm rewrites hundreds of
`"peer": true` markers, which is nothing but future rebase conflict.

On a fresh clone, run `mise trust` before `npm ci`. An untrusted `.mise.toml` makes
mise abort _before_ npm runs, so the install fails while a piped `$?` reports success.
Capture exit codes directly, never through `| tail`. Worktrees are covered
automatically by `scripts/worktree-trust-mise.sh`, the first `paseo.json` setup step.

## 3. Work in flight

### A. Side conversations — follow-ups closed

All seven follow-ups are done on branch `fork-handover/side-conversations-merge`
(tip `25c089317`): the closed-session spawn guard, the version-compare dedupe, the
`reason` field on unavailable answers, the unshared version-probe signal, OpenCode
in-flight refetch cancellation, the `clearParent` deletion, and the docs pass that let
the follow-ups doc be deleted per its README contract.

One durable decision from the port: side conversations route on the
`openInSidePane.subagents` preference rather than one of their own, because they
launch from the subagents track and present as one. Separating them means a new
`OpenInSidePanePreferences` key plus a settings row and nine locale files — additive,
but not free. `packages/app/src/workspace-tabs/open-beside.test.ts` pins that routing,
including the preference-off path. Break it and you have changed the decision, not
just the code.

### B. Three plans, all pending approval, none implemented

| Plan                                                  | State                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------- |
| `fork/plans/ralplan-fork-release-channel.md`          | Consensus reached, pending your approval                      |
| `fork/plans/ralplan-gjc-acp-busy-turn.md`             | Consensus reached, but superseded in approach — see below     |
| `fork/plans/ralplan-gjc-acp-cancellation-boundary.md` | Planner revision 2, **pending fresh Architect/Critic review** |

The cancellation-boundary plan reopened the busy-turn plan because that plan's
foreground `interrupt()` override delegates to the notification-only base path and so
does not fix the race. It was recovered from codex `gpt-5.6-sol` rollouts after the
session died on a provider usage limit mid-second-Architect-pass, so it has never been
through a full consensus round. Its evidence is `specs/gjc-acp-foreground-turn-trace.md`.
The busy-turn plan is retained for history; do not implement it as written.

The cards live in `~/repos/hart/triage/proposals.md` (commits `b5db173f`, `a75e4e93`).
Treat the pre-resolved decisions in each brief as settled; do not reopen them.

Base drift to know about: `fork/CHANGELOG.md` records the fork base advancing to
upstream `v0.7.0-beta.2`, and `plan/fork-release-channel` is rebased onto that tag.
`custom` is still on `0.7.0-beta.1`.

### Where the gjc work can run

**Not from a machine without gjc.** Check first:

```bash
which gjc || echo "no gjc here — dispatch to a host that has it"
```

As of 2026-08-30: ceres and saturn have gjc; neptune does not. gjc also needs
`~/.gjc/agent/config.yml` with working credentials, which is per-host.

Saturn has gjc **but its Paseo has no gjc provider registered**. Registering it means
adding this to that host's `~/.paseo/config.json` and reloading:

```json
{
  "agents": {
    "providers": {
      "gjc": {
        "extends": "acp",
        "label": "Gajae Code",
        "command": ["/Users/ctaylor/.local/bin/gjc", "acp"],
        "env": { "GJC_ACP_PERMISSION_MODE": "auto", "GJC_ACP_ABORT_SCOPE": "owned" },
        "enabled": true
      }
    }
  }
}
```

`GJC_ACP_ABORT_SCOPE=owned` makes Paseo's Stop terminate owned subagents and background
jobs, not just the turn. Then `paseo daemon reload` — **reload, not restart**; restart
kills every running agent.

### Dispatch

One workspace per plan, then one agent each. Use the Paseo MCP tools:

1. `create_workspace` — `isolation: "worktree"`, `mode: "branch-off"`, `path` = this
   repo, `baseBranch: "custom"`, `branchName` = the `plan/*` branch, a clear `title`.
2. `create_agent` in that workspace, with the brief file's body as `initialPrompt`:
   - `provider: "gjc/zai/glm-5.3"` — bare `gjc` is a hard error; it must be
     `gjc/<model-id>`.
   - `settings: { modeId: "default", thinkingOptionId: "high", features: { auto_accept: true } }`
     — `modeId: "plan"` blocks the plan write itself.
   - `notifyOnFinish: true`, plus `labels` naming the card.

**Create the agents one at a time.** Two `create_agent` calls fired in parallel wedged
the daemon's gjc provider refresh on ceres on 2026-08-29: every later `create_agent` and
`inspect_provider` failed at exactly 120000ms with `pending: initialize`, spawning no gjc
process at all, while gjc itself stayed healthy (`gjc acp` answered `initialize` in 1.5s
standalone, `gjc sdk session list` returned a healthy broker index). The non-destructive
fix is `paseo daemon reload`.

Creating a worktree workspace also runs `npm ci` in it, which is minutes of heavy IO in
this monorepo. Two at once saturated a 6-core box to load 47 and made `git rev-parse`
time out at 30s. Create them one at a time, and expect the first agent create to be slow.

Then stop and let `notifyOnFinish` deliver. Do not poll running agents.

A gjc plan agent can die mid-run on a provider usage limit without writing its output.
Its stage receipts survive under `.gjc/_session-<id>/plans/ralplan/<run>/`, and a codex
worker's reasoning survives in `~/.codex/sessions`. Recover from those before re-running
a plan from scratch.

## 4. Traps worth knowing

- **Never restart the Paseo daemon on port 6767.** It manages every running agent,
  including you. `paseo daemon reload` is the safe one.
- **Never run the full test suite.** Targeted only: `npx vitest run <file> --bail=1`.
- **macOS: exclude `node_modules` from Spotlight** before any large install. It burned
  ~190% CPU against npm's 35% on neptune. `touch <dir>/.metadata_never_index`; Spotlight
  has no glob rule, so it is per-directory or exclude a parent.
- **`fork/README.md` conflicts on every row.** oxfmt aligns markdown table columns, so
  adding one long row re-pads the whole table. Two hosts editing that table always
  collide; resolve by taking one side's table and re-inserting the other's rows.
- Fork-local material goes in `fork/`, never `docs/` — `docs/` is upstream's and is the
  first thing a rebase fight breaks.
