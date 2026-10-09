Run the fork release cycle for **{{TAG}}**, with unattended level **{{LEVEL}}**.

Read `~/.local/agents/docs/paseo.md`, section **The release cycle**, and its
linked build, deploy and verification procedures. That runbook owns the cycle.
Read `fork/upstream-sync.md` and `fork/CHANGELOG.md` before syncing.

This is an autonomous run authorized through the selected level:

- `build`: sync and gate `custom`, then build and gate local `mine` (steps
  1–2). Do not push `custom` or `mine`, publish, package or deploy. Leave the
  gated custom commit in the worktree's branch and report its ref and SHA
  so a human can advance `custom` and push both branches.
- `canary`: run through publish, all packaging and Saturn's verified deploy
  (steps 1–5). Stop before any Linux host or Neptune deploy.
- `fleet`: run the entire cycle, with Neptune last through the Saturn worker.

Use `/private/tmp/release-{{TAG}}` as a throwaway worktree, on a temporary
branch from committed `custom`. Fetch and include `origin/custom` before
merging the release tag so subsequent automatic cycles include prior
published custom commits. Preserve any local unpushed custom commits.
Never switch branches, merge, reset, stash, update the checked-out `custom`
ref, or discard edits in the shared checkout at
`/Volumes/offload/neptune/repos/paseo`. Use `fork/scripts/init-worktree.mjs`
and `fork/worktrees.md` for dependencies.

For every level, give Desvio an isolated config directory containing a copy
of its config, manifest, and required sibling hooks/scripts. Replace only
the `custom` carry in that manifest with the gated temporary worktree
branch, preserving every other carry and the existing resolver/rerere state.
Pin `DESVIO_STATE` and `DESVIO_WORKTREE` in the isolated config to the
existing absolute Neptune state and build-tree paths: their defaults are
relative to the config directory, which would otherwise create a second
build tree and lose the resolver state. Use
`desvio --config <isolated-config> build {{TAG}} --bisect-gate`; verify
its resulting mine tree contains the gated custom commit. Do not change the
fleet manifest to name a temporary branch. Persist the real `DESVIO_BASE`
only after the local mine build passes. At build level, retain the temporary
custom ref and report it for the human handoff; do not push either branch.

For canary/fleet, after the step-1 gates, push the gated temporary branch to
`origin`'s `custom` with an explicit lease against the remote custom SHA
recorded at the start. Stop if another session moved it. Push `mine` only
after the Desvio and conflict-resolution test gates pass. Leave the shared
checkout's local `custom` ref and working tree untouched; the isolated
manifest supplies the current custom commit to Desvio. A human can
fast-forward the shared checkout later. Report both custom and mine SHAs.

Stop at the first failed gate. Never push `mine` with a red gate or deploy
past a failed host. Do not restart a daemon to diagnose a timeout. Level
`fleet` authorizes the runbook's deployments, including Neptune through the
Saturn worker; you must never deploy Neptune from your own daemon session.

Append this cycle to `fork/CHANGELOG.md` and integrate new merge/build
lessons into `fork/upstream-sync.md` in the worktree. These records belong
in the gated custom commit before Desvio builds it. Do not delete the
worktree containing an unpushed build-level handoff.

Report through the file on **Neptune**:
`~/.paseo-fork/state/release-cycle-{{TAG}}.result`. The detector reserved this
cycle and removed an old result before starting you. Create the directory
if necessary. Write exactly one complete newline-terminated orchestrator
line, via a temporary file plus atomic rename, with actual values:

- Any failed gate: `RELEASE-CYCLE: FAILED {{TAG}} <step> <single-line reason>`.
- Successful build/canary handoff:
  `RELEASE-CYCLE: OK {{TAG}} <stamp> <mine-sha> stopped-at={{LEVEL}}`.
- Fleet: before dispatching the Neptune worker:
  `RELEASE-CYCLE: OK {{TAG}} <stamp> <mine-sha>`.

For fleet, prepare the worker brief and verify Saturn is on the target build
before writing OK. If worker dispatch fails after OK, replace it with a
FAILED line and notify. An OK without `stopped-at` means waiting for the
worker, never completion. After successful dispatch, the worker owns the
file: never overwrite it or report Neptune's outcome yourself.

The Saturn worker brief must include the target **{{TAG}}**, stamp, full
mine SHA, bundle and one-shot script paths, every packaging gate, launch
procedure, and verification probes, as required by the runbook. Include:

> After verifying Neptune (or on any failure), append one complete
> newline-terminated `RESULT: OK <single-line verification summary>` or
> `RESULT: FAILED <single-line reason>` over `ssh neptune` to
> `~/.paseo-fork/state/release-cycle-{{TAG}}.result`. Ensure the append
> succeeds, then post that line to the cycle's ntfy URL. Write FAILED for
> a failed gate or deployment; do not leave the detector waiting. Never
> deploy Saturn or Linux hosts, and never change source.

For your own FAILED stop or stopped-at handoff, post the result line to
ntfy. Read `RELEASE_WATCH_NTFY_URL` from `~/.paseo-fork/desvio.conf`; its
default is `https://ntfy.wedrifid.dev/paseo`. Pass that URL as a literal to
the Saturn worker (it must not depend on Saturn's copy of the config).
Use `curl --fail --silent --show-error --max-time 15 -H 'Title: Paseo release cycle'
--data-binary "$RESULT_LINE" "$NTFY_URL"`. Notification failures must not
prevent writing the result. The worker sends the fleet success message;
the orchestrator's last chat message is not the completion signal.
