# Fork changelog

Fork-local release notes. Upstream `CHANGELOG.md` is never touched; entries here
record fork-only decisions and releases. See
`fork/plans/ralplan-fork-release-channel.md` for the plan of record.

## npm channel goes automatic — 2026-09-13

Scope confirmed as **`@camerontaylor`** (the ADR's "personal scope, pending
approval"). `.github/workflows/fork-npm-publish.yml` publishes every push to
`mine` through npm trusted publishing (OIDC, GitHub-hosted runner, provenance
attached) — no long-lived token, which npm is retiring for CI anyway. The
first version of each of the 7 packages still has to go out with a token
(npm cannot attach a trusted publisher to a package that does not exist,
npm/cli#8544); the workflow carries a one-run `BOOTSTRAP_NPM_TOKEN` path for
that. `release-fork.mjs` gained `--fork-number auto` (next N from the
registry), `--no-github-release`, pushes only the tag (never the branch), and
stamps `<base>-fork.N` when the base is a stable release: `0.8.0.fork.1` is
not semver and npm rejected it at pack time. First automatic version:
`0.8.0-fork.1`.

## 0.7.0-beta.2 base decision — 2026-08-30

Fork base advanced to upstream `v0.7.0-beta.2` (4e60c2880b4c9ebdb9937be4782a21406bab9933,
CI green at tag time): the fork daemon must not be older than the stock
0.7.0-beta.2 client it replaces
(`fork/plans/ralplan-fork-release-channel.md`, Sitting 1 step 1). Branch
`plan/fork-release-channel` rebased onto the tag ahead of the first fork release
(0.7.0-beta.2.fork.1).
