# infi-pc intake work items — 2026-09-30

This file is the repo-local Desvio plus enhancements tracker for the features above the language-server option. The [intake](../infi-pc-intake-2026-09-30.md) explains the source and compatibility constraints; the [fork ledger](https://github.com/infi-pc/paseo/blob/paseo-customizations/docs/fork.md) maps source commits to files. The `IP-` IDs remain stable across branch renames.

## Integration contract

- Pin every port to the current Desvio base (`v0.10.1`) and `custom` (`2e2868796` at intake). Start an isolated topic branch from `custom`; copy behavior and relevant tests from the named source commits. A dependent branch may start from its prerequisite. The source commits are stacked, so their commit ancestry is not a usable manifest entry.
- Append a finished branch **after** `custom` in `~/.paseo-fork/manifest.txt`. Preserve every existing line's order. Treat a branch as ready only after focused tests, typecheck, lint, and an integrated `desvio build`; typecheck and lint alone do not verify behavior.
- Keep a separate branch per row unless a dependency is inseparable at the protocol boundary. A branch's manifest comment should carry its `IP-` ID, source commits, last verified base, and its likely silent regression joints.
- For an upstream sync, recheck whether each behavior landed, then rerun its focused tests on the rebased basket. New wire fields are optional, new RPCs follow dotted names, and each new daemon feature is gated once by `server_info.features.*` ([protocol rules](../../docs/protocol-compatibility.md)).
- Do not add a line for a design or investigation row. Add its implementation branch only when its stated acceptance checks pass. Platform checks for UI rows include desktop and a compact mobile layout.

The existing `burakcbdn/fix/forward-steer-active-turn` author branch force-rebased on 2026-09-30 and brought 322 commits and 2,005 changed paths into the pinned basket. Its manifest entry temporarily points to `fork/pinned-forward-steer-2026-09-30` at the previously reviewed `75c309ce6`. Review that upstream base drift separately before restoring the author ref; this decision is independent of the `IP-` ports.

## Basket status

The following ports have isolated branches and focused checks. The manifest carries them after `custom` in dependency order. The integrated Desvio build passed with IP-01 through IP-14 on 2026-09-30. Desvio's gate builds the server and runs full typecheck and lint. Individual branch checks cover the behavior named in the tables below.

| IDs | Branches | Integration notes |
| --- | --- | --- |
| IP-01 to IP-04 | `intake/infi-agent-file-links`, `intake/infi-fork-pr-lookup`, `intake/infi-desktop-quit-confirmation`, `intake/infi-package-scripts` | Independent file-link, forge lookup, desktop lifecycle, and script carries. |
| IP-05 to IP-08 | `intake/infi-plan-copy`, `intake/infi-plan-handoff`, `intake/infi-base-branch-contract`, `intake/infi-branch-header` | Handoff follows copy; header follows the optional base-branch contract and gates its mutation. |
| IP-09 to IP-12 | `intake/infi-recent-agents`, `intake/infi-navigation-history`, `intake/infi-pinned-prompt`, `intake/infi-status-pulse` | Navigation follows recent-agent tab behavior. The prompt pin is desktop only, matching the source's final compact behavior. |
| IP-13 to IP-14 | `intake/infi-project-pr-facts`, `intake/infi-project-pr-browser` | PR browser follows the forge facts. Existing blank-query forge search supplies the open PR list; IP-13 adds optional CI checks. |

Focused browser tests passed for the status pulse, integrated PR browser on desktop and compact startup, plan-card copy and handoff, the existing branch-switcher regression, and all six prompt-pin cases. The new branch-pair picker has unit coverage but no dedicated browser QA. Native device QA remains open for the UI carries.

## Carried correctness and workflow changes

| ID | Tracker item and branch | Source | Depends on | Acceptance |
| --- | --- | --- | --- | --- |
| IP-01 | Source-accurate agent file links — `intake/infi-agent-file-links` | `0f0ba1f1d` | none | A link emitted from checkout A opens the file in A while viewing from checkout B; paths outside the source workspace stay blocked; parser tests pass. |
| IP-02 | Fork's own PR lookup — `intake/infi-fork-pr-lookup` | `160430f94` | none | A fork checkout resolves its own PR before a parent's; batch polling agrees with single lookup; open PRs match head repository and terminal PRs match SHA; `github-service.test.ts` passes. |
| IP-03 | Desktop daemon quit confirmation — `intake/infi-desktop-quit-confirmation` | `884ac282d` | none | Prompt only if the desktop manages a running daemon and `keepRunningAfterQuit=false`; cancel keeps both running; ordinary quit, updater quit, and OS signal retain their intended lifecycle. |
| IP-04 | Discover and run `package.json` scripts — `intake/infi-package-scripts` | `41b31a3dd`, `4f9a6f739`, `ff66c741b` | none | Scripts from nested packages appear when the menu opens and run in a terminal from the right directory and package manager; workspace path boundaries hold; `paseo.json` services remain available and keep their status. |

## Carried interaction changes

| ID | Tracker item | Source | Depends on | Acceptance / seam |
| --- | --- | --- | --- | --- |
| IP-05 | Plan-card copy actions | `fe676b131`, `f777bc1b3` | none | Copy plan text and its useful link from both live and historical plan cards; clipboard errors are surfaced. Extract only the plan-card code from the shared commits. |
| IP-06 | Plan-card handoff | `fe676b131`, `f777bc1b3` | IP-05 | Open an editable agent draft in the source workspace with the full plan and source link. Do not create or send an agent turn until the user presses Send; verify one destination prompt then. Keep this separate from copy, which needs no draft navigation. |
| IP-07 | Branch/base-branch mutation contract | `fae603ccb` | none | Existing workspaces can change a valid base branch without moving HEAD, losing local changes, or changing unrelated worktree metadata; optional protocol shape, one feature gate, authorization, and mixed-version checks pass. |
| IP-08 | Branch pair header control | `fae603ccb` | IP-07 | Header presents branch and base branch as a pair, handles no base/remote/dirty state, and offers the mutation only on a capable daemon; desktop and compact mobile QA pass. |
| IP-09 | Recently closed agents menu | `f777bc1b3`, `ff66c741b` | none | Closing and reopening a tab restores the intended agent without changing archive state or workspace lifecycle; bounded recent list survives the intended app lifetime. |
| IP-10 | Navigation back/forward | `f777bc1b3`, `ff66c741b` | IP-09 only if the menu shares its tab selection model | Route history restores selected workspace and agent after reload and handles archived workspaces through the existing recovery route; browser back/forward and keyboard shortcuts do not double navigate. Read `docs/expo-router.md` before porting. |
| IP-11 | Pin the prompt for the visible response | `6843b4ff7`, `05382d877`, `0d3bda58e` | none | Desktop pin shows the nearest preceding user prompt while reading an assistant response, including historical turns; it changes on agent switch and respects scroll boundaries. Keep the source's compact behavior: no pin where it would consume the transcript viewport. |
| IP-12 | Sidebar status pulse | `6843b4ff7` | none | Pulse reflects actual running and attention state, stops when state settles, and does not force frequent list rerenders. Keep focus-triggered forge refresh as IP-15. |

## Forge and change review

| ID | Tracker item | Source | Depends on | Acceptance / seam |
| --- | --- | --- | --- | --- |
| IP-13 | Project PR listing and CI facts | `80c69f95c` | IP-02 | Prove whether current `forge.search.request` with a blank query already lists a project's open PRs through `listPullRequests`. Add only the missing CI facts or API boundary, if needed, with bounded results, authorization, and a capability gate. Do not replace current merged-PR auto archive. |
| IP-14 | Project PR browser and workspace seed | `80c69f95c` | IP-13 | Open PRs and check status appear in a project overlay; selecting one seeds a workspace through current creation APIs. Desktop/mobile QA covers empty, error, loading, and fork PRs. |
| IP-15 | Focus-aware PR polling | `429051faa`, `8e090cc2c`, `6843b4ff7` | IP-02; IP-13 if project lists use the same poller | Active views refresh promptly while background views obey a global API budget; reconnect/focus regain refreshes stale state once. Preserve current merge-driven archive and add no duplicate archive implementation. |
| IP-16 | Change-stat classification and wire facts | `80c69f95c`, `4f9a6f739`, `ff66c741b` | none | Classify paths and added/deleted lines with deterministic rules; preserve the current total; optional protocol facts parse on old and new clients; measure cost on large diffs. |
| IP-17 | One change-stat surface | same as IP-16 | IP-16 | Prototype the breakdown in the composer diff pill, including unknown category and narrow layouts. Decide categories, labels, and whether the view helps review before extending it. |
| IP-18 | Change-stat review surfaces | same as IP-16 | IP-17 | Add the approved breakdown to diff tree, file header, and hover card using one presentation model; totals match the composer, and large-diff rendering stays responsive. |

## Agent activity and model-backed enhancements

| ID | Tracker item | Source | Depends on | Acceptance / seam |
| --- | --- | --- | --- | --- |
| IP-19 | Tool-call summary service | `4f9a6f739`, `fe676b131`, `ff66c741b` | none | Opt-in model calls label completed tool calls without delaying the original timeline; failures leave original tool content intact. Bound usage and persist a source ID that survives timeline hydration. |
| IP-20 | Tool-call summary presentation | same as IP-19 | IP-19 | Collapsed calls show the label and still expose exact tool input/output; late labels update the right row after reconnect. One gated client path. |
| IP-21 | Background activity record and API | `fe676b131`, `23cb8e83c` | none | Record daemon jobs with owner, status, timestamps, and bounded retention; authorize the request and subscription; old clients parse all traffic. This is the shared seam for IP-19 and IP-26 if those jobs opt in. |
| IP-22 | Background activity panel | same as IP-21 | IP-21 | Explorer panel shows active and recent jobs, their failures, and the related agent/workspace; subscription releases on close. Test desktop and compact layout. |
| IP-23 | Response-control footer and daemon handling | `819cee695`, `c3e1edd11` | none | Structured footer is parsed without leaking into visible text; older providers/clients retain normal responses; metadata can name and summarize a turn under an explicit setting and capability gate. |
| IP-24 | Response-control UI | same as IP-23 | IP-23 | Settings explain generated names/summaries and permit disabling them; timeline and tab names update only from the correct turn; desktop/mobile QA passes. |
| IP-25 | Recommended prompts | `254fc5ebc` | IP-23 | Prompts come from the structured footer, render only for that completed turn, and insert into composer without auto sending; stale suggestions clear on agent/turn change. |
| IP-26 | Checkout chapter generation/API | `23cb8e83c` | IP-21 only if jobs are shown in activity | A chapter run groups a stable diff snapshot, has cancellation and bounded resource use, and sends optional protocol data through an authorized, gated API. Re-run after the diff changes rather than showing stale groups. |
| IP-27 | Chapter review view | same as IP-26 | IP-26 | Chapter outline selects files in the current diff and preserves review state; desktop/mobile navigation and empty/error states work. |

## Decisions before implementation

- **IP-13 to IP-15:** `forge.search.request` already routes `change_request` queries to each forge adapter's `listPullRequests`, and the daemon already has merged-PR auto archive. Confirm blank-query listing and CI fact availability against that path. Keep project browsing and polling distinct; archive may need no port.
- **IP-16 to IP-18:** Decide which categories are useful from the one-surface prototype. Avoid a new protocol field for a presentation-only distinction if existing facts suffice.
- **IP-19 to IP-27:** Start with one user problem at a time. Record model provider, cost, privacy, cancellation, and failure behavior in each item's brief before dispatch. Share only a genuinely reusable activity service; the fork's shared commits are not a reason to merge these tracker items.
- **Excluded:** TypeScript code intelligence (`58edd998d`, `7da2f317e`) and sleep prevention (`4f9a6f739`, `59ed3d0cb`, `fb4f42001`) sit below the language-server cut in the intake and are outside this work set.

## Remaining order

1. **Complete UI verification:** Exercise the new branch-pair picker in a browser and the carried screens on a native device before treating mobile behavior as verified.
2. **Build review workflows:** IP-15 can follow the current forge carries. IP-16 and IP-17 should prove change categories in one place before IP-18 spreads them.
3. **Choose model-backed value:** Pick one of IP-19, IP-23, or IP-26 based on the first user problem to solve. Bring IP-21 only when a visible job needs its activity record. Follow each service with its UI item, then consider IP-25 after response control works.
