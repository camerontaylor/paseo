# tmad port work items — 2026-10-04

Single owner of tracking status for the maintained `tmad4000/paseo` feature ports. The
[intake plan](tmad-maintained-port-plan.md) owns the policy (branch order, contracts, update loop,
acceptance bars); this file owns the state. Per-feature provenance (full blob tables, seam tables,
command logs) lives in the [tmad-port/evidence/](tmad-port/evidence/) directory and is referenced per row — this
file carries the summary each future sync or removal needs. The `TM-` IDs are stable across branch
renames. Where this file and a branch's manifest comment disagree, this file wins until the next
reviewed manifest rebuild.

**Location note:** the plan places this ledger on `custom`. It is drafted and maintained on the
`tmad-port/coordination` branch (with all evidence) because nothing is pushed to `custom` during
the port; landing it on `custom` (plus the [fork README](../README.md) link) is a promotion step for
the user. It relates to [feature-ledger.md](feature-ledger.md) as follows: that ledger owns
behavior absorbed into `custom`; the branches tracked here are manifest carries, which stay outside
`custom` by design. If a carry is ever absorbed into `custom`, its ownership moves there and this
row is marked disabled, not deleted.

## Source cursors

| Cursor | Value |
| --- | --- |
| Source repository | `tmad4000/paseo` |
| Frozen intake snapshot | `f0d5507d2` (`refs/research/tmad-main`) |
| Last source head inspected = fully classified | `929f1add3` (`refs/research/tmad-main-latest`, PR #36 — classified 2026-10-03, see below) |
| Effective source snapshot, all ported features | `51fb7693d` (source PR #21 integration); TM-01 rehearsal boundary `af247e4f4` (PR #19) |
| Desvio release base | `v0.11.0-beta.3` = `6166a7aca` |
| Custom floor (queue/voice lineage) | `cbd1210c7` — recorded at TM-02 intake |

## Integration state

| ID | Branch | Base | HEAD | Verdict | Removal group |
| --- | --- | --- | --- | --- | --- |
| P0 | `tmad-port/baseline-assembly` (on origin) | frozen manifest SHAs (`tmad-port/evidence/P0-inputs.txt`) | `2bfcd2e19` | APPROVED ([review](tmad-port/evidence/review-P0.md); 3 non-blocking dispositioned) | — (baseline, not a feature) |
| P2 | `tmad-with-stream` (clone-local, `/tmp/tmad-port/baseline-clone`) | P0 `2bfcd2e19` | `0ff83cbc5` | APPROVED ([review](tmad-port/evidence/review-P2.md)) | — (with/without proof) |
| TM-01 Stream | `intake/tmad-stream-flow` (on origin) | `6166a7aca` (release) | `a8241e535` (10 commits) | APPROVED twice ([review](tmad-port/evidence/review-TM-01.md), [delta](tmad-port/evidence/review-TM-01-delta.md)) | Stream |
| TM-01B bridge | not created | — | — | NOT NEEDED (TM-01 green on beta.3 alone) | Stream |
| TM-02 queue daemon | `intake/tmad-message-queue` (on origin) | custom floor `cbd1210c7` | `91392d6be` (6 commits) | APPROVED ([review](tmad-port/evidence/review-TM-02.md); no blocking) | Queue+Voice |
| TM-03 queue UI | `intake/tmad-queue-ui` (on origin) | TM-02 `91392d6be` | `9ab91bb75` (7 commits) | APPROVED ([review](tmad-port/evidence/review-TM-03.md); 3 non-blocking) | Queue+Voice |
| TM-04 voice flow | `intake/tmad-voice-flow` | TM-02 `91392d6be` | in flight | NOT DONE — see row below | Queue+Voice |
| TM-07 native find | `intake/tmad-native-find` (on origin) | `6166a7aca` (release) | `5f3634ad4` (1 commit) | APPROVED ([review](tmad-port/evidence/review-TM-07.md); no findings) | Native Find |
| TM-05, TM-06, TM-08+ | not started | — | — | Product decisions for the user; do not start | — |

Allowed ancestors, verified per report and re-checked by each reviewer: TM-01/TM-07 have only the
pinned release (custom, mine, and `51fb7693d` are NOT ancestors). TM-02 has only the custom floor.
TM-03 (and TM-04 when it lands) have only the TM-02 head; `intake/tmad-queue-ui` and
`intake/tmad-voice-flow` are siblings — neither may carry the other.

## Feature rows

### TM-01 — Stream/artifact vertical slice (`intake/tmad-stream-flow`)

- Source: PR #19 (`af247e4f4`) reconciled to #21 (`51fb7693d`); effective snapshot `51fb7693d`.
  Disposition: adapted (10 of 15 core files byte-identical to source; 4 intentional deltas —
  pin/manual-entry/artifact bounds, feed localization + Stream-pin glossary, agent-view-store
  narrowing, collector turn cap — each with rationale in the [report](tmad-port/evidence/TM-01.md)).
- Key seams (owner table in the report): agent-panel integration, accepted-event capture in
  `agent-manager.ts` (post-coalescer, fire-and-forget artifact collection — restored by `a8241e535`
  after the P2 assembly caught the await regression), storage/projections (incl. the strict-cache
  schema fix the source lacked), protocol delivery (flat `update_companion_entry_request` renamed
  to `agent.companion.update_entry.request/.response`; single `companionStreamPortV1` gate; source
  capability names absent by test), file navigation (no watcher; bounded end-turn scan + explicit
  CLI backfill).
- Tests carried/adapted: companion model/server suites, collector, backfill, auth index (7),
  protocol messages (artifacts + renamed-RPC), locale parity (10 locales), capability-absent gate.
- Runtime requirement: gate `server_info.features.companionStreamPortV1`.
- Human gates (promotion-blocking): matched source/port UI captures (desktop + compact web),
  native captures, locale parity screenshots incl. ko; informational decisions on the "Queue" tab
  label and the 100/200 ceilings.

### TM-02 — durable agent message queue (`intake/tmad-message-queue`)

- Source: PRs #23–26, #30–32 at `51fb7693d`; source head (`f0d5507d2`) queue files are voice-coupled
  and were NOT taken (recorded per-delta in the [report](tmad-port/evidence/TM-02.md)). Disposition:
  adapted — explicit `intent` on admission (no queue-by-omission), claim-in-place dispatching with
  per-attempt receipts, `uncertain`/`failed` states (8-attempt park, no silent deletion), revision
  guards, startup recovery without dispatch, journal + 0600 atomic writes, archived-agent fence,
  strict steer via the existing admission (refusal never interrupts or deletes).
- Legacy contract: `send_agent_message_request` without queue intent keeps the beta.3
  receipt-backed interrupt path — the source's queue-on-omission and receipt-service omission are
  deliberately not copied (tested).
- Wire: `agent.queue.*` dotted set (`list/update/delete/reorder/retry/send_now` + subscribable
  `agent.queue.update` event); feature flag `durableAgentQueueV1`, client capability
  `durable_agent_queue`; source flat `agent.queue.remove` renamed `delete`.
- Tests: queue store/service/send-or-queue suites (49), protocol sub tests (9), auth (7),
  ACP 130 / GJC 43 / agent-manager 210 on the custom floor.
- Known gaps carried: daemon e2e was re-anchored on the fake-provider harness in TM-03; the
  pre-existing `session.test.ts` side-conversation failure at the floor needs its owner (neptune).
- Removal note: removal group Queue+Voice — TM-03/TM-04 depend on this branch even if their own
  lines are commented.

### TM-03 — queue UI and cross-device behavior (`intake/tmad-queue-ui`)

- Source: same queue PR set; every queue UI file at the source head is byte-identical to
  `51fb7693d`, so the integration snapshot is the complete source UI. Disposition: adapted —
  outbox entries carry intent and park visible as failed at exhaustion (source drops silently);
  revision-guarded edit/reorder/delete/retry with visible conflict handling; take-into-composer
  edit/send-now; delivery-state badges. Source's `interrupt?` wire field (PR #32) NOT taken
  (protocol change outside the lease); typed-send default verified identical to ours — unchanged.
- `dispatchComposerAgentMessage` untouched; queue admission never creates a submitted timeline row;
  drain yields exactly one canonical user row (e2e-asserted).
- Tests: composer/actions + queue-sync + outbox model + session-store (177 app), queue + auth
  server (56), protocol (9), two-client mirroring + revision-conflict daemon e2e on the
  fake-provider harness (2, run twice).
- Human gate: browser/native screenshot pass on the new queue UI (badges, row menu, failed overlay).
- Update-loop candidates from PR #36 (`929f1add3`): waiting-to-sync gating, per-agent blocking
  flush, await-outbox-persistence before clearing the draft, exhaustion-UX product call. Classified,
  not ported.

### TM-07 — native Find wrapper (`intake/tmad-native-find`)

- Source: #11 as delivered by `51fb7693d`; six core files byte-identical to source (incl.
  `strategy-native.tsx`, viewport, matches + tests); shared seams adapted to exclude every Stream
  artifact (full exclusion table in the [report](tmad-port/evidence/TM-07.md)). Uses the existing
  search model/RPC (`agentHistorySearch` upstream flag; no new wire surface, protocol untouched).
  No Stream dependency in either direction (grep-verified).
- Known adapted merge on promotion: `agent-view-store.ts` (`findOpen` here vs TM-01's
  `selectedViews`) and `workspace-tab-menu.ts` — expect a small adapted merge, planned in P2 follow-up
  assembly work; documented by both branches.
- Human gate: the 10-point native device list in the report (reachability, historical-match reveal,
  wrap-around, cleanup, older-host, keyboard, rotation, non-Latin locales).

### TM-04 — voice flow (`intake/tmad-voice-flow`) — IN FLIGHT

- Source: PRs #13, #15, #22, #23 (NOT #14 iOS background = TM-06, NOT #17 mute = TM-05).
- State: first worker died leaving uncommitted WIP; recovered verbatim as wip commit `6ab56eba1`
  on the branch (content byte-verified against `origin/backup/tmad-voice-flow-wip-2026-10-04` =
  `fa9dac92b` and a tar). A fresh implementer is auditing the WIP against the brief and rebuilding
  proper history. **This row, its review link, and its manifest line are completed only after its
  gates pass.** Base: TM-02 `91392d6be`; only allowed extra ancestry.

## Source-change classifications

- `929f1add3` (PR #36, queued-message durability hardening): fully classified 2026-10-03. Covered
  in stronger form by TM-03 (visible parked failure, revision-guarded reconciliation, intent-carrying
  resends); four remaining candidates listed in [TM-03.md](tmad-port/evidence/TM-03.md). Not ported.
- Source head deltas beyond `51fb7693d` deliberately not taken (recorded per branch): TM-02 —
  finish-notification queueing, `paseo-tools` queue integration, voice-coupled queue fields;
  TM-03 — `interrupt?` wire field, session-store upstream noise; TM-07 — unrelated upstream layout/
  presentation changes.

## Base moves

- Custom moved `cbd1210c7` → `24f134618` (2026-10-04): plugin-SDK feature + fork docs. The delta
  touches plugins only (`plugin-provider.ts` and wiring) — no tmad port seam. Recorded floors stand;
  re-anchoring the queue root onto the new custom tip is a future update-loop batch per the plan
  ("merge the updated custom branch into the queue root, then update dependents in order"), with its
  own review.
- No upstream release move; `v0.11.0-beta.3` remains the release base for TM-01/TM-07.

## Manifest append block (DRAFT — nothing live edited; frozen copy in
[evidence/manifest-frozen-2026-10-02.txt](tmad-port/evidence/manifest-frozen-2026-10-02.txt))

```text
# Existing community, custom and infi lines retain their current order. APPEND BELOW THEM.
intake/tmad-stream-flow       # TM-01 a8241e535; source snapshot 51fb7693d reconciled; base v0.11.0-beta.3; removal group Stream (no bridge needed).
intake/tmad-message-queue     # TM-02 91392d6be; custom floor cbd1210c7 (recorded); removal group Queue+Voice (with TM-03/TM-04).
intake/tmad-native-find       # TM-07 5f3634ad4; source snapshot 51fb7693d; base v0.11.0-beta.3; removal group Native Find (independent of Stream and queue).
# TM-03 and TM-04 lines are added in dependency order only after their own gates; voice device evidence is a promotion gate.
```

Each line is valid only after its branch's Muse Spark review; assembly validation (P2-style with/
without rebuild) is required per removal group before any live manifest edit. The queue/voice group
still owes its own removal exercise with pending items present (plan P2 step 5) before promotion.

## Remaining human checks (complete list)

- TM-01: matched source/port UI captures (desktop + compact web), native captures, locale parity
  incl. ko; two informational decisions ("Queue" tab label; pin/artifact ceilings 100/200).
- TM-02: owner classification of the pre-existing `session.test.ts` side-conversation failure at
  the custom floor.
- TM-03: browser/native screenshot pass on the new queue UI.
- TM-04 (when done): its report will list the physical-device and per-provider checks (mic,
  playback, echo, lock/background, reconnect, owner contention; Claude, Codex, ACP/GJC) plus a
  rebuilt native dev client for the `expo-two-way-audio` changes.
- Promotion (P6): land this ledger + evidence on `custom`; queue/voice removal-group exercise with
  pending items; P2-style assembly validation of the final manifest block; the human evidence gates
  above. No push to `mine`, no live manifest edit, no production restart is authorized by the port.
