# Permission-preserving fork upgrades

Status: pending approval
Date: 2026-10-02
Mode: deliberate
Iterations: 2
Spec: none

## RALPLAN-DR

Principles:

1. Keep the identity of permission-bearing executables stable.
2. Preserve active agents, daemon identity and application state.
3. Reuse the maintained updater and packaging machinery.
4. Keep fork release provenance separate from upstream.
5. Validate actual permission operations and launch paths before migration.

Decision drivers:

- Tested macOS grants survive replacing signed build A with different build B.
- Client replacement cannot replace the daemon's runtime or restart its agents.
- Releases and rollback remain manageable across Intel Neptune and Apple Silicon Saturn.

| Option | Advantages | Costs and constraints |
| --- | --- | --- |
| A: sign the current bundled client and daemon | Smallest first change; preserves installed helpers and plugin layout | Client replacement still affects daemon resources; requires coordinated maintenance |
| B: signed client plus separately managed scoped npm daemon | Reuses fork npm packages and fleet supervision; independent installation timing | Must prove permission attribution, plugin SDK compatibility and complete runtime independence |
| C: signed client plus independently signed daemon bundle | Stable daemon identity; can preserve Electron helpers and original SDK layout | Additional packaging, signing, service and rollback machinery |

Recommendation: establish A first through signed manual A/B upgrades. Prefer B for ongoing operation only if its canary passes. Implement the bounded C fallback if B fails. Client automatic installation stays blocked until B or C passes on both hosts.

Keep **one coordinated fork version** for desktop and all seven npm packages, independent of upstream numbering. Install client and daemon releases on separate schedules. This preserves a single release process while allowing UI updates without agent downtime.

## Context and guardrails

The installed apps on both Macs are ad-hoc signed, use `sh.paseo.desktop`, have no Team ID, and have designated requirements tied to build-specific code hashes. Neither machine currently has a valid code-signing identity. macOS uses code requirements to recognize software across updates; ad-hoc requirements can identify only a particular build. Stable Developer ID signing is the proposed remedy, subject to real permission tests. [Apple TN3127](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements)

Current fork packaging and lifecycle need changes:

- `~/.paseo-fork/package.sh` disables certificate discovery and notarization, rejects updater configuration and finishes with ad-hoc signing.
- `~/.paseo-fork/install.sh` preserves application data but pins desktop daemon management and restarts a stale daemon.
- Both hosts currently manage the built-in daemon and keep it running after client quit.
- `packages/desktop/src/daemon/runtime-paths.ts` resolves the daemon runtime and resources inside the desktop bundle. `daemon-manager.ts` can restart a desktop-owned daemon on version mismatch.
- The installed CLI deliberately launches through `Paseo Helper.app`; its shim differs from the current checkout. Establish provenance and retain required behavior when producing new artifacts.
- Neptune's login-shell LaunchAgent and watchdog setup supports offload-volume access and provider authentication. Preserve GUI-session keychain access; SSH-to-localhost is unsuitable for that launch path.

No implementation, publication, installation, certificate creation, production setting change or daemon restart is authorized by this planning artifact. In particular, do not restart the production daemon on port `6767` without explicit permission. Isolated daemon tests use a separate `PASEO_HOME` and non-production port.

Preserve `~/.paseo`, credentials, host/server identity, schedules, agents and desktop user data. Do not reset TCC. Keep the desktop bundle ID, executable/product names, `/Applications/Paseo.app` and user-data identity stable; fork branding belongs in About.

## Delivery sequence

1. Capture the fleet baseline and set up Developer ID.
2. Correct release packaging; prove signed manual desktop A/B upgrades on Saturn, then Neptune.
3. Test independent npm daemon permission, plugin and resource behavior.
4. Perform an approved daemon cutover to B, or implement and validate C first.
5. Test fork updater beta A/B on both Macs.
6. Enable stable client update installation.

Release infrastructure can be prepared earlier, with artifacts kept draft and installation disabled. A successful signing test alone does not authorize unattended replacement of a bundle still hosting the production daemon.

## 1. Fleet baseline

Record on each host:

- OS, architecture, deployed versions, bundle identifiers, Team ID and designated requirements of the main app and relevant helpers.
- Actual permission operations for Accessibility, Screen Recording and microphone, including the requesting executable and responsible process ancestry.
- Daemon executable, entrypoint, ASAR/native-module/resource paths, PID and start identity, home, server identity and CLI symlink target.
- LaunchAgent and watchdog configuration; `USER`, `LOGNAME`, PATH, `PASEO_LOGIN_SHELL`, offload-volume readiness and GUI keychain behavior.
- Enabled plugins and SDK resolution. Include `codex-policy`; the historical Zcode plugin is disabled and its current replacement uses built-in ACP.
- Active agents, schedules and current connection behavior.
- CI availability; recheck the historical billing restriction recorded in `fork/ci.md`.

Retain rollback copies of the installed app and launch configuration without exposing credentials. Saturn is the first canary, but must pass independently from Neptune.

Acceptance: a reproducible per-host baseline identifies which executable owns each requested permission and which files the daemon depends on.

## 2. Your Developer ID tasks

Use an existing eligible Apple Developer team if available. Otherwise enroll in the Apple Developer Program; Apple lists USD 99 annually or a local-currency equivalent. [Membership](https://developer.apple.com/support/compare-memberships/)

1. In Keychain Access, open Certificate Assistant → Request a Certificate From a Certificate Authority. Enter your email and a descriptive common name, leave CA email blank, and save the CSR to disk. Keep the generated private key in that keychain. [Apple CSR instructions](https://developer.apple.com/help/account/certificates/create-a-certificate-signing-request/)
2. Have the team's Account Holder create a **Developer ID Application** certificate in Certificates, Identifiers & Profiles using that CSR. Download the certificate and import it into the same keychain containing its private key. Developer ID Installer is unnecessary for the current app/DMG/ZIP distribution. [Apple certificate instructions](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)
3. Confirm the signing identity includes its private key. Export both together as an encrypted `.p12`, with a strong export password. Keep an encrypted backup and record the Team ID. One certificate can sign both architectures; deployment Macs need no private signing key. [electron-builder v26 signing](https://www.electron.build/v26/docs/features/code-signing/code-signing-mac/)
4. Create an Apple ID app-specific password for notarization. Use it with the Apple ID and Team ID supported by the existing workflow; migrating to an API key is optional. [electron-builder v26 notarization](https://www.electron.build/v26/docs/features/code-signing/notarization/)
5. Add the protected fork release secrets below. Restrict their use to trusted release jobs, excluding untrusted PR execution.

| GitHub secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | Exported `.p12` in the builder-supported form, normally base64 |
| `APPLE_CERTIFICATE_PASSWORD` | `.p12` export password |
| `APPLE_ID` | Apple account used for notarization |
| `APPLE_PASSWORD` | Apple app-specific password, not the account password |
| `APPLE_TEAM_ID` | Developer team ID |

The current workflow maps the first two to `CSC_LINK`/`CSC_KEY_PASSWORD`, and `APPLE_PASSWORD` to `APPLE_APP_SPECIFIC_PASSWORD`. Verify these mappings when extracting fork jobs from `.github/workflows/desktop-release.yml`.

Do not recreate or revoke the certificate for each update. Document expiry, renewal, backup restoration and designated-requirement checks during certificate rotation. Private keys belong only on trusted build infrastructure.

Your remaining operational tasks are the first signed installation and any resulting one-time permission approvals on each Mac, followed by an explicitly approved daemon maintenance cutover. Later signed A/B upgrades must pass without build-caused reapproval for the tested operations.

## 3. Signed manual packaging

Files: `~/.paseo-fork/package.sh`, `~/.paseo-fork/install.sh`, `packages/desktop/electron-builder.yml`, desktop entitlements and the verified installed CLI shim.

- Separate unsigned development builds from signed release builds.
- Remove release-mode signing discovery disablement, notarization disablement and final ad-hoc re-signing. Fail release builds when signing prerequisites are missing.
- Use installed electron-builder v26 configuration: `mac.identity`, hardened runtime and current parent/inherited entitlements. Avoid v27-only configuration.
- Preserve the existing app identity, helper CLI behavior and native-module packaging.
- Let electron-builder sign nested code in its established order. Notarize and staple the `.app`; notarize/staple the DMG where used. Create the final updater ZIP from the finalized app. ZIPs cannot be stapled. Generate hashes and sizes after finalization.

Verify identity and requirements, nested signing, Gatekeeper acceptance and stapling:

```sh
codesign --verify --deep --strict /Applications/Paseo.app
codesign -dr - /Applications/Paseo.app
spctl --assess --type execute /Applications/Paseo.app
xcrun stapler validate /Applications/Paseo.app
```

Inspect relevant helpers and permission-bearing executables as well as the outer app. Keep the notarization diagnostics without credentials.

Build distinct signed versions A and B. During approved maintenance, install A and grant any permissions required by the ad-hoc→signed transition. Install B and repeat the baseline's real operations on Saturn, then Neptune.

Acceptance: both Macs retain grants and perform the tested operations across signed A→B. Record any helper or daemon failure; outer-app signature success alone is insufficient.

## 4. Numeric versions, tags and About

Files: `fork/scripts/release-fork.mjs` and its existing tests, `packages/app/native-release-version.js`, `packages/app/src/screens/settings-screen.tsx`, native About setup, fleet `~/.local/agents/scripts/setup-paseo.sh`, Desvio/base-reference and upstream-sync consumers.

Use `vX.Y.Z` and `vX.Y.Z-beta.N` release tags. All seven scoped packages and desktop share that fork release number. Record upstream base version and source SHA separately in release metadata and diagnostics.

Before choosing the initial number, inspect every package's versions/dist-tags, installed fleet versions and local/remote Git references. Choose an unused version that advances supported installations in its intended channel. Do not assume `0.11.0` is available. Respect native minor/patch/beta bounds and Android version-code limits; a year such as `2026` is unsuitable as a major here. Do not introduce an unapproved major.

Preserve historical `fork/v…` and upstream `v…` tags. Never overwrite published tags. Stop automatic upstream tag imports; fetch future upstream tags explicitly under `upstream/v…`, using `--no-tags` for ordinary fetches. Audit existing Desvio pins and all sync/release consumers before changing their reference assumptions.

Replace `.fork.`/`-fork.` detection in `setup-paseo.sh` with package scope or explicit fork provenance. Numeric versions must not cause a filesystem fork install to be mistaken for upstream. Preserve Linux fleet guards even though this rollout deploys only the two Macs.

Display **Paseo (fork)** in application and native About, with the ordinary numeric version. Keep actual client and daemon versions visible. Change `HostVersionRow` so expected independent version drift is neutral; use existing compatibility/capability gates rather than falsifying equality.

Acceptance: version parsing, update comparisons and package dependencies accept the scheme; no old tag is overwritten; fork detection remains correct; About identifies the fork without changing macOS identity or data paths.

## 5. Coordinated fork release workflow

Files: `.github/workflows/fork-npm-publish.yml`, `.github/workflows/desktop-release.yml` and all inherited publication workflows, `fork/scripts/release-fork.mjs`, `scripts/merge-mac-manifest.mjs`.

Keep the npm trusted-publishing filename `fork-npm-publish.yml`. Replace release-on-every-`mine`-push with an intentional coordinated release trigger. Preserve OIDC trust for all seven packages.

Ordinary `v*` tags match inherited desktop, Android/mobile, Docker and release-notes workflows. Add explicit repository/job gates to prevent unintended publication and duplicate finalizers. Audit every tag consumer, not only the desktop workflow.

Call reusable build jobs directly or explicitly dispatch them. Tags pushed with `GITHUB_TOKEN` do not trigger ordinary follow-on push workflows; do not rely on that chain. [GitHub token behavior](https://docs.github.com/en/actions/concepts/security/github_token)

One release owner performs this sequence:

1. Reserve an approved version and exact source SHA; create the immutable tag and one draft GitHub release.
2. Build signed/notarized Intel and ARM desktop artifacts, and staged tarballs for all seven packages.
3. Validate package contents, signatures, notarization, architecture, artifact hashes and manifest entries.
4. Publish npm packages only after valid desktop artifacts exist.
5. Merge/upload the Mac update manifests and finalize the GitHub draft only when all seven packages, both Mac architectures and the merged manifest are complete.

Use a Mac-only finalizer. The inherited finalizer waits for Linux and Windows too; omitting their jobs without replacing that barrier would leave the release stuck.

Publish stable npm packages directly with `--tag latest`, prereleases directly with `--tag beta`. Remove required post-publication `fork` alias mutations: existing OIDC publication does not authorize those dist-tag writes. Stable releases need not move npm's `beta` pointer; it can remain on the last prerelease. Verify desktop beta→stable feed behavior separately.

Retries reuse the same reserved version and source. Accept already published packages only after content/provenance verification. Refuse mismatched existing tags or tarballs; never overwrite an npm version. Report partial publication clearly and resume the missing work.

Acceptance: release dry-runs and a draft beta prove two-architecture manifest completeness, channel tags, immutable retries, fork provenance and a single finalizer without unintended upstream publishers.

## 6. Independent npm daemon canary and cutover

Files: fleet `setup-paseo.sh`, LaunchAgents/watchdog and CLI pins, desktop settings/lifecycle, fork installer, server daemon self-update capability reporting.

Install a pinned Node runtime and versioned scoped npm releases outside the client bundle. Use a separate home and port for the canary. Preserve Neptune's `zsh -lc`, watchdog login shell, `PASEO_LOGIN_SHELL=1`, `USER`, `LOGNAME`, PATH, offload access and GUI keychain behavior. Inventory Saturn's requirements separately.

Prove the executable, supervisor, entrypoints, lazy-loaded scripts, native libraries, plugin SDK dependencies and every operational CLI live outside `/Applications/Paseo.app`. A stable symlink or an unchanged PID does not prove privacy identity or resource independence.

Across two independent daemon releases, test actual permission-bearing operations, provider authentication and every enabled plugin, including `codex-policy` SDK imports. Do not silently remove plugins to pass. With a live canary agent, replace/remove the old client bundle and prove continued work. Then restart the isolated daemon and prove it starts without the old client resources.

The current built-in daemon updater targets stock/global npm installs and does not support the scoped release prefix. Keep that capability truthfully unsupported and use an operator-managed staged/pinned daemon upgrade path. Do not bypass install-origin safety checks.

After passing and explicit production restart permission, cut over one host at a time:

1. Capture active work and old supervisor PID/start identity.
2. Disable desktop built-in daemon management.
3. Stop only the captured old supervisor.
4. Start the independent supervisor with the same production home, address and credentials.
5. Verify exactly one supervisor, unchanged server identity and restored client connection; retain the previous runtime for rollback.

Remove the installer's `manageBuiltInDaemon=true` pin and unconditional daemon restart. Client version changes must leave the external daemon alone. Fix operational CLI pins so a stock CLI cannot respawn an unintended server.

Acceptance: all canary tests pass on both Macs; production cutover preserves state, plugins and auth. Client replacement preserves the daemon's PID/start identity, resources and live session. A separately approved future daemon restart succeeds without the old desktop bundle.

## 7. Bounded fallback: independently signed daemon

If npm fails privacy or SDK compatibility, implement option C before enabling automatic client installs:

- Fixed daemon bundle ID, for example `com.camerontaylor.paseo.daemon`, and stable installation path outside the client bundle.
- Own executable, helper apps, ASAR, runtime, native modules and CLI; preserve original internal SDK layout required by plugins.
- Hardened runtime and entitlements based on demonstrated daemon requirements.
- Developer ID signing/notarization, stapled app and appropriate DMG, final ZIP made afterward.
- Versioned staging, selected runtime, retained previous release and explicit rollback.
- LaunchAgent/watchdog ownership and pins preserving the validated login environment, volume access and provider auth.

Repeat real signed daemon A/B privacy tests, plugins, complete resource isolation and restart with the old client absent on both hosts. Then perform the approved cutover described above.

Acceptance: C passes the same independence and permission gates as B. If it cannot, keep the current runtime and report automatic client installation blocked. Signed manual upgrades remain a deliverable with coordinated daemon maintenance; do not claim uninterrupted updates complete.

## 8. Fork desktop updater

Files: desktop builder configuration, `packages/desktop/src/features/auto-updater.ts`, app update service/rollout, manifest merger and fork packaging.

Point packaged `app-update.yml` exclusively to `camerontaylor/paseo`. Assert it cannot name upstream. Reuse electron-updater, channel settings, manifest revalidation and existing rollout/quit-install behavior. macOS updater distribution requires the signed app and ZIP artifacts. [electron-builder v26 updates](https://www.electron.build/v26/docs/features/auto-update/)

Provide x64 and ARM ZIPs plus initial-install DMGs. Merge architecture entries into `latest-mac.yml` or `beta-mac.yml`; do not let the last build overwrite the other architecture. Keep stable `latest`, prerelease `beta` and existing downgrade prevention.

After daemon isolation passes, test beta A→B on Saturn and Neptune: correct architecture/feed, real retained permissions, fork About, active-agent continuity, unchanged daemon PID/start identity and future independent restart. Test beta→stable, manual checking, missing/incomplete artifacts and draft exclusion.

Acceptance: both hosts pass the updater canaries before stable installation is enabled. Automatic client replacement invokes no daemon upgrade or restart.

## Pre-mortem

1. Six months later, signed app updates still prompt because the actual requester is a changing Node/helper/tool. Compare responsible executables and requirements; require real A/B operations before rollout.
2. Six months later, an agent fails after a UI update because the daemon lazily loads replaced client files. Validate all resources and restart without the old bundle, not only PID continuity.
3. Six months later, a fork release selects upstream or incomplete artifacts because tags collide or inherited publishers run. Namespace imported tags, gate every publisher, retain one draft/finalizer and immutable source provenance.

## Verification and recovery

| Level | Required evidence |
| --- | --- |
| Unit | Extend existing release/version/updater/lifecycle suites: numeric versions, channels, collisions, retry provenance and no restart of an external daemon on client drift |
| Integration | Seven scoped tarballs; both signed architectures; nested verification, notarization, final hashes/merged manifests; launch configuration and isolated runtime |
| End-to-end | Actual A/B privacy operations on both Macs, enabled plugins, live-agent continuity, beta/stable transitions, login/reboot, manual rollback and approved independent daemon restart |
| Observability | Source SHA, upstream base, fork/client/daemon versions, architecture, Team ID/requirements, feed target/hash and supervisor PID/start/runtime path; no secrets |

For implementation, run npm formatting, lint and typecheck. Build owning workspace declarations before diagnosing cross-package type errors. Run only changed test files locally; broad coverage uses existing CI. Integrate knowledge into owning fork docs and the daemon-owner section of `~/.local/agents/docs/paseo.md` rather than appending duplicate runbooks.

Retain previous signed client and daemon artifacts independently. Prefer a higher-version corrective client release. Manual client rollback pauses updates to avoid a loop; existing `allowDowngrade=false` must not be assumed to offer automatic rollback. Daemon rollback switches the selected release and restarts during approved maintenance, preserving the same home. Returning to ad-hoc signing may require permission approval again.

Final acceptance: both Macs preserve tested grants across signed releases; fork updates select complete matching-architecture artifacts; client updates preserve daemon resources and active sessions; daemon upgrades are deliberate, independent and reversible; enabled plugins and launch/auth behavior remain functional.

## Intent reconciliation

- Ordinary tags and numeric npm versions: expressly permitted by the user; choose the first number only after registry/reference checks.
- Fork identification in About: requested by the user; use `Paseo (fork)` without changing executable identity.
- Separate daemon/client handling: requested as a design question; recommend independent installation timing with a single coordinated release number. The npm implementation remains conditional on evidence.
- Developer team availability and certificate access: conditional checklist, not assumed existing credentials.
- Production cutover: a future explicit maintenance approval, not implied by requesting this plan.

No matching spec or conflicting prior artifact was found. No unanswered preference prevents completing this plan; implementation choices above remain proposals for approval.

## ADR

**Decision:** sign the existing fork first, then isolate daemon deployment before enabling a fork of the desktop updater. Prefer scoped npm only after validation; use a separately signed daemon bundle if needed. Keep coordinated numeric release versions with independent installation timing.

**Drivers:** permission retention, uninterrupted client upgrades and understandable release/rollback ownership.

**Alternatives:** retain signed bundled daemon and schedule all app updates during maintenance; external npm daemon; independent signed daemon bundle. A self-signed fleet identity would add trust distribution and unproven privacy behavior, so Developer ID is the proposed distribution identity.

**Why chosen:** signing gives the smallest immediate improvement. Conditional isolation keeps its benefits while preventing updater installation from replacing the running daemon's files. Reusing maintained update machinery avoids a separate client updater implementation.

**Consequences:** one initial signing transition and one approved daemon cutover per host; two deployment schedules; additional packaging only if the simpler npm route fails. Runtime separation must be verified rather than inferred from a configuration flag.

**Follow-ups:** complete the Developer ID checklist, establish the exact initial version, validate CI access, then implement the ordered work packages after approval.

## Consensus trail

- Iteration 1: architect requested revision; critic `ITERATE`. Corrected rollout ordering, bounded fallback, resource independence, launch/plugin requirements, coordinated version semantics, inherited workflow gates, Mac-only finalization, OIDC channel policy and app-versus-ZIP stapling.
- Iteration 2: fresh architect `APPROVE`; fresh critic `APPROVE`. No critical or high findings remain. Incorporated the critic's non-blocking requirement for isolated home/port and explicit responsible-executable checks.
- Unresolved objections: none. Reviewer approval is consensus on the plan; its implementation remains pending user approval.
