# Beta upgrade, U2f A1 diagnostics handover (2026-10-18)

Owning branch `fork/a1-diagnostics-0.12.0-beta.1`, isolated worktree
`/home/ctaylor/repos/paseo-upgrade-a1`. Accepted local U2e and U2d worktrees remain
unchanged. Checks use Neptune's exclusive private candidate. This carry includes
no later layer, installation, publication, activation or daemon restart.

## Inputs and candidate ownership

| Input | SHA |
| --- | --- |
| Accepted U2e parent | `216eaa8fad88f4c09cf3479f73822f1d68e406e3` |
| Pinned A1 parent | `831f6a858127a41a6eeeef1dce2e6df0c905e18c` |
| Common merge base | `cbc2017186b980e7928bc376cfdeabb90ef56aa2` |
| Source merge, both parents preserved | `2747fae346da7bb37591cf6e40cd7ae5269c23cc` |
| Source tree | `c7685f8ff3405428ad5b2042e95e9970cc7c0731` |
| Read-only trial tree | `8495a5f8be22cf2c5e3d8b75242930ed52bbe72d` |

A1 was published in `929d7427163474f5c0cbfc45192436d3de7540c6` but was not an
ancestor of captured `origin/custom` (`7ce6fca987721c33ad2b87fcab8d1cb59f4b0c8b`)
or accepted U2e. Its pin contains exactly two unique commits: `09beed6e2`
preserves structured startup errors; `831f6a858` adds mode-rejection evidence.
The owning plan requires explicit preservation rather than a basket replay.

The candidate order must include this separate owner immediately after ACP:

```text
fork/acp-model-switch-0.12.0-beta.1
fork/a1-diagnostics-0.12.0-beta.1
```

The coordinator will commit that order in the control fork's separate
`fork/campaign/upgrade-0.12.0-beta.1.manifest.txt` before baseline assembly,
with all accepted heads pinned in comments. Candidate ownership remains open
until that file is committed; the owning branch alone does not close the
manifest omission. No live manifest was edited. Its read-only captured SHA256 remains
`95b83dd57269bd0b754de4adbaeed4ce4ffef5e1d94eb4382fbe17e43d289bf6`.

## Resolution and preservation

The fresh merge reproduced preflight: four shared paths, one test conflict hunk
and three automatic shared merges. There were no carry-only paths. The pin's
48 additions / 3 deletions become 122 additions / 3 deletions after the two
approved additive tests. No pre-existing test line or assertion is removed.

| Server path | Final treatment |
| --- | --- |
| `agent/providers/acp-agent.test.ts` | Union the carried mode-rejection test with the accepted stored-values test title and body. Retain U2e model rejection assertions and add the nonstandard-object summary and real-wrapper cases. |
| `agent/providers/acp-agent.ts` | Automatic shared merge equals the reviewed trial. Replace only the non-ACP/non-Error summary coercion and non-ACP object Error construction with the existing formatter. |
| `creation/index.ts` | Automatic shared merge equals the reviewed trial. Import the existing formatter and replace the failed-snapshot error expression; keep admission, receipt, stage, resource, retry and observer ownership. |
| `creation/index.test.ts` | Preserve the automatic carried structured-object test and add returned/observed/persisted real-Error coverage. |

Mode request wrapping already exists upstream and in accepted beta. Its carried
test is inherited equivalence coverage. The three formatter substitutions are
the missing production delta. The original A1 review and release evidence are
recorded in the preflight; historical receipts retain their original SHAs.

U2e still owns rejected model switches, numeric method-not-found `-32601`
config fallback, failure retaining the current model, initialization cleanup
and original errors. ACP cancellation, staged successor/history, argument hints,
configured models and modes remain covered by their retained assertions. CLI
caller identity, waitsForFinish, daemon targeting and computed thinking are
unchanged. The unrelated spawn-error and worktree-wrapper paths are untouched.

## Diagnostic exposure and authority

The carry reuses `agent/providers/diagnostic-utils.ts`; no second formatter is
introduced. Creation failures from real Errors now include code, signal,
stderr, stdout and cause, in addition to message. Nonstandard objects serialize
as JSON. ACP Error identity and numeric code handling remain unchanged.

The advisor and coordinator explicitly accepted this published diagnostic
expansion within existing operator-facing receipt/subscription authority.
These strings are unredacted and have no global size cap. The existing helper
caps individual Error stderr/stdout fields at 4,096 characters; that does not
cap arbitrary object JSON, messages, causes or aggregate output. Diagnostics
can persist in creation receipts and reach authorized clients and turn errors.

Pino's structured header redaction and the daemon diagnostic-export scrubber
are separate owners; neither protects these creation/turn strings. No new
export, upload, logging expansion, sanitizer, schema, authentication or
authorization change is included. Existing creation and subscription permission
mapping and delivery lifetime remain unchanged. The preflight traces the
current agent-only worktree wrapper's independent coercion boundary; this carry
does not claim all provider objects survive every UI path.

## Verification and review

Receipts live on Neptune under
`~/.paseo-fork/candidates/upgrade-0.12.0-beta.1/evidence/u2f/`; local copies live
under `/home/ctaylor/.jcode/scratch/beta-upgrade-20261017/u2f/`.

The persistent advisor approved the bounded design before edits. Coordinator
implementation sign-off explicitly accepted the diagnostic expansion, conflict
union, two additive tests, failing-first checks and unchanged authority.
Exact source was sent for advisor review while Neptune's checks ran.

Four bounded new cases each failed against accepted U2e production before the
substitutions: wrapper object details, summary object details, creation object
coercion and creation real-Error extras/cause. Each run selected only that case;
the inherited mode test was excluded. `failing-first-source.txt` binds accepted
production blobs and formatted test hashes. The failures are assertion failures
for missing diagnostic content, not harness or compilation failures.

The real-wrapper test calls `applyConfiguredOverrides` and the existing
`setSessionMode` seam, verifies an Error with exact serialized rejection detail,
one dispatch, no config fallback and unchanged mode. The creation test uses real
temporary receipt files, verifies exact formatted Error content in returned and
observed snapshots, then reads it through a fresh CreationService subscription.
It preserves failedStage, errorCode, outcomeUnknown and workspace assertions.
All added diagnostic strings are synthetic and non-secret.

| Check at source `2747fae346da7bb37591cf6e40cd7ae5269c23cc` | Receipt | Result |
| --- | --- | --- |
| Owning `npm run build:server`, before complete suites | `build-2747fae34.log` | Exit 0 |
| ACP `acp-agent.test.ts`, `--bail=1` | `acp-agent-2747fae34.log` | 144/144 pass |
| Creation `creation/index.test.ts`, `--bail=1` | `creation-2747fae34.log` | 13/13 pass |
| Required typecheck, lint and format | `static-2747fae34.log` | All exit 0 |

Build SHA256: `c0e44672f909c42c434b79d25999365eb69a5e509ae766444c39376020909630`.
Source static SHA256: `44e62642138e6cf0eb09a40a2efc14a739b6884f1fd3b93a657334328d89ef91`.
The two changed suites ran once in full after the owning build: 157 passing
tests. No source edit followed those checks. No build or test ran on Uranus.

Advisor source clearance is saved in `advisor-source-2747fae34.txt`. Final
**ACCEPT** at the same source SHA is saved in `advisor-final-2747fae34.txt`,
SHA256 `07870802cda1d17c69bae6619b85881f83104a114fbfdccd05cbfa2a55f3a3cf`.
The advisor checked the exact receipts and required this completed verification
record before sealing. Prior platform/environment gaps remain open; acceptance
does not grant ADVANCE, activation or a later layer.

`receipts-2747fae34.sha256` seals 31 source receipts and reproduction files,
SHA256 `528de2e01d5c0c6036488a81b554ddb424f478cd6fc782d78f0912a16264d7cb`.
Later docs-only formatting, final-head static and handover integrity receipts
sit outside that source inventory and do not replace its runtime evidence.

`source-inventory-2747fae34.json` binds both parents, four changed paths and 20
unchanged seams. Its SHA256 is
`6cf8a8d24884731df0ee9dcc3847444d5ab2051eef774f235642fd091b3410b6`.
It proves source preservation, not runtime coverage. Unchanged CLI and real ACP
request-error suites retain their U2e 25/11 passing receipts at the original SHA;
unchanged formatter, permission, app and browser suites are not rerun. See the
[U2e ledger](handover-beta-upgrade-u2e-2026-10-18.md) for preceding evidence.
