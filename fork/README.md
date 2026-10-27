# Fork source integration

Fleet maintenance lives in the [agents repository](https://github.com/camerontaylor/agents/blob/c0826d394ae64c0768849a304734bd942ebbcf92/docs/paseo-fork/README.md): worktree
acceleration, release observation, versioned Desvio inputs, carry decisions and
plans. The [archive](https://github.com/camerontaylor/agents/blob/c0826d394ae64c0768849a304734bd942ebbcf92/docs/paseo-fork/archive/provenance.json) preserves the original
research and plans with source SHA and file hashes. Use the agents fleet runbook
for release operations; no host configuration is installed by this checkout.
Historical `fork/plans/...` references resolve under `archive/fork/plans/` there.

This directory retains tooling that must travel with the assembled source:

- [Build versions](build-versions.md), `scripts/build-version.mjs`,
  `scripts/release-fork.mjs` and `scripts/package-desktop.sh` preserve artifact
  versions and npm publishing identity. The workflow entry remains in
  `.github/workflows/fork-npm-publish.yml`.
- [Changelog](CHANGELOG.md) records source/release decisions; [CI](ci.md) owns
  source CI constraints. Historical plans are in the external archive.
- [ZCode SDK validation](zcode-sdk-validation.md),
  [instruction migration](zcode-system-prompt.md) and their source-coupled
  migration scripts remain with the source.
- `repros/` contains source regression assets.
- `scripts/init-worktree.mjs` forwards to the optional agents initializer.
  Without it, public clones use `npm ci`. `paseo.json` keeps only this setup
  glue and source build/seed commands. The accelerator recreates workspace
  links locally; it never shares the entire root `node_modules` directory.

Upstream has no `fork/` directory. Keep source-coupled fork files here so they
have a separate namespace during upstream merges. Store future plans and
operational evidence in agents instead.
