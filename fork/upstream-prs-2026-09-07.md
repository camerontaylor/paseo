# Upstream PR evaluation — 2026-09-07

Snapshot: **2026-09-07**. Fork base: v0.7.2 (`9400a49af`, upstream main of
2026-09-02); upstream main at snapshot: `c424f8292`.

Scope: all 430 PRs open on `getpaseo/paseo` and created 2026-08-07..2026-09-07.
Method: 18 triage workers read title+body and returned one verdict line each;
10 deep-dive workers took the clusters, pulled diffs, review threads and live
`gh` state, and checked each candidate against the 100 files this fork patches.
Every PR named below was re-verified open (or noted merged) on 2026-09-07.

Reading the window: the maintainer merges ~30 PRs a week but left the deep-dived
community PRs untouched — zero maintainer reviews across the ~80 examined
closely. The merge-queue bottleneck from the 2026-08-22 research is intact, so
the carry-small-fixes strategy holds.

The Reconcile section is worked into integration plans in
[handover-upstream-reconcile-2026-09-07.md](handover-upstream-reconcile-2026-09-07.md).

## Corrections

Verification killed two beliefs from the 2026-08-22 basket:

| Belief | Reality |
| --- | --- |
| #2664 carried on `custom` | Not there. No `timeline-page-bounds.ts`, no `TIMELINE_PAGE_BYTE_BUDGET`, no history on this branch — it lives only in the desvio build tree. If #2610's oversized frames bite, start the carry; otherwise wait, because #4153 (Watch) makes it redundant. |
| #2319 merged into our base | Not merged. Its commit sits on an upstream branch that is not an ancestor of `custom`; the tree still carries the bug (`char: cell.getChars() \|\| " "`). #4101 (Grab next) lands on a clean base and supersedes it. |

Two verdicts that survived challenges:

- **#3440** (reject low-order X25519 peer keys): the hole is already closed in
  our base by #3669's zero-check at `packages/relay/src/crypto.ts:143`. Skip.
- **#2785 stays** in the basket despite #3778 competing on multi-account.
  #4092/#4093 build on #2785's account model — upstream's own ecosystem is
  converging on it. #3778 has zero maintainer engagement after 14 days,
  collides across 18 files, and drags 13 of our side-conversation files into
  the merge.

## Grab now

One pass, ~180 lines, none on contested ground. Relicensing (#2982) closed, so
the consent check from the 08-22 doc is retired; still confirm a PR has not
merged before adding it — desvio marks a landed line `○`.

| PR | What | Notes |
| --- | --- | --- |
| #3089 | Startup reconciliation treats a missing workspace root as metadata-only | ~1 line. This checkout lives on an external volume; zero fork overlap. |
| #3117 | One-shot workspace inventory skips the Git observers | ~1 line, kills a 26 s connect stall. session.ts is fork-patched — hand-place near the subscriptionId guard (~:5177). |
| #3369 | Async initial commands for custom ACP providers (`waitForInitialCommands` + timeout; `input.hint` → `argumentHint`) | 51 lines. Replaces the hard-coded `""` at `acp-agent.ts:2688`. |
| #3545 | A coalesced timeline flush for a torn-down agent crashes the daemon | 17 lines at `agent-manager.ts` onFlush (~:740); the crash is live in our tree. Narrow the catch to the "Unknown agent" throw — don't blanket-swallow. |
| #3672 | #3217's duplicate agents, root-caused to a babel-preset-expo miscompile of property-access computed-key destructuring-omit (expo/expo#49232) | Fix is copy+delete in `consumePending`, a regression test, and an AST guard test. Our tree carries the broken shape at `workspace-draft-submission-store.ts:99`. 176+1-. |
| #3727 | `claude-opus-5[1m]` manifest entry, `isSelectable:false` + aliases | 46 lines, mirrors the model-manifest pattern we already follow. Dominates #3897. |
| #3950 | `canUseTool` `decisionReason`: permission cards say why they appeared | 37+0-, additive field. |
| #4113 | Forwards `steerActiveTurn` through `wrapSessionProvider` | 10 lines. Our wrapper (fork `provider-registry.ts:441-471`) drops it today — the same line unblocks the fork's steer Tier 1. No-op once #4154 merges. |
| #4355 | Sends `display:"summarized"` so Claude thinking blocks render | 12 lines, verified against the installed claude-agent-sdk 0.3.246. |

### Manifest block — append at the end of the middle band, in this order

```
upstream/pull/3089/head       # PR #3089 — metadata-only startup reconciliation (external volumes)
upstream/pull/3117/head       # PR #3117 — observer-free one-shot inventory (26 s stall)
upstream/pull/3369/head       # PR #3369 — async initial commands for custom ACP providers
upstream/pull/3545/head       # PR #3545 — guard coalesced flush for torn-down agents (daemon crash)
upstream/pull/3672/head       # PR #3672 — draft dedupe copy+delete (babel omit miscompile, #3217)
upstream/pull/3727/head       # PR #3727 — claude-opus-5[1m] manifest entry (not #3897)
upstream/pull/3950/head       # PR #3950 — canUseTool decisionReason
upstream/pull/4113/head       # PR #4113 — forward steerActiveTurn through wrapSessionProvider
upstream/pull/4355/head       # PR #4355 — thinking display:"summarized"
```

## Grab next

**Claude provider**

- **#3378 + #3155** — read Claude transcripts from the provider profile's
  `CLAUDE_CONFIG_DIR`, precedence explicit > profile env > daemon env >
  `~/.claude`. Fixes the wrong-history class (#2005) live at
  `claude/agent.ts:1612/5038`. Take as one change.
- **#3649** — isolate the Claude provider env from the desktop host session
  (131+1-). `provider-launch-config.ts` untouched.
- **#4391** — one compaction marker per compaction; fixes the stuck
  "Compacting…" state (133+5-). Best-tested of the provider group.
- **#4320** — expand slash commands when attachments are present (83+1-). Rides
  the `parseSlashCommandInput` seam the side-conversation work uses.

**Daily use**

- **#3002** — pastes ≥10 KB attach as files. No joint cost.
- **#3519** — `paseo run --mcp-config` (176+1-, CLI-only).
- **#3489** — `logs --follow` keeps streamed fragments together; bug at
  `cli` `logs.ts:219` (222+5-).
- **#3034** — answered plans stay readable with verdict badges (338+30- across
  `claude/agent.ts` + `message.tsx`). Schedule with a quiet sync window.
- **#4280** — draft tab locked while its create request is in flight (162+9-).
  Anchors verified: `create-flow.ts:182/200/220`, `workspace-tab.tsx:416`.
  Second layer of the #3217 defense after #3672.
- **#3146** — reconnect on app resume, skipping backoff. Disjoint from our
  `daemon-client.ts` hunks (578/2981/5701/5733).

**Lifecycle** — one pass on `paseo-tools.ts`, before #3455/#3868 rewrite that
block upstream

- **#3065** — a still-tracked run is not reported canceled (14 lines).
  Prerequisite semantics for the cancellation plan's refused-vs-settled
  contract.
- **#3094 + #3147** — notify the caller when a detached child finishes;
  agent-scoped `create_agent` can request one.

**Subagents**

- **#4273** — pi-subagents surface in the Subagents Track (1454+0-, server-only,
  311 tests, no overlap with our track work).

**Usage** — append in this order so each resolves against what is below it:
#3155 → #3479 → #3336 → #4092 → #4093. Keep #3474 (already carried).

**CJK**

- **#4101** — rebased 2026-09-07 onto the tree's actual shape; supersedes
  #2319, #3458 and #3767 (199+13-).
- **#4340**'s app-side edge — the row-model sentinel skip and the regenerated
  `terminal-emulator-webview-html.ts`. Shared hunks with #4101 are identical;
  dedupe once.
- If #4324 merges (Watch), drop both sentinel hunks and keep the runtime refit.

## Reconcile

Don't carry these — upstream contributors are re-deriving our own plans. Mine
the mechanisms and the tests; the plans win. Integration steps, sequencing and
open decisions are in
[handover-upstream-reconcile-2026-09-07.md](handover-upstream-reconcile-2026-09-07.md).

| PR | What it re-derives | Verdict |
| --- | --- | --- |
| #4325 | Interrupt settles the foreground turn | Take the turnId guards' shape; the clear-on-interrupt half is the 2 s/5 s race cancellation plan §3 exists to kill. |
| #4154 | Steering via provider subclass | Take the wrapper line and the echo-suppression tests; its admission semantics lose to plan §6. |
| #4425 | Concurrent-prompt steer | Reject — reports accepted before validation; the defect class goes into plan §13's rationale. |
| #4041 | Forced-cancel rescue by session swap | Reject the mechanism; take its test matrix. |
| #3278 | close() must not read as user interrupt | Plan §7 owns it; take the failure mode as a required test, not the 9-file flag. |
| #3091 | Await Claude's interrupt ack | Invariant transfers; the async signature flip is a separate claude-scoped plan. |
| #2993 | `turn_failed.rejected?` | Take — optional server-internal field; caps the damage while the busy-turn work fixes the cause. |
| #3366 | Prompting a busy agent keeps subagents alive | Concept is our premise; mechanism is a session-level optional property (not a wire field) — take after the mirror exists. |
| #3145 | `turnSignalParser` (`_gjc/sdk/turn/*`) | Highest-value: supersedes `gjcPhase` mirroring; collides by name with our planned gjc file. Decide extend-vs-own before Step 2. |
| #3807 | All-hidden persisted layout repair | Our `workspace-layout-actions.ts` is byte-identical to upstream/main — port the repair, hand-port one invariant. |
| #4395 | Per-row width remount for iPad reflow | Reject the remount; take a width-bucket field through `areLayoutItemsEquivalent`. |

## Watch

| PR | What | Trigger → action |
| --- | --- | --- |
| #4421 | Restore cached conversations before reconnecting (boudra, 8.9k/3.2k) | Maintainer debug branch exists (`debug-pr-4160-session-restore-cache`). Recheck in 1–2 weeks. Merged → take wholesale; #4256 becomes redundant. |
| #4153 | Bounded agent timeline history (12k) | Merged → never start the #2664 carry. If #2610 bites first → carry #2664 (383+15-, server-only) as the stopgap. |
| #4324 | `TerminalCell.width` wire field behind a `terminalCellWidth` capability | Merged → drop the CJK sentinel hunks (#4101/#4340), keep the runtime refit. |
| #3778 | Provider account profiles + seamless continuation | Maintainer engagement → re-weigh the swap; the port is rebasing #4092/#4093's fetcher onto its registry. |
| #4361 | Transcript search (6.2k) | Re-triage after maintainer review. |
| #4256, #3168, #4227, #4345 | Cheap fallbacks | Carry only if the primary each shadows stalls. |

## Refuse

- **#2964** — plugin system and marketplace: second answer to #3222.
- **#3054** — SQLite persistence for schedules and tokens: the maintainer's
  own data-model move; arrives by sync when it lands.
- **#3360** — pluggable workspace runtimes: a large abstraction ahead of
  ratification; arrives by sync.
- **#3588, #3951** — completed-chat focus and smoothed streaming: re-answer the
  paced-reveal pipeline ([docs/agent-stream-performance.md](../docs/agent-stream-performance.md)).
- **#2972** — Steer default send mode: seven fork-patched files to change a
  default we already set.
- **#3546** — duplicate-agent guard: superseded by #3672 and textually
  conflicts #4280.
- **#3897** — selectable Opus 5 1M: dominated by #3727.
- **#4217** — OMP steering: depends on an external oh-my-pi release
  (oh-my-pi#10563), OMP-only.
- **#3650** — pi lifecycle rendering: file-for-file rival of #4273; #4273
  carries the tests.
- **#4157** — app-wide voice (4.9k/3.3k): a product surface, not a fix.
- **#3880** — OpenCode 2 provider (15.9k): arrives by sync when upstream lands
  its own.

## Sync hazards

- **#4321 (`parentSubagentId`, MERGED 2026-09-04)** — after our 09-02 base.
  Lands in `subagents/select.ts` and `protocol/messages.ts`, both fork-patched.
  The re-seating plan is in the handover (§ "Nested subagent ownership").
- boudra lands weekly in the timeline/session region our patches occupy. Sync
  early, sync small; a clean merge proves nothing
  ([upstream-sync.md](upstream-sync.md)).
- ~80 small fixes in the window look merge-soon. No action — they arrive via
  sync.
