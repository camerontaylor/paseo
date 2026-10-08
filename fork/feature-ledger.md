# Custom feature ledger

This ledger covers behavior maintained on `custom`. The live Desvio manifest at
`~/.paseo-fork/manifest.txt` owns the list and order of external PR carries.
Their authors can keep rebasing those branches while Desvio repeatedly merges
them into `mine`; that does not make their code part of `custom`. When we absorb
a carry into `custom`, move its ownership here and remove its manifest line on
the next rebuild.

Use `git diff <pinned-tag>..custom -- <path>` for the current footprint and
`git log <pinned-tag>..custom -- <path>` for its history. Paths below are entry
points and sync hotspots, not a copy of every changed file. Update the relevant
row when ownership or a cross-package seam changes.

| Owned work | Introduced | Entry points and shared wiring | Sync check |
| --- | --- | --- | --- |
| Side conversations | `7308e46e7` | `packages/server/src/server/agent/side-conversations/`, provider side-question modules, `packages/app/src/side-conversations/` and side-conversation panel; wires through `packages/protocol/src/messages.ts`, client capabilities, `agent-manager.ts`, `session.ts`, and app tab/panel identity. | Recheck permissions and client capability maps, then the provider and panel tests. See [upstream-sync.md](upstream-sync.md) for silent failures already seen. |
| ACP cancellation boundary and GJC provider | `70bbdcc6f`, `0cfa0d2ca` | `packages/server/src/server/agent/providers/gjc-acp-agent.ts`, `acp-agent.ts`, and `agent-manager.ts`; shares provider lifecycle with side conversations. | Recheck stop ownership, successor admission, and provider tests when upstream changes turn cancellation. The [fix-pass plan](plans/plan-cancellation-boundary-fix-pass.md) preserves the verified contract. |
| Fork build and release channel | `00a7ef783`, `c119276fe` | `fork/scripts/release-fork.mjs`, `.github/workflows/fork-npm-publish.yml`, `.github/workflows/fork-ci.yml`, and the external Desvio configuration. | Verify the pinned base, manifest, release script tests, CI result, and published artifact before deployment. [CHANGELOG.md](CHANGELOG.md) records base and release decisions. |
| Transient worktree setup | `05d3b9bf7`, `de22c6238` | `fork/scripts/init-worktree.mjs`, `scripts/worktree-trust-mise.sh`, and the carried `paseo.json` setup hook. | Recheck after upstream changes worktree initialization; [worktrees.md](worktrees.md) owns the environment gotchas. |
| Local Zcode plugin fixes | `57317859a` | `fork/scripts/zcode-plugin-patch/`. These patches target installed plugin code rather than Paseo's core. | Reapply after plugin updates until the two linked upstream fixes ship. The [README](README.md) links the patch workflow. |

The shared hotspots are `packages/protocol/src/messages.ts`,
`packages/client/src/daemon-client.ts`,
`packages/server/src/server/agent/agent-manager.ts`,
`packages/server/src/server/session.ts`, and app panel/tab identity. A textual
merge can leave these compiling while runtime routing is wrong. Use the checks
in [upstream-sync.md](upstream-sync.md) after each base change.
