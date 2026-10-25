# Beta upgrade, U3 #6762 handover (2026-10-18)

Owning branch `fork/snapshot-trimming-0.12.0-beta.1`, isolated worktree
`/home/ctaylor/repos/paseo-upgrade-snapshot-trimming`, starts directly from accepted
#7169 `78209041d`. The disposable basket remains at that accepted head. All nine
earlier owners and the original custom checkout remain unchanged. Checks ran
on Neptune's exclusive private candidate; no build or test ran on Uranus.

## Fixed input and integration

| Identity | SHA |
| --- | --- |
| Accepted parent | `78209041d21f7a308393f5ed7208d7bf49a46960` |
| Frozen #6762 base | `cd77ecd837df40d042599d8847403eb416b35b04` |
| Frozen #6762 head | `6c71d34ef9225ac7dad7f84ef8993d8ceebf9a32` |
| Frozen test-merge | `52daa97fd4ac12ad7a899e2490add2c520339eba` |
| Single original subject | `74fe3ee8d81d54ca53f9be1c91f2bab0b25fed24` |
| Attributed carry | `40252cc7fddceb7c77c1c7810f7eeab6ac8fd839` |
| Final source and approved preservation tests | `82b8722519d4b8228345e1bbe7d0c434b8448727` |
| Final source tree | `5a785da3e0d39a504fa083a14f6a764d95f56052` |

Frozen `upstream-pins.json` SHA256 remains
`d26697e552936677125975c675f94e85b7de4f24e7294a4ef041ee75ca104833`.
The original single subject, frozen base-to-head net and frozen test-merge
first-parent diff are byte-equal: two files, 59 additions, zero deletions,
SHA256 `b7da49f9ef94a9df682a831f7ae7f7b432a3a87f28e6ab3056b8c8cbebcbdb5d`.
Only the original subject was cherry-picked with its author and exact `-x`
attribution; three main-sync commits and unrelated upstream ancestry are excluded.

Fresh preflight and actual integration had zero conflicts. The sole automatic
content merge in `agent-projections.ts` preserves the accepted artifact and
companion-entry additions. The carry tree exactly matches the preflight trial
`0c4abe6b1fcb5694bce3a2445efaf9286d8f3ac1`. No shared hunk required resolution.

The only production addition omits `metadata.asyncQuestions` from the existing
wire projection's sanitized clone. Private stored records retain the full resume
log. Existing MCP omission, empty-metadata handling, native handles, unrelated
metadata, live pending permissions and retained stream facts remain. Stored
snapshots keep their existing empty pending-permissions policy until restoration.
This is neither a general sanitizer nor a total snapshot-size bound.

`source-inventory-82b872251.json`, SHA256
`fe4663425c9ea79e1cfc91c015f74a695c25e85de9569ccaa9b133be92ece4e2`,
proves the production delta is exactly the approved three lines, both upstream
test bodies are unchanged, and all 5,944 accepted paths outside the four changed
paths are identical. Earlier side-conversation, queue, receipt/subscription,
ACP model/cancellation and #7179/#7169 ownership is preserved without rerunning
unchanged suites. No protocol, dependency, authorization or provider change occurs.

## Behavioral proof and receipts

Local receipts:
`/home/ctaylor/.jcode/scratch/beta-upgrade-20261017/u3-6762-implementation/`.
Neptune receipts:
`~/.paseo-fork/candidates/upgrade-0.12.0-beta.1/evidence/u3-6762-implementation/`.
The separate 20-entry preflight seal remains unchanged at SHA256
`e26e7e107ded248031a0f7a2cc4825b4ee47c1e6c2ac7177dd40e60f44603cd5`.

Five selected cases failed first against accepted production on Neptune. Both
upstream omission cases, the mixed-metadata case, actual disk-reload case and
strengthened Codex wrapper case each failed at the intended wire omission
assertion because `asyncQuestions` remained present. These were behavioral
failures after setup, not import, bootstrap or provider-availability failures.
Their five `red-*.log` files and the unchanged production blob identity remain.

The mixed case checks unrelated metadata/native handle, exact sanitized pending
permission, artifact/companion facts, source/record nonmutation and a detached
wire mutation. The storage case uses `applySnapshot`, actual JSON, an independent
store reload, wire projection and a second independent reload; disk bytes remain
unchanged. The Codex case uses the real session wrapper and AgentManager with
the existing fake app-server adapter: the actual pending request remains
actionable, answering removes it, and the full answered private log remains
while wire snapshots omit it. Existing answer, rewind, Stop, late-follow-up,
retry and resume cases remain in the full changed suite.

| Check at exact source `82b872251` | Receipt | Result |
| --- | --- | --- |
| Owning `npm run build:server`, before suites | `build-82b872251.log` | Exit 0 |
| Complete `agent-projections.test.ts` | `projections-82b872251.log` | 23 pass |
| Complete `agent-storage.test.ts` | `storage-82b872251.log` | 21 pass |
| Complete `codex-async-questions.test.ts` | `codex-questions-82b872251.log` | 11 pass |
| Required typecheck / lint / format | `static-82b872251.log` | 0 / 0 / 0 |

All three changed full files ran once after the owning build: 55 passing unit
cases. No product or assertion repair was needed. Build SHA256 is
`5182dcbb7f7d644bf140362af94f93a393bb424a5dc83da8a8e4fac01c047a94`;
source static SHA256 is
`33e25a474d17474f6ca5d49ed9cce08c33eabe2e5f7c00985f2845b66d44e0cc`.
The local edit-only formatter attempt lacked `oxfmt` (exit 127). Existing Neptune
dependencies completed the same npm formatting operation; no installation or
environment repair occurred. This is separate from required static evidence.

## Review, seal and remaining gaps

Advisor **ACCEPT** at exact source `82b872251`: matching log hashes, owning
build, 55 passing tests, exact-source static and preservation inventory were
reviewed directly. No further source correction is required. The saved verdict
`advisor-final-82b872251.txt` has SHA256
`47cf56e4c92e1f222ac8110e129b541789f0f4e58c7b303888714f01060f6007`.

The 31-entry source seal `receipts-82b872251.sha256` has SHA256
`cae07b3c4badb0b92bfbe52237f595efd2b85e03f3d45e21ce0196df6322828f`.
Both hosts verify every entry. It retains all five intended failing-first
receipts, the failed local formatter attempt and the successful Neptune checks.
Final docs-head static and clean-host receipts remain outside that source seal
in `final-static.log`, `final-static.summary` and `receipts-final.sha256`.
The docs-only seal does not change the checked source tree. No green suite or
build is rerun for that seal.

The targeted docs-format command encountered the explicit `fork/**/*.md`
formatter exclusion. The full `npm run format` script succeeded; both command
receipts are retained separately. No formatter configuration changed.

Both inherited real-provider gaps remain explicit and unclosed through U7:

- **#7179 REAL Claude turn survival UNVERIFIED:** both real runs failed at
  createAgent availability admission before dispatch/sentinel/controls;
  underlying cause unknown.
- **#7169 REAL OMP UNVERIFIED:** `beforeAll` `omp --version` exited 127 with
  `env: bun: No such file or directory`; all 14 skipped before resources, body,
  turn or sentinel. No runtime cleanup path was exercised.

Projection unit results do not close either gap or the earlier physical/native,
packaged Electron and locale obligations. No runtime-green claim, provider/auth
probe, environment repair, basket/manifest write, later subject, publication,
live configuration change, restart, installation or activation is included.
Coordinator ADVANCE remains a separate gate.
