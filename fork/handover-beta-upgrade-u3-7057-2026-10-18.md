# Beta upgrade, U3 #7057 handover (2026-10-18)

Owner `fork/notification-rearming-0.12.0-beta.1` in isolated worktree
`/home/ctaylor/repos/paseo-upgrade-notification-rearming` starts directly from
accepted #6762. All ten earlier owners and original custom remain unchanged.
The disposable basket remains at accepted `df8df0bbe`. All checks ran on the
exclusive Neptune candidate; no build or suite ran on Uranus.

## Fixed input and integration

| Identity | SHA |
| --- | --- |
| Accepted parent | `df8df0bbef3969e87bdaa2d15bac2ca47447ad39` |
| Frozen base, original subject parent | `208e323035ab40bbf3b3476fb6175330bc79821c` |
| Frozen head, single original subject | `d2174afaa8ab5260fc87b4e93f99459151c53384` |
| Frozen test-merge | `86b409d05fbfae3b650cafa54f2c4f1bf85be657` |
| Attributed carry | `09bf154e6989d52c44e538e739de358f8834355a` |
| Initial strengthened source | `78af0c59f8a28c8daeb83e0c307228d19d9cb768` |
| Final source | `19adfb230998f215fa28887d763e9824bd32b276` |
| Final source tree | `1a1f39e93c17b13858b468725d83e60fa0ffbaf2` |

Frozen pins SHA256 remains
`d26697e552936677125975c675f94e85b7de4f24e7294a4ef041ee75ca104833`.
The frozen head is the original single subject: three files, 140 additions and
one deletion. Only that commit was cherry-picked with its author and `-x`
attribution. No unrelated upstream ancestry or synthetic merge was integrated.

Fresh preflight and actual carry have zero conflicts and three automatic content
merges. Carry tree `943dfd9130e9c8984f5768dec35a7894fa1e68d7` exactly equals
the approved trial. Production hunks equal the original subject; all four
upstream test bodies remain byte-equal. All 5,946 paths outside the three changed
source/test paths remain identical to accepted parent. `source-inventory.json`,
SHA256 `114c324d3694a9014603bcc51c199c223d2e1f6548bc9659c54c5d3dc438a649`,
records those identities and the preserved ten owner refs and clean worktrees.

The carry keeps finish notification watching armed across a child's error and
later autonomous recovery. Accepted #6008 early completion, terminal/cancel/close,
permission, replaced-arm, sourced caller/dispatch, run-start and #7169 semantics
remain. No provider, protocol, queue, subscription or authorization code changes.

## Behavioral evidence and classifications

Receipts are under local scratch
`/home/ctaylor/.jcode/scratch/beta-upgrade-20261017/u3-7057-implementation/`
and Neptune
`~/.paseo-fork/candidates/upgrade-0.12.0-beta.1/evidence/u3-7057-implementation/`.
The separate 20-entry preflight seal remains unchanged at SHA256
`1c82bf4616f9d2887629cd948d8f03698f002a208c05b3bd59942d4d7b364d4a`.

Four compatible recovery cases fail first against accepted production on Neptune:
upstream low-level/MCP recovery and the two additive repeated-error cases each
reach the missing second parent notification, expected two messages, received
one. Production blob identities match accepted HEAD. The corrected additive MCP
red is `red-repeated-mcp-corrected.log`; its earlier harness failure is separate.

Two superseded body assumptions remain explicit. `red-repeated-mcp.log` omitted
the existing system-error assistant response from its expected body.
`mcp-server-78af0c59f-failed.log` then expected only the second error, while the
existing manager joins contiguous assistant chunks without a separator. The
autonomous-turn adapter introduces no user-message boundary. Both corrections
received advisor design rulings and coordinator approval before edits. They
change literal test expectations only; no product, event, timing, timeout or
upstream assertion changed. The corrected final cumulative response was initially
source-derived, then actually asserted by the passing full MCP execution.

The additive cases verify exact ordered `errored, errored, finished` parsed child
identities, counts and full bodies. Duplicate error observations produce one
notice per cycle. The real manager/storage case observes lifecycle and parent-idle
boundaries and verifies the child's sole original sourced prompt. No second tool
call or watcher rearm manufactures recovery.

| Check | Exact source | Receipt | Result |
| --- | --- | --- | --- |
| Owning `npm run build:server`, before suites | `78af0c59f` | `build-source.log` | Exit 0 |
| Complete `agent-prompt.test.ts` | `78af0c59f` | `agent-prompt-source.log` | 24 pass |
| Complete corrected `mcp-server.test.ts` | `19adfb230` | `mcp-server-revised.log` | 148 pass |
| Required typecheck / lint / format | `19adfb230` | `static-revised.log` | 0 / 0 / 0 |

The final test-only child changes three expectation lines in the MCP file.
Production and the low-level suite blobs are unchanged, so the owning build and
24 passing cases are reused. No unchanged green rerun occurred. Exact initial
source static also passed and remains separate. Final source static SHA256 is
`30671909975fb254bffdb7ea6ad6f50ee86423f057ea243d43bbccb189efd22e`.

## Review, seal and remaining gaps

Advisor **ACCEPT** at exact source `19adfb230` follows direct source inspection,
actual log hashes and reconciliation of the 172 affected unit passes, owning
build and required static. Saved verdict `advisor-final-source.txt` SHA256 is
`02be8f9fa6a055d9f332088cc7a19f06adda9e650a828b3f4721fc21522fed14`.
No further source correction is required.

The 58-entry source inventory `receipts-source.sha256` has SHA256
`d1a19fa097425343033c9902357b4f11db955d4db48b254a02a0246602896482`.
It retains all four intended reds, both superseded failures, attributed history,
source inventories, actual checks and advisor verdicts. Both hosts verify every
entry. Final docs-head static and clean-host receipts are recorded separately in
`final-static.log`, `final-static.summary`, `final-completion.json` and
`receipts-final.sha256`. The docs-only seal changes no checked package source;
no build or unit suite reruns for it. The full npm formatter respects the existing
`fork/**/*.md` exclusion; no formatter policy changes.

Both inherited real-provider gaps remain separate and unclosed through U7:

- **#7179 REAL Claude turn survival UNVERIFIED:** both real runs failed at
  createAgent availability admission before dispatch/sentinel/controls;
  underlying cause unknown.
- **#7169 REAL OMP UNVERIFIED:** `beforeAll` `omp --version` exited 127 with
  `env: bun: No such file or directory`; all 14 skipped before resources, body,
  turn or sentinel. Runtime cleanup was not exercised.

HeldTurn adapter proof does not close either runtime gap or earlier native,
packaged Electron and locale obligations. No provider/auth probe, environment
repair, basket/manifest edit, later subject, live configuration write, publication,
installation, daemon restart or activation occurs. Coordinator ADVANCE is a
separate gate.
