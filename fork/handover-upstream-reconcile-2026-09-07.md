# Handover — upstream reconcile, 2026-09-07

Upstream PRs are independently re-deriving the fork's ACP busy-turn and
cancellation work. The decision made in
[upstream-prs-2026-09-07.md](upstream-prs-2026-09-07.md) § Reconcile: the plans
win; take the mechanisms and the tests, not the diffs. This doc maps each PR to
the plan section it touches and the integration steps.

Two research workers verified every anchor against this tree on 2026-09-07.
Read both plans before acting:

- [plans/ralplan-gjc-acp-cancellation-boundary.md](plans/ralplan-gjc-acp-cancellation-boundary.md)
  — §3 authoritative foreground terminal, §4 one staged successor, §5 recovery,
  §6 admission, §7 close and permission denial.
- [plans/ralplan-gjc-acp-busy-turn.md](plans/ralplan-gjc-acp-busy-turn.md) —
  §8 ownerless mirror, §11 two-fact gate, §13 steering, §14 tests.

## 0. Do this first, isolated from both plans

`wrapSessionProvider` (`packages/server/src/server/agent/provider-registry.ts:441-471`)
forwards no `steerActiveTurn` — any fork steer is silently dropped at the
wrapper boundary today. Add at :465:

```ts
steerActiveTurn: inner.steerActiveTurn?.bind(inner),
```

with a `provider-registry-wrap` test case, as its own commit so neither plan's
diff carries it. Upstream #4113 (grab-now pass) adds the same forwarding for
the basket build; the fork branch needs the line regardless.

## 1. ACP items

### #4325 — interrupt settles the foreground turn (iinitd, OPEN)

PARTIAL. Its clear-on-interrupt half is the 2 s/5 s race cancellation plan §3
exists to kill. Its turnId-scoped guards are a subset of §3's proof gate.

- When implementing §3's "finishTurn proves terminal ownership", port the
  drop-before-side-effects shape in `handlePromptResponse`
  (`acp-agent.ts:2847`) so `synthesizeCanceledToolCalls` can't stamp the
  successor's tools — but compare against the stop record's `stoppedTurnId` +
  connection identity, not live `activeForegroundTurnId` (`finishTurn` at
  :2938 clears unconditionally today). Under §3 a successor may already hold
  the slot when proof arrives.
- Steal its three tests (interrupt-settles, late `end_turn`,
  late-`cancelled`-vs-successor-tools) into `acp-agent.test.ts` with
  assertions flipped: a late settlement supplies terminal proof, never clears
  the successor.
- On merge: the `finishTurn` guard becomes a rebase conflict — resolve toward
  §3, keep the tests as regression coverage.

### #4154 — Hermes concurrent-prompt steering (atomlink-ye, OPEN)

TAKE two pieces; REJECT the admission semantics. The wrapper one-liner is §0
above. The echo-suppression and ordering tests are the hardest part of busy-turn
plan §13 — port them, don't re-derive. Admission loses to §6: ACP prompt
completion is not admission.

- Amend §13's test list to port the ordering cases (steer-first;
  original-first with permission release; unresolved-steer-then-Stop) against
  `_gjc/sdk/control` instead of `session/prompt`.
- On merge: upstream hoists `providerParams` and takes the `hermes` registry
  slot; our gjc slot at `provider-registry.ts:802-806` shifts mechanically.

### #4425 — steer reports accepted before validation (IEatCodeDaily, OPEN)

REJECT. It returns `accepted` after awaiting a prompt that resolves only at
turn end — blocks the manager's admission and misreports availability. §13's
`unavailable`-on-failure contract is correct.

- Add one sentence to §13's rationale naming the defect class (steer-ack ≠
  turn-end) so a future executor doesn't reintroduce it.
- On merge: the gjc subclass must neutralize `activeTurnSteerCommand` — gjc has
  no `/steer`; steer is `_gjc/sdk/control turn.steer`.

### #4041 — rescue by session swap (natearizona, WIP)

REJECT the mechanism, TAKE the test matrix. A manager-side session swap hides
the adapter stranding and recreates the "close the ownerless mirror early"
shortcut the cancellation plan rejects (~:114).

- Amend §14's test plan with its coverage matrix — interrupt ack never
  arrives / arrives late / arrives after force-settle — asserting the fork's
  behavior: staged successor rejects, session stays `stopping`, no swap.
- On merge: leave `AgentManagerRescueTimeouts` defaulted and unwired.

### #3278 — close() must not read as user interrupt (frontend-london, OPEN)

PARTIAL. The bug is real — close sends `session/cancel`, producing a synthetic
user interrupt. §7's stop-kind router already replaces the PR's 1-bit flag, and
the CLI/voice blast radius (9 files, 3 packages) is scope the fork should not
absorb.

- Amend §7 Step 1's close bullet to name the failure mode as a required test:
  close during `running` produces no user-visible interrupt and no
  `session/cancel` write. Add that one case to `acp-agent.test.ts`; skip the
  flag, CLI and voice changes.
- On merge: expect a conflict in the `acp-agent.ts` close region — resolve
  toward §7.

### #3091 — await Claude's interrupt ack (Elliotwu-7, OPEN)

PARTIAL. The invariant transfers — synthetic cancel waits for the provider's
ack; turn-id fences late results; same ground as §3, different provider. The
signature flip (`cancelCurrentTurn` `() => void` → `() => Promise<void>`) does
not belong in this changeset: our `claude/agent.ts` diverges ~+82 lines above
:2320 for side-question work, making the flip a rebase hazard and a
cross-package audit.

- Record in the cancellation plan's Unresolved decisions (:763): claude parity
  is its own plan owning the flip plus awaiting `agent.interrupt()` at
  `agent-manager.ts:2790-2812`.
- Steal its three regression tests (ack-before-cancel,
  late-cancel-no-duplicate, completed-turn-no-cancel) as that plan's spec.
- On merge: manual re-apply, not a merge.

### #2993 — `turn_failed.rejected?` (lxsolutions, OPEN draft)

TAKE. Optional server-internal field on the turn_failed `AgentStreamEvent`
variant; the manager skips `lifecycle = "error"` when set. Busy-rejection is
the busy-turn plan's premise — the fork fixes the cause; this caps the damage
when the cause still fires.

- Add to cancellation plan Step 1 (generic half): `rejected?: boolean` on the
  turn_failed variant, set at the prompt-rejection site
  (`acp-agent.ts:1640-1647`); `agent-manager.ts` drops the error branch when
  set.
- Test: a gjc `-32603 data.code:"busy"` rejection leaves health untouched
  while the row still lands in the timeline.
- Order: before the gjc subclass exercises busy rejections — otherwise every
  probe during an ownerless turn strands the agent at error.

### #3366 — prompting a busy agent keeps subagents alive (simonepri, OPEN)

PARTIAL. The concept is the busy-turn premise. The mechanism is a session-level
optional `AgentSession.acceptsPromptDuringAutonomousTurn` plus a manager-side
`hasBlockingRun` — a session property, not a `CAPABILITIES` wire field, so
there is no stub ripple. It is wrong for gjc until the mirror exists: with no
mirror, `activeForegroundTurnId` is null during ultragoal mode, so
`hasBlockingRun` would report unblocked.

- Amend busy-turn plan §8 with a post-condition: once the mirror publishes a
  stable explicit turn id, `GjcACPAgentSession` sets
  `acceptsPromptDuringAutonomousTurn = true` so the manager's foreground-only
  check is correct.
- Test in `gjc-acp-agent.test.ts`: a prompt during an open mirror starts a
  turn and never calls `interrupt`. Order after §8, not with Step 1.
- On merge: cherry-pick the optional field + `hasBlockingRun`; the fork
  supplies the gjc half upstream lacks.

### #3145 — turnSignalParser (snowykr, OPEN, last updated 2026-08-10)

PARTIAL, and the highest-value item. Generic ACP gains opt-in
`subagentUpdateParser` and `turnSignalParser`; the PR's own gjc client consumes
`_gjc/sdk/subagent/update` and `_gjc/sdk/turn/start|end|fail`, registered at
`providerId === "gjc"` — a three-way collision with busy-turn Steps 2–3 (file
name `GjcACPAgentClient`, registry slot `provider-registry.ts:802-806`). The
`turnSignalParser` is the missing-turn-state fix the fork diagnosed and then
reverted (commit `5c7d62df8`), in stronger form: explicit start/end/fail
boundaries instead of `gjcPhase` edge inference off `session_info_update._meta`.

- Amend §8's preamble: the mirror's signal source becomes `turnSignalParser`
  — `start` opens the mirror, `end`/`fail` terminalizes it. Keep `gjcPhase`
  as §11's post-stop idle proof; a signal doesn't prove abort completion, and
  ownerless abort still needs `_gjc/sdk/control`. Don't delete `gjcPhase`.
- Amend Step 3: if #3145 merges, extend upstream's `GjcACPAgentClient`
  (subclass or direct edit) rather than adding a same-named file; if not,
  keep our file but reserve the name. Decide before writing Step 2.
- Adopt `subagentUpdateParser` wholesale for the subagents track; delete any
  fork-equivalent.
- Port its `extNotification` session-id filtering and resume-replay buffering
  tests — both are bugs the fork's mirror would have hit.
- Low merge probability (stale since 08-10) but high impact if it revives.

## 2. UI, layout and stream items

### #3807 — all-hidden persisted layouts (jezifm, OPEN)

Our `workspace-layout-actions.ts` is byte-identical to upstream/main — the
v0.7.2 base already carries the refactored shape — so most of the PR ports
near-verbatim.

- Port `findFirstPane` verbatim (after `normalizeNode` ends, ~:1009).
- Insert the repair in `normalizeLayout` after `root` binds (~:1018): if
  `collectAllPanes(root)` is empty, reveal `focusedPaneId ?? DEFAULT_PANE_ID ??
  findFirstPane(root)` via `updatePaneInTree` with `hidden: undefined`.
  `hidden` is `true | undefined` in this file (never `false` — :321/:662/:685
  all test `=== true`), so `undefined` is load-bearing.
- Leave :1021-1026 alone. Post-repair, `collectAllPanes(root)[0]?.id` is
  guaranteed non-undefined, so the existing `?? DEFAULT_PANE_ID` becomes dead
  but harmless.
- Hand-port only the invariant in `resolvePlacementPane` (:1258-1292); the
  PR's rewrite doesn't fit the current three-branch nullable shape (:1288-1291
  returns null deliberately). Change the assertion message; the repair makes
  :1283's `find(supportsTarget)` total.
- `open-beside.ts` needs nothing: `resolveMainPane` (:41-60) already filters
  `hidden !== true` on all three branches, and the repair is what guarantees
  `store.ensureSidePane` a sibling to split against.
- Tests: the PR's all-hidden rehydration case into
  `workspace-layout-store.test.ts` after :188 (its trailing context line
  doesn't match ours — hand-place). Run
  `npx vitest run packages/app/src/stores/workspace-layout-store.test.ts --bail=1`.

Hazards: `resolvePlacementPane` returning null makes `openTab` a silent no-op
(:1304-1306) — no error, the tab doesn't open, no marker. `updatePaneInTree`
returns the root unchanged on an unknown paneId (:938-940), so a wrong id
turns the repair into a no-op and the new invariant fires on every rehydrate.
If the repair reveals the explorer-sidebar pane instead of `main`, the sidebar
becomes the default placement target — `collectAllPanes(root)[0]` is also what
`setPaneHidden`'s focus handoff (:2060-2062) and placement ordering read.

### #4395 — reflow stream rows on pane resize (yzim, OPEN)

REJECT the mechanism — `Fragment key={width}` remounts every row on first
measurement (0 → measured) and drops row state. TAKE the goal as a width
bucket.

- Take PR hunks 1–3 verbatim: the `setInlineDetailsExpanded` `isNative`
  simplification (`view.tsx:662-675`) and
  `defaultExpanded={expandedInlineToolCallIds.has(item.id)}` on Reasoning and
  both `ToolCallSlot` call sites — upstream's own fix for remount-destroyed
  expand state.
- Hoist measurement to one site — the stream container — rather than per-row.
  Pass a `widthBucket` down through `StreamLayoutItem` and **add it to
  `areLayoutItemsEquivalent`**: docs/agent-stream-performance.md:41-42 is
  explicit that a new field must be added there or layout-item sharing
  silently stops. That equivalence field is the reflow mechanism; no remount
  needed.
- Use `useContainerWidthBelow` (`use-container-width.ts:33-57`), not the raw
  hook — the raw hook returns 0 for `display: none` retained tabs (:4-8 warns
  about exactly this).
- The subagent track is not in `view.tsx` (hosted at `agent-panel.tsx:1272`
  via `agent-tracks.tsx`), so the track-reset concern from the triage doesn't
  apply; what resets is inline tool-call expansion, covered by the hunks
  above.
- Verify with `agent-stream-smoothness.spec.ts` (`PASEO_AGENT_STREAM_PERF_E2E=1`)
  at an iPad-size viewport; extract the bucket function as pure and unit-test
  it.

### #4321 — nested subagent ownership (MERGED 2026-09-04) — rebase-time work

`parentSubagentId` lands in `subagents/select.ts` and `protocol/messages.ts`,
both fork-patched. Ride the next upstream sync; don't cherry-pick — the commit
is in upstream's ancestry.

- `messages.ts`: the features object must carry both `sideConversations`
  (ours, :3474-3475) and `providerSubagentNesting` (upstream's, :3506), each
  with its own `// COMPAT(name): added in vX, remove after <date>` tag. Our
  flag sits ~30 lines earlier than upstream's, so the hunk auto-merges at a
  different position — check both survive.
- `select.ts`: upstream's early return for `providerParentSubagentId` must
  come **before** our `providerRows.length === 0 && sideConversationRows.length
  === 0` fallback (:231-236), and `sideConversationRows` must be excluded from
  the nested-parent view — else a managed agent's side conversations appear as
  children of a provider subagent.
- Re-check every row-kind dispatch keeps `side_conversation`:
  `track.tsx:192-198` (press routing), `:220` (actions),
  `track-presentation.ts:10/:29/:40`, `archive-finished.ts:38-39/:66-67` — and
  `:175-176`, which collects only `provider` and `paseo` ids and silently
  skips side conversations from archive. That joint rots with no marker.
- Upstream also added `turn: Agent["turn"]` to `PaseoSubagentRow` in a
  separate post-v0.7.2 PR riding the same merge — take it or explicitly
  reject it.
- Tests: the PR's nested-children case into `select.test.ts` after :128 (needs
  the protocol field first). Run
  `npx vitest run packages/app/src/subagents/select.test.ts packages/app/src/subagents/track-presentation.test.ts --bail=1`.

Highest-risk joint: fork commit `feb84133b` (side-question forks off the
parent's track) touches the same `opencode-agent.ts` path as this PR's hunk —
a semantic conflict with no markers.

## 3. Order

1. §0 wrapper line, isolated commit. Unblocks steer Tier 1; upstream #4113
   mirrors it.
2. Cancellation plan Step 1 — fold in #4325's guard shape and #2993's
   `rejected` field (both generic-half concerns).
3. Decide #3145 extend-vs-own, then busy-turn Steps 2–3 (gjc subclass).
4. #3366's `acceptsPromptDuringAutonomousTurn` as a post-§8 addendum.
5. Next upstream sync carries the #4321 re-seating. Port #3807 immediately
   after the sync, while `workspace-layout-actions.ts` is still byte-identical
   — that won't last.
6. #4395 last — `view.tsx` carries 48 divergent lines and the #4321 merge may
   shift its render callbacks.
7. #3091 becomes its own claude-scoped plan when `claude/agent.ts` is next
   open.

## 4. Decisions for the owner

1. #3145 namespace: extend upstream's `GjcACPAgentClient`, or keep our file
   under a reserved name?
2. Does `turnSignalParser` replace `gjcPhase` mirroring outright, or stay only
   as §11's post-stop idle proof? (Research recommends the latter — a signal
   doesn't prove abort completion.)
3. Does the fork adopt `providerSubagentNesting` at all? `side_conversation`
   rows are already a parent-child mechanism; declining the gate shrinks the
   #4321 change and removes the ordering hazard in `select.ts`.
4. `agent-sdk-types.ts` (touched by #2993) — is it on the rebase hot list?
5. Write the claude-parity plan (#3091) now, or defer until `claude/agent.ts`
   is next open?
