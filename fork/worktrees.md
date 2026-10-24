# Transient worktrees

`npm ci` in this repo installs 2.7 GB and takes minutes. That is the wrong price
for a worktree that exists for one review, one test run, or one agent dispatch.
[scripts/init-worktree.mjs](scripts/init-worktree.mjs) brings a fresh worktree up
in under a second by sharing the source checkout's third-party packages.

```bash
node ./fork/scripts/init-worktree.mjs                 # from inside the worktree
PASEO_WORKTREE_PATH=/path/to/wt node ./fork/scripts/init-worktree.mjs
```

Measured on a cross-volume worktree: 2.4s with dist seeding, 0.36s without,
against minutes for `npm ci`.

## Why it is not just `ln -s node_modules`

npm records workspace packages as **relative** symlinks —
`node_modules/@getpaseo/server -> ../../packages/server`. Reached through a
symlinked `node_modules`, those resolve back into the source checkout, so a
worktree test importing `@getpaseo/protocol` loads the source checkout's code
while reporting that it tested the worktree. A green run proves nothing.

The script shares every third-party package by symlink but rebuilds the two
directories that contain workspace-owned links: `node_modules/@getpaseo` and
`node_modules/.bin` (which holds `paseo -> ../@getpaseo/cli/bin/paseo`). Both are
rebuilt by copying each link's *target text* rather than its resolved path. The
text is relative, so it re-anchors to the worktree for free.

Per-package `node_modules` are shared whole. They hold only non-hoistable
third-party packages — no workspace links, and no bins that escape their own
directory.

`dist/` is copied, never linked. `npm run build:server` writes into
`packages/protocol/dist`, and a link would let a worktree overwrite the source
checkout's build output.

## Sharp edges

- **The shared tree is read-mostly.** `npm install <pkg>` inside a worktree
  writes through to the source checkout. Use `--mode=install` for a worktree that
  needs its own dependency set.
- **Seeded `dist/` is a snapshot** taken at init time, not a build of the
  worktree's code. It unblocks typecheck and type-only tests immediately. Run
  `npm run build:server` — or pass `--build` — before trusting anything that
  executes built output. Pass `--no-dist` when a real build follows anyway.
- **patch-package patches are already applied** in the shared tree. Editing a
  file under `patches/` in a worktree does not re-patch it.

## Options

| Flag              |                                                                       |
| ----------------- | --------------------------------------------------------------------- |
| `--mode=link`     | Default. Share the source checkout's packages.                        |
| `--mode=install`  | Plain `npm ci`. For a worktree that needs an independent tree.        |
| `--force`         | Rebuild `node_modules` even if the worktree already has one.          |
| `--no-dist`       | Skip seeding `dist/`.                                                 |
| `--build`         | Run `npm run build:server` after setup.                               |
| `--no-seed`       | Skip `.dev/paseo-home` seeding.                                       |

## Tooling

The script trusts the worktree's mise config before anything resolves a tool.
mise records trust per absolute config path, so a fresh worktree is untrusted
even though its `.mise.toml` is byte-identical to the checkout it was cut from,
and every mise entry point fails until it is trusted —
[scripts/worktree-trust-mise.sh](../scripts/worktree-trust-mise.sh) owns that
detail. Node is then checked against the `nodejs` pin in `.tool-versions`; a
major mismatch fails with a `mise install` pointer. The other pinned tools
(rust, java, android-sdk) are for native app builds, not for tests.

## The lefthook symptom

Git resolves `hooks` to the **common** `.git/hooks`, so lefthook's pre-commit
fires in every worktree without `lefthook install`. In an uninitialised worktree
its typecheck job dies on missing `tsgo` and `zod-aot` and the only way through
is `--no-verify`. That is a missing `node_modules`, not a hook problem. After
init, the full-workspace typecheck runs in ~16s.

`zod-aot` also generates `packages/protocol/src/generated/validation/ws-outbound.aot.ts`,
a gitignored file inside `src/`. It self-heals — protocol's `pretypecheck`,
`pretest` and `prebuild` all regenerate it — but only once `node_modules` exists.

## Carried edit to `paseo.json`

`worktree.setup` in `paseo.json` calls this script instead of `npm ci`. That file
is upstream's, so the edit is a rebase-conflict surface; see
[upstream-sync.md](upstream-sync.md).

The branch coupling is self-correcting. `fork/` and the modified `paseo.json`
both live on `custom` only, so they travel together. A worktree cut from `main`
gets upstream's `paseo.json` and its `npm ci`, and never looks for a script that
is not there.

Setup still runs `npm run build:server` afterwards, so Paseo-managed worktrees
get a real build rather than a seeded snapshot. Cold cost measured at 47s.
