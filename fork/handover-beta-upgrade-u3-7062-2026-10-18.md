# Beta upgrade, U3 #7062 handover (2026-10-18)

Owner `fork/attention-edges-0.12.0-beta.1` in isolated worktree
`/home/ctaylor/repos/paseo-upgrade-attention-edges` starts directly from accepted
#7057. All eleven earlier owners and original custom remain clean and unchanged.
The disposable basket remains at accepted `e96eb390f`. Checks ran only on the
exclusive Neptune candidate; no build or suite ran on Uranus.

## Fixed input and preservation

| Identity | SHA |
| --- | --- |
| Accepted parent | `e96eb390f5419bf51c357988b65fd86b82ea6ad9` |
| Frozen base, original subject parent | `208e323035ab40bbf3b3476fb6175330bc79821c` |
| Frozen head, single original subject | `a48bb2208688a4c71a5f91c7dce8ceac3b2b444b` |
| Frozen test-merge | `36b00f1afb9748b34e1c39d76ddf0c2eefe7fad8` |
| Attributed carry | `e8a37bd418b63f724a6909b2421fb5711dcb169b` |
| Initial additive source | `32a4b3233eab1baf6bf99b27f08f705cd9ecbd5e` |
| Final strengthened source | `05e0ccfdf3725d82acc5855ce091d76e82fe2659` |
| Final source tree | `5469fb36e99dac71910561b014c02e439cca56d2` |

Frozen pins SHA256 remains
`d26697e552936677125975c675f94e85b7de4f24e7294a4ef041ee75ca104833`.
Only the original subject was cherry-picked with its author and `-x` attribution;
no unrelated upstream ancestry or synthetic merge was integrated. Fresh trials
have zero conflicts and two automatic content merges, in manager source and its
test. Carry tree `d295d9390b24193033ca06e8f2e87d9edccb2bb6` exactly equals the
approved trial. Production hunks equal the original subject; the upstream test
body remains byte-equal, SHA256
`8642593cbe48e4d5ad3b26906bd42567e093e85949b8ff06dea281ff118a3ad1`.

`source-inventory.json`, SHA256
`625e9d949cfa14bc4e29e45563ff1684467a0fb82037097c854f85d615cc7f23`,
verifies all 5,947 outside paths unchanged and all accepted test bodies intact.
Only manager source and the two affected test files differ from accepted parent.
The final test-only child changes only flushes and storage readers in the two
additive cases, plus formatter whitespace; every payload assertion is preserved.

Each new finish/error edge refreshes unread finish/error attention. Duplicate
observations do not refresh it; clearing during the same error remains read.
Permission priority, internal-agent exclusion, delegated callback suppression
and status tracking before guards remain. Accepted #7057 rearming and #6008 early
completion survive unchanged, as do terminal/cancel/close, permissions, replaced
arms, sourced caller/dispatch, run-start, #7169 and earlier fork owners. No
provider, protocol, dependency, authorization or subscription code changes.

## Behavioral evidence and classifications

Receipts are under local scratch
`/home/ctaylor/.jcode/scratch/beta-upgrade-20261017/u3-7062-implementation/`
and Neptune
`~/.paseo-fork/candidates/upgrade-0.12.0-beta.1/evidence/u3-7062-implementation/`.
The separate 20-entry preflight seal remains unchanged at SHA256
`bf1e9cd843e6416552bd38c262c30c17c720d67132439928b6f28ce538471105`.

Three compatible selected cases failed first against accepted production on
Neptune. `red-upstream.log` reaches the second edge with expected error attention
but observes stale finished attention. `red-same-reason.log` reaches a second
actual error edge and finds its timestamp unchanged. `red-coexistence.log` finds
the same stale timestamp after the second sourced parent notification and parent
idle have already been observed. Notification progress alone does not count as
#7062 proof. Exact production blob identities, commands, exit codes and clean
restoration are retained. All three failures are intended behavioral reds.

Initial source `32a4b3233` passed the owning build, 228 manager cases, 149 MCP
cases and all required static checks. Its same-instance `AgentStorage.get`
observations are **cache-backed snapshot assertions**, not independent disk
proof. The unchanged upstream test also retains its original same-instance read.
Source inspection identified this distinction before acceptance; advisor and
coordinator approved the bounded strengthening before edits. Initial receipts
remain separate and retain their actual successful outcomes.

At `05e0ccfdf`, every existing additive snapshot assertion follows actual manager
and storage flushes and reads through a new independent `AgentStorage` instance
at the same path/logger. Four manager observations and two observations in each
of three MCP cycles now reload actual disk. Readers are read-only and have fresh
caches. Payload assertions are unchanged: exact status, unread flag, reason,
timestamp, callback sequence, duplicate silence and clear-then-observe behavior.

The MCP case independently verifies attention and the exact ordered parsed
`errored, errored, finished` source identities, message counts and literal
cumulative response bodies. The child receives only the original sourced prompt;
there is no second tool call or explicit rearm. Date-only control retains real
lifecycle timers and observed running/parent-idle boundaries. Cleanup attempts
every acquired resource, restores the clock on every exit, retains/rethrows a
primary error and reports cleanup failures; cleanup-only aggregate throws after
finally. All earlier #7057 assertions remain unchanged.

| Check | Exact source | Receipt | Result |
| --- | --- | --- | --- |
| Owning `npm run build:server`, before suites | `32a4b3233` | `build-source.log` | Exit 0 |
| Initial complete manager / MCP files | `32a4b3233` | `agent-manager-source.log`, `mcp-server-source.log` | 228 / 149 pass; cache-backed snapshot reads |
| Initial typecheck / lint / format | `32a4b3233` | `static-source.log` | 0 / 0 / 0 |
| Strengthened complete manager file | `05e0ccfdf` | `agent-manager-revised.log` | 228 pass |
| Strengthened complete MCP file | `05e0ccfdf` | `mcp-server-revised.log` | 149 pass |
| Exact strengthened source static | `05e0ccfdf` | `static-revised.log` | 0 / 0 / 0 |

The build is reused because the strengthened child changes tests only. Both
changed full files were rerun specifically; unchanged agent-prompt greens were
reused. No unchanged green suite or build was rerun.
Exact strengthened source static SHA256 is
`8de2970e7aa2c5eae756b1e3f8c4c60ab3aec26df48bb1cafe46e40a5255cea6`.

## Review, seal and remaining gaps

Advisor **ACCEPT** at exact source `05e0ccfdf` follows direct source inspection and
verification of actual log hashes, all 377 affected passes and required static.
No bounded findings remain. Saved verdict `advisor-final-source.txt` SHA256 is
`fbbbf3172d674ebd83dc247e88eb026d1982a6843e55eb33faaad48fc6851e48`.

The 47-entry source inventory `receipts-source.sha256` has SHA256
`e225a5747f06224b69c41ee76060c79f3afbaff4ccc2ef34a84291a03698085e`.
It retains all three intended reds, both source revisions and their actual
outcomes, the cache classification, attributed history and advisor verdicts.
Both hosts verify every entry. Final docs-head static and clean-host receipts
are recorded separately in `final-static.log`,
`final-static.summary`, `final-completion.json` and `receipts-final.sha256`.
The docs-only seal changes no checked package source and requires no build or
unit rerun. The npm formatter retains the existing `fork/**/*.md` exclusion.

Both inherited real-provider gaps remain separate and unclosed through U7:

- **#7179 REAL Claude turn survival UNVERIFIED:** both real runs failed at
  createAgent availability admission before dispatch/sentinel/controls;
  underlying cause unknown.
- **#7169 REAL OMP UNVERIFIED:** `beforeAll` `omp --version` exited 127 with
  `env: bun: No such file or directory`; all 14 skipped before resources, body,
  turn or sentinel. Runtime cleanup was not exercised.

Manager/MCP adapter evidence does not close either runtime gap or earlier native,
packaged Electron and locale obligations. No provider/auth probe, environment
repair, basket/manifest edit, later subject, live configuration write,
publication, installation, daemon restart or activation occurs. Coordinator
ADVANCE remains a separate gate.
