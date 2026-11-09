# Common rules for every tmad-port worker (read fully before starting)

Repo: the Paseo fork (npm workspace monorepo). Your worktree is a git worktree of
/Volumes/offload/neptune/repos/paseo (shared object store; refs/research/tmad-main,
commits 51fb7693d, af247e4f4, f0d5507d2, v0.11.0-beta.3 = 6166a7aca, custom = cbd1210c7 all exist locally).

The governing plan is /tmp/tmad-port/plan.md. Read it in full first; your brief names your phase.
Also useful: /tmp/tmad-port/infi-pc-intake-work-items.md (precedent ledger format),
/tmp/tmad-port/fork-README.md, /tmp/tmad-port/upstream-sync.md. Read the repo's CLAUDE.md and the docs it
lists that touch your area (docs/protocol-compatibility.md, docs/rpc-namespacing.md, docs/testing.md,
docs/file-observation.md, docs/expo-router.md, docs/coding-standards.md as relevant).

Source fork = tmad4000/paseo. Its integration commit 51fb7693d (source PR #21) mixes an upstream sync with
fork features: NEVER merge or cherry-pick it (or refs/research/tmad-main) wholesale, not even with -m.
Extract feature files/hunks only. Use `git show 51fb7693d:<path>` and `git diff <a> <b> -- <paths>`.
Exclude source branding, app ids, TestFlight, auto-updater, source CI, version bumps.

HARD RULES
- Work ONLY inside your own worktree / scratch clone. Never `cd` into /Volumes/offload/neptune/repos/paseo
  to change branches or files. Never touch ~/.paseo-fork (live build tree + manifest) except to READ manifest.txt.
- NEVER restart, stop or start the Paseo daemon on port 6767. Never run `desvio` against the live config.
- NEVER push anything to any remote (no origin, no mine, no custom). Commit locally on your branch only.
- Do not use bare `git stash`. Do not rewrite other branches. Do not merge custom or mine into a branch
  whose brief says it is release-based.
- NEVER run a full test suite. Run only specific files: `npx vitest run <file> --bail=1` from the owning
  package dir (redirect long output to a file under /tmp and read it). Never `npm run test` for a workspace.
- After code changes: `npm run build:server` (or build:client) when cross-package types matter, then
  `npm run typecheck` and `npm run lint` (scoped lint via `npm run lint -- <files>` is fine).
  Format with `npm run format` (or `npm run format:files -- <files>`) before each commit. Use npm scripts,
  never npx eslint/oxlint/oxfmt directly. Record pre-existing failures separately from yours
  (compare against the unmodified base when in doubt).
- Install deps in a fresh worktree with: `ONNXRUNTIME_NODE_INSTALL=skip npm ci` (if npm ci fails, `npm install`).
- Commits: conventional style; imported/adapted commits carry trailers
    Source-Repo: tmad4000/paseo
    Source-Commit: <full sha(s)>
    Port-Feature: TM-xx
  plus `Co-Authored-By:` is not required. Keep local-only fixes as separate commits from imports.
- Protocol: new wire fields optional; no .transform/.catch/.preprocess in wire schemas; new RPCs use dotted
  namespaces with .request/.response; every new op needs entries in authorization maps
  (packages/server/src/server/authorization/) and client capability defaults; run
  packages/server/src/server/authorization/index.test.ts after any protocol change.
- If you are blocked or something contradicts the plan, stop and write it in your report rather than guessing
  a product decision.

REPORT: when done, write /tmp/tmad-port/evidence/<YOUR-ID>.md with: branch name, base SHA, final HEAD SHA,
`git log --oneline <base>..HEAD`, allowed ancestors check (`git merge-base --is-ancestor` results for custom,
mine), files changed (stat), source->port ledger rows (source path, source blob `git rev-parse 51fb7693d:<p>`,
local blob, disposition: unchanged/adapted/excluded + rationale), commands run with pass/fail, pre-existing
failures, known gaps/deferred items, and anything requiring a human decision. Keep the final chat reply to a
short summary pointing at that file.
