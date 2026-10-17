# Beta upgrade, U2e ACP model-switch handover (2026-10-18)

Owning branch `fork/acp-model-switch-0.12.0-beta.1`, isolated worktree
`/home/ctaylor/repos/paseo-upgrade-acp-model-switch`. Accepted U2d remains unchanged in
`/home/ctaylor/repos/paseo-upgrade-tmad-baseline`. Neptune's exclusive private candidate runs
the checks; no install, activation, publication, daemon restart or later-layer work is included.

## Inputs and merge

| Input | SHA |
| --- | --- |
| Accepted U2d parent | `79422b485d7f68dfa24d36a81caa03ead5807992` |
| Pinned ACP carry parent | `de8ea216a9d4a2a64bb01a593143f02bddcf8d0f` |
| Merge base | `cbc2017186b980e7928bc376cfdeabb90ef56aa2` |
| Source merge, both parents preserved | `7a9072d1ac38562244a394d70833de826d24a703` |
| Read-only preflight merge tree | `a2426d5fbcfe643020b5487ab31b746a5eb04276` |

The pin contributes exactly two unique commits: `85d391441` rejects requested model-selection
failures; `de8ea216a` supplies configured default thinking to CLI runs. From the merge base,
ours changes 1,144 paths and the carry five. Four paths are shared, one is carry-only. The fresh
merge matches preflight: two conflicted paths with one import hunk each, two automatic shared
merges and one carry-only path. The source merge changes exactly five files, 389 additions and
70 deletions. No old basket is replayed.

## Conflict and automatic-merge audit

| Path | Result |
| --- | --- |
| CLI `commands/agent/run.ts` | Keep accepted shared `resolveCallerAgentId`; retire the carry's obsolete inline-caller error import. Use existing `Pick<ConnectedDaemonClient, "listProviderModels">`; no redundant client type. Preserve beta `waitsForFinish`, `--no-wait`, legacy aliases, structured-output restrictions, explicit daemon target and caller/workspace precedence. |
| CLI `commands/agent/run.test.ts` | Union `waitsForFinish` and `resolveRunThinkingOption` imports. Keep accepted caller/wait/transport/validation assertions, six carried default-thinking cases and six approved command-level cases. |
| Server `providers/acp-agent.ts` | Shared automatic merge; blob equals the inspected trial `17e13394032823c39127cc9ee2beac1fec5af00b`. Preserve usage/environment/session identity, history-only runtime release, argument hints, cancellation ledger, staged successors and late-event ownership. |
| Server `providers/acp-agent.test.ts` | Shared automatic merge; blob equals trial `3cef9deb9966173c275f97f4647e6cb3b1bfe93d`. Preserve argument-hint fixture and expectations, cancellation/successor/history/configured-model/mode cases. Model-warning expectations intentionally become rejection expectations. |
| Server `providers/generic-acp-agent.request-errors.test.ts` | Carry-only; blob equals pin `8eb64208f25c6fb7047e9b3524ea487e00f7334a`. Retain existing mode/effort errors and real fake-process JSON-RPC coverage for creation, resume, later rejection and config-only success. |

The intentional behavior change retires model-specific warning/silent-default handling and
`isModelSelectionUnavailableError`. Invalid requested model choices and failed model RPCs reject.
Only normalized method-not-found `-32601` permits config-option selection. Other RPC errors retain
their details; unsuccessful switches retain the current model. Initialization/resume still close
after failure and preserve the original error. Invalid-mode warnings and unrelated feature
tolerance remain.

Configured CLI thinking is a separate retained behavior. Omitted effort uses the selected model's
configured default, then its marked-default option; omitted model uses the default catalog model,
then the first. Explicit trimmed effort bypasses lookup. Unknown explicit models and models
without a default leave effort unset; catalog errors reject. Lookup and both creation paths use
the resolved workspace directory and the same explicitly targeted connected client.

Beta owns argument hints already; no duplicate hint or initial-wait implementation is restored.
The shared caller helper owns absent cross-daemon callers and transport failures. No protocol,
client, session, manager, registry, GJC, Pi, app, manifest or dependency edits are needed.

## Evidence and review

Receipts live on Neptune under
`~/.paseo-fork/candidates/upgrade-0.12.0-beta.1/evidence/u2e/`; local copies live under
`/home/ctaylor/.jcode/scratch/beta-upgrade-20261017/u2e/`.

Preflight report `preflight-79422b485-de8ea216a.md`, merge-tree output and
`preflight-inventory.json` were delivered to the existing advisor and coordinator before edits.
Advisor approved the bounded design; coordinator explicitly authorized implementation and the
command-level tests. Advisor source clearance at the exact merge SHA is saved in
`advisor-source-7a9072d1a.txt`: no blocking source or test-validity finding.
Final advisor **ACCEPT** at that source SHA is saved in `advisor-final-7a9072d1a.txt`, SHA256
`697f917587b0de0a2bc618c5d535aa1206318e2d9b5b63f89cbe614dfc1bceb0`. The coordinator independently
verified both parents, source/build hashes, owning build, 177 passing tests and static checks.

| Check at source `7a9072d1ac38562244a394d70833de826d24a703` | Receipt | Result |
| --- | --- | --- |
| Owning `npm run build:server`, before focused tests | `build-7a9072d1a.log` | Exit 0 |
| CLI `run.test.ts`, `--bail=1` | `cli-run-7a9072d1a.log` | 25/25 pass |
| Server `acp-agent.test.ts`, `--bail=1` | `acp-agent-7a9072d1a.log` | 141/141 pass |
| Server `generic-acp-agent.request-errors.test.ts`, `--bail=1` | `generic-acp-agent.request-errors-7a9072d1a.log` | 11/11 pass |
| Required typecheck, lint, format | `static-7a9072d1a.log` | All exit 0 |

Source static SHA256: `eee6ebbb574042d9426668573fbdb373181b67c468aeeaec055d783d245baee9`.
Owning build SHA256: `382e9e21325a9bb7a0206dd6840f595f770af54249b30ea42836db469881cc36`.

The sealed source inventory `receipts-7a9072d1a.sha256` contains 18 receipts and reproduction
scripts, SHA256 `5ce308fa77a544673f1bc344a633f897f0ff03f006f2c1f2e8254e5a1ed69154`.
All entries were verified locally and on Neptune. Documentation-seal formatting, final-head static
and final handover integrity receipts sit outside this source inventory; they do not replace the
source test receipts.

The six new command cases execute `runRunCommand` through a test connected-client adapter:
ordinary and structured creation each prove computed and trimmed explicit effort, resolved cwd
distinct from requested cwd, exact target, exactly one create and close, and catalog bypass for
explicit effort. Structured output uses the real response parser. Two catalog-failure cases prove
rejection with no creation or wait and one close. Existing helper assertions remain separate.

`integration-inventory-7a9072d1a.json` binds both parents, all five changed blobs and 20 unchanged
seams to the source SHA. It proves source preservation, not new runtime coverage. Unchanged
manager/session/client/protocol/target/GJC/Pi and U2d queue/artifact suites are not rerun. Their
older receipts retain their original SHA and scope in the [U2d ledger](handover-beta-upgrade-u2d-2026-10-17.md)
and its preceding layer links; an inspected source path is not promoted into a runtime receipt.

The first local commit hook attempted format/lint/typecheck in the dependency-free Uranus
worktree and failed on missing tools; app pretypecheck could not start its build because `tsc`
was absent. No suite ran or build completed. `local-hook-incident.txt` records this blocked attempt;
it supplies no verification evidence. The actual local merge used `LEFTHOOK=0` after Neptune's
`npm run format` passed. All owning build/test/static validation runs on Neptune.

## Acceptance boundary

Source and receipts are accepted. This handover is the only change after the source merge.
The docs seal requires typecheck, lint and format at the exact final head, recorded externally as
`static-<final-head>.log`, plus clean matching local and Neptune heads in `handover-<final-head>.txt`.
No passing focused suite is rerun for this documentation-only delta.

Coordinator U2e ADVANCE verification remains separate; this ledger does not grant it. U2d's
native/device, packaged Electron, locale and environment limitations remain as recorded in its
ledger. A1 and later layers require their own explicit preflight/design authorization; no wider
fixes or production actions are authorized.
