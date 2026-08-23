# CLAUDE.local.md

Local notes for this checkout. Gitignored upstream (`.gitignore:60`), so this
file never conflicts on rebase and is never committed.

## This is a fork checkout

`origin` is `camerontaylor/paseo`. `upstream` is `getpaseo/paseo`.

- **Branch from `upstream/main` when opening an upstream PR**, not from local
  `main` — local `main` carries the untracked-upstream `fork/` directory.
- PR refs (`refs/pull/N/head`) only resolve against `upstream`. A GitHub fork
  does not mirror its parent's PR refs.

## Read `fork/` before fork-related work

[fork/README.md](fork/README.md) is the index. It covers the fork-local
namespace convention, the `upstream` remote, the `.git/info/exclude` entry for
`.omc/`, and the PR grab basket at `~/.paseo-fork`.

[fork/upstream-research-2026-08-22.md](fork/upstream-research-2026-08-22.md) is
research into upstream's features, its community forks and PRs, and the pain
points people report. Point-in-time as of 2026-08-22 — verify anything you are
about to act on, since upstream merges ~30 community PRs a week.

## Fork-local files go in `fork/`

Upstream has no `fork/` directory, so nothing there can land in a rebase
conflict. Do not put fork-only material in `docs/` — `docs/` is upstream's and
is the first thing a sync fight breaks.
