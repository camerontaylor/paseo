# Upgrade to v0.12.0 beta 1

Execution plan, 2026-10-17. Upgrade the maintained fork to `v0.12.0-beta.1`, preserve or retire each carry by behavior, add the interesting upstream PRs where adaptation stays small, and complete a separate TMAD, infi-pc and colonelpanic8 intake. This planning pass has not changed application code, the live Desvio pin, publication branches or running services.

**Full TMAD is not active today.** Published `mine@929d74271` contains the original partial TMAD port. Queue/Stream durability overlays remain unpublished; many newer features are absent. The [complete TMAD matrix](../intakes/2026-10-17/tmad.md) is the acceptance inventory for this upgrade. A successful beta build alone cannot close it.

## Inputs and ownership

| Input | Pinned source | Treatment |
| --- | --- | --- |
| Latest beta | [`v0.12.0-beta.1`](https://github.com/getpaseo/paseo/releases/tag/v0.12.0-beta.1), peeled `e2f4948f92ce2fc3c4cfb7878f239a88034883de` | Target base; published October 16, 19:57:52 UTC. Keep this tag fixed through validation. |
| Published fork | `origin/mine` and `fork/v0.11.2-fork.2`, `929d7427163474f5c0cbfc45192436d3de7540c6` | Regression baseline and release receipt; never use the assembled branch as an authoring base. |
| Current permanent work | `origin/custom@557a5f9ca1917579605e3829ae32ad10dc5576be` | Includes Pi cache-risk/effective-effort work newer than the published fork. Preserve it. |
| Local permanent work | `custom@268be1c4b7af16787d920e74b3eed6a564932c8a` | One local research-doc commit diverges from origin. Preserve both sides when reconciling custom; do not reset either. |
| Carry configuration | Neptune `~/.paseo-fork/{desvio.conf,manifest.txt}` | Actual base is `v0.11.2`; manifest comments still say 0.11.1. Snapshot the files before changing a candidate configuration. |
| Existing refresh campaign | `paseo-control/fork/campaign/ledger.md` and `plans/ralplan-fork-source-refresh.md` | Reuse accepted code and acceptance contracts. Replace stale bases/source pins in new work; retain historical evidence. Do not overwrite an active worker's branch. |

Detailed source pins, patch applicability and PR sizes are in [upstream-pins.json](../intakes/2026-10-17/upstream-pins.json). The three requested intake workers completed separate reports: [TMAD](../intakes/2026-10-17/tmad.md), [infi-pc](../intakes/2026-10-17/infi-pc.md), [panic8](../intakes/2026-10-17/panic8.md).

Use `upgrade/custom-0.12.0-beta.1` for the permanent-work candidate and `upgrade/basket-0.12.0-beta.1` for disposable assembly. Give new subject branches a `-0.12.0-beta.1` suffix. Keep the current branches until the candidate is validated. New carries belong in a candidate manifest after their real prerequisites; accepted code must have an owning branch before assembly. Preserve source attribution and removal boundaries.

## Integration sequence

1. **Freeze inputs and preserve in-flight work.** Capture the live manifest, pin, remote custom, published mine and all adapted/accepted branch heads. Check the Neptune A3 worker and save its exact branch/dirty state; consume completed commits only. Do not run a second writer on that worktree. Reconcile the local research commit with current origin/custom without dropping the Pi change.
2. **Upgrade custom in isolation.** Merge the pinned beta into the candidate, preserving permanent behavior. Run the conflict and semantic checks below. Build the candidate stack on Neptune, then typecheck/lint and focused tests. Establish an upstream-beta baseline for any failures before attributing them to the fork.
3. **Rebuild the existing carries in order.** Custom, common carries, infi backend, infi UI, TMAD baseline, ACP model-switch fix. Reconcile each on the beta basket and record a new head; do not merge the authors' entire updated forks. Preserve A1 diagnostics explicitly, as described below. Check the assembled basket after each layer.
4. **Add the upstream PR subjects.** Start with the small fixes in the selected-PR table. Use one owning branch per independent subject; stack genuinely related changes only. Add conditional subjects if their behavior and tests fit with small local adaptation. Record an explicit reason for anything deferred under the difficulty condition.
5. **Integrate the three fork intakes.** The source owners remain separate workers/branches. TMAD first recovers C1/C2/A3, then closes the full matrix. Infi reuses B9 and completes the scoped workflow packages. Panic8 preserves accounts, then isolates usage history. Integrate shared composer, protocol, panels and schedule files serially through the coordinator.
6. **Verify the complete candidate and activation.** Run the gates below against the assembled SHA. Build/package separately from installation. Record installed client and connected daemon receipts and feature observations before saying TMAD is active. Publication or a production restart is a separate action; this plan does not perform either.

The beta baseline and the full-feature basket are separate checkpoints. Do not publish a baseline and describe it as full TMAD while the feature matrix remains open.

## Resolve the beta merge

The read-only `git merge-tree --write-tree origin/custom v0.12.0-beta.1` preflight reports **29 conflicted paths**. This count is for custom only. Independent carry-versus-beta checks also conflict, but their counts overlap and must not be summed.

| Area | Resolution and acceptance |
| --- | --- |
| Versions, dependency manifests, lockfile, postinstall patches | Take beta package versions and dependency changes, retain only actual fork additions, then regenerate the lockfile using the candidate's pinned npm on Neptune. Never resolve the lockfile by selecting one entire side. Keep the upstream replacement Markdown dependency. Audit patch applicability and generated protocol tooling. |
| `agent-tracks`, provider-subagent panel, workspace screen, subagents track, open-beside tests | Keep beta panel/layout/startup ownership and port side-conversation identities/actions into it. Exercise nested provider children, side conversations, compact sheets and close/reopen. Read `docs/expo-router.md` before touching routes or workspace selection. |
| Agent manager and lifecycle tests/docs | Preserve side-question forwarding, ACP cancellation/successor admission and completion notification semantics while incorporating beta background-workspace/provenance changes. Keep current optional-method wrappers and their receiver binding. Integrate changed documentation into its owning section. |
| Plugin provider/process protocol | Reconcile the new provider interfaces with optional side-question/session methods and provider removal/configuration transactions. Test live/persisted account rename and removal together; no partial updates. |
| Pi agent and RPC types | Retain effective-effort persistence and cache-risk warning from current custom. Resolve against beta's maintained provider interfaces; test configured effort across restart/resume without silently changing it. |
| Protocol generation and memory | Preserve all fork optional schemas, operation-permission entries and client capability defaults. Keep beta's #6847 generated-validator split and #6262/#6766 memory/lifecycle fixes. Regenerate validators from candidate schemas; never copy stale generated output. |
| Silent changes outside conflict markers | Check widened unions, newly required props, exhaustive operation maps, creation/recorder fixtures, provider snapshots, queue ownership, Markdown links/Find/selection, voice playback ownership and removed panel APIs. A clean merge is not acceptance. |

## Existing carry decisions

| Carry or behavior | Upgrade decision |
| --- | --- |
| `fork/carries-0.11.1@36fdadba6`: provider accounts #2785 | Keep account create/edit/rename/remove, provider-home routing, grouping and scoped Usage. Latest author account branch adds no demonstrated missing behavior; its three interface repairs are already adapted. Reconcile beta configuration transactions. |
| #2237 screenshots | Keep unless beta screenshot/tool-surface behavior is demonstrated equivalent. Test live and historical screenshots, not just attachment parsing. |
| #2664 bounded byte hydration | Keep; beta cache improvements and #6762 snapshot trimming address different paths. Verify bounded initial/history reads and large payloads. |
| #3545 torn-down terminal flush | Keep the minimal guard unless beta owns an equivalent. It was closed unmerged, so closure is not a retirement reason. Check flush after teardown and normal terminal delivery. |
| #3950 finish reasons | Preserve structured reasons through provider, stored record, wire and UI; retire only proven equivalent hunks. Distinguish cancellation, permission rejection and provider failure. |
| #4101 CJK patch | Beta #6452 supersedes the upstream-fixed portion. Compare adapted hunks and preserve any remaining behavior; run non-Latin terminal/selection/Find cases before removing the topic. |
| #3369 argument hints | Beta #6920 owns argument hints; #5411 already supplied the initial wait. Remove equivalent hint hunks while retaining generic ACP/GJC and model-switch semantics. |
| Infi backend `1dd375931` and UI `133ff0f7e` | Preserve IP-01–14 behavior on beta-owned surfaces. Do not restore older forge archive, composer or tab ownership. The infi report owns individual checks. |
| TMAD baseline `139e0c81e` | Preserve TM-01/02/03/04/07 and assembly fixes; port into current Markdown/audio/panel owners. This baseline is not full TMAD. |
| ACP model-switch `de8ea216a` / upstream #6878 | Preserve rejection and configured default-thinking behavior; the upstream PR does not include all local CLI behavior. Reconcile beta `run --background` deprecation and `--no-wait` handling without dropping explicit target/home precedence. |
| A1 diagnostics `831f6a858` | **Published but not an ancestor of origin/custom and not a live manifest line.** Give it an explicit candidate manifest entry, or absorb its reviewed permanent delta into custom and record that ownership. Do not lose it during the rebuild. |
| C1 `8468e7f55`, C2 `94fbbd6a4`, browser repair `d2407b79b` | Reuse the accepted overlays and reviewed repair where applicable. Resolve outstanding browser/publication defects on beta; old package acceptance does not close native/CI/disk-failure evidence. They are not in published mine. |
| B9 `eb6409c5ae062a6d03a99c2bfe416e9489f828e1` | Reuse accepted diff-stat code from Neptune. Its basket `4e48d0c95` is not proof of deployment. Preserve total/config versus production counts. |
| A3 legacy UI | Existing `ea90c7787` is the first stage only. Preserve that work and complete the remaining unread/activity pieces; do not mark A3 done. |
| Disabled #280/#1813/#1826/#1834 and mobile-fork-icon | Keep disabled. They need provider/renderer/session-fork ports, or are superseded by the maintained queue work. They are not required to preserve the currently active carry set. |
| Infi IPv6, panic8 #4827/#4831 | Use beta #6753, #7052 and #7074. Do not reintroduce older helpers, unbounded caches or stale/unpersisted overlay reads. The separate retry/backoff issue #5491 remains separate. |

## Selected upstream PRs

“Add” means include in implementation scope and retain after focused tests on the assembled candidate. “Conditional” means attempt the bounded adaptation, then defer if it needs a new subsystem or broad redesign. No PR is accepted solely because a patch applies.

All ten main candidates other than closed #5230 apply individually to a clean beta index. Eleven small subjects also apply **together**, in the order listed below. These are patch applicability checks, not runtime, typecheck or semantic results for the fork basket.

| PR | Decision | Integration and acceptance |
| --- | --- | --- |
| [#7179](https://github.com/getpaseo/paseo/pull/7179) Claude turn survival | U3 source conditionally accepted at `2b5f4be7d`; coordinator progression gate pending | Exact attributed `4e6357440` carry after accepted A1, owned by `fork/claude-turn-survival-0.12.0-beta.1`. Build and 82 affected unit cases pass; exact source static passes. **REAL Claude turn survival UNVERIFIED:** both real runs fail at createAgent availability admission before dispatch/sentinel/controls; underlying cause unknown. Track the real gap at U7. Preserve mode-error and closed-session guards. [Completed receipts and conditions](../handover-beta-upgrade-u3-7179-2026-10-18.md). |
| [#7169](https://github.com/getpaseo/paseo/pull/7169) slash-command and OMP follow-up fixes | U3 source conditionally accepted at `b2b8f342d`; coordinator gate pending | Single attributed `cd77ecd83` carry, byte-equal to frozen `57427189` net, after accepted #7179. Owning build and 468 affected unit cases pass; exact source static passes. **REAL OMP UNVERIFIED:** beforeAll `omp --version` exits 127, `env: bun: No such file or directory`; all 14 tests skipped before resources/body/turn/sentinel. Preserve sourced identity, structured prompts, ACP cancellation and busy-turn ownership. Replaces closed #7072. [Completed receipts and runtime gap](../handover-beta-upgrade-u3-7169-2026-10-18.md). |
| [#6762](https://github.com/getpaseo/paseo/pull/6762) snapshot trimming | U3 advisor-accepted source `82b872251`; coordinator gate pending | Single attributed `74fe3ee8` carry, byte-equal to frozen net; no main-sync ancestry. Wire-only async-question log omission preserves private disk persistence, live pending questions and artifact/companion facts. Owning build, 55 affected unit cases and exact source static pass. Separate #7179 Claude admission and #7169 OMP executable-preflight real gaps remain UNVERIFIED through U7. [Completed receipts and preservation](../handover-beta-upgrade-u3-6762-2026-10-18.md). |
| [#7057](https://github.com/getpaseo/paseo/pull/7057) notification rearming | U3 advisor-accepted source `19adfb230`; coordinator gate pending | Single attributed `d2174afaa` carry, exact frozen subject with three preserving automatic merges. Four intended failing-first recovery cases, owning build, 172 affected unit cases and exact source static pass. Exact sourced notifications across repeated errors and autonomous success retain #6008 early completion and existing terminal/permission/dispatch owners. Both inherited real-provider U7 gaps remain UNVERIFIED. [Completed receipts and classifications](../handover-beta-upgrade-u3-7057-2026-10-18.md). |
| [#7062](https://github.com/getpaseo/paseo/pull/7062) attention edges | U3 advisor-accepted source `05e0ccfdf`; coordinator gate pending | Single attributed `a48bb2208` carry after accepted #7057, with two preserving automatic merges. Three intended stale-attention reds, owning build, 377 affected unit cases and exact source static pass. Fresh independent disk readers prove attention edges, duplicate silence and clearing alongside exact #7057 sourced notifications; initial cache-backed observations remain classified separately. Both real-provider U7 gaps remain UNVERIFIED. [Completed receipts and preservation](../handover-beta-upgrade-u3-7062-2026-10-18.md). |
| [#7146](https://github.com/getpaseo/paseo/pull/7146) Node declaration walking | U3 advisor-accepted source `7a43f7930`; coordinator gate pending | Single attributed `b86cbd38e` carry after accepted #7062; both unrelated replica-cache reversions in the frozen-base diff are excluded. Three intended declaration-walk reds, owning build, 94 compiler cases and exact source static pass. Four real declaration cases retain explicit client/shared Node boundary errors; SDK normalization and physical ownership remain. Both real-provider U7 gaps remain UNVERIFIED. [Completed receipts and preservation](../handover-beta-upgrade-u3-7146-2026-10-18.md). |
| [#7106](https://github.com/getpaseo/paseo/pull/7106) heartbeat schedule listing | U3 advisor-accepted source `817b48ab1`; coordinator gate pending | Single attributed `4922bedf7` carry after accepted #7146, with complete EOF test union. Two intended missing-listing reds, owning build, 151 MCP cases and exact source static pass. All-daemon summaries omit run history; real scoped-caller proof preserves foreign-heartbeat deletion refusal and successful own deletion. No #6982 or permission-policy change. Both real-provider U7 gaps remain UNVERIFIED. [Completed receipts and preservation](../handover-beta-upgrade-u3-7106-2026-10-18.md). |
| [#7092](https://github.com/getpaseo/paseo/pull/7092) atomic idle-only send | Conditional, after C1 admission is reconciled | 17 files; new SDK API/capability and input mode. Check atomic competition, creation windows, receipt retries and refused-ID reuse. Gate new client sends before old servers parse them. Never fallback to steer/interrupt. Defer if queue admission requires redesign. |
| [#6731](https://github.com/getpaseo/paseo/pull/6731) installed plugins across disconnect | Conditional, favored | Eight files; preserve installed state through disconnect/reconnect while separating host availability. Check host removal, stale bundles and beta plugin readiness. |
| [#6732](https://github.com/getpaseo/paseo/pull/6732) cached plugin bundles | Conditional, after #6731 | Nine files; omitted unchanged bundles must not look uninstalled. Reconcile shared client tests and cache invalidation; verify changed hashes still download. |
| [#6864](https://github.com/getpaseo/paseo/pull/6864) archived schedules | Conditional | Nine files; archive pauses, unarchive resumes only archive-paused schedules. Preserve manual pause and prevent replay/runs during transitions. Reconcile infi snooze and beta schedule fixes. Closed #6863 is the duplicate, not a second port. |
| [#7086](https://github.com/getpaseo/paseo/pull/7086) fresh-agent schedules in a workspace | Defer from low-difficulty batch | 36 files, over 3,000 added lines across UI/CLI/MCP/contracts. Retain as a separate scheduling feature package, after #6864. |
| [#5230](https://github.com/getpaseo/paseo/pull/5230) paginated Codex history | Conditional, favored; closed unmerged | Two files. Production hunks apply to beta; test fixtures need adaptation. Verify installed app-server pagination, bounded import/resume, cursor progress, no duplicates/gaps and cancellation. Do not reproduce the 2.11 GiB transcript. Defer if maintained provider APIs require a larger rewrite. |

Small additional subjects retained from the research window: add [#6978](https://github.com/getpaseo/paseo/pull/6978) distinct Codex team seats, [#6264](https://github.com/getpaseo/paseo/pull/6264) slow SSH status, [#6402](https://github.com/getpaseo/paseo/pull/6402) bounded directory search and [#6165](https://github.com/getpaseo/paseo/pull/6165) urgent-agent selection if focused checks pass. The cumulative beta patch order tested was `7179, 7169, 6762, 7057, 7062, 7146, 7106, 6978, 6264, 6402, 6165`. Coordinate #6978 with panic8's account/Usage owner and #6165 with TMAD navigation.

| Other researched subjects | Disposition |
| --- | --- |
| [#6982](https://github.com/getpaseo/paseo/pull/6982) caller-owned heartbeat reads | Conditional; reconcile permission and target-error contracts with #7106. |
| [#6306](https://github.com/getpaseo/paseo/pull/6306) await plugin reload | Conditional; six files, 655 added lines, shared client tests. Do not turn a slow request into unbounded waiting. |
| [#6166](https://github.com/getpaseo/paseo/pull/6166), [#6371](https://github.com/getpaseo/paseo/pull/6371) | Small bounded ports if current owners still miss permission-wait resync or script-file refresh. Patches need beta adaptation; #6371's applicability failure is in a test. |
| [#6553](https://github.com/getpaseo/paseo/pull/6553) worktree listings | Recheck against beta #6545 and #6542; port only remaining newly-created-worktree invalidation. Multiple production conflicts make this conditional. |
| [#6079](https://github.com/getpaseo/paseo/pull/6079) scoped busy sends | Coordinate with #7092/C1; do not blanket-change explicit interrupt to steer or bypass receipt ownership. Port only a remaining scoped-send defect. |
| [#6601](https://github.com/getpaseo/paseo/pull/6601) Hermes class lowering | Conditional independent plugin package; five files but native/compiler behavior needs real Hermes proof. |
| [#6729](https://github.com/getpaseo/paseo/pull/6729) plugin compiler isolation | Defer: 115 files and substantial process/compiler ownership changes. Beta #6847 solves a distinct memory issue; it is not full equivalence. |
| [#6736](https://github.com/getpaseo/paseo/pull/6736) image persistence; [#6737](https://github.com/getpaseo/paseo/pull/6737) shared ordering | Defer from easy batch: 30 and 62 files, cross-client persistence/state contracts. Keep separate feature packages. |

Closed PR replacements already in beta require **no duplicate intake**: #3369→#6920, #6544→#6660, #4827→#7052 and #4831→#7074. Closed license proposal #5670 remains issue #7032; it is not a shipped license change. Track unresolved #4954/#5523 Nix packaging separately if that platform becomes a delivery target.

## Separate fork intake workers

Each worker starts from the completed beta preservation basket, owns its subject branches and reports integration SHA plus evidence. Their completed read-only intakes are handoff inputs, not implementation or activation receipts. Avoid concurrent edits to the same shared file: workers prepare deltas; the coordinator serializes integration and shared checks.

### TMAD full feature closure

Use the complete [TMAD matrix and ordered T0–T10 backlog](../intakes/2026-10-17/tmad.md): 26 distinct register features plus the legacy and open-PR inventory. The required scope is source-main behavior at `33a09e4fd4c1a44bc62092223b824707ec706a63`, including the legacy features previously deferred. Source branding is satisfied by our own fork identity. Source-open PRs receive separate explicit decisions; source's own unimplemented requests are not falsely reported as ports.

1. Recover C1/C2 and finish A3, including browser defects, nine-locale parity and durable receipts. Retain stronger local queue parking/retry and archived fences.
2. Complete voice: realtime C3 plus #67/#80 entry and #88 error fixes, verbal mute and iOS background policy. Use current shared audio ownership, explicit provider configuration and genuine device checks.
3. Complete favorites, simultaneous footer date/time **and** duration, five-choice sorting, unread/activity, recent sessions/workspaces and navigation through the existing infi history owner. Beta itself lacks the simultaneous footer and Quiet/Summary default.
4. Add pinned/default projects, Views, subagent/checklist side panels, UI side placement, cross-workspace splits and session-ID search through maintained panel/tab identities.
5. Complete configured-provider routing and dispatcher modes, best-match routing, deep lexical search, quick launch and Find or Start in dependency order. Bounded searches never start dormant providers; queue delivery never silently interrupts.
6. Close standalone native keyboard dismissal, Find in Chat, message clamp, CLI target/default/tab-opening and the source typed-send queue default. Keep explicit existing user preferences; test fresh-install defaults separately.
7. Adopt open #61 after re-pinning/review at `bcd72781546359edf0939d0cf5aac7ce33e8670e` on C2. Add #65 pin curation at `105ef17230cb7685c3e20cf7c3c07c3d8442929f` as a separate negotiated capability. Adapt #84 threaded replies at `1971b81603ead25773979e6055d78ccb7df509a5` through our side-conversation owner after the queue and side-panel prerequisites. These open additions have their own review/acceptance units. Alias repair #55 is an offline artifact; adoption does not authorize running a repair against production.

Source #86 changes fallback policy. Preserve our single capability gate and clear unknown/unsupported state; do not import approximate fallback implementations or rewrite repository policy. This is an explicit adaptation, not an omitted feature. The classifier must use supported configured-provider seams, not private ChatGPT token/endpoint plumbing.

### Infi workflow closure

Use the [infi report](../intakes/2026-10-17/infi-pc.md), source `paseo-customizations@c7d1a05371b9372884d735c743b42c26f2f7387b`; `main` is an upstream mirror. The previous exhaustion assessment checked the wrong branch.

Preserve IP-01–14; reuse B9, complete held A2 quit authority and pending B1–B8. B10 follows B5 snooze plus B6 Linear/header and must include October 12 GitHub/Linear partial-failure fixes and populated browser flows. Add PR #6 transcript clipboard as its own medium unit coordinated with B4/composer queues. PR #5 provider activity/historical interval diffs is a separate larger unit; defer if it does not fit easily. Keep model-generated summaries, recommended prompts, chapter grouping and language-server work explicitly outside this scoped intake. Skip the source IPv6 helper because beta #6753 already owns that fix.

### Panic8 accounts and usage

Use the [panic8 report](../intakes/2026-10-17/panic8.md). Account source `multi-account-provider@63916fe3003da650fe418fb94856d038c534caea` adds no missing port to our adapted account branch; verify beta integration instead of replaying rebased history.

Usage history at `7dc20c0503f94e02bf4732b060d60a134ef7a6a0` is genuinely additional: 24 topic commits, 57 files and about 10,000 added lines. Split contract/scanner, multi-host UI and follow-ups into the report's P8-H1/H2/H3 units. It is outside the cheap PR batch and does not block TMAD parity. Do not merge `assembled` wholesale or use the obsolete all-hosts branch. Preserve beta's bounded/durable performance implementations.

## Verification and activation receipts

All builds run on Neptune or CI. Use an isolated candidate checkout and private dependencies (`npm ci`); this beta changes dependencies, so shared writable node_modules is inappropriate. Keep builds serial with the existing campaign. Use an isolated home/port and preserve live daemon `dist` and lazy-load paths. No full suite on either development host; broad suites belong in existing CI jobs.

Per accepted subject: build the owning declaration stack, run targeted existing test files with `npx vitest run <file> --bail=1`, run `npm run typecheck` and `npm run lint`, inspect the diff and format via npm scripts before committing. Trust another worker's exact-SHA passing check unless new changes invalidate it. Record inherited failures with the baseline SHA rather than declaring the candidate green.

Required integrated checks:

- Protocol pure optional schemas, operation-permission coverage (`authorization/index.test.ts`), exhaustive capabilities, old/new parsing and client-negotiated new pushes. Keep question enums unchanged where C2 already adopted nested optional ask state.
- Side conversations and provider children, ACP cancellation/successor boundaries, account configuration transactions, model rejection/default thinking, queue receipts and retry/crash/reconnect races.
- Snapshot size, bounded Codex history/directory reads, memory regression from split validators, provider process cleanup and plugin disconnect/reload/cache behavior.
- Real browser flows for existing fork surfaces and each accepted UI package: desktop and compact, actual populated data, failures/retry/reload, Markdown selection/file links/Find, panel/route restoration and nine locales. Recheck the old C1/C2 browser failures against beta instead of inheriting a waiver.
- Schedule manual/archive pause transitions, no duplicate slots, child wake/attention edges and terminal outcomes.
- Packaged Electron, physical iOS/Android, selected voice provider/credentials and background/audio behavior for the applicable TMAD rows. Unsupported hardware checks remain open, not implicitly passed by a browser run.

Add four evidence columns to every TMAD matrix row: **included source SHA, artifact digest, installed version/source, observed platform behavior**. Preserve deliberate equivalences and explicit source-open deferrals. Existing queue/Stream flags being `true` only proves that the source advertises a feature; it does not prove a client runs it.

The final delivery must say either **full TMAD active**, with all required rows observed on their supported delivery platforms, or list the exact remaining rows. Missing physical/device evidence prevents the broad activation claim. Keep the known-good published release/install paths until the candidate is verified; a production daemon restart still requires explicit permission.

## Planning verification

GitHub APIs verified the tag, release, PR heads and fork branches. Read-only merge trials identified the custom/carry conflict areas. Isolated temporary-index checks tested 23 PR patches individually against beta and published mine, plus the cumulative eleven-subject beta stack. Production services were not inspected or changed. These checks establish planning inputs and patch compatibility only; implementation, builds, integrated tests and activation remain subsequent work.

Document verification passed: relative links, 26 distinct TMAD register rows, 27 pinned PR records, the peeled beta SHA and whitespace checks. Required `npm run typecheck`, `npm run lint` and `npm run format:files` were attempted but could not run: this checkout has no installed dependencies (`tsgo`/`oxfmt` missing; the `oxlint` shim has no selected version). No dependency installation or build was performed on Uranus.
