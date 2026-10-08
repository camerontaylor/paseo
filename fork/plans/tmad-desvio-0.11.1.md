# Pluto TMAD delivery on Desvio v0.11.1

The user authorized adding the completed Pluto ports to the live Desvio plan, building the full basket, and deploying it on 2026-10-08. This delivery supersedes the historical no-promotion boundary in the copied Pluto evidence; it does not claim the outstanding device/provider checks passed.

## Build inputs

Keep Neptune's existing manifest order: `custom`, `fork/carries-0.11.1`, `fork/infi-backend-0.11.1`, `fork/infi-ui-0.11.1`. Append `fork/tmad-0.11.1`, based on the reviewed current basket `b388a10a742f7104d613facbc6661da17abfb839`. Keep `DESVIO_BASE=v0.11.1`. Do not merge Pluto's older upstream or external-carry ancestry into this basket.

Port the feature delta from Pluto P0 `2bfcd2e19638484baf1651d69dc0be55df483bcd` to full approved basket `9584b2a669ce90a5df8c9eac66073e85124e90bb`. Exclude older custom/plugin/release-tooling changes: the current `custom` already owns those subjects. Preserve attribution through these refs and the copied [Pluto evidence](tmad-port/evidence/P6-assembly-2026-10-08.md).

| Work | Reviewed input | Delivery |
| --- | --- | --- |
| TM-01 Stream/artifacts | `a8241e53530d6bd0a958971118d6b8b57ff80b0c` | UI, bounded storage, localized labels, optional wire facts, capability gate, artifact scan CLI |
| TM-02 durable queue | `91392d6beed3fc49f9be7496a70b8d5822957d4c` | Daemon-owned queue, receipts/recovery, dotted RPCs, permissions |
| TM-03 queue UI | `9ab91bb759be1951bdaa9cbe7bc991cafed2569d` | Revision-guarded snapshots, durable outbox, delivery badges, queue actions |
| TM-07 native Find | `5f3634ad43256c18f9f41667348c65fe1b03d7f4` | Native viewport, historical matches, menu and tab plumbing |
| TM-04 voice flow | `84f11381ceabec13d5deaff6c1e2c05dc67a6c62` | Independent capture/playback lifecycle, queued speech, receipt reconciliation, generation ownership, failure cues |
| Side-conversation repair | `fddb4fa8587ae377286ffbea3137df4c53bdc7a9` | Deliver update/removal events to capable attached clients |
| Assembly test fix | `e423a8666a30075a584f4a8e6f646a28054e6af0` | In-memory AsyncStorage in the existing session suite |
| Assembly startup fix | `9584b2a669ce90a5df8c9eac66073e85124e90bb` | One shared receipt owner injected before queue activation |

The adapted branch carries the complete reviewed integration, including the menu union and duplicate queue-client cleanup. It is one manifest entry because the final Voice/Queue receipt wiring was reviewed as a basket. TM-05/06/08 and the typed-send default change were never implemented and remain outside this delivery.

## Adaptations to the current base

Upstream #5976 moved audio to `src/audio` and introduced shared plugin/voice playback. Keep that implementation; port cancellation during preparation into its shared queue, and retain browser microphone-track loss reporting. Port the existing Pluto regression tests to that module. Keep upstream #6255 archive rollback while adding queue preparation failure classification. App typecheck builds the native audio workspace first: the static import needs its generated declarations on a clean checkout, including CI and Desvio.

## Verification and deployment

1. Build server and app dependency stacks; format, typecheck, lint. Run focused changed-file protocol, queue, receipts, side-conversation, voice, audio, and Find tests serially. Run a synthetic-home daemon startup/recovery probe.
2. Push the durable carry branch. Append it to Neptune's manifest without reordering existing entries. Run `desvio build`; assert its result matches the tested tree. Run remote CI on the candidate; do not run full suites on a workstation.
3. Publish `mine` through the existing fork workflow, verify all seven exact npm packages, and package both desktop architectures plus Android from the same SHA.
4. Deploy the Saturn canary using its detached launchd job. Verify app/daemon version, code signature, health, and WebSocket upgrade. Deploy Linux hosts serially and verify each before continuing. Deploy Neptune through its detached launchd job and verify from Saturn.
5. Record the exact source SHA, versions, check results, deployment results, and any remaining evidence gaps here.

Physical iOS/Android captures, Korean UI review, voice-device capture/playback, credentialed provider E2E, and live-home migration behavior remain unverified. The copied-home probe and fake-provider E2E do not establish those results. Back up each live home before changing its daemon version.

## Candidate validation

Server/app dependencies build, typecheck, lint, and formatting passed. All 30 focused suites passed serially; the adapted native audio and prompt suites also passed (3 and 17 tests). The two-client queue E2E passed both tests. The synthetic-home startup/recovery probe recovered `pending-copy-1` at revision 1 with identical queue bytes before/read/stop and zero fake-provider turns. It first creates an isolated fake agent so the queue fixture references a real persisted record.
