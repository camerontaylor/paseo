# Automatic release detection

Neptune's `local.paseo-release-watch` checks published upstream releases at
06:17 and 18:17 local time. The detector runs independently of the Paseo
daemon. A sleeping Mac checks a missed slot when it wakes.

The cycle belongs to `~/.local/agents/docs/paseo.md`, **The release cycle**.
The committed `custom:fork/briefs/release-cycle.md` supplies its agent brief.
Commit that file on `custom` before enabling dispatch; an uncommitted brief
is never used. The shared checkout must be clean for any dispatch.

## Configuration

Add these settings to `~/.paseo-fork/desvio.conf` on neptune:

```bash
RELEASE_WATCH_LEVEL="canary"
RELEASE_WATCH_NTFY_URL="https://ntfy.wedrifid.dev/paseo"
```

`canary` is the initial default: publish, package and verify Saturn, then
hand back to a human. Use it for the first two automatic cycles before
choosing `fleet`. `fleet` deploys every host, with Neptune last via the
Saturn worker. `build` creates gated local commits only, without pushing
`custom` or `mine`; the result brief names the retained custom worktree ref.
The fork publish workflow fires on a `mine` push, so a build-level stop must
precede that push. Subscribe the phone to the configured ntfy topic.

The plist is neptune-specific. Its PATH includes the owner's mise shims and
`~/.local/bin` as well as Homebrew: neptune's Node and gh currently live
under mise, and Paseo is the packaged desktop CLI. Do not replace this with
checkout dev CLI commands; the detector targets the production daemon.
Ensure gh authentication works outside a login shell. Do not put a token
in the committed plist or logs.

## Install and validate

Create `~/.paseo-fork/state` and copy
`fork/launchd/local.paseo-release-watch.plist` to
`~/Library/LaunchAgents/local.paseo-release-watch.plist`. First append a
`--dry-run` string to the installed plist's `ProgramArguments`, then:

```bash
plutil -lint ~/Library/LaunchAgents/local.paseo-release-watch.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.paseo-release-watch.plist
launchctl kickstart gui/$(id -u)/local.paseo-release-watch
cat ~/.paseo-fork/state/release-watch.log
```

After a successful dry-run, boot out this detector job, remove its dry-run
argument and bootstrap it again. Never kickstart or boot out the main
Paseo daemon as part of installation. Dry-run may create the state directory
and acquire the short tick lock, but does not update cycle state, delete
results, notify or dispatch an agent.

Exercise dispatch selection with the targeted fixture suite:
`npx vitest run fork/scripts/release-watch.test.mjs --bail=1`. Do not rewind
live state or lower the real base floor to dispatch a historical release.
The detector always requires a release newer than both `handled` and
`DESVIO_BASE`. To preview a real pending release, run
`fork/scripts/release-watch.sh --dry-run`.

## Recovery

State is `~/.paseo-fork/state/release-watch.json`. A failure blocks only its
tag; newer published releases can still run. After investigating a failure:

```bash
fork/scripts/release-watch.sh --retry v0.11.1
```

This removes the failed entry and its old result. It does not dispatch
immediately or bypass either version floor. The next tick still chooses
the newest published release, so a superseded failed tag stays skipped.

An OK orchestrator line without `stopped-at` is a worker handoff. Wait for
Neptune's terminal `RESULT:` in the same file. A stale cycle notifies once
after eight hours; it never triggers an automatic retry or daemon restart.

An ambiguous dispatch (timeout or missing agent ID) retains `inFlight` with
`agentId: null`, preventing duplicate work. Find the agent by its
`release-cycle=<tag>` label and repair its ID in the state. If no agent
started, clear the reservation only after confirming that, then retry.
A corrupt state file or an unavailable daemon also stops dispatch; preserve
the state when investigating. The one-hour lock expiry only reclaims a lock
whose recorded process is gone.
