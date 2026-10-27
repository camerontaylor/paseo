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

The [0.13.2 audit](audit-0.13.2.md) assesses retention and plugin feasibility,
including the external basket, at that release boundary.

| Owned work | Introduced | Entry points and shared wiring | Sync check |
| --- | --- | --- | --- |
| Side conversations | `7308e46e7` | `packages/server/src/server/agent/side-conversations/`, provider side-question modules, `packages/app/src/side-conversations/` and side-conversation panel; wires through `packages/protocol/src/messages.ts`, client capabilities, `agent-manager.ts`, `session.ts`, and app tab/panel identity. | Recheck permissions and client capability maps, then the provider and panel tests. See [upstream-sync.md](upstream-sync.md) for silent failures already seen. |
| ACP cancellation boundary and GJC provider | `70bbdcc6f`, `0cfa0d2ca` | `packages/server/src/server/agent/providers/gjc-acp-agent.ts`, `acp-agent.ts`, and `agent-manager.ts`; shares provider lifecycle with side conversations. | Recheck stop ownership, successor admission, and provider tests when upstream changes turn cancellation. The [fix-pass plan](plans/plan-cancellation-boundary-fix-pass.md) preserves the verified contract. |
| Fork build and release channel | `00a7ef783`, `c119276fe` | `fork/scripts/release-fork.mjs`, `.github/workflows/fork-npm-publish.yml`, `.github/workflows/fork-ci.yml`, and the external Desvio configuration. | Verify the pinned base, manifest, release script tests, CI result, and published artifact before deployment. [CHANGELOG.md](CHANGELOG.md) records base and release decisions. |
| Transient worktree setup | `05d3b9bf7`, `de22c6238` | `fork/scripts/init-worktree.mjs`, `scripts/worktree-trust-mise.sh`, and the carried `paseo.json` setup hook. | Recheck after upstream changes worktree initialization; [worktrees.md](worktrees.md) owns the environment gotchas. |
| Usage protocol compatibility | Upgrade 0.11.1 | Optional streaming negotiation in protocol, client observer and Usage session RPC. | Old beta.3 clients receive terminal reports; patched clients consume streamed and terminal reports once. Unpatched beta.4–0.11.1 clients need an update for Usage display. [Protocol contract](../docs/protocol-compatibility.md). |
| Pi effort notices | Cancellation-boundary work | Pi effort-cache notice, effective thinking state and MCP `update_agent` result. | Check notices through both provider updates and MCP, including effective-level persistence. |
| Fork plugin SDK identity | Upgrade 0.11.1 | `packages/plugin/src/sdk-specifiers.ts`, server compiler/evaluator mappings and app plugin evaluator. | Public and fork-scoped SDK imports must resolve to the same host modules; keep upstream compatibility entrypoints. |
| Provider prompt policy | Native ZCode cutover | Daemon appended-policy exclusions and plugin-provider `supportsSystemPrompt` validation. | Preserve explicit rejection of unsupported instructions. Migrate policy and provider validation before removing host changes. |
| Android table selection | After 0.13.0 | `patches/react-native-enriched-markdown+*.patch`; native regression cases in `ScrollSelectionTest.kt`. | Keep selection within each cell, short file-link taps, and whole-table copy actions in the selection toolbar. Rebuild Android after updating the patch; verify horizontal scrolling and the inverted chat viewport. |
| Native ZCode migration | Upgrade 0.11.1 | `fork/scripts/migrate-zcode-native.mjs` materializes AGENTS policy before provider cutover. | [Instructions and priority change](zcode-system-prompt.md); old ACP source remains disabled for rollback. |

The shared hotspots are `packages/protocol/src/messages.ts`,
`packages/client/src/daemon-client.ts`,
`packages/server/src/server/agent/agent-manager.ts`,
`packages/server/src/server/session.ts`, and app panel/tab identity. A textual
merge can leave these compiling while runtime routing is wrong. Use the checks
in [upstream-sync.md](upstream-sync.md) after each base change.
