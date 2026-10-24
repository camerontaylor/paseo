# TMAD intake → Desvio promotion transaction

Prepared 2026-10-25 for review. **Nothing below has been executed against
production: no publish, no tag, no push, no manifest change, no restart.**
This document is the concrete transaction the release review approves.

## Source and version

| Item | Value |
| --- | --- |
| Candidate tip (carry) | `fork/tmad-2026-10-24-integration` = `fork/tmad-2026-10-24-carry` = `6e070f7b10937ace90f4c7226136ed9189e37245` (triton `/home/ctaylor/repos/paseo-tmad-integration`) |
| Release version | `0.12.0-fork.2` — resolved by `release-fork.mjs --fork-number auto` from the `@camerontaylor` registry union (all 7 packages at `0.12.0-fork.1`); matches the manual check of `npm view` |
| Dry-run | 2026-10-25, triton, `FORK_SCOPE=@camerontaylor`: 7/7 GATE PASS, web-ui assets present, staged `paseo --version` = `0.12.0-fork.2`; no publish/tag/push (`/tmp/paseo-d10-dryrun3.log` on triton) |
| Prior release | `0.12.0-fork.1` = `568972505113179d03cc6e2c2c899ba16243cc42`, tag `fork/v0.12.0-fork.1`, published 2026-10-20 |

Note: the first dry-run without `FORK_SCOPE` defaulted to `@paseo-fork` and
resolved `fork.1`; the CI publish workflow sets `FORK_SCOPE=@camerontaylor`,
which is the resolution above. Any local dry-run must set the same env.

## Manifest transaction (neptune, after authorization)

Live `~/.paseo-fork/desvio.conf` manifest, currently:

    origin/custom
    origin/upgrade/basket-0.12.0

becomes:

    origin/custom
    origin/upgrade/basket-0.12.0
    fork/tmad-2026-10-24-carry # TMAD feature intake; reviewed 6e070f7b

Both existing lines keep their position and SHA (`origin/custom` =
`d9a9dfa063d8115b6f574f531a9d1d518488ae8a`; basket = the published snapshot
`568972505113179d03cc6e2c2c899ba16243cc42`). The carry ref must be reachable
to the resolver before assembly (bundle-fetch into the neptune repo, or push
to a private remote once authorized — `mine` is never used for this).

Reproduction already proven on triton: isolated assembly at the carry
produces `a8caabab39fdfc662b547aeb7060097bbe563be4` (merge chain base
`cafe4b01c` → custom → basket → carry, 436 files), with the usage guide and
i18n fix verified in the tree. The live assembly should reproduce this tree
(`git rev-parse HEAD^{tree}` compared against triton's record).

## Publication

- Via `.github/workflows/fork-npm-publish.yml`: push the carry ancestry to
  `mine` (fast-forward where possible) or dispatch with `dry_run=true` first
  for CI validation. Publishing requires the workflow's own push path;
  `workflow_dispatch` WITHOUT `dry_run` publishes and must not be used for
  staging.
- Record from the publish run: the 7 tarball names + SHA-256s, the
  `fork/v0.12.0-fork.2` tag, and the GitHub Release assets. A partial publish
  blocks deployment; follow the existing recovery runbook, never blind retry.
- Post-publish verification: all 7 `@camerontaylor/paseo-*` versions at
  `0.12.0-fork.2`, `latest` dist-tag moved, tarball hashes match the Release
  assets, `paseo --version` and `server_info` report `0.12.0-fork.2`.

## Client artifacts

| Artifact | State |
| --- | --- |
| Android dev APK | Built on triton: `sh.paseo.debug`, versionName 0.12.0, versionCode 12000, sha256 `a68cc3be1a67f7e85dabe339e05198aca20167dd6a24e3253ba01b30eafafbd6`. Dev shell loads app JS from Metro at the candidate tip. Device install + QA pending (device was unreachable); transfer script staged at `/tmp/d9-docs/device-transfer.sh` on triton. |
| Android store/EAS build | Not started — separate decision from the dev-APK QA path. |
| macOS desktop package | Not built yet: requires a disposable neptune (Intel) or Saturn (arm) checkout at `6e070f7b` with explicit `DESVIO_WORKTREE`/`DESVIO_CONFIG`, ad-hoc codesign (not notarized), never installed over production (same singleton lock). |
| Web | Packaged into the daemon (dry-run: 57 web-ui assets, 26.26 MiB raw). |

## Rollback

- **Registry**: `0.12.0-fork.1` tarballs remain published and installed; npm
  unpublish is not part of rollback. Re-point `latest` per the existing
  dist-tag runbook only if a broken fork.2 shipped.
- **Hosts**: redeploy the prior daemon build per host; stop new writers before
  any data restore; new persistence fields written by fork.2 daemons are
  additive (protocol stays backward-compatible), and old daemons preserve them
  as unknown-but-retained state.
- **Manifest**: remove the carry line and rebuild — the two prior lines are
  byte-identical, so the pre-intake tree reproduces exactly
  (`1dff9184a4305d15b861a278023e43d7d776f7f7`).
- **Devices**: `sh.paseo` (production) was never touched; `sh.paseo.debug`
  uninstalls cleanly.
- Private cold backups per the D0 receipt procedure precede any canary data
  migration; rehearse on a copy before the first host restart.

## Deployment order (after publication + authorization)

1. **pluto first** (daemon canary) from a different host, in an approved
   restart window: real Claude + Codex turns, receipt-safe queue
   reconnect/restart, Stream restart, `queue ls` + `diagnostics errors`, and
   one older-version client against the new daemon.
2. Observe, then the remaining roster hosts one at a time, verifying each
   before the next; refresh versions/paths from the live runbook, not from
   this document. Upgrade daemon capabilities before enabling matching
   clients. Keep the orchestrating agent out of the service being restarted.
3. neptune and Saturn follow their documented cross-host procedure.

## Open items gating the review

1. Android device QA (mic permission, voice modes, mute/unmute, queued
   attachment recovery, lock/background, Bluetooth) — device unreachable all
   window; script staged.
2. macOS desktop package build + smoke (disposable neptune/Saturn).
3. Physical iOS remains unverified — no iPhone in the fleet; recorded as an
   explicit gap in the matrix, not waived.
4. Matrix rows keep `installed`/`observed` open until 1-3 land; the release
   cannot be described as full parity while they are open.
