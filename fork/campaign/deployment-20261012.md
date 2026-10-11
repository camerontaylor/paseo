# Partial deployment, 2026-10-12

Authority: Cameron requested "Resume, deploy work that is available." See [execution-start.md](execution-start.md#authorization-record). This release is separate from the frozen campaign baskets.

## Inputs

- Current release: `d62ed60c8db88f762945284b433d57c43c6f1c69`, based on upstream 0.11.2. Preserve its ACP model-switch fix.
- Current custom: `a4d6922874fb68fa5cab2ffa946a80baf8c441e4`. Do not substitute it for the campaign's frozen custom.
- C1: `8468e7f55`, accepted.
- C2: `2671a9f62`, accepted.
- A1: `831f6a858`, package and frozen-basket ADVANCE. Campaign basket `9d2fdd0d243272794756eabf78243bb0ee85d5c7`.
- Coordinator resumed as Jcode on uranus. Persistent Sol advisor `3f2c7ea5` resumed with its existing context. Workers remain DeepSeek V4.1 Flash via Jcode.

## Delivery checklist

- [x] Verify committed package state and resume persistent advisor.
- [x] Close A1 package and frozen-basket gates.
- [x] Obtain advisor partial-deployment preflight.
- [x] Assemble candidate on current release, preserving existing changes.
- [ ] Check build, typecheck, lint, format, and affected targeted suites.
- [ ] Run remote Fork CI and publication dry-run on exact candidate.
- [ ] Obtain advisor release verdict.
- [ ] Verify release branch is unchanged, then fast-forward `mine` without force.
- [ ] Verify publication and registry version.
- [x] Resume next serial package with a DeepSeek worker.

## Candidate and running checks

Candidate: `568b12127fe0519396ef18ebfdcd74d205480f7d` on `fork/refresh-deploy-20261012`, based on the recorded release plus C1, C2, A1 in that order. Versions, release tooling, and workflows are unchanged. The newer ACP fix remains an ancestor. One test-file conflict retained A1's inserted regression and the current release's renamed test and assertions, after Sol's exact-resolution PREFLIGHT APPROVE.

- Fork CI: https://github.com/camerontaylor/paseo/actions/runs/38150800919
- Publication dry-run: https://github.com/camerontaylor/paseo/actions/runs/38150802920
- Both runs report the exact candidate SHA. Results are pending.
- Local validation is serial. Logs: `/home/ctaylor/.jcode/scratch/partial-deploy-checks/`.
- A2 worker `3af10474-80e6-4085-8371-62a4d4b7b062` is on `fork/infi-refresh-quit-dialog-0.11.1`, based on frozen backend. Its initial task is read-only s0, followed by a stop. No concurrent worker builds or suites are authorized during local release validation.

Integration merge hooks were skipped; checks run after assembly. Control records are docs-only and `fork/**/*.md` is explicitly excluded by the repo formatter. The formatter is still run before commits. No unchecked production-code commit is represented as validated.

## Advisor preflight

> **PREFLIGHT APPROVE — separate partial-release candidate based on `d62ed60c8db88f762945284b433d57c43c6f1c69`. This does not yet approve pushing `mine`.**

Sol approved C1, C2, then A1 after its package gate. Release approval still requires exact-SHA CI and packaging evidence, local checks, preservation of 0.11.2 and the shipped ACP fix, and a final remote-head check. Recorded browser/native/locale/real-disk gaps are nonblocking for this requested partial npm release, not evidence of platform acceptance. No live activation is authorized.

## Safety and open evidence

No production restart, in-place installation, config change, or live-home repair. The live Desvio directory is absent on uranus, so no live manifest is edited. A future Desvio rebuild needs the accepted overlays added to the owning host's manifest or it will drop them.

C1 and C2 retain the QA limitations in the ledger. No native evidence or real disk-full result is claimed. Two baseline daemon e2e failures were established on the frozen 0.11.1 basket, not on the current 0.11.2 release, so candidate failures need their own baseline comparison.
