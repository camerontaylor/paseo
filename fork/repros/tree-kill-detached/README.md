# Repro: closing one ACP agent kills a shared daemon

End-to-end check for `fix/tree-kill-spare-detached` (desvio basket carry).
The branch's unit tests live in `packages/server/src/utils/tree-kill.test.ts`;
this harness proves the user-visible behaviour against a real daemon.

## The bug

jcode runs one shared `jcode serve` behind every `jcode acp` adapter. The first
adapter starts it; the server calls `setsid()` but keeps that adapter as its
PPID. Paseo stopped an ACP agent with `tree-kill`, which walks descendants by
PPID alone, so closing that one agent sent SIGTERM to the shared server and
every other jcode agent failed with `Jcode daemon disconnected | code=-32603`
(neptune, 2026-10-25 12:00:47).

## The harness

- `server.mjs`: fake `jcode serve`. One Unix-socket backend; logs SIGTERM.
- `fake-acp.mjs`: fake `jcode acp`. Spawns the server detached (setsid) on
  its first prompt, so the server's PPID is that adapter, like jcode.
- `repro.sh <tree> <label>`: starts a side daemon from `<tree>` on
  `127.0.0.1:6870` with a throwaway home under `~/.cache/tk-repro/<label>`.
  Agent A starts the server; B and C start 20 s turns; A is archived. The
  script prints whether the server survived and what B and C returned. It
  never touches `~/.paseo` or the :6767 daemon.

`<tree>` must be a built checkout (`npm ci && npm run build:server`); the
adapter loads the ACP SDK from its `node_modules`. Linux only as written
(`ps -o sid=`; mise for Node).

## Expected

| Build | Shared server after archiving A | B and C |
|---|---|---|
| without the fix | `Server received SIGTERM`, dead | `Fake jcode daemon disconnected \| code=-32603` |
| with the fix | alive | `done after 20s` |

Verified on pluto 2026-10-25: v0.13.0 failed, the branch and `mine` + branch
passed. Re-run it on the canary when a release cycle touches
`packages/server/src/utils/tree-kill.ts` or ACP process shutdown.
