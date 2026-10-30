# Dispatch brief — ralplan for `paseo-fork-release-channel`

Prepared 2026-08-29, never dispatched (the daemon's Gajae Code provider refresh was
wedged; see `fork/handover-2026-08-29.md`). Paste the body below as `initialPrompt`.

**Agent settings (verified):** provider `gjc/zai/glm-5.3`, `modeId: default`,
`thinkingOptionId: high`, `features.auto_accept: true`, `notifyOnFinish: true`,
workspace = a worktree off `custom` on branch `plan/fork-release-channel`.

---

Run the gjc built-in **ralplan** skill (/skill:ralplan), deliberate mode, using your native role subagents.

CONTEXT — this is a fork of Paseo (getpaseo/paseo). You are in a git worktree on branch `plan/fork-release-channel`, branched off `custom`, which is rebased onto upstream/main at version 0.7.0-beta.1. Read `CLAUDE.md` and `CLAUDE.local.md` in the repo root first. This plan is about DISTRIBUTION, not application code.

PROBLEM: fork code has no path onto any machine in the fleet. All of this was verified live on 2026-08-29:

- **ceres** (Arch, headless): the daemon runs from the mise install `~/.local/share/mise/installs/npm-getpaseo-cli/0.7.0-beta.2/bin/paseo`, started by the SYSTEM unit `paseo-daemon.service` (confirmed via /proc/<pid>/cgroup → system.slice/paseo-daemon.service). It tracks npm's `@beta` dist-tag.
- **saturn** (macOS arm64) and **neptune** (macOS x64): the daemon is started by a user LaunchAgent `local.paseo-daemon` running `paseo daemon start --home ~/.paseo`. The `paseo` binary is a SYMLINK into the app bundle — `/opt/homebrew/bin/paseo` (saturn) and `/usr/local/bin/paseo` (neptune) both point at `/Applications/Paseo.app/Contents/Resources/bin/paseo`, and the daemon serves from `app.asar/node_modules/@getpaseo/server`. There is no standalone npm CLI on the Macs to swap. Both hosts are on 0.7.0-beta.2, same as ceres.
- Paseo plugins cannot carry a provider implementation (`docs/plugins.md:173` — plugins borrow surfaces and do not expose connection lifecycle), so this genuinely needs packaging.
- `@getpaseo/*` is not a scope this fork can publish to.
- The authoritative fleet runbook is `~/.local/dotfiles/docs/paseo.md` — READ IT. It requires CLI and desktop versions to stay in lockstep, explains why the daemon binds `[::]:6767` instead of sitting behind Caddy, and owns the `paseo-at` / `paseo-ceres` / `paseo-hosts` helpers.
- Paseo's own release playbook is `docs/release.md` (two steps: local preparation, then a user-authorized publish; all workspaces share one version and release together). A release-beta skill exists in this repo's skill set.

PRE-RESOLVED DECISIONS — do not re-open these:

- Hosts: all three (ceres, saturn, neptune) — fleet parity, even though only ceres and saturn run gjc today.
- Mechanism: a fork release channel reusing `docs/release.md` and the release-beta flow — versioned fork artifacts that hosts install, not ad-hoc per-host builds.
- Ships the CLI/daemon ONLY for now; a forked desktop app is revisited only if real version drift actually bites. So: install a forked CLI on each host and repoint its launcher — the systemd unit on ceres, the LaunchAgent ProgramArguments on the Macs — leaving the stock Paseo.app in place as a client.
- Tier T3 external-durable. Appetite: two sittings, one for ceres and one for both Macs.
- Done: "A named fork version of the Paseo daemon runs on ceres, saturn and neptune — each host's launcher repointed at the forked CLI, each host's version verified — with the stock desktop app left as a client."
- The first move to plan around: spike the ceres path end to end — publish a fork version, repoint mise, restart the daemon, confirm it reports fork code.
- OUT OF SCOPE: forking the desktop app, replacing the brew cask, any code signing or notarization work; changing the `[::]:6767` bind or the Tailscale topology.
- Obstacle discipline: if two sittings cannot reach the T3 bar on all three hosts, plan a third sitting rather than lowering the standard. The tier is fixed once, not renegotiated to fit the container.

THE PLAN MUST RESOLVE:

1. Where fork artifacts live — own npm scope vs GitHub Packages vs versioned tarballs on the fork's GitHub Releases — with the trade-offs stated.
2. How fork versions are named against upstream betas so they never collide and so `paseo --version` makes the running code obvious.
3. Rollback to stock on each host, per host.
4. Whether the stock Paseo.app's own managed daemon collides on 6767 once the LaunchAgent runs a different binary, and how that is prevented.
5. What the runbook `~/.local/dotfiles/docs/paseo.md` must gain, since it is the authoritative fleet document.

HARD RULES: NEVER restart the Paseo daemon on port 6767 — it manages every running agent, including you. NEVER run the full test suite. Do not publish anything, do not touch any host's launcher, do not install anything, do not SSH to saturn or neptune to change state. This is a plan, not a deployment.

OUTPUT: write the final plan to `fork/plans/ralplan-fork-release-channel.md`, marked "pending approval", including the ADR. Fork-local material belongs under `fork/` — never `docs/`, which is upstream's and breaks on rebase.

PLANNING ONLY: no source changes, no installs, no commits, no implementation, no changes to any host. If you hit ralplan's 5-iteration cap (PLANNING-STUCK), stop and report it; do not blind-retry.
