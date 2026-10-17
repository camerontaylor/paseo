# Beta upgrade, U3 #7106 handover (2026-10-18)

Owner `fork/heartbeat-listing-0.12.0-beta.1` in isolated worktree
`/home/ctaylor/repos/paseo-upgrade-heartbeat-listing` starts directly from
accepted #7146. All thirteen earlier owners and original custom remain clean
and unchanged. Checks run on the task-authorized exclusive Neptune candidate;
no build, installation or suite runs on Uranus.

## Fixed input and preservation

| Identity | SHA |
| --- | --- |
| Accepted parent | `67531e3301901041ded5d159a5df5f7cc32ff5cf` |
| Accepted parent tree | `41fe84256a5ea15af10e91aaccf66ca03da6b768` |
| Frozen base, actual subject parent | `8388f161865134f53d55b8e4c4c3cf5296d515de` |
| Frozen head, single original subject | `4922bedf72804b0867abf17147e7c2fb2eb14279` |
| Excluded synthetic test merge | `34f97b3a9a772ec0b2755364360db281eece55be` |
| Attributed carry | `41403446173bab2305ac2c665d2ab036d6279ca8` |
| Final source | `817b48ab183a649e5a03f999087fa7e5224b5955` |
| Final source tree | `6aa47fbed3f628334bed93ff12ac8766c49f9d57` |

Control `97e954c716fa4876ee7b0609ef71a2aba2710288` supplies thirteen exact comment
pins. Every ref, clean owning worktree and serial ancestry was verified before
the disposable basket advanced ff-only from accepted #7062 to accepted #7146.
Its HEAD/tree equal the accepted parent above. No assembly commit, build or
green rerun was needed: exact SHA/tree identity permits evidence reuse. The
three-entry assembly seal verifies on both hosts, SHA256
`5fcff402cf64eeae94d6dcefab1f40949fe0bcbd8ce214dd914f172ca2c3dd5c`.
The basket stays at accepted #7146 throughout this owning carry.

Frozen pins SHA256 remains
`d26697e552936677125975c675f94e85b7de4f24e7294a4ef041ee75ca104833`.
Actual subject parent equals frozen base; one unique subject has the same
byte-for-byte net, two files with 64 additions and four deletions. Its original
author and `-x` are preserved. Synthetic test-merge ancestry and unrelated main
are excluded. The historical published-fork MCP applicability conflict is
distinct from the current adaptation.

Fresh explicit-parent trial found one EOF conflict in `mcp-server.test.ts` and
one automatic production merge in `tools/paseo-tools.ts`. The complete accepted
protocol-negotiation regression and complete upstream listing describe are
unioned. The needed ScheduleService value import is retained. Production changes
only the upstream listing-filter removal. `source-inventory.json` verifies every
accepted test byte and upstream fixture, with only the additive scoped-caller
case on top. Every other package path is unchanged.

The advisor explicitly approved all-daemon enumeration: the existing listing
description already specifies that scope. Heartbeat summaries now appear for
top-level and scoped callers. Enumeration grants no new mutation authority.
Exact caller-agent ownership for heartbeat deletion and new-agent target checks
for the other schedule tools remain unchanged. No #6982 helper, tool, policy or
target-error contract is adopted. Existing summary projection still omits run
history. Schedule execution, queue/receipt/subscription/readiness, permissions,
side conversations, #7057 rearming and #7062 attention owners remain unchanged.
There are no protocol, dependency, provider or live configuration changes.

## Behavioral evidence and classifications

Receipts are under local scratch
`/home/ctaylor/.jcode/scratch/beta-upgrade-20261017/u3-7106-implementation/`
and Neptune
`~/.paseo-fork/candidates/upgrade-0.12.0-beta.1/evidence/u3-7106-implementation/`.
The separate seventeen-entry preflight seal verifies on both hosts, SHA256
`0e162258e350455a503cdcc29ab0bd30e62a54e4c5ec55b2b69df633788448a3`.
Persistent advisor approved the exact carry and one additive scoped-caller case
before implementation, within the user's existing authorization.

Two selected failing-first cases run against accepted #7146 with identical
production blob hashes. The unchanged upstream fixture fails at expected two
summaries versus actual one; 149 other cases skip. The additive scoped case
fails at expected two heartbeats versus actual zero; 150 others skip. These
are intended missing-listing failures, not cleanup, timing or environment
failures. Both reverse-patch clean receipts are retained. No assertion or
semantic repair was needed after those runs.

Both cases use real temporary storage, ScheduleService and registered tools.
Neither starts the service tick loop or executes a provider. The unchanged
upstream case covers active new-agent and paused heartbeat summaries, absent
`runs`, deletion and an empty list. The additive case covers own and foreign
heartbeat identities, absent `runs`, exact rejection of foreign deletion with
the full record intact, successful own deletion and retained foreign listing.
The existing flush/remove helper cleans each fixture's temporary state.

| Check at exact source `817b48ab1` | Receipt | Result |
| --- | --- | --- |
| Owning `npm run build:server`, before suite | `build-source.log` | Exit 0 |
| Complete changed MCP test file, once | `mcp-source.log` | 151 pass |
| `npm run typecheck` / `lint` / `format:check` | `static-source.log` | 0 / 0 / 0 |

Exact source static SHA256 is
`b791b485b95c0d1d31c9cefc295cf028eeb9b82dda4905fb29ac4c2a0a84a604`.
No unchanged green suite or build is rerun. The docs-only child requires exact
final-head static checks; package sources and tested behavior remain identical.

## Review, seal and remaining gaps

Advisor **ACCEPT** at exact source `817b48ab1` follows direct source inspection
and verification of actual receipt hashes, all 151 MCP passes and required
static checks. No bounded findings remain.

The 33-entry source inventory `receipts-source.sha256` has SHA256
`ca22e34adc6f4d9cba0ca7ba3d4e99d9ba9f19a8c72e6dd1f111040978c6505d`.
It retains both intended red runs, attributed source, preservation inventory
and advisor verdict. Both hosts verify every entry.

Final docs-head static and clean-host receipts are recorded separately in
`final-static.log`, `final-static.summary`, `final-completion.json` and
`receipts-final.sha256`. The docs-only seal changes no checked package source
and requires no build or unit rerun. The npm formatter retains the existing
`fork/**/*.md` exclusion.

Both inherited real-provider gaps remain separate and unclosed through U7:

- **#7179 REAL Claude turn survival UNVERIFIED:** both real runs failed at
  createAgent availability admission before dispatch/sentinel/controls;
  underlying cause unknown.
- **#7169 REAL OMP UNVERIFIED:** `beforeAll` `omp --version` exited 127 with
  `env: bun: No such file or directory`; all 14 skipped before resources, body,
  turn or sentinel. Runtime cleanup was not exercised.

MCP unit evidence does not close either runtime gap or earlier native, packaged
Electron and locale obligations. No provider/auth probe, environment repair,
further basket/manifest edit, later subject, live configuration write,
publication, installation, daemon restart or activation occurs. Coordinator
ADVANCE remains a separate gate.
