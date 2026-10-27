# infi-pc intake for the beta upgrade — 2026-10-17

Read-only source investigation. Only this /tmp report was written. No refs, branches, source, services, builds, or tests changed. Host is uranus; all builds and broad verification belong on neptune or CI.

## Source identity and correction

- Live source: https://github.com/infi-pc/paseo/tree/paseo-customizations at `c7d1a05371b9372884d735c743b42c26f2f7387b` (GitHub API verified this run).
- Old pinned intake: `refs/research/fork-refresh-infi-20261008` = `886a8690317a72c1177484c3f7358bf72d943cc3`.
- GitHub comparison reports 228 commits ahead, but most are upstream history admitted by the October 12 sync. Do not interpret 228 as 228 fork features.
- The earlier assessment that infi was exhausted was incorrect: it checked `main`. Source docs explicitly designate `main` as an exact upstream mirror and `paseo-customizations` as the actual fork.
- Latest release target verified: `v0.12.0-beta.1`, annotated tag f6956fc78de9da6330f4812dab0c99024432e137, peeled commit `e2f4948f92ce2fc3c4cfb7878f239a88034883de`, published October 16 19:57:52 UTC.
- Source open PR #5 head: `a2d4b246ffbe42b58df6b65bc7e52fa8d63481d2`, updated Oct 13 15:48 UTC. https://github.com/infi-pc/paseo/pull/5
- Source open PR #6 head: `95b1b5cae9943bb85a60adf833db18bbf6fc7644`, updated Oct 13 18:27 UTC. https://github.com/infi-pc/paseo/pull/6

## Current campaign evidence and baseline

Authoritative current campaign ledger: `/home/ctaylor/repos/paseo-control/fork/campaign/ledger.md`; implementation definitions: `/home/ctaylor/repos/paseo-control/plans/ralplan-fork-source-refresh.md`.

Existing infi carried baselines remain `fork/infi-backend-0.11.1` = `1dd375931a0c4de5e930abb4b2cf2dc52d9cbcc5` and `fork/infi-ui-0.11.1` = `133ff0f7e0234da8aa684a23a8da31024531242d`. These are actual adapted carries, not a wholesale merge of infi history.

- A2 quit dialog: HELD before s1; branch still at frozen backend head. s0 passed; implementation not done.
- B9 diff-stat: DONE October 15 at `eb6409c5ae062a6d03a99c2bfe416e9489f828e1`; accepted rolling basket `4e48d0c950ac0af54069617bd35d2f3e28baa59a`. Preserve and port this accepted implementation, rather than repeating the old source extraction. Open evidence: native, remote CI, locale screenshots, basket browser run.
- B1-B8 and B10: PENDING. No evidence these planned features are active in the published app.
- Publication is a separate fact: campaign delivery doc identifies A1-only `0.11.2-fork.2` at `929d7427163474f5c0cbfc45192436d3de7540c6`. C1/C2 had publication holds. Neither B9 DONE nor any pending row establishes runtime activation.
- Existing IP-01..14 are prior adapted carries: file links, fork-aware PR lookup, initial quit confirmation, package scripts, plan copy/handoff, branch/base contract and header, recent agents, navigation history, pinned prompts, status pulse, PR facts/browser. Reconcile their behavior on beta before layering missing features. The original tracker records historical verification, not proof of current runtime health.

## Beta overlap and preservation strategy

The beta source tree has none of the feature roots `workspace-snooze`, `agent-defaults`, `transcript-picker`, `sleep-inhibitor`, `linear-service`, `provider-activity`, or `turn-changes`. This is a structural absence check, not a complete semantic equivalence proof. Their implementation remains genuine intake work.

The beta includes background workspace visibility, compact header/sidebar changes, replacement Markdown work, agent-message provenance, diff review changes, and owned subscription evolution. Reapply infi UI behavior into those maintained owners. Source's Oct12 sync record specifically reports 22 conflicts and silent breaks in panel close/singleton policy, launch catalog deleted toggle fields, stored-agent projection complexity, and session fixtures lacking background recorder. These are high-value upgrade regression seams.

Preserve before extending:

| Existing behavior | Beta risk / acceptance |
| --- | --- |
| Source-aware links | Markdown replacement and activity rendering: link from checkout A opens A while viewing B; non-ASCII paths work; containment enforced. |
| Fork-aware PR lookup and PR browser | Preserve head-repository match for open PRs and SHA match for terminal PRs; existing forge registry owns the behavior. Do not restore old GitHub-only archive flow. |
| Package scripts | Preserve configured services and nested package discovery, manager/cwd/path safety, running status. Check inherited Windows temp-path failure separately. |
| Branch/base header | Integrate with beta compact header; base mutation leaves HEAD and dirty tree intact, one capability gate. |
| Recent/history/pinned prompt/pulse | Read expo-router docs for routing changes; restore selected tabs without archive side effects; pinned prompt follows reading offset and remains absent in compact source behavior; no high-frequency list rerenders. |
| Plan copy/handoff | Clipboard failure visible; handoff opens editable draft with full source context and never sends implicitly. |
| B9 categories | Keep config in totals and category breakdown, exclude only production counter. Code +2/-1 plus config +7/-3 => totals +9/-4, production +2/-1. Keep existing pill; no duplicate surface. |

### Proven supersession: IPv6

Skip a separate fork port of `ddf4c533dba6a7d6932748bd2714d067c117375a` (IPv6 loopback services). Upstream #6753 merged October 13 at `b0f054de90bdf0773a1a9281972294410f35837a`. GitHub compare to beta reports merge-base equal to that exact commit, behind_by 0, ahead_by 91: conclusively in beta. Upstream owns `packages/server/src/server/local-service-connection.ts`; source fork used a different `service-loopback.ts`. Carry the upstream solution and regression cases, not both helpers. Acceptance: IPv4-only and IPv6-only HTTP GET/POST, WebSocket upgrade, health checks; preserve streaming bodies, headers, paths, and IPv4-first behavior. https://github.com/getpaseo/paseo/pull/6753

## Integration units, in execution order

Use isolated units rebased onto the exact completed beta basket, with per-unit attribution and removal boundaries. B labels preserve campaign identity, not a demand to repeat stale stage gates or old bases. New work should consume these existing acceptance contracts rather than revive the old frozen assembly wholesale.

| Unit | Source / prerequisite | Work and acceptance |
| --- | --- | --- |
| Carry preservation + B9 | Existing adapted branches and B9 accepted head above | Reconcile all previous behavior on beta first; test real module owners and run focused browser checks. Record inherited failures independently. |
| A2 quit authority | `bf85d1ed6`; existing initial confirmation | Preserve beta owned-launch identity checks. Preexisting desktop-managed daemon prompts only when keepRunningAfterQuit=false. Prompt names home/PID/startedAt. Unowned default/cancel/no window/pre- or mid-dialog abort keep running; null startedAt never stops; recheck same instance+home after confirmation; updates/OS signals never stop unowned daemon. Never copy source confirmedQuit bypass. |
| B1 selection and replies | `736c36792`, `730f7921a`, `95cd778da` | Extend existing assistant-selection-copy architecture; no parallel selection system. Quote into draft, sidebar reply via canonical Explorer host, latest-response fork retains current context. Web DOM behind web gate/files. Selection focus and overlay dismissal tested. |
| B2 host/project defaults | `0c3bfc2f1` | Atomic shared defaults store, project overrides follow worktree membership, explicit user selections win; one capability gate, no silent provider substitution. Update 9 locales and push negotiation. |
| B3 browser preview scale | `6505143ec` | Electron implementation only; persisted percentage picker, source responsive default 75%, parking retains logical viewport. Test compositor/capture harness unaffected and tab restoration; compact layout considered. |
| B4 multi-transcript drafts | Old pinned `886a869...` | Independent immutable snapshots from open workspace chats; attachment-scope selection and removals agree; preserve preselected fork context and draft prompt; no auto-send. Coordinate shared attachment contract with PR6. |
| B5 workspace snooze | `a88994e36` | Persistent server-owned deadlines; timed/evaluated snooze and notification/sidebar flow; restart restores deadline, closing/disconnecting client cannot cancel wake. Background-visibility beta is a separate workflow; define combined Show all/hidden/archived behavior. |
| B6 Linear + PR toolbar | `a3497a660` | Shared bounded CLI lookup using host credentials, no keys in wire/logs; PR URL identity and cache; links require explicit action. Add beside existing branch controls; preserve forge contracts. Include latest Linear correctness patch below in the canonical service. |
| B10 status snooze, refreshed | B5+B6 genuine combined base; `554a140ee10fbcf6ecd501a7804a5c5e01d900c6`, blocker record `142683d18f3afcf9921bd908b483af684531355c`, latest patches below | Fixed identity targets, coalesced/budgeted reads, unknown observations never treated as state changes; successful eligible field change may wake despite sibling field error. Remove either B5/B6 => remove B10. |
| B7 provider tool titles | `267c60805`, mapper hunks only | Prefer real provider title through existing presentation model; absent title preserves current label. Source tool-call-summary service hunk is no-op in our tree; no LLM labeling import. Check beta providers' current title preservation first and record any newly equivalent hunks. |
| B8 sleep prevention delivery | Narrow paths from `4f9a6f739`,`59ed3d0cb`,`fb4f42001`; delivery fix `c6f77872a` | Server-owned active-agent demand; disconnect/unsubscribe never releases inhibition. Darwin caffeinate and Linux systemd-inhibit only; other platforms unsupported. Spawn errors visible; cleanup owned child. Status travels through owned status observation, negotiated push only. Two-client and unsupported-host tests. |
| IP-new-6 transcript clipboard | PR6 exact head above; coordinate B4 | Real feature, medium adaptation, not a trivial cherry-pick. Bounded streaming export and immutable source snapshot, max 2 million chars, incomplete export fails; old clipboard preserved on failure. Full conversation/tab and up-to-response menu actions; Markdown+HTML external paste; local persisted removable context attached to existing destination draft without overwriting prompt, cross-tab leakage, or auto-send. Preserve queue editing and reload; archive source after copy and still send snapshot. |
| IP-new-5 provider activity and historical diffs | PR5 exact head above | Larger independent unit; defer if trying to remain low-difficulty in first beta delivery. Can split activity capture/projection/UI from interval diffs if wire ownership stays coherent. Preserve unknown non-streaming root events with redaction, bounds, omission markers; multiple reviews correlate without conflating permission denial and execution failure; streaming text stable across replay. Interval snapshots before dispatch and each terminal outcome preserve preexisting dirty files, staging, and external concurrent edits; label interval changes honestly (not exclusive authorship). No ignored untracked/.env/symlink/binary capture, no commits/staging mutation. |

### New October 12 patches: incorporate into owning units, not loose patches

1. `160d23f8f35ec06e8344bef9317709f8e97910ae` — B10 GitHub correctness. Paths: services/github-service.ts + existing tests; workspace-snooze/status.ts + service.test.ts. Shared readers join scheduled OR in-flight fixed-PR request once. GraphQL error paths distinguish unavailable state/review from successful `null` review (which means known no-decision). Errors in sibling metadata/alias do not poison healthy fields; ancestor/unscoped errors invalidate affected reads. Selected unhealthy field cannot seed baseline or wake; healthy lifecycle change still can.
2. `31b738ee341645c3e9a95470c0c26f8da3c290e5` — B6/B10 Linear correctness. Preserve healthy aliases in completed nonzero CLI GraphQL response while dropping errored aliases. Missing/unscoped errors, killed/timeout process, malformed/empty/no-usable response fail; avoid logging private process arguments. Transport dependency injectable through existing execution seam; strict mutation behavior remains strict.
3. `42b5de2cc68c5cf3315426522c6baa10e27d310f` — B10 integration evidence. Adds real browser populated snooze flow and real transport test fixtures; inject status checker through daemon dependencies and test utility rather than replace service with mocks. Required flow: save -> reopen -> edit -> simulated failure -> retry while state persists.
4. `c7d1a05371b9372884d735c743b42c26f2f7387b` — optional tiny B5 UI hunk: color only Snoozed label with statusWarning token; detail remains muted. Integrate where our design tokens allow, no new palette.
5. `2b40cdfc0d6a` is source documentation recording fixes; attribution facts belong in our intake ledger, not wholesale source docs.

These October12 fixes directly answer the four blocker tests already required by the existing B10 plan. Update that unit's source pins instead of inventing a second snooze implementation.

## Gaps intentionally outside this beta intake

The source full feature ledger also has model-generated tool summaries, background activity inspector, structured response-control naming/summaries, recommended prompts, chapter diff grouping, TypeScript language service, extended diff-category presentation on every review surface, and focus-aware PR polling. Older tracker rows IP-15/18..27 list these separately; prior refresh plan excludes several. They are not covered by claiming B1-B10 complete. This assignment does not establish approval to silently add all model-backed infi features. Record each as excluded/deferred or separately scoped, and do not describe infi full parity without an explicit decision per feature.

PR5 activity evidence differs from the older background daemon-jobs panel, and interval historical diffs differ from model-generated chapters. PR6 clipboard transcript copy differs from B4 New Agent picker. Beta background workspace visibility differs from B5 snoozing. Preserve these identities in the ledger.

## Completion gates and worker handoff

- First freeze new beta basket SHA and the three source SHA categories (carried adaptations, latest customization branch, PR5/6 heads). Requery heads immediately before implementation; report drift instead of auto-expanding the source set.
- Per unit: source path allowlist, owning branch, beta-equivalence decision, focused tests and acceptance evidence, explicit pending platform evidence. No source merge/version churn or optional locale weakening. All 9 locale resources via existing parity suite.
- Wire changes: pure optional schemas, dotted request/response namespaces, one feature gate, client-negotiated new pushes and exhaustive defaults, old-client parse proof; update generated validators via supported tooling on neptune.
- Build owning workspace declarations on neptune before diagnosing cross-package types; run typecheck, lint via npm scripts, format before commit. Targeted suites only, no full local suite, no duplicate testing another worker already proved green.
- Coordinate composer/stream/queue files with TMAD worker and beta integrator; do not let PR6 replace durable queued-message recovery or B1 introduce a duplicate selection system.
- B9 accepted does not mean deployed. Publication requires integrated basket evidence; activation requires matching installed/running build and manual surface verification. This task performed no runtime contact.

## Sources consulted

Local protocol compatibility, QA, coding standards; control refresh plan, campaign ledger, deployment report, original infi intake/work tracker; live GitHub branch, compare, source docs and commit diffs; fork PR5/6 metadata+file lists; upstream #6753 metadata and exact beta ancestry; beta tree API. Source-reported test passes for PR5 (372 focused) and PR6 (55 unit plus browser scenarios) remain author evidence, not independent verification of our port. Native iOS/Android and packaged Electron evidence is open in those sources.
