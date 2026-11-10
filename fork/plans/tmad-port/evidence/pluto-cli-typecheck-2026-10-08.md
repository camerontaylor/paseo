# Pluto CLI typecheck investigation — 2026-10-08

## Result

Environment recovery; no source fix or commit needed. At the assigned SHA, both owning-stack builds and the complete workspace typecheck pass. The reported claim that these callback errors persist after successful builds was not reproduced. A controlled missing-protocol-declarations experiment reproduces TS7006 in all six reported files, and restoring those declarations makes CLI typecheck pass again without changing source.

## Identity and constraints

- Worktree: /home/ctaylor/.paseo/worktrees/3rzqjhby/pluto-cli-typecheck
- Branch: fix/pluto-cli-typecheck
- Initial and final HEAD: 24f134618cd8a7143615debf927c1ac60b9ba813
- Reported drift ref resolves to 0110302b6fd172933ef9ba615fc9f0a08e420668; not integrated or used as the reproduction baseline.
- Node v22.20.0; TypeScript 5.9.3; tsgo 7.0.0-dev.20260423.1; Zod 4.4.3; test runner reports Vitest 4.1.7.
- No delegation, daemon operations, deployment, push, live manifest edits, or custom/mine branch edits.
- Read CLAUDE.md, listed docs/, read coding-standards.md, testing.md, development.md and fork/worktrees.md.

## Causal mechanism

The six CLI commands receive a DaemonClient from utils/client.ts. Its fetchAgents overload returns Promise<FetchAgentsPayload>. In packages/client/src/daemon-client.ts:766, FetchAgentsPayload derives from Extract<SessionOutboundMessage, { type: "fetch_agents_response" }>["payload"]. SessionOutboundMessage is inferred from the canonical protocol Zod schema; its response entries are a Zod array of AgentDirectoryResponseEntrySchema.

Package exports resolve to compiled dist declarations. Removing this worktree's packages/protocol/dist breaks the type dependency beneath the client declaration. With skipLibCheck enabled, errors within imported declarations do not provide a useful upstream diagnostic at every consumer; callback inference degrades and the CLI reports implicit-any parameters. Direct CLI protocol imports also report TS2307 in the controlled experiment.

This establishes a declaration-resolution cause for the reported error pattern, not proof of the exact state of the original failing checkout. Its logs/artifacts were not supplied. Missing/stale/wrong-checkout declarations remain possible explanations for that original run. No evidence supports a defect in these callbacks at the assigned SHA.

## Commands and results

Heavy checks were run sequentially with logs in /tmp. Root build:server internally uses the repository's existing concurrent highlight/plugin/relay build stage. One premature CLI check briefly overlapped the server rebuild; this was recorded and excluded from final verification.

1. `node fork/scripts/init-worktree.mjs --no-dist --no-seed > /tmp/pluto-init.log 2>&1` — exit 0. Shared third-party packages from /home/ctaylor/repos/paseo; verified workspace package resolution inside this worktree. node_modules is a local directory, not a whole-directory symlink. @getpaseo/client and protocol links both point to ../../packages/<name>.
2. `npm run build:client > /tmp/pluto-build-client.log 2>&1 && npm run build:server > /tmp/pluto-build-server.log 2>&1` — exit 0. Full server/CLI owning stack rebuilt before final diagnosis.
3. Premature `npm run typecheck --workspace=@getpaseo/cli > /tmp/pluto-cli-typecheck.log 2>&1` — exit 2 while server output was not yet built. Missing server exports caused TS2307 and downstream errors; none of the six target files had TS7006. This is not the completed-stack result.
4. `npm run typecheck > /tmp/pluto-typecheck.log 2>&1` — exit 0, all workspaces.
5. `npm run lint > /tmp/pluto-lint.log 2>&1` — exit 0, 0 warnings and 0 errors, 4535 files.
6. Controlled reproduction: moved only worktree-local packages/protocol/dist to a fresh /tmp directory, with an EXIT trap restoring it. `npm run typecheck --workspace=@getpaseo/cli > /tmp/pluto-missing-protocol-typecheck.log 2>&1` — exit 2. No source or shared dependency files changed. Target diagnostics:
   - archive.ts:60,70 — entry TS7006
   - delete.ts:54,58,60,78 — entry/a/agent TS7006
   - detach.ts:34 — entry TS7006
   - reload.ts:55 — entry TS7006
   - stop.ts:58,63,66,86 — entry/a/agent TS7006
   - worktree/ls.ts:53,74 — entry/wt TS7006
7. After automatic dist restoration, `npm run typecheck --workspace=@getpaseo/cli > /tmp/pluto-cli-recovered-typecheck.log 2>&1` — exit 0.
8. `npm exec --workspace=@getpaseo/cli -- vitest run src/commands/agent/delete.test.ts --bail=1 > /tmp/pluto-delete-test.log 2>&1` — exit 0, 1 file / 1 test passed. No full test suites run.
9. `git diff --exit-code` — exit 0. No tracked changes. Initializer-created package-level node_modules symlinks appear as untracked setup artifacts; they were not staged.

## Recovery

From this isolated worktree, initialize dependencies using fork/scripts/init-worktree.mjs (never link the whole node_modules directory), then run npm run build:client and npm run build:server. Verify that the build commands actually exit successfully and that workspace package symlinks resolve into this worktree. Run npm run typecheck and npm run lint afterward. Seeded dist output is a snapshot and cannot substitute for the owning-stack rebuild.

No duplicate types, callback annotations, or source workaround were added. Existing fork/worktrees.md and docs/development.md already document the recovery. No commit was made because there is no necessary tracked change; the evidence requested by the task lives in this file.
