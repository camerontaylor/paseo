# Proposal: run the release cycle automatically on a new upstream release

Status: proposal, 2026-10-02. Nothing here is built.

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

`local.paseo-release-watch`, `StartInterval` 1800. Each tick:

1. Take a lock (`mkdir ~/.paseo-fork/state/release-watch.lock`); exit if held.
2. Read state from `~/.paseo-fork/state/release-watch.json`:
   `{ handled, inFlight: { tag, agentId, startedAt }, failed: [tags] }`.
3. Find the newest **published** upstream release, betas included:
   `gh release list --repo getpaseo/paseo --exclude-drafts --limit 5 --json tagName,isPrerelease`.
4. Exit unless it is newer (semver) than both `handled` and `DESVIO_BASE` in
   `~/.paseo-fork/desvio.conf`, and is not in `failed`.
5. If `inFlight` is set: check the agent with `paseo inspect <agentId>`. Still
   running → exit; the next tick picks up the newer tag after it finishes.
   Running for more than 8 hours → notify once and exit. Finished → read its
   result line, move the tag to `handled` or `failed`, clear `inFlight`.
6. Preflight, notify-and-exit on failure: the shared checkout has no
   uncommitted changes from another session (`git status --short`), at least
   30 GB free on `/Volumes/offload`, and no `local.paseo-deploy-once` job
   loaded.
7. Dispatch the orchestrator and record `inFlight`:

   ```sh
   paseo run --provider codex/gpt-6-sol --thinking high --mode full-access \
     --background --json --label release-cycle="$TAG" \
     --cwd /Volumes/offload/neptune/repos/paseo \
     --title "Release cycle $TAG" "$(sed "s/{{TAG}}/$TAG/g" fork/briefs/release-cycle.md)"
   ```

`--dry-run` prints the decision and the rendered brief and dispatches nothing.

Superseded tags are skipped by construction: the detector always takes the
newest published release, so a tag that lands mid-cycle is the next cycle's
target and anything between is never built.

A failed cycle is not retried automatically. Its tag goes into `failed`, and
`release-watch.sh --retry <tag>` clears it after a human has looked. Without
that, a conflict the resolver cannot settle becomes an agent dispatched every
30 minutes.

### 2. `fork/briefs/release-cycle.md`, on `custom`

The orchestrator's brief, versioned with the fork so it rides into every
build. It names the runbook section rather than copying it, and adds the
autonomous-run rules:

- Sync `custom` in a throwaway worktree (`/private/tmp/release-$TAG`), never
  in the shared checkout's working tree.
- Stop at the first failed gate and report; never push `mine` with a red
  gate, never deploy past a failed host.
- Write the neptune worker brief and dispatch it to saturn as the last step.
- Append the cycle to `fork/CHANGELOG.md` and anything new to
  `fork/upstream-sync.md`.
- End with exactly one line: `RELEASE-CYCLE: OK <tag> <stamp> <mine-sha>` or
  `RELEASE-CYCLE: FAILED <tag> <step> <reason>`. The detector parses it.

### 3. Notification

On dispatch, on success, and on any failure, post to ntfy on ceres (already
running) so it reaches the phone. The neptune worker posts its own result,
because neptune's restart drops the orchestrator before it can.

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
| A Paseo schedule (`paseo schedule`) every 30 minutes | Each tick starts an agent. With one release a day that is ~47 sessions a day that find nothing. Usable as a stopgap: a schedule whose brief says "run `release-watch.sh` and stop" is cheap only on a small model. |
| GitHub Actions on the fork: cron poll of upstream releases | It can detect, but the build cannot run there (no desvio state, no resolver, no Macs), so it would only forward a signal back to neptune. That needs an inbound path to neptune it does not have today. |
| Watch npm `@getpaseo/cli` dist-tags instead of GitHub Releases | npm is published before the GitHub draft is published, so it fires on releases whose desktop builds later fail. |
| Trigger on the tag | Fires ~30 minutes early, and on failed releases that stay drafts. |

## Build steps

1. `fork/scripts/release-watch.sh` with `--dry-run` and `--retry`; a small
   test that feeds it a canned `gh release list` and state file.
2. `fork/briefs/release-cycle.md`.
3. The launchd plist, installed on neptune only. If this becomes fleet
   tooling, it moves to the agents repo next to `paseo-watchdog`.
4. Validate: `--dry-run` against today's state (expect "nothing to do"),
   then rewind `handled` to `v0.11.0-beta.1` with level `build` and check
   the dispatch picks `v0.11.0-beta.3`.
