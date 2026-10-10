# Execution start — fork source refresh implementation campaign

Date: 2026-10-10. Control workspace `wks_171bca3667c4acf6`, branch `fork/source-refresh-control-20261010` (based on frozen `custom`). Campaign owner: GLM-5.3-Flash. Plan: `/Volumes/offload/neptune/repos/paseo/plans/ralplan-fork-source-refresh.md`, sha256 `abfe87512f35907382ff559d59a6a5c102ceff28290bb09faf62d16ed0605c53` — uncommitted in the source checkout, preserved there unmodified. This file is the binding EXECUTION-START note per plan §1.

## Authorization record

- User, 2026-10-10: "Send out implementation to be done by glm-5.3-flash with sol advisor."
- This authorizes local implementation of all 21 packages in the reviewed plan (5-pass consensus, pass 5 architect ACCEPT + critic APPROVE). The plan header's `Authority: none` / pending-approval status is superseded for local implementation only. Deployment, activation, publication, live-manifest edit, `mine` rebuild, production remediation, and remote pushes remain out of scope (plan §10).
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

Live `~/.paseo-fork/manifest.txt` edit; `mine` rebuild/change; releases, deployment, activation, publication; remote pushes; production daemon on port 6767 (no restart/access/repair); live-home audit or repair (C8 Track 2); edits to the frozen refs or to the source checkout's unrelated dirty files.

## Re-pin record — host migration neptune → uranus (2026-10-10)

Operations moved from neptune (macOS; network heavily throttled) to uranus (Ubuntu cloud box, `/home/ctaylor/repos/paseo`). All campaign work was preserved as pushed commits before the move. The frozen heads above were re-verified identical on uranus; nothing about the basket changed.

- **Coordinator:** the neptune GLM coordinator (`acb705cc-…`) is replaced by a Claude Opus 5.5 coordinator on uranus.
- **Advisor re-pin.** The authorization record says the Sol advisor is "reused — never relaunched." Sol `54e4d36e-38b4-4efa-8c19-c0aca88fa575` lives on neptune and cannot be reached reliably from uranus, so a new Sol was launched on uranus: `3f2c7ea5-1328-4cd7-85c3-8c3d3ddbe4ff` (`codex/gpt-6.1-sol`, full-access, low thinking, read-only reviews, reused for the rest of the campaign). Its first prompt carried the full C1 log and the approved C1 s2 PREFLIGHT verbatim, so prior verdicts bind it. Protocol is unchanged. This is the only advisor relaunch; any further one needs its own record here.
- **Plan location.** The plan is now committed on this branch at `plans/ralplan-fork-source-refresh.md` (sha256 unchanged, `abfe8751…0605c53`). This branch is the control branch from now on.
- **Remote pushes (out-of-scope change).** Cameron authorized pushing campaign branches to `origin` (git@github.com:camerontaylor/paseo.git) to preserve work: `fork/*refresh*`, `fork/source-refresh-control-20261010`, `fork/acp-diagnostics-0.11.1`, `fork/queue-alias-guard-0.11.1`, and `handover/*`, after each committed stage. No PRs. No pushes to `custom`, `mine`, or the frozen fork/* heads. The "remote pushes" entry in the standing out-of-scope list is narrowed accordingly; everything else on that list stands.
- **C1 s2 starting point.** The neptune worker `24636e40-330f-47a2-bde0-8817265461c1` was still running at handover and could not be cancelled. Its uncommitted tree was snapshotted as `handover/c1-s2-wip-20261010` (`b5dd0d2e2`, on `db54e7d71`). That snapshot is authoritative; neptune edits after it are ignored.
- **Moved frozen head: `custom`.** Cameron had neptune's `custom` pushed: `origin/custom` moved `cbc201718` → `c07c4e5280223f1cc9927c478102e27e0b039d29` ("feat(fork): Add automatic upstream release cycles"). Per this note that is a moved frozen head: the campaign keeps `cbc201718`, local `custom` on uranus is not fast-forwarded, and no campaign work is rebased onto it. The re-pin question goes to Sol at the next basket (C1). Custom-owned re-capture against `c07c4e528` (`git diff --name-only 41537e6a0 c07c4e528`) now lists one **non-`fork/`** path, `.github/workflows/fork-ci.yml`, alongside `fork/README.md`, `fork/briefs/release-cycle.md`, `fork/launchd/local.paseo-release-watch.plist`, `fork/plans/proposal-auto-release-cycle.md`, `fork/release-watch.md`, `fork/scripts/release-watch.{mjs,sh,test.mjs}`. If it is re-pinned, any tmad overlay touching `.github/workflows/fork-ci.yml` is a [PF] stop.
- **Workers.** `claude-zai/glm-5.3-flash` (bypass, high thinking) stays the assigned worker model. Muse Spark 1.3 Contributor is available as a second worker option through the `pi` provider (`pi/opencode-go/muse-spark-1.3-contributor`); the separate `muse` provider stays disabled and unused.
