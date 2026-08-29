---
description: Resume the Paseo fork work from this checkout — verify state, then dispatch the two pending ralplans via Paseo.
---

You are picking up fork work in this checkout. Orient, verify, then act.

## 1. Orient

Read, in this order:

- `fork/handover-2026-08-29.md` — the migration record and the state of the work.
- `fork/README.md` — the `fork/` namespace, branch discipline, the PR grab basket.
- `CLAUDE.local.md` (symlink to `fork/claude-local.md`) — origin/upstream remotes.

Do not re-derive the gjc ACP diagnosis; it is written up with file:line anchors in the
handover. Verify any anchor before acting on it — upstream moves fast and this branch
gets rebased.

## 2. Verify this checkout

```bash
git status --short && git log --oneline -1
git fetch origin && git status -sb | head -1
```

Then confirm the workspace declarations are built. If `packages/protocol/dist` is
missing, `npm run typecheck` fails everywhere with `Cannot find module
'@getpaseo/protocol/...'` — stale-declaration noise, not real breakage — and the
lefthook pre-commit hook fails on **every** commit, including docs-only ones:

```bash
ls -d packages/protocol/dist >/dev/null 2>&1 || npm run build:server
```

On a fresh clone, run `mise trust` before `npm ci`. An untrusted `.mise.toml` makes
mise abort _before_ npm runs, so the install fails while a piped `$?` reports success.
Capture exit codes directly, never through `| tail`.

## 3. The two pending plans

Both are shaped, both have committed dispatch briefs, neither has been run:

| Card                                            | Brief                                              | Output the plan should write                 |
| ----------------------------------------------- | -------------------------------------------------- | -------------------------------------------- |
| `gjc-acp-busy-turn` (T2, ~2h)                   | `fork/plans/brief-ralplan-gjc-acp-busy-turn.md`    | `fork/plans/ralplan-gjc-acp-busy-turn.md`    |
| `paseo-fork-release-channel` (T3, two sittings) | `fork/plans/brief-ralplan-fork-release-channel.md` | `fork/plans/ralplan-fork-release-channel.md` |

The cards themselves live in `~/repos/hart/triage/proposals.md` (commits `b5db173f`,
`a75e4e93`) with Done, Tier, First move, Appetite, Tail, Obstacle and Not-doing. Treat
the pre-resolved decisions in each brief as settled; do not reopen them.

Branches `plan/gjc-acp-busy-turn` and `plan/fork-release-channel` exist and are pushed.
The worktrees that once backed them were reaped by Paseo, so recreate workspaces.

### Where these can run

**Not from this machine if it has no gjc.** Check first:

```bash
which gjc || echo "no gjc here — dispatch to a host that has it"
```

As of 2026-08-29: ceres and saturn have gjc; neptune does not. gjc also needs
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

## 4. Traps worth knowing

- **Never restart the Paseo daemon on port 6767.** It manages every running agent,
  including you. `paseo daemon reload` is the safe one.
- **Never run the full test suite.** Targeted only: `npx vitest run <file> --bail=1`.
- **macOS: exclude `node_modules` from Spotlight** before any large install. It burned
  ~190% CPU against npm's 35% on neptune. `touch <dir>/.metadata_never_index`; Spotlight
  has no glob rule, so it is per-directory or exclude a parent.
- Fork-local material goes in `fork/`, never `docs/` — `docs/` is upstream's and is the
  first thing a rebase fight breaks.
