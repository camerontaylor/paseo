# Proposal: run the release cycle automatically on a new upstream release

Status: proposal, 2026-10-02; check cadence changed to twice a day on
2026-10-08. Nothing here is built.

The cycle itself — who runs which step, the gates, neptune last via a saturn
worker — is in the fleet runbook, `~/.local/agents/docs/paseo.md`, *The
release cycle*. This proposal covers only what starts it.

## What we know about the trigger

- Upstream ships about one release a day, sometimes two (`v0.11.0-beta.1`
  and `beta.2` landed 6 hours apart on 2026-10-01). A cycle takes 1–3 hours,
  so tags will arrive mid-cycle.
- A tag is not a release. Upstream's release workflow creates the GitHub
  Release as a draft and publishes it only after every platform build and
  manifest upload succeeds (`docs/release.md`). `v0.11.0-beta.3` was tagged
  at 00:15 UTC and published at 00:48. A tag whose release stays a draft is a
  failed upstream release.
- The cycle needs neptune: desvio's build tree and rerere state, the Codex
  conflict resolver, x86_64 packaging, and ssh to every other host. A
  GitHub-hosted runner has none of these.

## Proposed mechanism

A **detector** that costs nothing when nothing changed, and starts an
**orchestrator agent** only when there is work.

### 1. `fork/scripts/release-watch.sh` on a launchd timer on neptune

`local.paseo-release-watch`, twice a day: `StartCalendarInterval` at 06:17
and 18:17 neptune local time. launchd runs a missed slot once on wake, so a
sleeping Mac still checks. A release waits at most 12 hours.

launchd starts the job in `/` with a minimal environment, so the plist sets
`WorkingDirectory` to the checkout and `PATH` to include `/opt/homebrew/bin`
(`gh`, `paseo`, `node`), and the script uses absolute paths throughout. `gh`
must be authenticated with a token it can read outside a login shell. Prove
the environment before the job goes live: load the plist with `--dry-run` in
`ProgramArguments`, run it with
`launchctl kickstart gui/$(id -u)/local.paseo-release-watch`, and read its
log.

Each tick:

1. Take a lock (`mkdir ~/.paseo-fork/state/release-watch.lock`); exit if held
   and less than an hour old, otherwise take it over (a crashed tick leaves it
   behind).
2. Read state from `~/.paseo-fork/state/release-watch.json`:
   `{ handled, inFlight: { tag, agentId, startedAt, staleNotified }, failed: [tags] }`.
3. **Collect a finished cycle first.** If `inFlight` is set, read
   `~/.paseo-fork/state/release-cycle-<tag>.result` (section 2):
   - It ends with a neptune `RESULT:` line → move the tag to `handled` (`OK`)
     or `failed`, clear `inFlight`, and continue to step 4.
   - It has a `FAILED` line → move the tag to `failed`, clear `inFlight`,
     continue.
   - It has an `OK … stopped-at=<level>` line → move the tag to `handled`,
     clear `inFlight`, continue. The human finishes the cycle from there.
   - It has an `OK` line and no `RESULT:` yet → the neptune worker is still
     deploying; go to the stale check.
   - No result file → check the agent with `paseo inspect <agentId>`. Still
     running → go to the stale check. Finished → move the tag to `failed`,
     notify, clear `inFlight`, continue.
   - Stale check: in flight for more than 8 hours with `staleNotified` unset
     → notify and set `staleNotified`. Then exit. At 12-hour ticks the
     notification comes on the first tick after a cycle sticks.
4. Find the newest **published** upstream release, betas included:
   `gh release list --repo getpaseo/paseo --exclude-drafts --limit 5 --json tagName,isPrerelease`.
5. Exit unless it is newer than both `handled` and `DESVIO_BASE` in
   `~/.paseo-fork/desvio.conf`, and is not in `failed`. Compare with semver
   precedence (`node -e` with the repo's `semver` package), not `sort -V`:
   `sort -V` puts `0.11.0` before `0.11.0-beta.1`.
6. Preflight, notify-and-exit on failure: the shared checkout has no
   uncommitted changes from another session (`git status --short`), at least
   30 GB free on `/Volumes/offload`, and no `local.paseo-deploy-once` job
   loaded.
7. Render the brief from the committed `custom`, not the working tree, so a
   half-edited brief from another session never ships. Substitute `{{TAG}}`
   and `{{LEVEL}}` (`RELEASE_WATCH_LEVEL`, below). Dispatch the orchestrator,
   record `inFlight`, and notify:

   ```sh
   CHECKOUT=/Volumes/offload/neptune/repos/paseo
   BRIEF=$(git -C "$CHECKOUT" show custom:fork/briefs/release-cycle.md \
     | sed -e "s/{{TAG}}/$TAG/g" -e "s/{{LEVEL}}/$LEVEL/g")
   paseo run --provider codex/gpt-6.1-sol --thinking high --mode full-access \
     --background --json --label release-cycle="$TAG" \
     --cwd "$CHECKOUT" --title "Release cycle $TAG" "$BRIEF"
   ```

`--dry-run` prints the decision and the rendered brief and dispatches nothing.

Superseded tags are skipped by construction: the detector always takes the
newest published release, so a tag that lands mid-cycle is the next cycle's
target and anything between is never built.

A failed cycle is not retried automatically. Its tag goes into `failed`, and
`release-watch.sh --retry <tag>` clears it after a human has looked. Without
that, a conflict the resolver cannot settle becomes an agent dispatched on
every tick. `failed` blocks only that tag: if the same conflict survives into
the next upstream release, that release is dispatched and fails once too,
about one failed cycle a day until a human fixes `custom`.

### 2. `fork/briefs/release-cycle.md`, on `custom`

The orchestrator's brief, versioned with the fork so it rides into every
build. It names the runbook section rather than copying it, and adds the
autonomous-run rules:

- Sync `custom` in a throwaway worktree (`/private/tmp/release-$TAG`), never
  in the shared checkout's working tree.
- Run only as far as `{{LEVEL}}` allows (*Decision for the owner*, below),
  then stop and report.
- Stop at the first failed gate and report; never push `mine` with a red
  gate, never deploy past a failed host.
- Append the cycle to `fork/CHANGELOG.md` and anything new to
  `fork/upstream-sync.md`.
- Report through the result file, not the agent's last message.

**The result file** is `~/.paseo-fork/state/release-cycle-<tag>.result` on
neptune. The orchestrator cannot report the cycle's outcome itself: step 7's
neptune deploy kills its running command, and its session resumes only after
the new daemon is up, with no view of whether the worker's verification
passed. So the outcome is written by whoever finishes last:

- The orchestrator writes its line before dispatching the neptune worker:
  `RELEASE-CYCLE: OK <tag> <stamp> <mine-sha>` or, at any earlier stop,
  `RELEASE-CYCLE: FAILED <tag> <step> <reason>`. At level `build` or
  `canary`, where it stops before neptune, it writes
  `RELEASE-CYCLE: OK <tag> <stamp> <mine-sha> stopped-at=<level>`, and the
  detector moves the tag to `handled` on that line alone.
- The saturn worker's brief tells it to append neptune's
  `RESULT: OK|FAILED <reason>` to the same file over `ssh neptune` once its
  verification finishes.

### 3. Notification

Post to ntfy on ceres (already running) so it reaches the phone. Each actor
posts its own events:

| Actor | Posts on |
| --- | --- |
| Detector | Dispatch, preflight failure, stale cycle (once), a cycle with no result file |
| Orchestrator | Its `FAILED` stop, or `stopped-at=<level>` when it hands back to a human |
| Saturn worker | Neptune's `RESULT:` line, which is the cycle's success message |

## Decision for the owner: how far it runs unattended

Pushing `mine` publishes to npm, and deploying restarts every daemon. Three
levels; the detector reads `RELEASE_WATCH_LEVEL` from `desvio.conf`.

| Level | Runs unattended | Waits for a human |
| --- | --- | --- |
| `build` | Steps 1–2 into a local `mine`; no push | Push, publish, package, deploy |
| `canary` | Through publish, packaging and saturn's deploy | Linux hosts and neptune |
| `fleet` (recommended) | The whole cycle | Nothing unless a gate fails |

`fleet` is the recommendation because every gate that a human checks today
is already a scripted check, the cycle already runs as an agent rather than
as a person, and a fork build that fails on a host is rolled back by
re-running `setup-paseo.sh` or the deploy job with the previous version. Use
`canary` for the first two automatic cycles to see the detector and brief
work end to end, then switch.

A stable release and a beta are treated the same. Upstream's betas are what
this fleet runs day to day, and the base floor (runbook, *The base floor*)
does not distinguish them.

## Alternatives considered

| Option | Why not |
| --- | --- |
| A Paseo schedule (`paseo schedule`) twice a day | Each tick starts an agent, so about one session a day finds nothing. That is cheap at this cadence, but the schedule runs under the daemon that step 7 restarts, and a detector should not depend on the thing the cycle bounces. Usable as a stopgap: a schedule whose brief says "run `release-watch.sh` and stop". |
| GitHub Actions on the fork: cron poll of upstream releases | It can detect, but the build cannot run there (no desvio state, no resolver, no Macs), so it would only forward a signal back to neptune. That needs an inbound path to neptune it does not have today. |
| Watch npm `@getpaseo/cli` dist-tags instead of GitHub Releases | npm is published before the GitHub draft is published, so it fires on releases whose desktop builds later fail. |
| Trigger on the tag | Fires ~30 minutes early, and on failed releases that stay drafts. |

## Build steps

1. `fork/scripts/release-watch.sh` with `--dry-run` and `--retry`; a small
   test that feeds it a canned `gh release list`, state file and result
   file. Cover a stable after its betas (`v0.11.0` over `v0.11.0-beta.3`),
   `beta.10` over `beta.9`, a finished agent with no result file, and an
   `OK` line still waiting for neptune's `RESULT:`.
2. `fork/briefs/release-cycle.md`, and the result-file instruction added to
   the runbook's neptune worker brief template.
3. The launchd plist, installed on neptune only. If this becomes fleet
   tooling, it moves to the agents repo next to `paseo-watchdog`.
4. Validate: `--dry-run` against today's state (expect "nothing to do"),
   then rewind `handled` to `v0.11.0-beta.1` with level `build` and check
   the dispatch picks `v0.11.0-beta.3`.
