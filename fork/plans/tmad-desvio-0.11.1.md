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
3. Publish `mine` through the existing fork workflow, verify all seven exact npm packages, and package both desktop architectures plus Android from the verified runtime source. Record each artifact’s exact assembly SHA.
4. Deploy staged Intel bundles on Eris and Neptune first. Use detached launchd jobs and verify app/daemon version, code signature, health, and WebSocket upgrade. Deploy Saturn through launchd with a one-time continuation for the deploying agent. Deploy Linux hosts serially and verify each before continuing.
5. Record the exact source SHA, versions, check results, deployment results, and any remaining evidence gaps here.

Physical iOS/Android captures, Korean UI review, voice-device capture/playback, credentialed provider E2E, and live-home migration behavior remain unverified. The copied-home probe and fake-provider E2E do not establish those results. Back up each live home before changing its daemon version.

## Candidate validation

Server/app dependencies build, typecheck, lint, and formatting passed. All 30 focused suites passed serially; the adapted native audio and prompt suites also passed (3 and 17 tests). The two-client queue E2E passed both tests. The synthetic-home startup/recovery probe recovered `pending-copy-1` at revision 1 with identical queue bytes before/read/stop and zero fake-provider turns. It first creates an isolated fake agent so the queue fixture references a real persisted record.

Clean-checkout CI caught the missing native-audio declaration build; app `pretypecheck` now owns it. The carried script-health fixture now implements terminal activity. Pluto's Speak expectations retain upstream's deliberately independent voice-tool policy. The Hub leak check tracks newly acquired subscriptions: closed setup clients can expire after the 90-second reconnect grace, making an exact total subscriber count nondeterministic. These are build/test adaptations; they do not change deployed runtime behavior.

## Built and deployed

The final source is `mine@db4a750601fcd110ebec663536a66d643bc26acc`, assembled from carry `b0b92121ba4410b1392e65a9afb0e6d44bb56326`. Desvio assembly, full typecheck and lint passed. Neptune’s active manifest contains `fork/tmad-0.11.1` after the four existing entries. It retains the `v0.11.1` base.

Both signed desktop bundles are `0.11.1-mine.261008-1523`, built from assembly `2c554ab82356116d0430baa29f28c0f0713c5235`. Its runtime source matches the final assembly exactly; the final delta contains tests and delivery evidence. The ARM bundle also passed isolated health and WebSocket startup checks. Intel bundles were staged before the build tree was reassembled.

All seven exact `@camerontaylor/paseo-*` packages are published as `0.11.1-fork.2`. [Publication run 37728821931](https://github.com/camerontaylor/paseo/actions/runs/37728821931) succeeded; the release tag points to the final assembly. `latest` advances with publication; the optional `fork` dist-tag update was denied by npm’s trusted-publisher permissions.

| Host | Installed version | Verified |
| --- | --- | --- |
| Saturn, Neptune, Eris | `0.11.1-mine.261008-1523` | Signed app, daemon version, IPv4/IPv6/localhost/Tailscale health 200, WebSocket 101; external daemon ownership retained |
| Ceres, Makemake, Pluto | `0.11.1-fork.2` | Exact systemd pin, active service, daemon version, IPv4/IPv6/localhost/Tailscale health 200, WebSocket 101 |
| Quaoar | Previous version | Host offline; not deployed |

Each reachable host’s durable home was backed up before replacement. Mac deployment logs are `~/.paseo-fork/deploy-<host>-0.11.1-mine.261008-1523.log`; Linux logs are `~/.paseo-fork/deploy-tmad-fork.2.log`. Completed Mac deployment jobs were retired. Saturn’s one-time continuation resumed this conversation after its daemon restart.

Pluto’s tracked NixOS pin and authoritative manifest were committed and pushed to infra `main` (`8ea923d`, integrated as `7b38f27`). The new system closure is `b8csffip3bmvxscxrab0xz1zvfzxybhz`; the closure change was limited to Paseo, and no failed system units remained. Package-age exceptions on Pluto and Makemake were temporary and scoped to the verified package.

Android’s release build succeeded from the final assembly. Signature verification passed for `sh.paseo.debug`, version `0.11.1`, code `11001`, ARM64. Artifact: Neptune `~/.paseo-fork/Paseo-debug-0.11.1-tmad-db4a75060-arm64.apk`; SHA-256 `30815b3d4e907c38f90c3bb38018f01a001d1f3364ccc0206f9441ccc636ae44`. Taildrop delivery to `camerons-s24` succeeded, recorded in `/tmp/paseo-tmad-android-delivery.log`. Phone installation and device QA remain unverified.

## CI limits

[Final CI 37728476105](https://github.com/camerontaylor/paseo/actions/runs/37728476105) passed typecheck, lint, formatting, Linux server tests, macOS watcher tests, app tests, SDK, relay, all CLI shards, and both desktop suites. Windows passed 6,359 tests and failed one unchanged worktree-bootstrap assertion comparing the equivalent `RUNNER~1` and `runneradmin` temporary paths.

Final browser results:

| Shard | Passed | Failed | Remaining failures |
| --- | --- | --- | --- |
| 1 | 157 | 2 | First-prompt authoritative hydration and upward-scroll position |
| 2 | 196 | 1 | Chat-find setup locator matches both user row and pinned prompt; one other test passed on retry |
| 3 | 160 | 2 | Pinned-prompt transition and archived side-conversation removal; two other tests passed on retry |
| 4 | 195 | 5 | Four viewed-timeline locators match both user row and pinned prompt; nested script completion timeout |

The side-conversation archive failure also occurs in pre-port [baseline CI 37718194103](https://github.com/camerontaylor/paseo/actions/runs/37718194103); the carried broadcast unit test passing does not establish the browser archive flow. The baseline also failed upward-scroll position. The other failures remain unresolved; do not label them baseline failures without matching evidence. CI completed with failure. Two CodeRabbit attempts failed to connect to its review service; neither produced a review verdict.
