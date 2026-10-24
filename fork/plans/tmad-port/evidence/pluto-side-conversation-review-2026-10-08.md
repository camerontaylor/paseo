# Independent review: Pluto side-conversation event delivery

**Verdict: APPROVE**

## Scope

- Branch: `fix/pluto-side-conversation-events`
- Reviewed commit: `fddb4fa8587ae377286ffbea3137df4c53bdc7a9`
- Exact base: `24f134618cd8a7143615debf927c1ac60b9ba813` (the supplied `base24f134618`; also recorded in the reproduction evidence)
- Changed tracked files: `packages/server/src/server/session.ts` and `packages/server/src/server/session.test.ts` only.
- Worktree status at review: the only untracked items were seven package `node_modules` symlinks, excluded from scope.

## Findings

No actionable correctness or authorization findings.

## Review evidence

- The manager subscription is demand-driven at `session.ts:1647-1667`. `updateClientCapabilities()` now refreshes producer demand after every update (`:1236-1276`); side-conversation capability contributes demand (`:1670-1675`). When that demand goes away and no other agent observation remains, the existing unsubscribe branch runs (`:1661-1665`). Session cleanup also releases the manager subscription (`:8606-8614`).
- Source-free fallback state is recorded independently (`:1241-1245`) and is consulted only when there are no attached sources (`:1670-1675`). With attached sources, demand comes from their current capability snapshots, so a detached source's stale capability cannot restore demand.
- Side-conversation events are sent once to each attached source whose own capability set includes `sideConversations` (`:1678-1693`). The source-free path emits once only when source-free demand exists. In real WebSocket sessions, `onMessageToSource` verifies the socket remains attached (`websocket-server.ts:1387-1395`); the capability-aware path does not also call the shared broadcast emitter. The tests cover both capable/incapable connection orders, two capable sources, individual detach, full detach, capability removal, and the source-free case (`session.test.ts:233-379`).
- The outbound authorization guard remains before either delivery path (`session.ts:1684`). The existing permission map assigns `workspace.read` to update/removal and `workspace.write` to ask responses (`authorization/operation-permissions.ts:233-237`); inbound ask authorization remains `workspace.write` (`:16-18`). No authorization mapping or test checks were weakened.
- The diff is limited to the stated two tracked files and `git diff --check` produced no diagnostics. I did not rerun tests, builds, typecheck, lint, or formatting, per instruction. The supplied evidence records 157 session tests, 7 authorization tests, build/typecheck/lint/format passing.
- Read `docs/permissions.md`, `docs/architecture.md`, `docs/protocol-compatibility.md`, and `fork/upstream-sync.md` plus the side-conversations feature-ledger entry. This change does not modify protocol schemas or permission mappings; the relevant sync guard is retaining per-message authorization and preserving capability-specific routing.

## CodeRabbit

- `/home/ctaylor/.local/bin/coderabbit --version`: `0.8.2`.
- `coderabbit review --help` advertises both `--committed` and `--base-commit`; I used the supported exact-scope command:
  `coderabbit review --agent --committed --base-commit 24f134618cd8a7143615debf927c1ac60b9ba813`
- The CLI review did not start: authentication returned `environment_unsupported` because browser login is unavailable. Raw output: `/tmp/paseo-side-conversation-coderabbit-review.txt`. No credentials were requested and no login was attempted.
- CodeRabbit's official CLI page documents its Linux/macOS install channel at `cli.coderabbit.ai`; the local binary reports the expected version and help options. Its local binary provenance could not be cryptographically verified in this review. Official page: https://www.coderabbit.ai/cli
