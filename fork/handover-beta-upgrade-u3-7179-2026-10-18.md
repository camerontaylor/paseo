# Beta upgrade, U3 #7179 handover (2026-10-18)

Owning branch `fork/claude-turn-survival-0.12.0-beta.1`, isolated worktree
`/home/ctaylor/repos/paseo-upgrade-claude-turn-survival`. The disposable basket
remains at accepted baseline `6a2d930ee`; all previous source owners remain
unchanged. Checks ran on Neptune's exclusive private candidate.

**REAL Claude turn survival UNVERIFIED.** Both real runs failed during
`createAgent` availability admission, before dispatch, sentinel or controls.
The underlying cause is unknown. Advisor acceptance is conditional on keeping
this gap explicit; the coordinator will consider source-only progression with
the real gap tracked at U7. ADVANCE and later preflight remain ungranted.

## Fixed input and source ownership

| Identity | SHA |
| --- | --- |
| Accepted A1 parent | `6a2d930ee4845e121c718a143742b9d2cb8909c0` |
| Exact #7179 subject pin | `4e63574404ddf2a8153455d6a79bf45c4756fff8` |
| Subject's upstream parent, excluded from integration | `30122b1ae11369f275cf931b68078716d5a8c4c3` |
| Attributed source cherry-pick | `34176c6142b357f03f7040f51646de69a4bd07ac` |
| Approved test-only cleanup correction | `2b5f4be7d11f7a619f8d2317eb50639efcfd4dd5` |
| Corrected source tree | `f0d74140fc67f110844d1ed6d040a466152010de` |

The checked-in `upstream-pins.json` SHA256 remains
`d26697e552936677125975c675f94e85b7de4f24e7294a4ef041ee75ca104833`.
The single subject was cherry-picked with its original author and exact source
trailer. Its parent history was excluded: #6242 background-subagent UI, #7098
question-response UI and lockfile/Nix signatures are not carried here. The pin
is attributed input, not a merge parent. The sole source-cherry-pick parent is
accepted A1; the cleanup correction is its direct child.

Fresh preflight and actual application both found one conflicted production
file and one hunk. The approved union retains `ensureQuery`'s entry and
post-build closed-session guards and carries the exact upstream active-query
reuse condition. The automatically merged `previousQuery` identity comparison
distinguishes a reused running query from a rejected newly launched query.
Production remains exactly 5 additions / 3 deletions from accepted A1.

Current mode, plan state, original mode-error rethrow, side-question restart
refusal, cancellation, process reaping, autonomous-turn ownership and all other
fork seams remain unchanged. No protocol, dependency, provider configuration,
authentication or authorization change is included. No earlier owner is retired.

`source-inventory-2b5f4be7d.json`, SHA256
`0ce95c8a930a8a05f7ee5dfd1b93d8095bb061df408d9c5bf6a557568a5069af`,
proves the exact production substitutions, unchanged upstream test and real
acceptance bodies, and all 5,943 accepted paths outside the production file.
The only additions are the two carried test files. The cleanup-only child
changes neither production nor the four unit files; owning-build inputs remain
unchanged. This inventory proves source preservation, not runtime behavior.

## Tests and exact receipts

Receipts live under local scratch
`/home/ctaylor/.jcode/scratch/beta-upgrade-20261017/u3-7179/` and Neptune
`~/.paseo-fork/candidates/upgrade-0.12.0-beta.1/evidence/u3-7179/`.

The three original mode/model/commands cases each failed first against accepted
A1 production with `query closed before turn finished`, rather than setup or
compilation failure. Separate failing-first logs retain each result and the
accepted production and original test blobs. The complete new suite then passed
all five cases after the carry. The additive active/idle rejection cases assert
original error identity, retained mode, actual running-query survival, pending
effort on the next turn and retirement of the rejected idle replacement query.

| Check | Exact source | Receipt | Result |
| --- | --- | --- | --- |
| Owning `npm run build:server`, before unit files | `34176c614` | `build-34176c614.log` | Exit 0 |
| Complete `agent.live-settings.test.ts` | `34176c614` | `live-settings-34176c614.log` | 5 pass |
| Complete `agent.redesign.test.ts` | `34176c614` | `redesign-34176c614.log` | 40 pass |
| Complete `side-question.test.ts` | `34176c614` | `side-question-34176c614.log` | 23 pass |
| Complete `agent.interrupt-restart-regression.test.ts` | `34176c614` | `interrupt-restart-34176c614.log` | 14 pass |
| Initial typecheck / lint / format | `34176c614` | `static-34176c614.log` | 0 / 1 / 0; original lint failure retained |
| Corrected typecheck / lint / format | `2b5f4be7d` | `static-2b5f4be7d.log` | 0 / 0 / 0 |
| Initial real-provider case | `34176c614` | `real-mid-turn-34176c614.log` | Exit 1; availability admission gap |
| Changed real-provider case | `2b5f4be7d` | `real-mid-turn-2b5f4be7d.log` | Exit 1; availability admission gap |

Build SHA256 is
`f96132c525485f8868def3e7e585759ca902dc69a736a3541919ba76d57d2815`.
Corrected source static SHA256 is
`f42d7a9cbca831a2eb4bdce1cb920ced5ec6dfbafca5fcd179fd5c1fcd8dfb24`.
The four affected unit files ran once: 82 passing cases. The build and unit
receipts retain their original source SHA and are reused after the approved
cleanup-only correction. No unchanged green suite was rerun. No build or test
ran on Uranus.

## Real-provider gap and cleanup classification

Both real failures report `Provider 'claude' is not available` with
`exit code: unknown`, at `client.createAgent` (initial line 27, corrected line
28). Their test bodies ran 352 ms and 401 ms. Neither reached timeline
subscription, message dispatch, sentinel creation, thinking/mode controls or the
first-command completion assertion. Neither supplies a passing runtime receipt
or a #7179 product-failure verdict.

Read-only source tracing identifies the ready-provider admission check and
Claude's default launch resolver. It does not establish a missing installation,
configuration, version, authentication or quota cause. A separate attempted
diagnostic import failed with `ERR_MODULE_NOT_FOUND` before loading a nonexistent
unbundled dist module; it is retained as a failed diagnostic command and supplies
no provider-cause evidence. No provider/auth command, install, environment change,
model substitution or timeout/sentinel adjustment was performed for diagnosis.

Both runs acquired daemon and client resources before creation failed. Cleanup
attempts each acquired resource independently, preserving the primary throwable
and reporting cleanup failures. Both receipts retain the original admission
error and report no cleanup aggregate; this is not injected cleanup-fault proof.
The first static run flagged the success-body cleanup throw inside `finally`.
Advisor and coordinator approved moving that throw after `finally`, collecting
failures outside and reporting inside only when a primary failure exists. The
original lint failure and both failed real runs remain separate receipts.

The unchanged real-case contract would prove only the first foreground command
completes after the controls. It does not claim all three commands or final DONE.
That proof remains open at U7; no provider installation, auth check or assertion
relaxation is authorized by this handover.

## Review and seal

The persistent advisor approved design before implementation, cleared both exact
source heads, and issued **CONDITIONAL ACCEPT** at `2b5f4be7d`. Its final ruling
is `advisor-final-2b5f4be7d.txt`, SHA256
`226e2f5bc5a011da862c0552dd2574561e9c815688f7c482e8bbed90f03fc0ff`.
Coordinator authorized the bounded carry and cleanup correction, then the
docs-only seal with the real gap explicit. This does not grant progression.

`receipts-2b5f4be7d.sha256` seals 62 source, review and reproduction files,
SHA256 `738ee1b846d133991ab90d275c257d7aab806b7fd30ffa75036b320962156f17`.
It includes both real failures, the original failed static receipt and corrected
passing static receipt. The earlier 13-entry preflight inventory is preserved.
Final docs-only formatting, final-head static and clean-head integrity receipts
sit outside this sealed source inventory. The handover and owning-plan row are
the only intended docs-seal changes; no later subject or basket edit is included.
