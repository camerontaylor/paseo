You are the Native Find porter (P6 item, feature TM-07). Read /tmp/tmad-port/COMMON.md first and obey it, then /tmp/tmad-port/plan.md (Scope table row "Native chat search wrapper", P6, Verification "Native Find"). Your worktree is on branch `intake/tmad-native-find`, from v0.11.0-beta.3 (6166a7aca). Release-based: custom/mine must never be ancestors. No Stream dependency in either direction.
Report ID: TM-07.

Context: in our tree packages/app/src/agent-stream/chat-find/index.tsx (native) is a no-op stub while web search exists (index.web.tsx, model/matches/viewport). Source 51fb7693d has a reconciled native wrapper: packages/app/src/agent-stream/chat-find/{index.tsx,native-viewport.ts,native-viewport.test.ts,matches.ts,model.ts,...} (source PRs #11 and #21). Compare every chat-find file between v0.11.0-beta.3 and 51fb7693d first: `git diff v0.11.0-beta.3 51fb7693d -- packages/app/src/agent-stream/chat-find packages/app/e2e/browser/chat-find.spec.ts`, and find the native call sites/viewport hooks it needs in agent-stream/view*.tsx and the tab menu (`git diff v0.11.0-beta.3 51fb7693d -- packages/app/src/agent-stream packages/app/src/screens/workspace` filtered to find-related hunks).

Steps:
1. ONNXRUNTIME_NODE_INSTALL=skip npm ci; record baseline typecheck/lint.
2. Port the native wrapper + native viewport onto the EXISTING search model/RPC (do not resurrect a removed search scaffold; reuse upstream's model/matches if source changes to them are not needed). Commit with trailers (Source-Commit: 51fb7693d..., Port-Feature: TM-07).
3. Requirements: history loading for matches outside loaded window, selected-row reveal/highlight, invocation via the existing tab menu "Find" (native), cleanup on panel hide/unmount. Must compile and run without any Stream code. Localize any new strings in every locale.
4. Tests: carry native-viewport.test.ts and any matches/model test changes; run each file; npm run typecheck, lint, format.
5. Verify custom/mine not ancestors.
Report per COMMON.md (ledger rows for every chat-find file). Note for the report: native device evidence is required later (iOS simulator/Android); say what to check.
