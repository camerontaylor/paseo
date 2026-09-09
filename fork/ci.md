# Fork CI

What the fork needs from CI, what it costs, and where it should run. Measured
2026-09-07 against upstream run `34093120061` and the four fleet machines.

## The gap is the trigger, not the hardware

`.github/workflows/ci.yml:3-8` fires on `push` and `pull_request` to `main` only.
`custom` matches neither, so nothing runs automatically on this fork. Every fork
CI run since 2026-08-24 was a hand-kicked `workflow_dispatch`.

The fork is **public**, so GitHub-hosted runners are normally free and
unmetered, and nothing about cost should push the fork off them.

> **As of 2026-09-09 that is not true in practice.** Every GitHub-hosted job in
> run `34396878560` failed in two seconds with *"The job was not started because
> your account is locked due to a billing issue."* An account-level billing lock
> stops **all** Actions usage, including free public-repository minutes, whatever
> the balance came from. The self-hosted job in the same run was unaffected —
> self-hosted runners consume no Actions minutes and are not gated on billing.
> Until the lock clears at <https://github.com/settings/billing>, makemake is the
> only CI this fork has.

## Load

A full run is **150 job-minutes across 18 parallel jobs, ~24 min wall clock**.
Recent runs on `main` land between 23 and 45 min.

| Job                      | Duration | The test step alone      |
| ------------------------ | -------- | ------------------------ |
| playwright (shard 1/4)   | 24m25s   | 22m02s                   |
| server-tests (windows)   | 17m57s   | —                        |
| playwright (shard 4/4)   | 17m42s   | —                        |
| desktop-tests (ubuntu)   | 16m35s   | 7m28s + 4m56s smoke      |
| cli-tests (shard 1/3)    | 7m47s    | 5m17s                    |
| server-tests (ubuntu)    | 7m46s    | 5m55s                    |

Setup is already cheap: `npm ci` is 58–73s per job with the npm cache warm, and
`build:server` is 38s. **A self-hosted runner has no setup overhead to win back.**

`windows-latest` accounts for 22 of the 150 job-minutes and has no fleet
equivalent.

## Fleet benchmark

Identical commands, real clone of `custom`, cold cache on the fleet boxes:

| Step           | GitHub ubuntu-latest | ceres | makemake |
| -------------- | -------------------- | ----- | -------- |
| `npm ci`       | 58–73s (warm)        | 36s   | 145s     |
| `build:server` | 38s                  | 37s   | 56s      |
| `typecheck`    | 16s                  | 15s   | 21s      |
| relay tests    | 4s                   | 1s    | 7s       |

**ceres is at compute parity with a GitHub runner, not faster.** Its higher clock
is cancelled by 6 cores against GitHub's 4 vCPU. It wins only on `npm ci`, because
installing a 2.7 GB tree is small-file I/O and its NVMe does 2.4 GB/s.

So self-hosting buys about one runner's worth of compute to replace eighteen.
Running the Linux half of the suite (~128 job-minutes) on ceres is roughly 60–70
min wall clock against GitHub's 24, for no cost saving.

### Machines

| Host         | Specs                                       | Verdict                                                                                                                                             |
| ------------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ceres**    | 6c i5-8500, 31 GB, NVMe, CachyOS, Docker    | Fastest Linux, but runs Immich, miniflux, ClickHouse, 2×Postgres, Redis, Ollama, Syncthing, SMB. **Port 8081 is taken** — Expo's default. inotify already 524288/1024. |
| **makemake** | 4c Intel N97, 15 GB, Ubuntu 24.04, 344 GB free | Idle (load 0.02) and dedicated. 1.4× slower CPU, 4× slower install. **inotify 65536/128 is too low** — raise before use.                            |
| **saturn**   | 10c arm64 macOS, 32 GB, 6.2 GB/s reads      | 2.1× ceres throughput, fastest in the fleet. The only route to macOS coverage, which upstream CI does not have at all.                              |
| **eris**     | 4c Intel Mac, 24 GB, 423 MB/s writes        | Slowest disk. Not a candidate.                                                                                                                     |

## What the suite needs from a host

- **Provider tests already skip.** The fork has no secrets, so every
  `*.real.e2e.test.ts` skips via `canRunRealProvider()`
  (`packages/server/src/server/daemon-e2e/real-provider-test-config.ts:166-181`),
  and the default Playwright project ignores `**/*.real.spec.ts`
  (`packages/app/playwright.config.ts:37`). Upstream CI never runs them either.
- One ungated exception needs a real `claude` binary:
  `packages/server/src/server/daemon-e2e/models.e2e.test.ts:47`, 180s timeout.
- **Container needs:** `/dev/pts` for node-pty, ≥1 GB `/dev/shm` for Chromium,
  `--init` because `packages/cli/tests/setup.ts:23-48` kills by process group.
- **inotify limits are host-level and cannot be set from inside a container.**
  `packages/server/src/server/file-observer/internal/linux.ts:8` caps at 5,000
  watched directories per root, and the server unit leg runs with
  `--fileParallelism`, so N forked workers multiply that.
- **File-permission suites** assert `0600`/`0700` on `paseo.pid`, the daemon
  keypair and config. They break under an odd umask or a bind mount on a
  filesystem that drops mode bits. Keep `umask 022`.
- **Two concurrent full runs on one box are unsafe.** `project-dir.test.ts:17`
  uses a fixed `~/.paseo-claude-parity-tests`, and 15 CLI test files pick ports
  with `10000 + Math.random()*50000` instead of `getAvailablePort()` from
  `packages/cli/tests/helpers/network.ts`. Give each run its own `HOME`.

## What is built

Set up 2026-09-09. A self-hosted runner on makemake runs a check tier on your
own pull requests and nothing else.

### makemake host state

```
/etc/sysctl.d/99-paseo-ci.conf
  fs.inotify.max_user_watches  = 524288   (was 65536)
  fs.inotify.max_user_instances = 1024    (was 128)
```

Persistent across reboots, and matching ceres. Both were too low for the file
observer: it caps at 5,000 watched directories per root
(`packages/server/src/server/file-observer/internal/linux.ts:8`) and the server
unit leg runs `--fileParallelism`, so forked workers multiply the demand.
**These are host-level and cannot be set from inside a container** — a
containerised runner would still need them applied on the host.

### The runner

| | |
| --- | --- |
| Service | `actions.runner.camerontaylor-paseo.makemake` |
| Directory | `~/actions-runner` on makemake, work dir `_work` |
| Labels | `self-hosted`, `Linux`, `X64`, `paseo-makemake` |
| Registration | Repository-level on `camerontaylor/paseo` |

A systemd drop-in at
`/etc/systemd/system/actions.runner.camerontaylor-paseo.makemake.service.d/override.conf`
sets `LimitNOFILE=524288`, because the repo's own diagnostics treat fd
exhaustion as the expected file-observer failure
(`packages/server/scripts/measure-file-observer.ts` reads `/proc/self/fd`). It
also sets `MISE_TRUSTED_CONFIG_PATHS`, because the repo ships a `.mise.toml`
and mise aborts `npm` on an untrusted config — that is what broke the first
benchmark run on makemake.

The runner is **persistent, not ephemeral**. Ephemeral registration protects
against one job contaminating the next when untrusted code runs; the gate below
means untrusted code never runs, and JIT registration would require a PAT
sitting on the box, which is its own exposure.

```sh
ssh makemake systemctl status actions.runner.camerontaylor-paseo.makemake
gh api repos/camerontaylor/paseo/actions/runners --jq '.runners[] | {name,status,busy}'
```

### The gate

This repository is public. A self-hosted runner on a public repository will
execute a stranger's pull request unless something stops it. Three things do:

| Layer | Control |
| --- | --- |
| Repository | `fork-pr-contributor-approval` set to `all_external_contributors` (was `first_time_contributors`) — no outside pull request runs anything without an explicit click |
| Workflow | `.github/workflows/fork-ci.yml` gates the job on `github.actor == github.repository_owner` **and** `head.repo.full_name == github.repository` |
| Event choice | `pull_request` only. **Never `pull_request_target`** — it runs fork code with a write-scoped token and defeats the rest |

The workflow layer is the load-bearing one. A job whose `if` evaluates false is
skipped *before* a runner is assigned, so untrusted code never reaches makemake.
And `pull_request` runs the workflow file from the **base** branch, so a pull
request cannot edit the gate to let itself through.

`fork-ci.yml` is a filename upstream does not use, so it cannot land in a rebase
conflict.

### Host contamination

makemake is a workstation, not a clean image, and two of its personal settings
broke the suite in ways that reproduce nowhere else:

| Setting | Effect |
| --- | --- |
| `~/.gitconfig` with `diff.mnemonicprefix` and `diff.algorithm=histogram` | Rewrites diff prefixes from `a/` `b/` to `i/` `w/` and changes hunk output. `packages/server/src/utils/checkout-git.test.ts` parses real git output and fails 3 of its 160 tests. `fork-ci.yml` points `GIT_CONFIG_GLOBAL` at an empty file in `$RUNNER_TEMP` before checkout, which is what a GitHub-hosted runner effectively has. |
| `mise` installed globally, plus the repo's `.mise.toml` | mise aborts `npm` on an untrusted config. Handled by `MISE_TRUSTED_CONFIG_PATHS` in the service drop-in. |
| `$SHELL` pointing at the owner's zsh | `packages/server/src/terminal/terminal.ts:245` resolves the default shell from `$SHELL`, so PTY tests spawn a zsh carrying powerlevel10k's instant prompt, mise activation and a secrets loader before it accepts input. Tests that allow 10s for a spawn plus a round trip sit close to that budget. `fork-ci.yml` pins `SHELL=/bin/bash`, which is what a hosted runner has. |

The general lesson: a GitHub-hosted runner is a clean image, and any test that
shells out to a real tool is reading that tool's *host* configuration. Expect
more of these if the tier grows.

### Coverage

Runs on makemake, verified green 2026-09-09:

| Step | makemake |
| --- | --- |
| `format:check` | 7s |
| `lint` | 4s |
| `build:server` | 56s |
| `typecheck` | 23s |
| protocol / client / highlight / relay | 16s / 8s / 3s / 7s |
| `@getpaseo/server` (5,451 tests) | 362s |

Plus `npm ci` at 145s, so about 11 minutes end to end.

First live run (`34396878560`) failed two PTY tests on timeout —
`worker-terminal-manager`'s default-shell case and `worktree-bootstrap.posix`'s
terminal-backed services — and passed clean on retry. Both spawn a shell and
wait; `SHELL=/bin/bash` was added to cut the spawn cost. **Treat this tier as
green but not yet proven stable**: it has one clean run out of two, on hardware
slower than anything upstream tests on.

No credentials are needed — the provider suites skip themselves through
`canRunRealProvider()` when `OPENROUTER_API_KEY` is absent
(`packages/server/src/server/daemon-e2e/real-provider-test-config.ts:166-181`).
The agent CLIs are installed globally because
`packages/server/src/server/daemon-e2e/models.e2e.test.ts:47` is not gated on
the binary being present.

**Deliberately not on makemake:** the four Playwright shards (22 min each on
hardware faster than makemake, plus a Metro instance per shard), desktop E2E and
the packaged smoke, the three CLI shards, and everything `windows-latest`.
Routing them here would turn a 24-minute GitHub-hosted matrix into a multi-hour
serial queue on one 4-core box, for no cost saving — see the benchmark above.

### The full matrix

`fork-ci.yml` also calls `ci.yml` as a reusable workflow, so a pull request into
`custom` gets the whole 18-job GitHub-hosted matrix — Playwright, desktop E2E,
the CLI shards and Windows — alongside the makemake tier. That needed one line
in `ci.yml`:

```yaml
on:
  ...
  workflow_call:
```

**This is the only fork edit inside an upstream file.** It is tagged
`FORK-LOCAL` in place. The `on:` block has never been modified in repo history,
so the rebase risk is low, but if it is ever dropped during a merge the fork
loses its full CI silently — `fork-ci.yml` would fail to resolve the callee.

Two things follow from calling `ci.yml` rather than copying it:

- `permissions` in the caller is a **ceiling**, not a default. `ci.yml`'s
  `changes` job asks for `pull-requests: read` for `dorny/paths-filter`, so
  `fork-ci.yml` has to grant it or the job fails.
- The gate is duplicated across both jobs, so it is written once as a YAML
  anchor (`&fork_owner_only` / `*fork_owner_only`). Two copies of a security
  check drift; one does not. `secrets: inherit` is why the gate stays on the
  GitHub-hosted job too, even though GitHub-hosted runners are not themselves
  at risk from a fork pull request.

### Known redundancy

The makemake tier and the full matrix both run format, lint, typecheck and the
server suite. They run concurrently so there is no wall-clock cost, but makemake
spends ~11 minutes per pull request duplicating work GitHub is doing for free —
and because `ci.yml` path-filters through `.github/ci-paths.yml` while the
makemake job does not, a docs-only pull request runs *more* on makemake than on
GitHub.

If that becomes annoying, trim the makemake job to `format:check`, `lint` and
`typecheck` for fast-fail feedback (~90s after install) and let the matrix own
the tests.

## Ruled out

| Option                      | Why                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| ceres as the runner host    | Contends with Immich, ClickHouse and Ollama on a machine the household uses. Port 8081 collides with Expo.   |
| Full suite self-hosted      | ~128 Linux job-minutes at one runner of compute is 60–70 min against GitHub's 24, and saves nothing.         |
| Windows coverage in-fleet   | No Windows machine. Those 22 job-minutes stay on GitHub.                                                     |
