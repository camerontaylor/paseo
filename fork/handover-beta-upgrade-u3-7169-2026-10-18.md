# Beta upgrade, U3 #7169 handover (2026-10-18)

Owning branch `fork/slash-followup-0.12.0-beta.1`, isolated worktree
`/home/ctaylor/repos/paseo-upgrade-slash-followup`. The disposable basket remains
at accepted `ea141f351`; all earlier source owners and the original custom
checkout remain unchanged. Checks ran on Neptune's exclusive private candidate.

**REAL OMP UNVERIFIED.** The real suite failed in `beforeAll`: `omp --version`
returned exit 127 with `env: bun: No such file or directory`. All 14 tests were
skipped; no test resources, body, turn, sentinel or cleanup path ran. This is
separate from #7179's real Claude availability-admission gap, which remains
UNVERIFIED through U7 with underlying cause unknown. Neither gap is a passing
runtime receipt or an established subject product failure.

## Fixed input and integration

| Identity | SHA |
| --- | --- |
| Accepted #7179 parent | `ea141f351920e51f7b7e0116352f998d8e97deb7` |
| Frozen #7169 base | `ae0b2588bf3a8f884b5b7207285e4df52bdcc01d` |
| Frozen #7169 head | `57427189cead2594dabb670a593c9a61b156921c` |
| Exact published squash | `cd77ecd837df40d042599d8847403eb416b35b04` |
| Attributed carry | `183aa718c870b9bdca79650ff2c07b4f14bc98e2` |
| Additive behavioral proof and bounded real cleanup | `b44b9f54b704d8e3dd195b553f099eb30a7cb8c7` |
| Approved test-only synchronization and callback extraction | `b2b8f342d2bb7e791578505ff75af7bd2f40379e` |
| Corrected source tree | `6d84b74037c7985b3750d6f5a37aa849966e31d8` |

The frozen `upstream-pins.json` SHA256 remains
`d26697e552936677125975c675f94e85b7de4f24e7294a4ef041ee75ca104833`.
The four frozen commits' net patch is byte-equal to the published squash patch,
stable patch ID `c7e3b5fac11acbccbaa0d46cd4dc8a0500869cb1`. Only that single
published commit was cherry-picked with its original author and exact `-x`
trailer. Its unrelated parent history is excluded. The carry's sole parent is
accepted #7179; the pin is attributed input, not a merge parent.

Fresh explicit-base inventory found two conflicted files and nine automatic
merges. The approved import union retains side-conversation imports alongside
the parser. The test union adds the envelope case before the accepted ACP
cancellation test, retaining its full name, fence comment and body. MCP's
automatic union retains earlier fork tests; eight OMP paths had identical
accepted/base blobs and received the pinned content. The carry is exactly
403 additions / 51 deletions across 11 files. No raw upstream basket is merged.

The sourced envelope is unwrapped only for provider command classification.
Recording retains its source and client identity; structured prompts pass
through. Idle OMP commands use the existing prompt lifecycle and request-ID
correlation; busy commands retain their active turn without aborting. The sole
private runtime `followUp` helper and its fake are retired after their caller
migrates; native active steering and existing RPC variants remain. No protocol,
dependency, authentication, authorization or broader provider change is included.

`source-inventory-b2b8f342d.json`, SHA256
`14e194e12c4ac1cff1b3177e9fa1a0cad41939245f4b0f84d3f730723bde3622`,
proves all 5,936 accepted paths outside the 11 subject paths remain unchanged.
Production remains identical to the attributed carry, including five exact
published OMP production blobs. Accepted manager tests are unchanged except the
additive case; the ACP cancellation tail and side-conversation import are exact.
The corrected child changes only MCP and the real harness. Its two extracted
real acceptance bodies are equal after formatting whitespace/trailing commas;
legacy real cases and the three reused unit-file blobs remain exact. This is
source preservation evidence, not real-provider runtime proof.

## Behavioral proof and receipts

Receipts live under local scratch
`/home/ctaylor/.jcode/scratch/beta-upgrade-20261017/u3-7169/` and Neptune
`~/.paseo-fork/candidates/upgrade-0.12.0-beta.1/evidence/u3-7169/`.

Compatible cases failed first against accepted #7179 production on Neptune.
The sourced manager command returned false instead of true. Both idle OMP
commands recorded no prompt instead of the exact streaming prompt. The first
selection expression matched only the manager case because parameterized test
names contain quotes; that one-failure receipt and its skipped OMP file remain.
The corrected selection ran both intended OMP cases: two behavioral failures,
71 skipped. No product/assertion change occurred between those selections.

The final tests cover `/follow-up` and `/steer` symmetrically: idle success,
early and late rejection using an ACK gate at the actual injected runtime seam,
unrelated request-ID rejection, exact ACK identity, terminal error and parent
notification. Actual session events prove one `turn_started` despite a later
native start. Busy delivery preserves the active turn and does not abort.
Manager coverage retains the original sourced timeline envelope/client identity
and verifies structured-input identity and human-pasted-envelope behavior.

| Check | Exact source | Receipt | Result |
| --- | --- | --- | --- |
| Owning `npm run build:server`, before unit files | `b44b9f54b` | `build-b44b9f54b.log` | Exit 0 |
| Complete `agent-manager.test.ts` | `b44b9f54b` | `agent-manager-b44b9f54b.log` | 226 pass |
| Complete OMP `agent.test.ts` | `b44b9f54b` | `omp-agent-b44b9f54b.log` | 73 pass |
| Complete OMP `cli-runtime.test.ts` | `b44b9f54b` | `omp-cli-runtime-b44b9f54b.log` | 23 pass |
| Initial complete MCP attempt, bail on first failure | `b44b9f54b` | `mcp-server-b44b9f54b.log` | 71 pass, 1 fail; remainder not run |
| Corrected complete MCP | `b2b8f342d` | `mcp-server-b2b8f342d.log` | 146 pass |
| Initial typecheck / lint / format | `b44b9f54b` | `static-b44b9f54b.log` | 0 / 1 / 0; five harness lint findings retained |
| Corrected typecheck / lint / format | `b2b8f342d` | `static-b2b8f342d.log` | 0 / 0 / 0 |
| Focused real OMP selection | `b44b9f54b` | `real-omp-b44b9f54b.log` | Exit 1 in beforeAll; all 14 skipped |

Build SHA256 is
`73c066b07b2edee03b1d79e7e7c5880b43c4dfea679e42419e220fc2748ccff5`.
Corrected static SHA256 is
`766d35ea79e3b98e2d18d1428daf61904d5c64a7d4631c29227d17532aeb7cc7`.
The final receipts cover 468 passing affected unit cases. The owning build and
three unchanged green unit files are reused after the test-only correction;
only failed/changed MCP and required static reran. The blocked real suite did
not rerun solely for mechanical callback extraction. No build or test ran on
Uranus, and no unchanged green suite reran.

## Failure classification and bounded corrections

The first strengthened rejection case observed manager `idle` immediately after
the fake runtime received its prompt. `nextPrompt()` establishes runtime receipt,
not ingestion of the manager's asynchronous `turn_started` event. Advisor and
coordinator approved waiting for actual manager `running` while the ACK remains
gated, before the unrelated-result injection. The immediate assertion after that
injection and all ACK-order, correlation, terminal, parent and no-abort assertions
remain. This is test startup synchronization, not a product correction.

The first lint receipt contains four nested-callback errors introduced by the
bounded real wrapper and one mutable-reverse error. The approved correction
lifts exactly the two complete idle callback bodies into named top-level helpers
and uses `toReversed()` for the same LIFO cleanup. Assertions, cleanup
registrations, sentinels, models and timeouts remain unchanged; no suppression
was added. Both source heads received advisor clearance.

The real selection requires the existing executable/version preflight. Its
actual `omp --version` command failed because its `bun` interpreter could not
resolve in the run environment. This does not prove OMP is uninstalled, a version
mismatch, authentication failure or quota issue. No provider installation,
authentication check, environment repair, model substitution or timeout/sentinel
adjustment occurred. No real command reached dispatch, admission or turn survival.

The approved harness attempts every acquired client, daemon and temporary root,
plus registered MCP cleanup, even after an earlier cleanup failure. Setup/body
errors retain their identity and report cleanup failures; cleanup-only failures
throw an aggregate after `finally`. Those paths are source reviewed, not runtime
exercised by the preflight failure; no injected cleanup-fault proof is claimed.

## Review and seal

The persistent advisor approved the bounded design before implementation,
cleared both source heads and approved both mechanical corrections before edits.
Its final **CONDITIONAL ACCEPT** at `b2b8f342d` verifies the source inventory,
468 unit passes and build/static receipts, with the real OMP gap explicit.
`advisor-final-b2b8f342d.txt` has SHA256
`54840170dbfc0a252d2530ffbf5414b43a4ac781cd99d83b1e23fc07bf0200e8`.

`receipts-b2b8f342d.sha256` seals 68 source, review and reproduction files,
SHA256 `4663b8093c08f08fc273417c4eefb7f6c844dae832f38ce3fddb94f33e6aa3ef`.
It retains the initial MCP, lint and real failures separately, plus corrected
passing receipts. The earlier 17-entry preflight seal remains unchanged.
Final docs formatting, exact docs-head static and clean integrity receipts sit
outside this source seal. Only this handover and the owning plan row belong in
the docs-only commit.

Coordinator ADVANCE remains ungranted. No later subject, basket mutation,
publication, live configuration change, restart, installation or activation is
part of this owner. The separate #7179 real gap and other U7 platform/runtime
obligations remain open.
