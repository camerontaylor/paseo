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

Native ZCode: [SDK validation](zcode-sdk-validation.md) and
[system instruction limitation](zcode-system-prompt.md).

| File                                                                                           |                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [upstream-research-2026-08-22.md](upstream-research-2026-08-22.md)                             | Research into upstream, its 1,546 forks, 490 open PRs and 467 open issues — features built, pain points, and the PR grab basket setup. Point-in-time; upstream merges ~30 community PRs a week.                                                      |
| [upstream-prs-2026-09-07.md](upstream-prs-2026-09-07.md)               | Evaluation of the 430 upstream PRs opened in the last month — corrections to the basket, the grab-now pass with a ready-to-paste manifest block, grab-next clusters, watch triggers, and sync hazards. Point-in-time. |
| [infi-pc-intake-2026-09-30.md](infi-pc-intake-2026-09-30.md) | Feature-level intake of `infi-pc/paseo` for the Desvio basket: current-base compatibility, first ports, dependencies, and the reason not to carry its whole branch. |
| [feature-ledger.md](feature-ledger.md) | The work owned by `custom`: where each feature lives, its shared wiring, and the tests to revisit after an upstream sync. External PR carries remain in the Desvio manifest. |
| [upstream-candidates.md](upstream-candidates.md)                                               | Changes we could write that fit upstream's code and philosophy. Bug-shaped, layer-correct, one concern each. Offered upstream, carried either way.                                                                                                   |
| [local-fork-candidates.md](local-fork-candidates.md)                                           | Changes we would build and keep. Upstream has declined them or would build them differently. Permanent carries, with their maintenance cost stated.                                                                                                  |
| [side-conversations-2026-08-23.md](side-conversations-2026-08-23.md)                           | Research into the `/btw` side-question mechanism — what it is in Claude Code, the Codex and OpenCode equivalents, why upstream #2056 was closed unevaluated, and what building it here would cost. Backs the Side conversations candidate.           |
| [side-conversations-phase1-plan.md](side-conversations-phase1-plan.md)                         | Phase 1 implementation plan for side conversations — the provider seam, four PR-sized steps, and the one vendor joint no gate catches. **Approved** after two critic passes.                                                                         |
| [handover-2026-08-29.md](handover-2026-08-29.md)                                               | Handover written before migrating this checkout to neptune — repo state after the upstream rebase, what breaks on the move (five worktrees, an unpushed branch, gitignored files), and the work left in flight.                                      |
| [upstream-sync.md](upstream-sync.md)                                                           | What breaks when `custom` moves to a newer upstream tag — why a clean merge proves nothing, the exhaustive-map joints that rot without conflicting, and the per-sync record.                                                                         |
| [handover-2026-09-04.md](handover-2026-09-04.md)                                               | Handover for the gjc ACP cancellation-boundary branch after its verification review — the rebase blocker in the manager tests, the finalized-plan gaps that postdate the implementation, and the ordered fix list with anchors.                      |
| [handover-upstream-reconcile-2026-09-07.md](handover-upstream-reconcile-2026-09-07.md) | Integration plans for upstream PRs that re-derive our own ACP busy-turn/cancellation work — what to mine from each, what to reject, the #4321 re-seating steps for the next sync, and the order to do it in. |
| [ci.md](ci.md)                                                         | What fork CI needs, measured — the trigger gap that stops it running on `custom`, the 150 job-minute load, the fleet benchmark, and why only a narrow nightly tier is worth self-hosting. |
| [worktrees.md](worktrees.md)                                                         | Fast setup for transient worktrees — why a whole-directory `node_modules` symlink silently resolves into the source checkout, what the init script rebuilds locally, the shared-tree sharp edges, and the carried `paseo.json` edit. |
| [plans/plan-cancellation-boundary-fix-pass.md](plans/plan-cancellation-boundary-fix-pass.md)   | Verified, resequenced fix list for the ACP cancellation boundary — what the 2026-09-04 handover got right, the two SDK-level corrections it got wrong, and the eight plan units in dependency order. Delete when the pass lands.                     |
| [plans/review-gjc-acp-cancellation-boundary.md](plans/review-gjc-acp-cancellation-boundary.md) | Verification review of the landed cancellation-boundary work against the finalized plan — the acceptance rollup the fix pass closes (AC 6, 11, 12, 15, 17) and the evidence behind every verdict. Record; the fix-pass plan supersedes its ordering. |
| [plans/proposal-auto-release-cycle.md](plans/proposal-auto-release-cycle.md) | Proposal, not built: a launchd detector on neptune that watches for published upstream releases and dispatches the release-cycle orchestrator. Covers trigger choice, skip-and-retry rules, and the `build`/`canary`/`fleet` autonomy decision. The cycle itself is in the runbook. |
| [plans/](plans/)                                                                               | Dispatch briefs and ralplan output for fork work. `brief-*.md` are ready-to-paste gjc dispatches; `ralplan-*.md` are the plans they produce.                                                                                                         |
| [scripts/](scripts/)                                                                           | Fork-local tooling. `release-fork.mjs` stages, renames and gates a fork npm release; it never publishes without both `--publish` and `--yes-i-am-publishing`. `--fork-number auto` reads the next N from the registry. `init-worktree.mjs` brings a transient worktree up in under a second — see [worktrees.md](worktrees.md).                                                                                        |
| [`.github/workflows/fork-npm-publish.yml`](../.github/workflows/fork-npm-publish.yml)         | Publishes every push to `mine` as `@camerontaylor/paseo-*@<base>-fork.N` (dist-tags `latest` + `fork`, both on the newest build) via npm trusted publishing, plus a `fork/v<version>` tag and GitHub Release. Runbook, bootstrap and the two hard constraints (GitHub-hosted runners only; first publish needs a token): `~/.local/agents/docs/paseo.md` § *Fork release channel*. |
| [scripts/zcode-plugin-patch/](scripts/zcode-plugin-patch/)                                     | Re-apply script + patches for the two local `paseo-plugin-zcode` fixes (bridge path under `checkout/node_modules`, Happy Eyeballs kill switch) that every `paseo plugin update` wipes. Fleet-wide: neptune, saturn, ceres. Upstream PRs: [plugin#1](https://github.com/lianxin255/paseo-plugin-zcode/pull/1), [zcode-acp#182](https://github.com/william0wang/zcode-acp/pull/182).                    |
| [CHANGELOG.md](CHANGELOG.md)                                                                   | Fork-only release notes and base decisions. Upstream `CHANGELOG.md` is never touched.                                                                                                                                                                |

The two candidate files split on one question: **does it need a product decision?**
If it is a defect at the right layer, it is an upstream candidate — cheaper to
upstream a fix than to carry one. If it needs someone to decide what the product
should do, it is ours, because upstream has said that decision is the maintainer's.

#1628 and #3629 are the worked example. The same problem — worktree setup running
under a non-interactive `bash -c` with no shell init — was closed NOT_PLANNED as a
feature request and is open as a defect. Framing decides the outcome.

## Build sources

The build has three inputs and one disposable output. Do not infer ownership
from `mine`: Desvio recreates that branch and merge commits obscure provenance.

| Source | Owns | Change here when... |
| --- | --- | --- |
| `upstream/main` and the release tag pinned by `DESVIO_BASE` | Upstream code. The tag is the Desvio build base; `upstream/main` is the reference for new upstream PRs. | Moving to a newer release: update the pin, sync `custom`, then rebuild the basket. See [upstream-sync.md](upstream-sync.md). |
| `custom` | Our permanent code, fork tooling, `fork/` docs, and changes we have deliberately absorbed from other branches. [The feature ledger](feature-ledger.md) records the owned behavior. | Fixing or extending something we maintain ourselves. |
| `~/.paseo-fork/manifest.txt` | The ordered external PR branches and any separate local carry branches. The author remains the source for an external branch even when we repeatedly resolve it against newer upstream. | Adding, removing, or updating a carry. The manifest owns the active list and its reasons. |
| `mine` | Disposable result of the pinned base plus every active manifest entry, including `custom`. A push triggers [`fork-npm-publish.yml`](../.github/workflows/fork-npm-publish.yml). | Never author here; change the owning source and rebuild. |

There is no local `main` branch in this checkout. `origin/main` is an old
upstream snapshot (2026-08-22), not a live mirror. Use `upstream/main` when
branching for an upstream PR, and use the pinned release tag when comparing the
current Desvio build base. `chore/pnpm-migration` is a shelved reference branch;
it is not in the basket.

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

**Opening an upstream PR:** branch from `upstream/main`. Branching from
`custom` would include our fork changes in the PR diff.

## The Desvio grab basket

[Desvio](https://github.com/cleiter/desvio) assembles our pinned upstream base,
external PR branches, and `custom`. Some PR branches stay in the basket for
multiple upstream releases; those changes are part of `mine` without becoming
commits owned by `custom`.

It lives **outside this checkout**, at `~/.paseo-fork`. It holds the build tree,
state and manifest, none of which belongs in a repo we also send PRs from.

```sh
cd ~/.paseo-fork
$EDITOR manifest.txt     # one branch or PR ref per line
desvio build             # ~1 min warm; several minutes if the lockfile moved
```

The live manifest is the only list of active carries. Its order is part of the
build: append new entries, and do not reorder existing ones merely to group
them by owner. Each active line says why it is carried; disabled lines say what
must change before they can return. Keep the current base pin in `desvio.conf`.
`git log --first-parent --oneline <pinned-tag>..mine` shows the merge sequence
for a built result; the manifest still owns which entries should be in it.
The setup history and Linux portability fixes are in
[upstream-research-2026-08-22.md](upstream-research-2026-08-22.md) §4.

Use this intake rule:

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
The build uses the pinned base plus every active manifest branch, including
`custom`. Run targeted tests and app/daemon QA before using the result as a
daily driver. [upstream-sync.md](upstream-sync.md) records failures that a clean
merge missed.

`desvio run start` swaps the daemon on the real `~/.paseo` and kills every
running agent, including any agent session running on this machine. It prompts
first. It is the one command in that directory that can bite.
