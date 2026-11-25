# CLAUDE.local.md

Local notes for this checkout. Gitignored upstream (`.gitignore:60`), so this
file never conflicts on rebase and is never committed.

## This is a fork checkout

`origin` is `camerontaylor/paseo`. `upstream` is `getpaseo/paseo`.

- **Branch from `upstream/main` when opening an upstream PR.** This checkout has
  no local `main`; `origin/main` is an old snapshot. Branching from `custom`
  would include fork changes in the PR.
- PR refs (`refs/pull/N/head`) only resolve against `upstream`. A GitHub fork
  does not mirror its parent's PR refs.

## Read `fork/` before fork-related work

[fork/README.md](fork/README.md) lists what stays with the source. Fork maintenance (upstream
sync, carry decisions, release operations, plans) lives in the agents repository under
`docs/paseo-fork/`, checked out at `~/.local/agents/docs/paseo-fork/`.

The 2026-08-22 research into upstream's features, forks, PRs and pain points is archived there as
[`archive/fork/upstream-research-2026-08-22.md`](https://github.com/camerontaylor/agents/blob/cd412623d27b7f46ad2d7be5aa3fe782c0938947/docs/paseo-fork/archive/fork/upstream-research-2026-08-22.md).
It is point-in-time; verify anything you are about to act on.

## Fork-local files go in `fork/`

Upstream has no `fork/` directory, so nothing there can land in a rebase
conflict. Do not put fork-only material in `docs/` — `docs/` is upstream's and
is the first thing a sync fight breaks.
