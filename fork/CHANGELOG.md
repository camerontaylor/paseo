# Fork changelog

Fork-local release notes. Upstream `CHANGELOG.md` is never touched; entries here
record fork-only decisions and releases. See
`fork/plans/ralplan-fork-release-channel.md` for the plan of record.

## 0.7.0-beta.2 base decision — 2026-08-30

Fork base advanced to upstream `v0.7.0-beta.2` (4e60c2880b4c9ebdb9937be4782a21406bab9933,
CI green at tag time): the fork daemon must not be older than the stock
0.7.0-beta.2 client it replaces
(`fork/plans/ralplan-fork-release-channel.md`, Sitting 1 step 1). Branch
`plan/fork-release-channel` rebased onto the tag ahead of the first fork release
(0.7.0-beta.2.fork.1).
