# Neptune beta build handover — migration STOP

Goal: publish the accepted partial beta and prepare the two-Mac release sequence.
Execution is now STOPPED for Neptune-to-Triton migration. No Saturn build/install,
Neptune worker/job, daemon restart, Linux rollout or live default config change has
started. Prior deployment approval must not be acted on during this handover.

## Source and published refs

- Accepted source: [`upgrade/basket-0.12.0-beta.1`](https://github.com/camerontaylor/paseo/tree/upgrade/basket-0.12.0-beta.1),
  commit `1aa33f374428db47e8e969110fbd32105a98ebd8`, tree
  `ba91e63a2b5fdfbee94cac0d48f29083453b5ddc`. The local `u3-7106-source`
  worktree is clean at this published commit; it needs no source commit.
- Control: `213879f0834522ee68e7249a1caa800ff02714f2`; original input
  `dcd5e30f178d3593d3899c2f9834807b417280e3` retained. All 14 pins unchanged.
  Manifest SHA256: `d2b96952688ae0932343ceff8b58aad3471d8d768ca06cb7eb7690a6ac0cdf6d`.
- Separate accepted harness:
  [`test/packaged-smoke-isolation-0.12.0-beta.1`](https://github.com/camerontaylor/paseo/tree/test/packaged-smoke-isolation-0.12.0-beta.1),
  commit `7a21c3a68fba6f89c77903d4d4addf81773eab98`. This is not the artifact source.
- Handover branch:
  [`docs/beta-build-migration-handover-20261018`](https://github.com/camerontaylor/paseo/tree/docs/beta-build-migration-handover-20261018).
  It contains documentation, an inert config example, the provenance-only packager
  patch, draft tooling hashes and a read-only preservation verifier. No product edits.
- Remote `mine` remains `929d7427163474f5c0cbfc45192436d3de7540c6`.
  No force push, reset, history rewrite or merge to `mine` occurred.

## Publication

One approved fixed-N dispatch ran at the accepted basket:
[39095502619](https://github.com/camerontaylor/paseo/actions/runs/39095502619).
CI succeeded. The tag `fork/v0.12.0-beta.1.fork.1` points directly to the accepted
commit. [Public release](https://github.com/camerontaylor/paseo/releases/tag/fork/v0.12.0-beta.1.fork.1)
is non-draft, not marked prerelease, and is the actual GitHub Latest release under
the approved automatic selection. Notes explicitly retain the partial-beta gaps.

The one delayed bounded registry recheck passed. All seven
`@camerontaylor/paseo-{highlight,relay,protocol,client,plugin,server,cli}` packages
and their `latest` tags resolve to **`0.12.0-beta.1.fork.1`**. Actual downloads pass
SHA512 SRI/SHA1, exact internal dependency pins, registry signatures, signed
attestations, exact GitHub workflow identity and accepted source/run binding.
All seven downloaded GitHub release assets equal registry tarballs byte-for-byte.
No packages remain missing. `publication-summary.json` records per-package hashes.

Original partial propagation responses and failed verification attempts remain
preserved. Five original cryptographic successes were reused only after matching
immutable integrity; the remaining two were verified from saved final metadata.
No second dispatch, registry write or publication retry occurred.

All seven best-effort `fork` tag changes failed HTTP 403 under trusted publishing;
`fork` remains **`0.8.0-fork.1`**. Exact versions must be used for any future install.

This approved basket-as-release-source exception replaces the normal runbook's
`mine` tracing for this release only. Correlate basket SHA/tree, control manifest,
CI run, npm version, fork tag, Mac stamp and per-architecture artifact hashes.
Live `~/.paseo-fork/desvio.conf` and its old carry manifest remain unchanged.
Future isolated builds must select the recorded configuration explicitly; use the
established `desvio run prepare/package/verify`, not identity-changing assembly.

## Artifact, QA and installed Macs

- Neptune x64 artifact: `Paseo-0.12.0-beta.1-mine.261018-0125-x64.zip`.
  SHA256 `03efd54fc281442295ff3347f76992e4161d0cf548f2384fbaafabaa70936c3f`.
  Stamp `0.12.0-beta.1-mine.261018-0125`; plist and asar source SHA/tree match
  accepted source. Deep/strict ad-hoc codesign passed; this is not notarization.
  CDHash `c60bc21123dc5a655bf05d29ced8e4079b10a053`; no `app-update.yml`.
- Packager extension adds only four source-provenance metadata arguments, plus
  its executable mode. It makes no runtime/source edits. Packager SHA256
  `466c7f6a08f2eab90ac3e5b7a726acd3e80225fbbc7cd9d7993b780692bb6a43`;
  patch SHA256 `bfd93e46a5efda6a5ec1d75dcec42a20dbab451a4f45137a615facd0470e3042`.
- Packaged QA: `PASS_NEPTUNE_MACOS_X64_ONLY`. Original terminal marker FAIL,
  unchanged sanitized-environment PASS, causal diagnostic and corrected-harness
  PASS are distinct receipts. Accepted harness seal SHA256
  `82dfc4c80adad927eabf366f3084b7ac64bb5d11111ac8e859a8e5cd5e2588e0`.
  This provides no real-provider or physical-platform proof.
- Both Macs still have **`0.11.2-mine.261011-1857`** installed. Fresh read-only
  checks found their existing listeners and `/api/health` HTTP 200. Neither app,
  daemon, state, settings, credentials nor build selection was changed.
- Neptune known-good rollback ZIP: `rollback-0.11.2-mine.261011-1857-x64.zip`.
  SHA256 `f9893673d68f82a0ade53d2b1edcf904ee9b115ff283199832f04696590b674e`.

## Private preservation required before deleting clones

Preserve the **entire** original
`~/.paseo-fork/candidates/upgrade-0.12.0-beta.1/evidence/`, not only selected logs.
The off-host private destination is:

```text
triton:/home/ctaylor/.paseo-fork/migration/upgrade-0.12.0-beta.1-20261018/
```

It contains `evidence/`, `evidence.tar`, both ZIPs under `artifacts/`,
`supplemental.tar` plus extracted `supplemental/`, `file-manifest.json`, and
`preservation-receipt.json`. The receipt records source/destination SHA256 for the
archives and ZIPs, complete file counts, manifest SHA256 and verification results.
Read it before any deletion; public git deliberately excludes private logs/settings.

Verified source/archive hashes:

| Preserved object | SHA256 |
| --- | --- |
| `evidence.tar` (758,628,352 bytes) | `bff5946f36771c0407452f90a584a1fbd34626489d4290007f317bf5b3eb7535` |
| `supplemental.tar` (30,146,560 bytes) | `fa1a62377e9a97874ed2f67feff00d553cc27e10ed5ea88eb2d4afa9ad4826c6` |
| `file-manifest.json` | `3f5a40a369c72177031ca369c01a4514af89655e09c5611a72dda4494ebc99bd` |

The complete manifest covers 2,528 entries and 1,976 regular files, including both
artifact ZIPs. Source verification and destination verification are separate
receipts. `preservation-receipt.json` records their final correlated result.
Private final receipt SHA256:
`5a4b36419b166d28294dddfc110555b929351c93a9bc17a75f1534717dc632a8`.
The receipt result is **PASS**; no clone has been deleted.

Critical evidence includes `u3-7106-implementation/` and every implementation
receipt/seal, plus all of `build-deploy/`: config and exact command receipts;
original/current control snapshots; source/build/artifact identity and hashes;
known-good app/config/settings/state snapshots; original failed QA and causal
receipts; corrected harness reviews/seals; approvals/proposal; original partial
registry propagation responses; downloaded npm/release tarballs, signatures,
attestations and publication verification; ledger; staged scripts/plists and their
unfinished advisor review. The supplemental archive preserves candidate-root
bundles, briefs, helper scripts and frozen control documents.

The checksum text files may contain historical absolute Neptune paths. Do not
rewrite sealed receipts during migration. Use the relative complete manifest and
`verify-preservation.py` to verify the destination. Keep the ZIPs byte-for-byte;
Linux storage of the app/ZIP does not establish macOS execution or signature proof.
Linux represents 14 macOS symlink modes as `0777` instead of `0755`; the verifier
records these differences explicitly while requiring exact targets and all regular
file/directory modes. Original tar/ZIP bytes retain the macOS metadata. Linux tar
also reports unsupported Apple provenance xattrs during extraction; use the
original archive/ZIP for restoration on macOS.

## Next steps after migration, when work is explicitly resumed

1. Recover refs from origin and evidence from the verified Triton destination.
   Adapt isolated paths deliberately; keep the accepted basket and owner pins
   immutable. Do not run the old live build configuration by assumption.
2. Complete bounded deployment-tooling review. The installer checksum's relative
   path issue was corrected and checked from `/` and `/tmp`, and plist working
   directory made explicit. Further draft changes still lack final persistent
   advisor ACCEPT and final artifact/approval/file-hash binding. Saturn's draft
   counterpart predates recent Neptune edits. Historical `two-mac-worker.sha256`
   is stale. **All staged jobs are NOT launch-ready.** Reconcile, validate and seal
   final bytes before any launch; `tooling-inventory.json` inventories current drafts.
3. Only when resumed, build Saturn arm64 serially at the accepted source/tree,
   same Mac stamp, with the established packager. Preserve Saturn's own known-good
   app/settings/history/rollback first. Require arm64 artifact/signature/provenance
   and corrected-harness QA; x64 evidence is not a substitute.
4. Only after every gate, perform Saturn canary install/restart and independent
   probes. After Saturn `RESULT: OK`, launch a Saturn-hosted worker to deploy
   Neptune LAST, survive Neptune coordinator death, and write/verify durable
   newline-terminated `RESULT: OK/FAILED` on Neptune with independent SSH probes.
   These steps interrupt agents. Stop on drift/failure/timeout; no automatic retry,
   rollback, force, history deletion or credential reset. Linux hosts stay unchanged.

Ordinary source work, git and evidence storage can move to **Triton**. Building,
codesigning, executing packaged Electron QA and installing/restarting **Paseo.app
require macOS**. Neptune's x86_64 packaging remains on Neptune or another suitable
Intel Mac; Saturn must produce and prove its own arm64 app. A Linux Triton build
cannot replace those platform gates. Preserve the already proven x64 ZIP so clone
removal does not require an unnecessary rebuild.

## Still open

- **#7179 real Claude survival UNVERIFIED:** provider availability admission fails
  before dispatch; cause remains unknown. Green unit proof is separate.
- **#7169 real OMP UNVERIFIED:** `omp --version` exits 127, Bun absent, all 14 tests
  skipped before bodies/resources/turn/sentinel. This is separate from Claude.
- U3 #6978/#6264/#6402/#6165, full TMAD/U4, infi/U5 and history/U6 are not
  implemented; full TMAD inactive; compact search/grouping/grid not adopted.
- Physical iOS/Android, nine-locale visual/device voice/background, Saturn arm64
  and PowerShell runtime proof remain open. No U7/campaign completion claim.
