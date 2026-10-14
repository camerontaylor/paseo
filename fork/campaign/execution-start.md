# Execution start — fork source refresh implementation campaign

Date: 2026-10-10. Control workspace `wks_171bca3667c4acf6`, branch `fork/source-refresh-control-20261010` (based on frozen `custom`). Campaign owner: GLM-5.3-Flash. Plan: `/Volumes/offload/neptune/repos/paseo/plans/ralplan-fork-source-refresh.md`, sha256 `abfe87512f35907382ff559d59a6a5c102ceff28290bb09faf62d16ed0605c53` — uncommitted in the source checkout, preserved there unmodified. This file is the binding EXECUTION-START note per plan §1.

## Authorization record

- User, 2026-10-10: "Send out implementation to be done by glm-5.3-flash with sol advisor."
- Local implementation of all 21 packages is authorized (5-pass consensus, pass 5 architect ACCEPT + critic APPROVE). The plan header's `Authority: none` / pending-approval status is superseded by the authorization records here.
- User, 2026-10-12 local time: "Resume, deploy work that is available." This additionally authorizes a partial release of accepted packages through the existing fork publication workflow, after separate deployment-candidate checks and advisor review. Preserve the current release baseline and changes already shipped. This does not authorize restarting the production daemon, installing over its running files, changing its config, or repairing live state. The deployment record owns the exact candidate and verification evidence.
- Advisor override: every "Opus 5.5 advisor" reference in the plan is replaced by the persistent GPT-6.1 Sol advisor (`codex/gpt-6.1-sol`, agent `54e4d36e-38b4-4efa-8c19-c0aca88fa575`, full-access/low, read-only reviews, reused — never relaunched). Protocol unchanged: per-stage ADVANCE, [PF] PREFLIGHT before any edit/commit, package gate + rolling-basket verdicts, one review request outstanding at a time.
- Model routing: package workers run `claude-zai/glm-5.3-flash` — the same verified GLM-5.3-Flash (native ZCode repeated launch timeouts in this session; user-directed same-model fallback, not a model switch), settings `bypassPermissions` + `high` thinking, `notifyOnFinish`. Provider availability/modes/model verified by root 2026-10-10. All implementation code by GLM-5.3-Flash; integration/conflict resolution by the coordinator (also GLM) under Sol checks.

## Frozen heads (verified 2026-10-10 via `git rev-parse refs/heads/*` from the control worktree)

| Ref | Full SHA |
| --- | --- |
| `custom` | `cbc2017186b980e7928bc376cfdeabb90ef56aa2` |
| `fork/carries-0.11.1` | `36fdadba65369dc41feb756d5b2c6004dc2a17e8` |
| `fork/infi-backend-0.11.1` | `1dd375931a0c4de5e930abb4b2cf2dc52d9cbcc5` |
| `fork/infi-ui-0.11.1` | `133ff0f7e0234da8aa684a23a8da31024531242d` |
| `fork/tmad-0.11.1` | `139e0c81e8eb51b0f97551171b2217838c3ebab5` |
| baseline `v0.11.1` | `ab10a6694ccf068959d1a6b67b6c915e21a9fe91` |
| `mine` (release channel; not an adoption source) | `95c31f6a9c0a6105057607c56a382d7e21683402` |
| upstream diff base | `41537e6a0a57a33b99d483e3d6f8f37202204d91` |

The rolling basket must contain exactly the five frozen heads. A moved head on any frozen line is a stop + advisor-approved re-pin record, never auto-adopt.

## Custom-owned list (captured 2026-10-10)

`git diff --name-only 41537e6a0 custom` → `fork/plans/proposal-auto-release-cycle.md` (today `fork/**` only, as committed; the remaining `fork/**` files in the source checkout are uncommitted dirty state and out of bounds). Re-captured at each basket; a new non-`fork/` entry combined with a tmad overlay touching it is a [PF] stop.

## Local research refs (verified present 2026-10-10)

- `refs/research/fork-refresh-tmad-20261008` = `695c48fed` (TMAD snapshot head)
- `refs/research/fork-refresh-infi-20261008` = `886a8690317a72c1177484c3f7358bf72d943cc3` (infi snapshot head)
- `refs/research/fork-refresh-cjk-20261008` = `701bf00d7`
- `refs/research/fork-refresh-accounts-20261008` = `f9ee6713b`
- `refs/research/tmad-main` = `f0d5507d2` (frozen intake)

All TMAD/infi source SHAs needed by near-term packages verified present locally (incl. C1's `929f1add3`, `d7bf8205f`, `380218527`; C2's intake lineage; B4's full infi SHA). The five not-local pins (`554a140ee…`, `142683d18f…`, `8e6473ee31…`, `94c987cf18…`, `c9a1d7a064…`) are fetched and pinned to `refs/research/*` only when their owning package needs them, advisor-verified before any worker reads.

## Execution order

baseline/equivalence records (§5.3 + A1 s0) → C1 → C2 → A1 → A2 → B9 → A3 → B1 → B2 → B3 → B4 → B5 → B6 → B10 → B7 → B8 → C3 → C4 → C5 → C6 → C7 → C8.

Serial. At most one implementation worker active. Sol gate between stages; package gate + rolling basket after each package. Canonical [PF] map per plan §4.

## Standing out-of-scope list

Production daemon restart, in-place installation, config changes, and live-home audit or repair (C8 Track 2) remain out of scope. Campaign frozen refs stay unchanged. Partial-release candidate assembly and publication are authorized by the 2026-10-12 request, subject to independent checks and advisor approval. Campaign pushes retain the allowlist below. Do not edit a manifest on a different host without checking its current content and preserving its existing entries.

## Re-pin record — host migration neptune → uranus (2026-10-10)

Operations moved from neptune (macOS; network heavily throttled) to uranus (Ubuntu cloud box, `/home/ctaylor/repos/paseo`). All campaign work was preserved as pushed commits before the move. The frozen heads above were re-verified identical on uranus; nothing about the basket changed.

- **Coordinator:** the neptune GLM coordinator (`acb705cc-…`) is replaced by a Claude Opus 5.5 coordinator on uranus.
- **Advisor re-pin.** The authorization record says the Sol advisor is "reused — never relaunched." Sol `54e4d36e-38b4-4efa-8c19-c0aca88fa575` lives on neptune and cannot be reached reliably from uranus, so a new Sol was launched on uranus: `3f2c7ea5-1328-4cd7-85c3-8c3d3ddbe4ff` (`codex/gpt-6.1-sol`, full-access, low thinking, read-only reviews, reused for the rest of the campaign). Its first prompt carried the full C1 log and the approved C1 s2 PREFLIGHT verbatim, so prior verdicts bind it. Protocol is unchanged. This is the only advisor relaunch; any further one needs its own record here.
- **Plan location.** The plan is now committed on this branch at `plans/ralplan-fork-source-refresh.md` (sha256 unchanged, `abfe8751…0605c53`). This branch is the control branch from now on.
- **Remote pushes (out-of-scope change).** Cameron authorized pushing campaign branches to `origin` (git@github.com:camerontaylor/paseo.git) to preserve work: `fork/*refresh*`, `fork/source-refresh-control-20261010`, `fork/acp-diagnostics-0.11.1`, `fork/queue-alias-guard-0.11.1`, and `handover/*`, after each committed stage. No PRs. No pushes to `custom`, `mine`, or the frozen fork/* heads. The "remote pushes" entry in the standing out-of-scope list is narrowed accordingly; everything else on that list stands.
- **C1 s2 starting point.** The neptune worker `24636e40-330f-47a2-bde0-8817265461c1` was still running at handover and could not be cancelled. Its uncommitted tree was snapshotted as `handover/c1-s2-wip-20261010` (`b5dd0d2e2`, on `db54e7d71`). That snapshot is authoritative; neptune edits after it are ignored.
- **Moved frozen head: `custom`.** Cameron had neptune's `custom` pushed: `origin/custom` moved `cbc201718` → `c07c4e5280223f1cc9927c478102e27e0b039d29` ("feat(fork): Add automatic upstream release cycles"). Per this note that is a moved frozen head: the campaign keeps `cbc201718`, local `custom` on uranus is not fast-forwarded, and no campaign work is rebased onto it. The re-pin question goes to Sol at the next basket (C1). Custom-owned re-capture against `c07c4e528` (`git diff --name-only 41537e6a0 c07c4e528`) now lists one **non-`fork/`** path, `.github/workflows/fork-ci.yml`, alongside `fork/README.md`, `fork/briefs/release-cycle.md`, `fork/launchd/local.paseo-release-watch.plist`, `fork/plans/proposal-auto-release-cycle.md`, `fork/release-watch.md`, `fork/scripts/release-watch.{mjs,sh,test.mjs}`. If it is re-pinned, any tmad overlay touching `.github/workflows/fork-ci.yml` is a [PF] stop.
- **Workers.** `claude-zai/glm-5.3-flash` (bypass, high thinking) stays the assigned worker model. Muse Spark 1.3 Contributor is available as a second worker option through the `pi` provider (`pi/opencode-go/muse-spark-1.3-contributor`); the separate `muse` provider stays disabled and unused.

### Re-pin ruling — custom (Sol, C1 gate, 2026-10-11)

> **APPROVE — CUSTOM RE-PIN ruling: retain `cbc201718`; do not adopt `c07c4e528` mid-campaign.**
>
> Verified the moved origin-tracking head and reported path delta. The existing control record identifies the move (`fork/campaign/execution-start.md:60`); the current basket excludes it.
>
> Record this ruling: all campaign baskets continue using frozen custom `cbc201718`. Add `.github/workflows/fork-ci.yml` to the prospective custom-ownership watch list; any overlay touching it requires a **[PF] stop**, even while the newer custom remains excluded. Re-evaluate the move at final rehearsal before any manifest proposal. This resolves the moved-head stop without changing the campaign baseline.

### Local custom drift ruling (Sol, 2026-10-12)

An external actor advanced uranus local `custom` from `cbc201718` to `268be1c4b7af16787d920e74b3eed6a564932c8a`. Reflog records commit `81dcdbce8` at 02:51:35 +11 and its amend at 02:52:00 +11. Only `fork/README.md`, `fork/fork-survey-2026-10-12.md` and `fork/upstream-prs-2026-10-12.md` changed. Remote custom is separately `a4d692287`; the other four campaign refs are unchanged.

The coordinator detected the drift in the delivery close-out audit, stopped browser worker `99388f8a`, and preserved its four uncommitted test files. Sol reviewed the refs, diff and reflog, then ruled:

> **APPROVE — retain campaign custom pin `cbc2017186b980e7928bc376cfdeabb90ef56aa2`; no campaign re-pin.**
>
> Assemble baskets using frozen **full SHAs**, never mutable `custom`.
>
> Leave local `custom` and `origin/custom` untouched.
>
> Resume the interrupted browser worker on held release base `568b12127`, incorporating approved EXC-3 as planned; preserve its uncommitted work. No rebase onto moved `custom`.
>
> Published A1 ancestry is unaffected: `929d74271` has parents `d62ed60c8` and `831f6a858`. Publication success and seven-package verification are accepted on coordinator report. No additional Cameron sign-off is required to retain the existing pin.

Full verdict: [local custom drift](logs/local-custom-drift-verdict.md). The stop is resolved without changing the campaign baseline or either custom branch. Check full pinned object identities, not mutable branch names, at subsequent baskets.

**Custom-ownership watch list** (checked at every basket in addition to the re-captured custom-owned list): `.github/workflows/fork-ci.yml`.

**Basket assembly convention** (C1 onward): base `v0.11.1` `ab10a6694`, then `--no-ff` merges in mine's deployed order — custom `cbc201718`, carries, infi-backend, infi-ui, tmad — then accepted overlays in schedule order. The infi-ui merge conflicts in `packages/app/src/agent-stream/view.tsx`; replay mine's resolution from `7021e8b4a` (identical inputs). Basket refs are pushed as `fork/refresh-basket-<pkg>`.

## Worker model change — GLM → DeepSeek V4.1 Flash (Cameron, 2026-10-11)

Cameron: "Replace workers with deepseek 4.1-flash workers via jcode. Push through additional work via that mechanism." From C2 s4 onward, package workers run `jcode/opencode-go:deepseek-v4.1-flash` (thinking `high`; jcode exposes no permission modes) in the package's Paseo worktree workspace. This supersedes the GLM-5.3-Flash worker assignment in the plan header and the authorization record above. Protocol is unchanged (serial, one implementation worker, Sol gates). The GLM C2 worker `7bca4486-…` was stopped mid s4 ITERATE; its tree was snapshotted as `handover/c2-wip-uranus` (`7b103a714`) and the DeepSeek worker `a6214735-52a4-43d5-a0b6-a8ec61cfeaa6` resumed in the same worktree. Commit trailer convention unchanged.

Deviation recorded: during C2 s4 browser acceptance the GLM worker ran `sudo apt` (Playwright install-deps) on uranus, a system install outside the standing scope. Workers are now told not to use sudo or system installs.

### Carry-test exception C2-GATE-EXC-1 (2026-10-11)

Coordinator basket run found `codex-app-server-agent.test.ts` "discovers a MultiAgentV2 child from a legacy-only lifecycle notification" failing on C2 (`codex-turn-0` expected; C2 s4 emits `codex-turn-<uuid>`, an approved s4 behavior). Sol approved the fix route for coordinator sign-off: keep production UUIDs; adapt only the two `turnId` assertions (`:4194,4204`) to the observed foreground turn id with child/spawn correlation asserted; no production id factory. **Signed off by the Opus 5.5 coordinator**, not Cameron: Sol approved it, it is the direct consequence of an already-approved behavior, and the handover reserves Cameron for exceptions the advisor will not sign. Cameron can overturn it.

### Carry-test exception C2-GATE-EXC-2 (2026-10-11)

`codex-app-server-agent.test.ts` "dismisses a pending synthetic plan approval after a new prompt is accepted" (`:5881–5889`) lacks `disposition: "expired"`, which approved s4 expiry semantics now emit (`codex-app-server-agent.ts:4841`). Sol: APPROVE for coordinator sign-off — add only that field; preserve the empty-pending-permissions assertion, request identity, denial behavior, dismissal message; production unchanged. **Signed off by the Opus 5.5 coordinator** on the same basis as EXC-1.

### Carry-test exception C2-GATE-EXC-3 (2026-10-12 local time)

Partial-release CI at `568b12127` found two stale expectations from the approved C2 additions: the hello capability map omits `global_stream: true`, and sidebar expected arrays omit the Stream builtin. Sol approved changes confined to `packages/client/src/daemon-client.test.ts` and `packages/app/src/sidebar-nav/model.test.ts`, including the shifted plugin index while preserving its exact object assertion. Keep fixtures, existing order/visibility/plugin assertions, and exact matchers. Do not derive expected results from production defaults. **Signed off by the Jcode coordinator before worker edits.** Production is unchanged. Both full files and checks must pass, then both integration paths and exact-SHA remote gates are revalidated.

## Host split — no builds on uranus (Cameron, 2026-10-14)

Cameron: "Do NOT run builds on uranus … Hand the APK build to neptune (or CI) instead, and continue the rest of the fork refresh from here." The Hosts rule in `~/.claude/CLAUDE.md` forbids builds on uranus: APK/Gradle/Hermes, desktop packaging, `npm run build*`, and full suites. One APK build exhausted RAM and swap there and dropped the daemon. From B9 onward:

- **Package workers run on neptune** (`ssh neptune paseo run …`, DeepSeek V4.1 Flash via jcode, high), in Paseo worktrees of `/Volumes/offload/neptune/repos/paseo`. `npm ci`, `build:server`, typecheck, lint and tests all run there.
- **Rolling baskets are built on neptune** in a dedicated basket worktree. The coordinator drives them over ssh.
- **Sol `3f2c7ea5` and the coordinator stay on uranus.** Sol only reads code. Workers push their branch, then reach Sol through `ssh uranus` (fetch the branch into `/home/ctaylor/repos/paseo`, then `paseo send 3f2c7ea5 --prompt-file`).
- Uranus keeps editing, git, and at most targeted single-file tests.
- Neptune's local `custom` has drifted again (now `a4d692287`). Workers and baskets name frozen heads by full SHA, never by branch name. The campaign pin stays `cbc201718`.
- B9 s2 source `8e6473ee316aa7a0b62df0366470ee13bdbd52ff` (infi-pc/paseo, "Exclude config changes from production counters") was fetched and pinned on uranus as `refs/research/infi-diff-exclusion-8e6473ee`. Sol verifies it before any worker reads it.

### Neptune worker hazards (2026-10-14)

- Paseo worktrees on neptune come with `packages/*/node_modules` symlinked into the shared main checkout `/Volumes/offload/neptune/repos/paseo`. `npm ci` then fails with ENOTDIR and creates empty directories in the main checkout. The B9 worker hit this. It verified that no file was written and nothing tracked changed, removed the 7 empty directories it had created, and removed its worktree's symlinks before reinstalling. Every neptune brief now says: remove only your worktree's `packages/*/node_modules` symlinks before `npm ci`.
- jcode does not re-invoke a worker when its background command finishes. Workers must wait for Sol sends in the foreground rather than end their turn with `WAITING`.

### B9 exceptions — coordinator sign-off (2026-10-15)

- **B9-S1-EXC-1 (sharing policy).** Sol: APPROVE, subject to coordinator sign-off recorded before edits. Scope: in `packages/app/src/git/diff-sharing.ts` `equalFile`, add `replaceEqualDeep(left.breakdown, right.breakdown) !== left.breakdown`. In `diff-sharing.test.ts`, add a `breakdown` key to the exhaustive `fileChanges` record and three focused cases: a deep-equal breakdown keeps the previous file reference; changed category counts replace the file; breakdown removal replaces the file. All existing assertions are preserved. Cause: the approved `messages.ts` hunk adds `breakdown` to `ParsedDiffFileSchema`. **Signed off by the Opus 5.5 coordinator.**
- **B9-HOOK-EXC-1 (`LEFTHOOK=0` for B9 stage commits).** Sol: APPROVE. The frozen infi-backend base `1dd375931` already fails whole-workspace typecheck at `packages/app/src/panels/panel-manifest.ts(46,3)` TS2739, so `lefthook.yml:16–17` blocks every commit. Before each B9 commit the worker must show: `npm run typecheck:server` green; whole-workspace typecheck with **only** that unchanged baseline error; `npm run lint` and format clean. Each stage report records the exception and the actual checks. No new failure is waived, and `panel-manifest.ts` stays outside B9. **Signed off by the Opus 5.5 coordinator.**
- **Baseline recorded:** frozen infi-backend `1dd375931` fails whole-workspace typecheck at `panel-manifest.ts(46,3)`. This is pre-campaign. Packages based on infi-backend must report it as baseline and never claim whole-workspace typecheck green.
- **B9-S3-EXC-1 (five carry-suite edits).** Scope:
  - `checkout-git.test.ts`: an exact-preserving helper, plus destructuring of the structured `files`.
  - An additive `commit-file-diff` test.
  - `ref-derived`: exact totals plus command accounting.
  - The browser seed helper, plus the code/config totals fixture.

  Exact totals, existing file fields, command accounting, and navigation/layout assertions are preserved. Breakdown assertions are additive only, and no matcher is weakened. Sol: advisor-approved. **Signed off by the Opus 5.5 coordinator (2026-10-15).**

### Standing coordinator sign-off rule (2026-10-15)

To cut round-trips, the coordinator pre-signs carry-suite or out-of-allowlist test edits that Sol approves **and** explicitly classifies as purely additive or exact-preserving. Such an edit adds assertions, cases or fixtures; removes or changes no existing assertion or expected value; and weakens no matcher. The worker quotes Sol's classification in its log and proceeds. Explicit coordinator sign-off is still required, before edits, for:

- any edit that changes an existing expected value, removes an assertion, or loosens a matcher;
- any production-code change outside the package allowlist;
- any hook bypass beyond B9-HOOK-EXC-1's terms;
- anything Sol flags as a behavioral carry-test exception.
