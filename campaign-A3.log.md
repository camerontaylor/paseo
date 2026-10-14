# Campaign A3 — TMAD legacy UI (package A3, fork source refresh)

Worker: DeepSeek V4.1 Flash via jcode (`jcode/opencode-go:deepseek-v4.1-flash`, thinking high). Advisor: Sol (GPT-6.1, agentId `3f2c7ea5-1328-4cd7-85c3-8c3d3ddbe4ff`, read-only reviews).
Host: neptune (macOS) — installs, builds and tests run here; uranus is read-only for Sol.
Worktree: `/Users/ctaylor/.paseo/worktrees/1ns0r9d9/a3-legacy-ui` — branch `fork/tmad-refresh-legacy-ui-0.11.1` off frozen tmad `139e0c81e8eb51b0f97551171b2217838c3ebab5`.
Plan: `plans/ralplan-fork-source-refresh.md`, sha256 `abfe87512f35907382ff559d59a6a5c102ceff28290bb09faf62d16ed0605c53` (verified), 279 lines, read in full from `origin/fork/source-refresh-control-20261010`.

`campaign-A3.log.md` is added to the repo's `info/exclude` (`/Volumes/offload/neptune/repos/paseo/.git/info/exclude`, the same file B9 used; the worktree-private `info/exclude` does not exist for this git version). Never committed.

## s0 — orientation (2026-10-15, no edits)

Parent audit (both required equal to frozen tmad `139e0c81e8eb51b0f97551171b2217838c3ebab5`):

```
git rev-parse HEAD                                              → 139e0c81e8eb51b0f97551171b2217838c3ebab5  ✅
git merge-base HEAD 139e0c81e8eb51b0f97551171b2217838c3ebab5   → 139e0c81e8eb51b0f97551171b2217838c3ebab5  ✅
```

Frozen heads named by full SHA only (neptune's local `custom` has drifted; branch names are never used for frozen heads).

Control records read: `fork/campaign/execution-start.md` (host split, neptune hazards, worker-model change to DeepSeek V4.1 Flash, B9 exceptions, the standing coordinator sign-off rule), `fork/campaign/ledger.md` (A3 row 6 = IN PROGRESS; B9 CLOSED), `fork/campaign/baseline-equivalence.md` §6 (the `#33` delta list this package starts from), `fork/campaign/logs/B9.log.md` (log structure + Sol review style: real owners, deterministic tests, COMPLETE test-file runs, file:line evidence).

Docs read: `CLAUDE.md`, `docs/data-model.md` (file-based JSON persistence, no server-side migration framework), `docs/testing.md`, `docs/hover.md`, `docs/forms.md`, `docs/design.md`, `docs/unistyles.md`, `docs/explorer-sidebar.md`, `docs/qa.md`, `docs/protocol-compatibility.md`.

Sources verified present on neptune:

```
git cat-file -t e66cc56b8 → commit e66cc56b849bf7c39c69f578454b9ee37e21002f  "feat(pfork-4ab): add quiet tool-call display"
git cat-file -t a4bd8e3fe → commit a4bd8e3fe88e4783cc6658bcc79f21543b936650  "no-mistakes(review): Keep answered questions and approvals visible in Quiet"
git cat-file -t fe9086a39 → commit fe9086a39bed983fdaebd299815273d117bf21fa  "Show unread activity and sort workspace agent tabs (#33)"
```

### #34 source series (correction to the two-SHA shorthand)

`e66cc56b8` and `a4bd8e3fe` are the endpoints the plan names, but the commit series between them is four commits; there is one further touch of the same file set after `a4bd8e3fe`:

```
git log --oneline e66cc56b8..a4bd8e3fe
  a4bd8e3fe no-mistakes(review): Keep answered questions and approvals visible in Quiet
  6cae90316 test(pfork-4ab): verify Summary tool-call default in settings
  da5b159af no-mistakes(review): Default to Summary and keep failed tool calls visible

git log --oneline a4bd8e3fe..695c48fed -- packages/app/src/tool-calls/detail-level/ packages/app/src/hooks/use-settings/
  5de785ea2 no-mistakes(document): Document tool-call display and verify lint formatting
```

Ancestry (all ancestors of the TMAD snapshot head `695c48fed`):

```
e66cc56b8 IS ancestor of a4bd8e3fe   ✅
a4bd8e3fe IS ancestor of 695c48fed   ✅
fe9086a39 IS ancestor of 695c48fed   ✅  (and is the parent of e66cc56b8)
```

`5de785ea2` is a docs/lint follow-up: `README.md` +2 (user documentation), `tool-call-overview-sheet.spec.ts` (test), and a `migrations.ts` **comment-only** change (+5/−1, the rationale comment quoted below). The final production state of `migrations.ts`, therefore, is `5de785ea2`'s; every other production file's final state is at `a4bd8e3fe` (no later touch).

`fe9086a39` is the base commit for the whole #34 series (`e66cc56b8^ == fe9086a39`), so the cumulative #34 delta is `git diff fe9086a39..a4bd8e3fe` (18 files, +236/−26).

### s0 — environment readiness (2026-10-15)

Neptune hazard handled first, exactly as the brief requires. Four `packages/*/node_modules` were symlinks into the shared main checkout `/Volumes/offload/neptune/repos/paseo`:

```
packages/client/node_modules    -> /Volumes/offload/neptune/repos/paseo/packages/client/node_modules
packages/highlight/node_modules -> /Volumes/offload/neptune/repos/paseo/packages/highlight/node_modules
packages/plugin/node_modules    -> /Volumes/offload/neptune/repos/paseo/packages/plugin/node_modules
packages/protocol/node_modules  -> /Volumes/offload/neptune/repos/paseo/packages/protocol/node_modules
```

The four symlinks (and only the symlinks) were removed from this worktree; the main checkout was not touched. `mise trust .mise.toml` was run in the worktree.

- `ONNXRUNTIME_NODE_INSTALL=skip npm ci` → EXIT=0 (54 s).
- `NODE_OPTIONS=--max-old-space-size=6144 npm run build:server` → EXIT=0.

### s0 — baseline (recorded before any edit; frozen tmad `139e0c81e`)

```
npm run typecheck    → EXIT=0   (all 14 workspaces, no errors)
npm run lint         → EXIT=0   0 warnings, 0 errors, 4722 files, 177 rules
npm run format:check → EXIT=0   all files correctly formatted
```

**The A3 base is fully green.** This differs from the frozen infi-backend base (`panel-manifest.ts(46,3)` whole-workspace typecheck failure recorded in B9's log and in `execution-start.md`); tmad is unaffected. No baseline failure exists on this base, so no hook exception is needed and no baseline red needs reporting as waived. Campaign-recorded pre-existing e2e failures (`daemon-e2e/agent-basics.e2e.test.ts` "creates agent and receives response", `creation/creation.e2e.test.ts` "legacy keyed creation preserves checkout error codes", three `checkout-git.test.ts` structured-diff cases) are unrelated to A3's files and are never fixed here.

### s0 — base-vs-source file comparison (adaptation, not cherry-pick)

Ported files are compared against the source series' base state (`fe9086a39`) before adaptation. For the #34 file set:

```
SAME  packages/app/src/hooks/use-settings/migrations.ts
SAME  packages/app/src/hooks/use-settings/migrations.test.ts
SAME  packages/app/src/tool-calls/detail-level/grouping.ts
SAME  packages/app/src/tool-calls/detail-level/projection.ts
SAME  packages/app/src/tool-calls/detail-level/projection.test.ts
SAME  packages/app/src/screens/settings/chat/chat-section.tsx
DIFF  packages/app/src/hooks/use-settings/storage.ts        (base has contentMaxWidth/usage/sidebarFooterItems + steer-only SendBehavior; the #34 lines are identical)
DIFF  packages/app/src/hooks/use-settings/storage.test.ts   (base has extra legacy-shape tests; the #34 lines are present verbatim)
```

The two `DIFF` files differ from the source base only outside the #34 hunks, so the #34 hunks apply cleanly; the deltas are upstream/fork drift unrelated to this package.

## s1 — design note sent, Sol verdict (2026-10-15), verbatim

Sent: s0 status + the #34 four-commit correction + four rulings requested (default-change scope, migration id, test-expectation classification, README hunk). Sol replied:

> **s0 ADVANCE. s1 design APPROVE — option A**, subject to coordinator sign-off before changing existing test expectations.
>
> 1. Adopt the final #34 behavior through `a4bd8e3fe`, including the intermediate Summary-default correction. Fresh installs default to `overview`; existing installs move to Summary once. Explicit Quiet and Full-detail choices made afterward must survive reload and repeated migration. Record that the migration also overrides previously deliberate choices once—it cannot distinguish them from materialized defaults.
>
> 2. Keep the source migration id **`summary-tool-calls`** and its rationale. Do not ship the superseded `quiet-tool-calls` migration.
>
> 3. Classify the two storage expectation changes and added migration-id expectations as **behavioral carry-suite edits required by this approved default change**, not additive-only edits. Coordinator sign-off must be recorded before editing them. Preserve all other assertions; add coverage for later-choice retention, stored Quiet, and legacy `compactToolCalls: false`.
>
> 4. Drop the upstream-owned README hunk. Put the user-facing default/migration note in the owning fork documentation.
>
> Port and execute the targeted browser round trip during s1. Quiet must retain actionable questions/approvals, failures, and nonzero shell exits, including answered items. No hook exception is authorized or needed on this green base.
>
> This approves the stated design, not additional hunks from the intermediate commits; keep extraction limited to #34.

Sol's point 1 ("record that the migration also overrides previously deliberate choices once") is recorded in two places: the `migrations.ts` comment (`packages/app/src/hooks/use-settings/migrations.ts:16-21`) and `fork/CHANGELOG.md`.

## s1 — implementation (uncommitted; 19 files, +N/−M)

`git status --short` (excluding the git-excluded log):

```
 M fork/CHANGELOG.md
 M packages/app/e2e/browser/tool-call-overview-sheet.spec.ts
 M packages/app/src/hooks/use-settings/migrations.test.ts
 M packages/app/src/hooks/use-settings/migrations.ts
 M packages/app/src/hooks/use-settings/storage.test.ts
 M packages/app/src/hooks/use-settings/storage.ts
 M packages/app/src/i18n/resources/{ar,en,es,fr,ja,ko,pt-BR,ru,zh-CN}.ts
 M packages/app/src/screens/settings/chat/chat-section.tsx
 M packages/app/src/tool-calls/detail-level/grouping.ts
 M packages/app/src/tool-calls/detail-level/projection.test.ts
 M packages/app/src/tool-calls/detail-level/projection.ts
```

Production changes, each with its source:

- `storage.ts:43` `ToolCallDetailLevel = "quiet" | "overview" | "detailed"`; `:160` `DEFAULT_CLIENT_SETTINGS.toolCallDetailLevel = "overview"`; `:256` schema enum gains `"quiet"`; `:259` `.catch("overview")`; `:308` `stored.toolCallDetailLevel ?? "overview"` (the `compactToolCalls ? "overview" : "detailed"` branch is dropped, matching the source).
- `migrations.ts:16-22` `SUMMARY_TOOL_CALLS_MIGRATION = "summary-tool-calls"` with the adapted rationale comment; `:55-63` the one-time switch of any non-`overview` stored level, recorded in the applied-marker after the settings write (same writer order as `steer-default`).
- `chat-section.tsx:13-17` options ordered summary, quiet, full detail.
- `grouping.ts:39-48` `ACTIONABLE_TOOL_NAMES`; `:75-87` exported `isStandaloneToolCall`; `:89-94` `isGroupableToolCall = !isStandaloneToolCall`.
- `projection.ts:5` imports `isStandaloneToolCall`; `:24-35` `quietToolCallItems` (same WeakMap memo shape as `visibleToolCallItems`); `:59` `prepareToolCallHistory` returns null for quiet; `:86-93` the quiet projection branch.
- 9 locales: `settings.general.toolCallDetail.options.quiet` added with the source's translations (ar هادئ, en Quiet, es Discreto, fr Discret, ja 控えめ, ko 간소화, pt-BR Discreto, ru Тихий режим, zh-CN 精简).
- `fork/CHANGELOG.md` (Sol ruling 4): dated entry recording the Summary default, the once-only switch of existing installs, Quiet's semantics, and the migration id. The upstream `README.md` hunk is **dropped** per guardrail §2.12.

Test changes:

- Additive only (no sign-off needed): `projection.test.ts` three new tests (quiet hides routine calls, keeps failures/nonzero exits/plans/answered questions/approvals; summary keeps them separate; failed calls outside summary groups) plus `quiet` added to the existing `it.each` level list; `migrations.test.ts` two new tests (full-detail → summary once with a later `detailed` retained; stored `quiet` → summary with a later `quiet` retained) and the `storedToolCallDetailLevel` helper; `storage.test.ts` one new test (legacy `compactToolCalls: false` now resolves to summary).
- Browser: `tool-call-overview-sheet.spec.ts` gains the settings round trip (defaults to Summary, Quiet and Full detail offered, both survive a reload). **Adaptation:** the source writes evidence PNGs through a new `PASEO_TEST_EVIDENCE_DIR` env var that does not exist in this repo; I used the file's existing `testInfo.attach(..., { body: await page.screenshot() })` idiom instead, so the run yields three attachments (`compact-summary-tool-calls`, `desktop-summary-tool-calls`, `chat-tool-call-display-choices`, `chat-tool-call-display-quiet`).

## s1 — evidence (2026-10-15)

`npm run format` (clean), `npm run typecheck` → EXIT=0 (all 14 workspaces), `npm run lint` → EXIT=0 (0 warnings, 0 errors, 4722 files, 177 rules). Baseline was already green, so nothing is waived and no hook exception is used.

Complete-file unit runs (`npx vitest run <file>`, no `-t`, no `--bail`):

| File | Result | Failing assertions |
| --- | --- | --- |
| `packages/app/src/tool-calls/detail-level/projection.test.ts` | 21 passed, 2 failed | both failures are the two pre-existing fixtures that contain a `status: "failed"` call, now standalone → `editedFileCount 1→0`, `searchCount 1→0` |
| `packages/app/src/hooks/use-settings/migrations.test.ts` | 5 passed, 7 failed | all seven are `appliedIds(...)` lists now missing `"summary-tool-calls"` |
| `packages/app/src/hooks/use-settings/storage.test.ts` | 83 passed, 2 failed | the two `toolCallDetailLevel` expectations at `:782` and `:812` |
| `packages/app/src/i18n/resources.test.ts` | 40 passed, 0 failed | 9-locale parity holds with the new key |

**All three new modules' new tests pass**, and the extended `it.each` quiet case passes; every failure is one of the expectation edits awaiting sign-off below (no other failure exists).

Targeted browser e2e (`npx playwright test --project=browser e2e/browser/tool-call-overview-sheet.spec.ts`, `NODE_OPTIONS=--max-old-space-size=6144`, from `packages/app`):

```
✓ 1 compact overview tool calls › keeps a live group sheet current and stacks individual details above it (17.6s)
✓ 2 keeps overview tool calls inline on desktop (10.6s)
✓ 3 defaults tool calls to Summary and keeps Quiet and Full detail available (16.2s)
3 passed (1.6m)
```

Harness isolation (never port 6767): `[metro] Waiting on http://localhost:63544`, `[e2e] Metro warmed on port 63544`, `[e2e] Worker 0 daemon started on port 63601, home: /Users/ctaylor/.tmp/paseo-e2e-worker-0-HewIdg`. The harness reserves 6767/6768/61680 explicitly (`packages/app/e2e/support/global-setup.ts:19-23`) and picks a free port.

## s1 — PENDING: coordinator sign-off for three existing-test edits (blocking commit)

Sol classified the storage/migration expectation changes as **"behavioral carry-suite edits required by this approved default change, not additive-only edits"** and requires coordinator sign-off before editing them. Under the standing rule I am also asking about the two `projection.test.ts` fixtures, which Sol did not classify, because they too modify pre-existing tests. Nothing below is edited yet.

1. `packages/app/src/hooks/use-settings/storage.test.ts:782` — `expect(result.toolCallDetailLevel).toBe("detailed")` → `"overview"`. Required because the default is now Summary (test: "defaults the appearance fields when an old blob omits them").
2. `packages/app/src/hooks/use-settings/storage.test.ts:812` — `expect((await loadAppSettingsFromStorage(deps)).toolCallDetailLevel).toBe("detailed")` → `"overview"`. Required because the unknown-level fallback is now Summary (test: "clears settings with an unrecognized tool call detail level").
3. `packages/app/src/hooks/use-settings/migrations.test.ts` — seven `appliedIds(...)` expectations gain `"summary-tool-calls"`: `:55` `["steer-default"]` → `["steer-default","summary-tool-calls"]`; `:74` same; `:83` same; `:93` `["some-later-migration","steer-default"]` → `[...,"summary-tool-calls"]`; `:104` `["steer-default","mobile-content-16"]` → `["steer-default","summary-tool-calls","mobile-content-16"]`; `:115` `["steer-default"]` → `+ "summary-tool-calls"`; `:154` `["steer-default"]` → `+ "summary-tool-calls"`. `:142` (`toEqual([])`) is **not** touched: that test's settings write fails, so no marker is written.
4. `packages/app/src/tool-calls/detail-level/projection.test.ts:329` — the call `toolCall("4", { type: "edit", ... }, { status: "failed" })` becomes non-failed, so the "builds overview summaries without category-specific presentation data" fixture keeps `editedFileCount: 1`. The assertion itself is unchanged.
5. `packages/app/src/tool-calls/detail-level/projection.test.ts:356-357` — the call `toolCall("4", { type: "search", ... }, { status: "failed" })` becomes non-failed, so "distinguishes reads, searches, and other tools in overview" keeps `searchCount: 1`. The assertion itself is unchanged.

Items 4 and 5 change fixture inputs (not expected values, assertions or matchers) to preserve each test's intent under the adopted `isGroupableToolCall = !isStandaloneToolCall` rule, which the approved final state requires. Sol's ruling on the source series is "adopt the final #34 behavior through `a4bd8e3fe`", which includes that rule.

**Status: s1 implementation complete and green except the five edits above; nothing committed; branch still at `139e0c81e8eb51b0f97551171b2217838c3ebab5` on `origin`.**

## s2 — DRAFT equivalence record (#33 vs upstream `mark-unread.ts`) — evidence gathered, not yet submitted

Held until s1 ADVANCE per the stage protocol. Evidence collected so far is recorded here so the record can be sent immediately after ADVANCE.

### The two mechanisms, with file:line

**Upstream (our base) — explicit, server-owned, persisted, per-agent attention.**
`packages/app/src/workspace/mark-unread.ts:5` exports only `markWorkspaceUnread(serverId, workspaceId)`; it resolves the host client, unfocuses the pane so the mark is not consumed, and calls `client.markWorkspaceUnread(workspaceId)`. Its only caller is `packages/app/src/hooks/use-workspace-read-state.ts` (`import` at `:6`, `markUnread` at `:37-43`), which gates on `useHostFeature(serverId, "workspaceMarkUnread")` and `status === "done"`. Server side: `packages/server/src/server/session.ts:7696` `handleWorkspaceMarkUnreadRequest` picks the newest finished root agent (`idle`/`closed`, no `requiresAttention`, no pending permissions) and calls `agentManager.markAgentUnread`, which sets `attention = { requiresAttention: true, attentionReason: "finished", attentionTimestamp }` and persists the snapshot (`packages/server/src/server/agent/agent-manager.ts:2398-2414`). The app renders that as the workspace "attention" bucket (`packages/app/src/utils/sidebar-agent-state.ts`, test "treats unread finished agents as attention"). So: **user-initiated, daemon-authoritative, persisted, per-agent, workspace-level badge, cleared by attention-clearing.**

**TMAD #33 — automatic, client-local, ephemeral, per-tab.**
`fe9086a39` does **not** touch `mark-unread.ts`, adds no RPC and no server state. `workspace-tab-activity.ts:7-27` `reconcileTabActivity` derives `unread` for each agent tab from `agentLastActivity` deltas observed while the tab is not in a focused visible pane (`viewedTabIds`), memoized in React state, cleared when the tab becomes the focused pane tab. It is a display dot in the workspace tab row / tab switcher, cleared on visit, never persisted, never sent anywhere. So: **implicit, client-only, session-scoped, per-tab, no daemon authority.**

**Conclusion:** the mechanisms are complementary, not duplicates. #33 does not reimplement mark-unread and does not create a second unread authority; it adds an automatic "background activity" indicator where upstream only has an explicit "mark as unread" action. The plan's premise for "adopt missing sort delta only" ("upstream has `mark-unread.ts`") therefore does not remove anything from #33's unread-display half.

### s3 carrier audit against our base (base `139e0c81e`, source parent `794c9e0b3`)

17 files in `fe9086a39`. 3 are absent from our base (both new modules and the e2e spec); 14 exist and differ from the source parent. Drift is real, so s3 is adaptation, not cherry-pick:

```
ABSENT-BASE  packages/app/e2e/browser/workspace-tab-activity.spec.ts
ABSENT-BASE  packages/app/src/screens/workspace/workspace-tab-activity.ts
ABSENT-BASE  packages/app/src/screens/workspace/workspace-tab-activity.test.ts
DIFFERS      packages/app/src/components/split-container.tsx             (vs implicit base: 27 lines)
DIFFERS      packages/app/src/screens/workspace/workspace-screen.tsx    (140 lines)
DIFFERS      packages/app/src/screens/workspace/workspace-desktop-tabs-row.tsx (142 lines)
DIFFERS      packages/app/src/screens/workspace/explorer-sidebar.tsx    (115 lines)
DIFFERS      packages/app/src/screens/workspace/workspace-tab-presentation.tsx (3 lines)
DIFFERS      packages/app/src/i18n/resources/*.ts  (9 files)
SAME         packages/app/src/screens/workspace/workspace-tabs-types.ts
SAME         packages/app/src/stores/workspace-layout-actions.ts
```

Anchors that do exist on our base (so adaptation is feasible): `agentLastActivity` (`packages/app/src/stores/session-store.ts:457`), `collectAllPanes` (`packages/app/src/stores/workspace-layout-actions.ts:1099`), `uiTabs` and `focusedPaneTabState` (`workspace-screen.tsx:1916`, `:1994`), `uiTabs: WorkspaceTab[]` on `SplitContainer` (`split-container.tsx:103`), `tabs.modified` in all 9 locales, and on the e2e side `seedMockAgentWorkspace`/`openAgentRoute`, `SeedDaemonClient.createAgent|sendAgentMessage|waitForFinish` (`e2e/support/helpers/seed-client.ts:104,149,150`), `modeId: "load-test"` (used by several existing helpers), the `workspace-tab-switcher-trigger` testID, and the `bottomSheetBackdrop` "Bottom sheet backdrop" label that already has a precedent spec (`e2e/browser/sidebar-mobile-menu-sheets.spec.ts:11`).

Also verified after the audit: `e2e-fast-stream` is a real mock model id (`packages/server/src/server/agent/providers/mock-load-test-agent.ts:165`, already used by `e2e/browser/sidebar-workspace-mark-unread.spec.ts:175`), and the row testIDs the #33 spec targets already exist (`workspace-tab-${testIdentity}` at `workspace-desktop-tabs-row.tsx:888`, `workspace-tab-modified-${testIdentity}` at `:905`). The `unread` dot testID is the one this package adds. `packages/app/test-results/` is gitignored (created by the playwright run, not tracked).

### Scope question for the s2 verdict

The plan row says "#33 ... adopt missing sort delta only"; the coordinator's `baseline-equivalence.md` §6 delta list names the full carrier set (including `workspace-desktop-tabs-row.tsx`, `workspace-tab-presentation.tsx`, the one `explorer-sidebar.tsx` line and one locale line × 9, all of which exist only to carry the unread dot), and the A3 brief lists the same set. My reading is that the §6 list and the brief describe the intended s3 scope and the plan row's "sort delta only" understates it because the equivalence premise turned out not to hold. Requested ruling: **adopt the full #33 set (sort + the client-local unread dot)**, or restrict s3 to `sortTabsByActivity` alone (which would drop those four carriers, the locale line, and force the e2e down to ordering-only assertions).


