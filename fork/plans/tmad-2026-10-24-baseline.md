# TMAD intake baseline receipt — 2026-10-24

This receipt freezes the published Desvio source before feature intake. It records source and assembly identity, not feature parity or installed runtime evidence. Future changes belong in maintained source/carry branches before a new disposable assembly is promoted.

## Immutable inputs and reproduction

| Input | Observed value |
| --- | --- |
| Live neptune base setting | `DESVIO_BASE=v0.12.0`; annotated tag object `d288bcfc840ffba71aa8565ee05184d9fce0a592`, peeled commit `cafe4b01c8522ff39560241c5deb01427dc8dc5b` |
| Live manifest, line 1 | `origin/custom` at `d9a9dfa063d8115b6f574f531a9d1d518488ae8a` |
| Live manifest, line 2 | `origin/upgrade/basket-0.12.0` at `568972505113179d03cc6e2c2c899ba16243cc42` |
| Published output | `origin/mine` and `fork/v0.12.0-fork.1` at `568972505113179d03cc6e2c2c899ba16243cc42`; tree `1dff9184a4305d15b861a278023e43d7d776f7f7` |
| Source intake pin | `tmad/main` at `cf39560a31793641f8cb25e2a75435fa4b660325`, fetched 2026-10-24; no drift from plan |
| Local tool | Desvio `0.1.0`, copied from neptune `/Users/ctaylor/src/desvio` at `db401c5c6cd0e3be15fab9d05a2bb8d5e7a51871`; Node `v22.20.0`, npm `10.9.3`, mise `2026.10.12` |
| Isolated candidate | `/home/ctaylor/repos/paseo-tmad-intake`, branch `fork/tmad-2026-10-24-baseline`, starting at published output SHA |
| Isolated assembly | `/home/ctaylor/repos/paseo-tmad-desvio/{desvio.conf,manifest.txt,state,build-tree}`, tool at `bin/desvio`; branch `fork/tmad-2026-10-24-assembly` |

The neptune manifest has exactly the two active lines above, in that order. Its second ref currently points to the published output itself; the first parent of that output is `b7d5070b45a08d713d377fbc43033fbea400244e`, whose second parent is current `custom`. Treat the second entry as the accepted assembled stable basket snapshot, not an independent patch or a safe place to author new behavior. Preserve both lines and their order until a reviewed replacement proves every behavior.

The isolated `desvio --config /home/ctaylor/repos/paseo-tmad-desvio/desvio.conf build --assemble-only --no-resolve --no-bisect-gate` merged the two current refs onto the peeled base. It produced `a3d7a4f02048f176a704c86dc324a5680622f9c8`; its tree is exactly `1dff9184a4305d15b861a278023e43d7d776f7f7`, matching the published tree. The different commit SHA reflects a fresh merge. The tool supports `--config` before `build` and `--assemble-only` on the build command; these were checked against `--help` and the installed implementation. The isolated config has its own branch, state and build tree, and does not source the live neptune resolver or installation hooks. This assembly performed no install or gate. Keep the baseline worktree available for future packages; build new worktrees from the published SHA or this recorded tree, with workspace links reconstructed locally.

## Carry ownership at this baseline

| Carry lead | Baseline result and owner |
| --- | --- |
| C1 queue durability `8468e7f55` | Overlay commit absent from both published output and `custom`. Existing published owner is `packages/server/src/server/agent-queue/` plus `packages/app/src/stores/queue-outbox-store/`: persisted queue and client outbox, eight-attempt parked retries, uncertain host state. C1 adds edit/tombstone/hydration and admission evidence; reconcile against those owners before #94/#95. Source branch: `origin/fork/tmad-refresh-queue-durability-0.11.1`. |
| C2 Stream durability `94fbbd6a4` | Overlay absent from both. Published owners are `packages/server/src/server/agent/companion-stream.ts`, `packages/app/src/companion-stream/`, and protocol `companionStreamPortV1`. The current feed starts `viewTab="stream"`, `filter="all"`, `onlyOpen=true`; artifacts are hidden, and a user message can mark every open question replied. The C2 tracked-ask/global/persistence model is not supplied by this code. Source branch: `origin/fork/tmad-refresh-stream-durability-0.11.1`. |
| Browser repair `d2407b79b` | Absent. It follows C2 in `origin/fork/refresh-browser-repair-20261012`; review its focused browser fixes after C2 rather than as a standalone merge. |
| A3 Quiet/Summary `ea90c7787` | Absent. Published `packages/app/src/hooks/use-settings/storage.ts` still defaults tool detail to `detailed` and accepts `overview`/`detailed`; the source adds a new preference migration and tool projection in `origin/fork/tmad-refresh-legacy-ui-0.11.1`. D3 owns reconciliation. |
| ACP diagnostics `831f6a858` | In published output ancestry and the accepted basket, outside `custom`. `packages/server/src/server/agent/providers/acp-agent.test.ts` contains mode rejection cases; keep its provider lifecycle and structured error behavior in the stable basket. |
| infi B9 diff-stat `eb6409c5ae062a6d03a99c2bfe416e9489f828e1` | Overlay absent from published output and `custom`. Published app has a basic additions/deletions pill in `packages/app/src/components/diff-stat.tsx` and `composer/workspace-diff-stat.ts`; B9 categorized production/config counts and emission/capability checks are not present. Source branch: `origin/fork/infi-refresh-diff-stat-0.11.1`. Preserve other accepted infi menu/history behavior in the basket; B9 is outside this TMAD campaign unless separately approved. |

Commit ancestry alone is not the parity test. The listed owner files and observable defaults were inspected against the published tree; each overlay needs focused tests and runtime evidence after porting. Permanent adaptations belong to `custom` or a separately declared maintained carry. `mine` and the isolated assembly branch are disposable outputs.

## Baseline checks and state safety

The isolated candidate uses a private `npm ci` dependency tree, with no whole-tree `node_modules` symlink. On 2026-10-24 it installed 2,695 packages in about one minute. `npm run build:server`, `npm run typecheck` and `npm run lint` all passed; lint reported zero warnings and zero errors on 4,869 files. Focused tests passed: app queue outbox model (7), app Stream model (2), app navigation history store (6), server Stream collector (12), ACP provider (144), plugin provider (43), and app diff-stat pill (1), 215 tests total. Each ran as one file with `--bail=1`; logs are in `/tmp/paseo-tmad-d0-*.log` on triton. ACP logged an EPIPE from a test connection and the diff-stat unit test logged unavailable IndexedDB during garbage collection; both suites passed. No full local suite ran. Run memory-heavy commands sequentially on triton under `/tmp/paseo-tmad-heavy-checks.lock`; the app typecheck process reached about 2.64 GiB RSS and the server typecheck about 1.31 GiB RSS. Uranus is for editing/read-only commands. The desktop macOS package remains a neptune-only artifact. There is no installed browser, iOS, Android, Electron or fleet observation in D0; later matrix receipts must identify exact client/daemon versions and observed platforms.

Before any canary or data migration, stop new writers through an approved service window, record the active version and copy the relevant `PASEO_HOME` to a private permission-restricted cold backup. After the stop, set `state_source` to the chosen home and `backup_dir` and `rehearsal_dir` to private directories outside the repo. Create both destinations with mode 700; use `rsync -a` from source to backup and then backup to rehearsal, retaining the original tree. Verify file counts and checksums before starting an isolated daemon with `PASEO_HOME` set to the rehearsal directory. Check queue, Stream and agent data there. Keep the original and any newer canary data for reconciliation; never overwrite a live home with an old snapshot. No live home was copied, restored, modified or restarted for this receipt.
