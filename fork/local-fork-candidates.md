# Local fork candidates

Changes we would build and carry ourselves, because upstream has declined them,
would decline them, or would build them differently.

These are **front-band** manifest entries: permanent carries. Merges resolve
against everything already merged, so a permanent branch is cheapest at the front
of the stack where nothing above it disturbs its recorded resolutions. See
[README.md](README.md).

Anything bug-shaped and layer-correct belongs in
[upstream-candidates.md](upstream-candidates.md) instead — it is cheaper to
upstream a fix than to carry one.

## What a carry actually costs

From building the basket on 2026-08-22 (research §4). Cost tracks **age against
the churn rate of the files touched**, not diff size:

- #2785 — +3,722 across 65 files — cost **nothing**.
- #1826 — +5,642 across 45 files — cost **five** companion patches.

The difference is the constructs, not the size. #1826 introduced an exhaustive
`switch` over a union upstream kept widening, and a `Pick<>` of an interface
upstream kept extending. Both freeze a closed world at branch time, and both break
**without conflict markers** when the world moves.

**Before starting anything here, ask what joints it creates:**

| Joint | Rots when |
|---|---|
| Exhaustive `switch` over a shared union | upstream adds a variant |
| `Pick<>` / `Omit<>` of an upstream interface | upstream adds a required member |
| Test stubs mirroring an interface's shape | upstream changes the interface |
| A new file importing broadly from upstream modules | any of them move |

None of these produce conflict markers. Only the typecheck gate catches them, so
keep `desvio_verify` at typecheck **and** lint.

Prefer changes that **add a branch to existing code** over changes that introduce
a new file with its own view of upstream's types.

## Candidates

| Item | Origin | Why it is ours, not upstream's | Rot risk |
|---|---|---|---|
| **Workspace / worktree reclamation** | #2474, closed NOT_PLANNED | Filed as a bug with hard numbers — 243 workspaces, 190 worktrees, **124 GB in a week** — and reclassified: *"This requests a new daemon-side workspace retention and pruning capability. Issues are only for bugs, so we are closing this feature request."* The need is real for us and the door is closed. | **Low.** Additive daemon-side pruning with its own config; touches little upstream type surface. |
| **Shell-initialised worktree setup** | #1628 closed NOT_PLANNED; #3629 open | #1628 carried a definitive proof that direnv cannot work: *"direnv activates from a `precmd` hook, which fires when an interactive shell draws a prompt. A `-c` invocation never draws a prompt, so the hook never runs, even with `-lic`."* Ten comments, then boilerplate closure. #3629 restates it as a defect and is open. | **Medium.** Touches the setup/exec path, which upstream is actively changing. |
| **Fleet ergonomics** — per-host defaults, routing, at-a-glance host health | Our setup: saturn / neptune / ceres | Upstream has multi-host sidebar merge (#1538) and named hosts (#2335), but the model is still one-user-one-machine (research §3.6, where four separate forks built auth gateways). Our needs are specific enough that a general design is upstream's call, not ours. | **High.** Sidebar and host code are among the busiest files in the repo. |
| **Cost and completion awareness** — per-turn tokens, quota windows, an idle chime | Forks `JrDw0`, `alnimra`, `JLarky` | Three independent forks built versions of this. Upstream ships a quota panel (#1278) but not per-turn cost or audio. `alnimra`'s framing — *"quota windows, not dollars"* — is the useful one. | **Medium.** Additive UI, but touches the turn footer, which moves. |
| **Mid-session account switching** | #2780 | Listed here **only as a watch item.** It is labelled `bug` upstream, and #2785 already implements it and is in our manifest. Do not build a second answer — that is exactly what made #280 unmergeable. Support #2785 instead. | n/a |

## Do not build these

Each would fight upstream, and the research shows what that costs.

- **A second answer to a settled question.** #280 offered Cursor over the headless
  CLI while upstream ships it over ACP; both claim the same `cursor` key in
  `PROVIDER_CLIENT_FACTORIES`, and no merge skill reconciles that. Check whether
  upstream has already answered before designing.
- **A kanban or task board.** Six forks built one independently (`hubcode`,
  `haikostudio`, `AngusFu`, `HumanBoss`, `mcrowder65`, `jtalborough`). That is a
  real signal about the product, but it is a large permanent surface and the
  evidence is that it is where forks sink their time.
- **A rename or rebrand.** The protocol has `paseo` in field names. `vincu`
  discovered this and needed a compat shim for `isPaseoOwnedWorktree`; `BAS-More`
  renamed to `@bas-more/*` and reverted across four commits.
- **Vendored third-party code.** Upstream will not take it, and we inherit the
  maintenance either way.
- **Anything achievable in a plugin.** Upstream routes themes and similar to
  plugin contributions (#3222). A plugin survives rebases; a core patch does not.

## Before starting any of these

1. Re-check upstream has not shipped it. It merges ~30 community PRs a week.
2. Write it as a branch off `upstream/main` with one concern, even though it is
   never going upstream — that is what keeps the merge cheap.
3. Put it in the **front** band of `~/.paseo-fork/manifest.txt`, above the
   in-flight PRs, and leave the reason on the line.
4. Note the joints it creates, in the manifest comment, so a future typecheck
   failure is diagnosable rather than a surprise.
