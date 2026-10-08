# infi-pc/paseo intake — 2026-09-30

Source: [`infi-pc/paseo` `paseo-customizations`](https://github.com/infi-pc/paseo/tree/paseo-customizations), especially its [feature ledger](https://github.com/infi-pc/paseo/blob/paseo-customizations/docs/fork.md). This is the 2026-09-30 source assessment; [work items and port verification](plans/infi-pc-intake-work-items.md) live in the repo-local tracker. The manifest is the live list of carries.

## Basket fit

Do not add `infi-pc/paseo-customizations` as one manifest line. At intake on 2026-09-30, its base was upstream `e3c853df5` (2026-09-24), while our `custom` and Desvio build were on `v0.10.1` (2026-09-29). Against that build tree, a Git merge-tree dry run reported eight text conflicts. The fork branch changed 379 files, adding about 30,000 lines. Forty-five paths had changed on both sides since its base. These are point-in-time measurements; check `~/.paseo-fork/desvio.conf` for the live build base. A clean textual merge would still need protocol, runtime, platform, and UI verification.

The fork's feature commits are stacked on one branch. A manifest line pointing at a commit includes its ancestors and therefore earlier fork features. For a selected feature, create a new topic branch from the pinned Desvio base, port the behavior and relevant tests, then append that branch **after `custom`** in `~/.paseo-fork/manifest.txt`. Do not reorder existing entries. The current basket's `desvio_verify` runs typecheck and lint; targeted tests and platform QA remain separate gates before using a build.

## Intake order

| Candidate | Source | Assessment at intake | Next step |
| --- | --- | --- | --- |
| Source-accurate agent file links | `0f0ba1f1d` | **First pick.** A focused correctness fix in existing link parsing and the agent stream. The patch needs a port; its tests cover source checkout paths and workspace containment. | Port to one local branch. Test `assistant-file-links/parse.test.ts` and opening links from a different checkout. |
| Fork's own PR lookup | `160430f94` | **First pick.** Current GitHub resolution jumps from a fork checkout to the parent; the fork checks its own PRs first, including batch polling. This is a forge correctness fix. The patch needs a port because current lookup code moved. | Port to one local branch, preserve current head-repository and terminal-PR SHA matching, and run `github-service.test.ts`. Consider sending the fix upstream. |
| Quit confirmation when a desktop-managed daemon would stop | `884ac282d` | **Good small carry.** Current quit lifecycle stops the managed daemon without asking. The patch needs a port around current update-quit handling. | Make the confirmation conditional on an actual running managed daemon and `keepRunningAfterQuit=false`; test cancel, quit, updater, and OS-signal paths. |
| `package.json` script discovery | `41b31a3dd`, `4f9a6f739`, `ff66c741b` | **Useful, medium carry.** Current Scripts UI launches `paseo.json` services only. The fork discovers nested package scripts on menu open and runs them in terminals. Its later fixes are required; the initial commit alone is incomplete. | Port the discovery service and menu as one branch. Preserve configured service behavior and test path boundaries, package-manager selection, and script execution. |
| Branch and base-branch control | `fae603ccb` | **Medium carry.** Current workspace model already stores base branch, but the header has no paired control. Touches protocol, checkout mutation, and mobile UI. | Port after the smaller items, with mixed-version client/daemon checks. |
| Plan copy and handoff actions | `fe676b131`, `f777bc1b3` | **Potential small UI carry.** Shares source commits with background activity and navigation; cannot select by commit alone. | Extract the plan-card behavior onto its own branch if wanted. |
| Project PR browser, polling, merged archive | `80c69f95c`, `429051faa`, `8e090cc2c` | **Reassess against current forge work.** Current Paseo already has merged-PR auto-archive and a forge-neutral registry. The fork's PR browser is a substantial GitHub-oriented overlay. | Define the missing workflow first; extract polling or project listing separately. Do not carry its archive implementation wholesale. |
| Change-stat categories | `80c69f95c`, `4f9a6f739`, `ff66c741b` | **Design decision.** New protocol facts and changes throughout diff, sidebar, and composer. | Prototype one surface before carrying the full breakdown. |
| Navigation history, recent agents, pinned prompts, status pulses | `f777bc1b3`, `ff66c741b`, `6843b4ff7` and follow-ups | **UI-level candidates.** They cross route restore, tab identity, timeline, and layout code that has changed since the fork base. | Evaluate each interaction on desktop and mobile; port separately. Read `docs/expo-router.md` before navigation changes. |
| Tool summaries, background activity, response control, recommended prompts, Chapters | `4f9a6f739`, `fe676b131`, `819cee695`, `23cb8e83c`, `254fc5ebc` and follow-ups | **High-cost bundle.** These share metadata, model calls, timeline rows, protocol messages, client state, and multiple UI panels. Recommended prompts depend on response control's structured footer. | Do not add as a single basket item. Decide on one user problem and design a narrow capability and feature gate first. |
| TypeScript code intelligence | `58edd998d`, `7da2f317e` | **High-cost host feature.** Adds a language service, protocol operations, authorization, editor/diff UI, and packaging changes. | Separate product/operational review before a carry. Verify native fallbacks and host resource use. |
| Sleep prevention | `4f9a6f739`, `59ed3d0cb`, `fb4f42001` | **Host policy decision.** Affects daemon lifecycle and settings across clients. | Decide default, idle behavior, and sleep/wake QA before porting. |

## Compatibility checks for every port

- Preserve the protocol's optional-field and capability-gate rules in `docs/protocol-compatibility.md`; the phone and desktop can run different builds.
- Keep forge behavior within the registry/adapter structure in `docs/forge-providers.md`. In particular, retain SHA matching for closed PRs and head repository matching for open PRs.
- Check current upstream behavior before each port. The fork is a snapshot, and our Desvio base and upstream move independently.
- Validate real behavior separately from Desvio's typecheck/lint result. The fork's own 2026-09-24 sync found silent timeline and layout regressions despite a merge.
