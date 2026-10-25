# Beta upgrade, U3 #7146 handover (2026-10-18)

Owner `fork/node-declaration-walk-0.12.0-beta.1` in isolated worktree
`/home/ctaylor/repos/paseo-upgrade-node-declaration-walk` starts directly from
accepted #7062. All twelve earlier owners and original custom remain clean and
unchanged. Checks run only on the exclusive Neptune candidate.

## Fixed input and preservation

| Identity | SHA |
| --- | --- |
| Accepted parent | `65723a80fcedaca36ac558fe9bc82b86fc84172f` |
| Accepted parent tree | `96268d00f141eb0052950d301adcd7534a30e010` |
| Frozen base, excluded sibling #7141 | `c1558d29eab78c898743adb613afa01ba4f0e780` |
| Actual original subject parent | `8d9a7123ba38353029352a93a85cca7160af6f07` |
| Frozen head, single original subject | `b86cbd38e5628e7329ff31cec5af89c87bfc4ac9` |
| Attributed carry | `973bd72caa0196379967ebbc2bb3ff6477a37654` |
| Final source | `7a43f7930657dab0b645f4c29c29a29cd27f677a` |
| Final source tree | `50beb2adf9c165002ed1f234ad29efb8e979c40d` |

Control `91088fd130cdd62722a0e6180672e0ad3a4a3a79` supplies twelve exact comment
pins. Each ref, clean owner and serial ancestry was verified before the disposable
basket advanced ff-only from accepted #7057 to accepted #7062. Basket HEAD/tree
equal the accepted parent above. No assembly commit, build or green rerun was
needed; exact SHA/tree identity permits evidence reuse. Three assembly receipts
verify on both hosts, seal SHA256
`aff6949e881d7105577d0ee09a94bd948b52a3395c999021e6c0c2f58d36a3e6`.
The basket stays there throughout this separate owning carry.

Frozen pins SHA256 remains
`d26697e552936677125975c675f94e85b7de4f24e7294a4ef041ee75ca104833`.
The frozen base is a sibling of the subject, with the same actual parent. Its
raw diff to the subject includes unrelated replica-cache reversions: 86 test
lines and three production lines. Both reversions are excluded completely.
Only the actual parent-to-head subject, two compiler files with 55 additions and
seven deletions, is attributed with its original author and `-x`. No unrelated
ancestry or synthetic test merge is integrated. The frozen synthetic merge object
was unavailable locally and was not used as an input.

Fresh explicit-parent trial had zero conflicts and two automatic content merges,
in compiler source and tests. Carry tree
`122ab36f9164af2a25f08eef9ece75a2de537d43` exactly equals that trial; both files'
carry hunks equal the original subject. The three upstream fixtures remain
byte-equal, SHA256
`67491350c314662d9d13601255397438aca92ddd31fc214b2a1901ded14dd91d`.
`source-inventory.json` verifies all 5,949 outside paths unchanged, including both
replica-cache files, and every accepted test body intact. Only compiler source
and its existing test file differ from the accepted parent.

Declaration-only `import "node"` maps to `@types/node`; Node host classification
recognizes builtins and future `node:` names independently of the host version.
Checks on both original and mapped names run before host-type skipping. Client
and shared Node imports still produce explicit architectural errors. Fork SDK
normalization, canonical/renamed aliases, host-private entries, protocol type-only
exemption, missing third-party declarations, runtime ownership, physical realpath,
symlink and linked-dependency confinement remain. Plugins are trusted,
unsandboxed code; this is no new security or sandbox guarantee. There are no SDK,
protocol, dependency, provider, installation or live configuration changes.

## Behavioral evidence and classifications

Receipts are under local scratch
`/home/ctaylor/.jcode/scratch/beta-upgrade-20261017/u3-7146-implementation/`
and Neptune
`~/.paseo-fork/candidates/upgrade-0.12.0-beta.1/evidence/u3-7146-implementation/`.
The separate thirteen-entry preflight seal verifies on both hosts, SHA256
`e1bef97825a273191307f262e98bc57f9cdee04519da2b1e42e2f6618d19eed3`.
Persistent advisor approved the exact two-file carry and four additional negative
cases before implementation, within the user's existing authorization.

The initial three exact expanded-title selectors matched no tests: each exited
zero with all 90 cases skipped. Those original receipts remain as a selection
gap, not red or green evidence. A corrected common-title-prefix selector changes
only the command selection and runs all three unchanged upstream fixtures
against accepted production: three fail, 87 skip. `red-three-fixtures.log` records
unresolved Node declaration failure, including future `node:paseo-future-builtin`
in `@types/node`. No test body or assertion changed. Exact accepted production
blob identity, commands, exits and clean restoration are retained.

Four additive cases use real temporary dependency declarations reached from
client/shared owners, crossed with ambient `node`/future `node:` imports. Each
requires the literal Node architectural error naming the owner, original/mapped
specifier and canonical declaring file; unresolved-type failures cannot satisfy
the assertion. No compiler or declaration-reader mock is used. All existing SDK,
runtime and physical-owner tests remain unchanged.

| Check at exact source `7a43f7930` | Receipt | Result |
| --- | --- | --- |
| Owning `npm run build:server`, before suite | `build-source.log` | Exit 0 |
| Complete compiler test file, once | `compiler-source.log` | 94 pass |
| `npm run typecheck` / `lint` / `format:check` | `static-source.log` | 0 / 0 / 0 |

Exact source static SHA256 is
`6d5b8f80b2bfe5b61fc2bc313c73b541c0a64e88c2ddfc1205d7a473d6a8d386`.
No unchanged green suite or build is rerun. The docs-only child requires exact
final-head static checks; package sources and tested behavior remain identical.

## Review, seal and remaining gaps

Advisor **ACCEPT** at exact source `7a43f7930` follows direct source inspection and
verification of actual receipt hashes, all 94 compiler passes and required static.
The four boundary cases require architectural errors and canonical paths; the
zero-selection runs remain non-proof. No bounded findings remain.

The 37-entry source inventory `receipts-source.sha256` has SHA256
`f6a4612548ada5bfc6996d4ef952a62d2d3c316a0756a00ddb2f10738be5f2a5`.
It retains the intended red run, original selection gap, attributed source,
preservation inventory and advisor verdict. Both hosts verify every entry.
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

Compiler evidence does not close either runtime gap or earlier native, packaged
Electron and locale obligations. No provider/auth probe, environment repair,
further basket/manifest edit, later subject, live configuration write,
publication, installation, daemon restart or activation occurs. Coordinator
ADVANCE remains a separate gate.
