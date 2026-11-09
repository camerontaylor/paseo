APPROVE

# Review: TM-03 queue UI and cross-device behavior — `intake/tmad-queue-ui`

Reviewer: read-only audit. No files edited except this report, nothing built
or run, no commits, no pushes, no ref changes. All verification by read-only
git inspection (`rev-parse`, `show`, `diff`, `merge-base --is-ancestor`,
`grep`, `log`) against `/home/ctaylor/repos/paseo`, reading source files at
pinned refs, and reading the implementer's logs under `/tmp/tmad-port/logs/`.
Branch HEAD at review time: `9ab91bb759be1951bdaa9cbe7bc991cafed2569d`
(matches the report's claimed HEAD). Declared base: TM-02 APPROVED head
`91392d6beed3fc49f9be7496a70b8d5822957d4c`.

Read first, in order: `COMMON.md`, `plan.md` ("Queue and composer" contract,
P4, "Branch and removal contract", TM-02 daemon contract), `brief-TM03.md`,
`evidence/TM-03.md`, `evidence/TM-02.md`, `evidence/review-TM-02.md`.

## 1. Ancestry — PASS (7 commits, no extra ancestry)

| Ref | Check | Result |
| --- | --- | --- |
| `intake/tmad-message-queue` head `91392d6be` | `rev-parse` both | Identical SHA — base IS the approved TM-02 head ✓ |
| `rev-list --count 91392d6be..HEAD` | count | 7 ✓ |
| custom `cbd1210c7` | `merge-base --is-ancestor` | ANCESTOR (through TM-02 floor) ✓ |
| `v0.11.0-beta.3` `6166a7aca` | `merge-base --is-ancestor` | ANCESTOR (through custom) ✓ |
| source integration `51fb7693d` | `merge-base --is-ancestor` | NOT ancestor ✓ |
| source head `f0d5507d2` | `merge-base --is-ancestor` | NOT ancestor ✓ |
| `929f1add3` (tmad-main-latest) | `merge-base --is-ancestor` | NOT ancestor ✓ |
| `mine` `4cc94e07e` (= `origin/mine`, same SHA) | `merge-base --is-ancestor` | NOT ancestor ✓ |
| `intake/tmad-stream-flow` | both directions | NEITHER is ancestor of the other ✓ |

Linear history, no merges (`git log --merges base..HEAD` empty). The
`git log --oneline` matches the report exactly (7 commits, same SHAs and
subjects). Custom and beta.3 reach HEAD only via the TM-02 head, which is
the declared and only prerequisite.

Trailers: all six feature/test commits carry `Source-Repo: tmad4000/paseo`,
`Source-Commit: 51fb7693d…`, `Port-Feature: TM-03`. The docs commit
`9ab91bb75` carries `Port-Feature: TM-03` only — acceptable for a local-only
file (same convention accepted in the TM-02 review). Non-blocking note only.

## 2. Canonical submission ownership — PASS

- `dispatchComposerAgentMessage` (actions.ts:220) is byte-untouched: the
  base..HEAD diff on `actions.ts` has hunks only at imports, the
  `QueuedComposerMessage` interface, and the appended queue section
  (@@ line 436+). The submit path (`submit.ts`, `composer/input/`) has an
  empty diff — untouched.
- Queue admission (`queueComposerMessage`, actions.ts:264) writes only to
  the queue writer (`input.queue.write`, new id via `generateMessageId`);
  no submission writer is referenced anywhere in the queue section.
- `queueComposerMessageOnServer` (actions.ts:550): optimistic queued row +
  outbox-first write + `enqueueAgentMessage` with explicit `intent: "queue"`,
  then `applySnapshot`. On failure with an outbox present it keeps the row
  (durable retry path); without an outbox it rolls back the optimistic row.
  Never creates a timeline row.
- Tests present on the branch: actions.test.ts:1124 "admits with the
  explicit queue intent and never touches a submission writer",
  session-store.test.ts:909 "never creates a submitted timeline row:
  snapshots only touch the queue", and the e2e asserts exactly one
  canonical `user_message` carrying the edited text after drain
  (`expect(userRows).toHaveLength(1)`, e2e test file :251).

## 3. Capability gating — PASS

- Every durable path gates on `features.durableAgentQueueV1`:
  composer selector (index.tsx:1532) and session-context flush
  (session-context.tsx:582). Both call sites carry dated
  `COMPAT(durableAgentQueue)` comments naming TM-02/TM-03.
- Against old hosts the composer keeps the existing local in-memory queue
  with today's rendering/actions; the outbox is written only in durable
  mode. Nothing labels the legacy queue durable (glossary Queue-track entry
  states both meanings explicitly).
- Protocol diff base..HEAD is EMPTY (no new wire fields — this branch adds
  none, as required). Server diff is exactly one additive file: the e2e
  test. TM-02's wire contract is consumed unchanged.

## 4. Controls and revisions — PASS

- Edit = take (delete + image rehydration via `persistImage`, draft
  recovery through returned `{text, attachments}`); reorder = full-id-list
  `agent.queue.reorder` from the row menu; delete = confirmed
  `agent.queue.delete` (`confirmDialog`); send-now = take-then-submit.
  Every mutation sends `expectedRevision`; `queue_revision_conflict`
  maps to a visible `conflict` outcome plus queue refresh — never a silent
  overwrite (index.tsx:1857-1858, 2228-2229, 2283-2284).
- `isQueueRevisionConflictError` branches on the machine-readable error
  code surfaced by the new daemon-client helpers (no prose parsing).
- Outbox exhaustion: `QUEUE_OUTBOX_MAX_ATTEMPTS = 8` (model.ts:48);
  entries park with `failedAt` instead of being dropped (model.ts:101-102),
  flush skips failed entries, `retryFailedOutboxEntry` is the explicit
  retry. Daemon `failed`/`uncertain` rows show `<StatusBadge>` +
  last-error + Retry/Discard (index.tsx:748-750, 791-864).
- Steer/Queue/Interrupt affordances: no diff hunks touching them (grep for
  steer/interrupt in the index.tsx diff returns only queue-track lines).
- Typed-send default UNCHANGED: `sendBehavior: "steer"` identical in
  branch, base, and source (`storage.ts` diff base..branch is empty);
  source-vs-ours comparison present in the report (§"Typed-send default
  comparison"). The worker correctly made no product decision.
- Draft attachments / edit recovery: `userAttachmentsOnly` filtering and
  image rehydration preserved through take (actions.ts:308, 681);
  `plugin_resource` passthrough kept in queue-sync mapping.

## 5. Two-client daemon e2e — PASS

- Re-anchored on the in-process harness (`createDaemonTestContext`,
  `DaemonClient` from `../test-utils/`, fake permission request parks the
  turn) — no provider credentials, consistent with
  docs/ad-hoc-daemon-testing.md. No `claude`/credential references in the
  test file.
- Coverage confirmed by reading the test: enqueue/edit/reorder/delete
  across two clients, `agent.queue.update` mirroring, fresh-client
  reconnect via `agent.queue.list`, drain to one canonical row, plus a
  stale-revision conflict test.
- Log pair `tm03-test-e2e-8.log` / `tm03-test-e2e-9.log`: 2 passed twice
  (22:16, 22:19). Earlier runs e2e-1..4 (1 failed of 2), e2e-5 (error),
  e2e-6 (1 failed) are honestly part of the iteration trail; e2e-7 was the
  first green run and 8/9 are the claimed stability re-runs. The report does
  not hide the failing runs — they exist in `logs/` and the report's claim
  is scoped to the final pair. Supersession is honest.
- Coverage split for capability-absent behavior (TM-02 parse-compat +
  existing local-queue tests rather than an old-client e2e) is documented
  with rationale. Accepted — forcing it into the e2e would need capability
  overrides the test client does not have.

## 6. Localization and docs — PASS

- `composer.queued.*` (12 keys: menu, moveUp/Down, delete, discard, retry,
  sending, unconfirmed, failed, changedOnAnotherDevice, deleteTitle,
  deleteMessage) present in ALL nine locales; key-name parity verified by
  extracting the `queued: {…}` block per locale — all 8 non-en locales
  match en exactly. Each locale file is +14 lines (12 keys + block lines).
- `docs/queue-mirroring.md` gains the composer-side contracts (snapshots
  replace/outbox survives, outbox as durable copy, exhaustion parking as a
  deliberate source divergence, downgrade behavior). `docs/glossary.md`
  gains the Queue-track entry (durable vs legacy meanings distinct) and the
  Steer cross-reference keeps the forbidden terms ("Delivery",
  "Queued prompt" not used as labels — confirmed absent from UI copy grep).
  Terminology matches the plan ("durable" vs "legacy"/"local in-memory").

## 7. Provenance and evidence — PASS

- Ledger recomputed: all five source blobs at `51fb7693d` match the
  reported values exactly (`3d6130d6…`, `8b278e1a…`, `ce83ee9c…`,
  `64537da4…`, `6d6b7707…`); all five local blobs differ (adapted, as
  claimed — no false byte-identical claim). The
  `51fb7693d..f0d5507d2` diff on the queue UI paths is empty, confirming
  the "newer head is byte-identical" claim.
- Exclusions verified present-as-absent: no `interrupt?: boolean` on sends
  (no "interrupt" in the protocol/server diff or daemon-client queue
  section), no `voiceOwner`/`wrapSpokenInput`/`waitForPendingDispatch`,
  no `companion`/`viewArtifacts`/`selectedViews`/Stream references in the
  app diff, side-conversation handlers preserved in session-context
  (diff shows only additive queue subscription + flush + unsub).
- Cited logs match claimed results (tails read):
  app 8 files/177 passed, server 4 files/56 passed, protocol 9 passed,
  typecheck 0 `error TS`, scoped lint 0 warnings/0 errors.
- Source-vs-ours typed-send comparison, PR #36 classification, six known
  gaps, and the two design calls (send-now via take+submit; exhaustion
  parking) are all recorded with rationale inside the plan's fences.

## Findings

No blocking findings. Non-blocking notes (no code action required):

1. (non-blocking) Prior-commit trailer gap, same class as TM-02 §6.1: the
   local-only docs commit carries `Port-Feature` without `Source-*`
   trailers. Correct as-is; recorded here for the ledger.
2. (non-blocking) The optimistic-row race (broadcast between optimistic add
   and `outbox.add` briefly erases the row, self-heals on the enqueue
   response snapshot) is inherited from the source and honestly documented
   as gap #4. A future hardening could write the outbox entry
   synchronously before the image-encoding await; not required for approval
   since the window is small and self-healing.
3. (non-blocking) Gap #6 (no browser/native screenshot evidence for the new
   badges/menu rows) is openly declared; a human pass on the dev app is the
   natural next check, per the report.

## Not verifiable read-only

Test execution itself (relied on the logs above — no `npm`/`vitest` run
per the read-only constraint); live two-device daemon interop and
crash-recovery behavior; native rendering of the new queue-track controls;
the PR #36 update-loop candidates (correctly deferred, not claimed).

## Plan contracts — PASS

- Native Find / Stream independence: no companion/Stream references added;
  removal group is additive queue files + narrow seams (composer actions,
  session-store snapshot applier, session-context subscription/flush,
  daemon-client helpers, i18n, docs, e2e test). No removed scaffold
  resurrected; no Stream dependency in either direction.
- Queue removal (TM-02 + TM-03 + descendants) remains coherent: this branch
  layers strictly on the TM-02 head with no other ancestry.
- The branch respects its lease: no protocol change, no typed-send flip, no
  silent deletion at the retry cap, no manifest edit, no push, no daemon
  restart, no full-suite run.
