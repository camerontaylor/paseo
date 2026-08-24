# fork/

Fork-local material for this checkout. **Upstream has no `fork/` directory**, so
nothing in here can land in a rebase conflict — that is the whole reason the
namespace exists. Keep fork-only files here rather than in `docs/`.

The lesson comes from the fork survey in
[upstream-research-2026-08-22.md](upstream-research-2026-08-22.md): the most
repeated commit message across the entire fork corpus is some variant of
_"restore X dropped during upstream merge"_, and `yooztech` invented a
`packages/app/src/fork/` namespace for exactly this reason.

## What's here

| File                                                                   |                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [upstream-research-2026-08-22.md](upstream-research-2026-08-22.md)     | Research into upstream, its 1,546 forks, 490 open PRs and 467 open issues — features built, pain points, and the PR grab basket setup. Point-in-time; upstream merges ~30 community PRs a week.                                            |
| [upstream-candidates.md](upstream-candidates.md)                       | Changes we could write that fit upstream's code and philosophy. Bug-shaped, layer-correct, one concern each. Offered upstream, carried either way.                                                                                         |
| [local-fork-candidates.md](local-fork-candidates.md)                   | Changes we would build and keep. Upstream has declined them or would build them differently. Permanent carries, with their maintenance cost stated.                                                                                        |
| [side-conversations-2026-08-23.md](side-conversations-2026-08-23.md)   | Research into the `/btw` side-question mechanism — what it is in Claude Code, the Codex and OpenCode equivalents, why upstream #2056 was closed unevaluated, and what building it here would cost. Backs the Side conversations candidate. |
| [side-conversations-phase1-plan.md](side-conversations-phase1-plan.md) | Phase 1 implementation plan for side conversations — the provider seam, four PR-sized steps, and the one vendor joint no gate catches. **Approved** after two critic passes.                                                               |

The two candidate files split on one question: **does it need a product decision?**
If it is a defect at the right layer, it is an upstream candidate — cheaper to
upstream a fix than to carry one. If it needs someone to decide what the product
should do, it is ours, because upstream has said that decision is the maintainer's.

#1628 and #3629 are the worked example. The same problem — worktree setup running
under a non-interactive `bash -c` with no shell init — was closed NOT_PLANNED as a
feature request and is open as a defect. Framing decides the outcome.

## Branches

Two-branch discipline, borrowed from `UnbrokenHunter/paseo`'s `docs/fork-workflow.md`:

| Branch   |                                                                                                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `main`   | **Mirrors upstream 1:1. Never commit here.** Tracks `origin/main`, which follows `getpaseo/paseo`. Sync with `git fetch upstream && git switch main && git merge --ff-only upstream/main && git push origin main`. |
| `custom` | Everything of ours, including this directory. Rebase or merge `main` into it when upstream moves.                                                                                                                  |

Why it matters: a mirror branch stays a fast-forward only while it has no local
commits. Put `fork/` on `main` and every sync becomes a merge — and the first
`git reset --hard upstream/main` deletes it. Fork `lzm04521` has the commit
`"docs: restore fork README on main (lost when main was reset to v0.4.0 base)"`.

`custom` is named that, not `fork`, because git refs are paths: `refs/heads/fork`
cannot coexist with `refs/heads/fork/mobile-fork-icon`.

### CLAUDE.local.md

Upstream gitignores `CLAUDE.local.md` (`.gitignore:60`), and that bare pattern
matches at any depth — `fork/CLAUDE.local.md` would be ignored too. So the content
lives at `fork/claude-local.md`, under a name the pattern does not match, and each
checkout symlinks it — the symlink is itself ignored, so nothing changes for upstream:

```sh
ln -s fork/claude-local.md CLAUDE.local.md
```

Do that once per machine after cloning `custom`. Claude Code loads it
automatically.

## This checkout

`origin` is `camerontaylor/paseo` (our fork). `upstream` is `getpaseo/paseo`.

The `upstream` remote is **required**, not a convenience: a GitHub fork does not
mirror its parent's `refs/pull/*`, so PR refs only resolve against `upstream`.

`.git/info/exclude` carries `.omc/` — a local skill-distiller writes there on
every `claude` run. It is untracked and absent from `.gitignore`, which makes it
invisible day to day but fully visible to anything reading
`git ls-files --others --exclude-standard`. That tripped desvio's resolver guard
until it was excluded. Check for other such directories before they trip
something else.

**Opening an upstream PR:** branch from `upstream/main`, not from local `main`,
or the diff will include this directory.

## The PR grab basket

A personal build carrying upstream PRs that have not merged yet, assembled by
[desvio](https://github.com/cleiter/desvio) — written by `cleiter`, Paseo's top
non-core contributor, and shipping a working Paseo example config.

It lives **outside this checkout**, at `~/.paseo-fork`. It holds the build tree,
state and manifest, none of which belongs in a repo we also send PRs from.

```sh
cd ~/.paseo-fork
$EDITOR manifest.txt     # one branch or PR ref per line
desvio build             # ~1 min warm; several minutes if the lockfile moved
```

Full setup, the intake rule, the current carries, and the four Linux portability
fixes are in [upstream-research-2026-08-22.md](upstream-research-2026-08-22.md)
§4. The short version:

- **Carry** fixes, and features adding a capability upstream has no answer for.
- **Refuse** a second answer to a question upstream already answered differently
  — that is what made #280 unmergeable.
- **Cost tracks age against churn, not diff size.** #2785 is +3,722/65 files and
  cost nothing; #1826 is +5,642/45 files and cost five patches, because it froze
  an exhaustive `switch` and a `Pick<>` at branch time and upstream kept widening
  both. Exhaustive switches, `Pick<>`/`Omit<>` derivations and interface-mirroring
  test stubs are the joints that rot silently — none of them produce conflict
  markers.

**`desvio build` green means typecheck and lint passed. Nothing was executed.**
The build sits on the unreleased dev tip plus unmerged PRs, so it is less tested
than the current beta release, not more. Use it to pull a specific fix when you
need it; do not treat it as a daily driver without your own QA.

`desvio run start` swaps the daemon on the real `~/.paseo` and kills every
running agent, including any agent session running on this machine. It prompts
first. It is the one command in that directory that can bite.
