You are the Stream porter (P1, feature TM-01). Read /tmp/tmad-port/COMMON.md first and obey it, then read ALL of /tmp/tmad-port/plan.md, especially "Compatibility contracts > Stream", "Source tracking", "Update loop" and "P1". Your worktree is already on branch `intake/tmad-stream-flow`, branched from v0.11.0-beta.3 (6166a7aca). It is RELEASE-BASED: custom and mine must never become ancestors.
Report ID: TM-01 (/tmp/tmad-port/evidence/TM-01.md).

Objective: a complete, standalone Stream/artifact vertical slice (capture, storage, optional wire contract, artifacts, feed, pins, triage, Chat/Stream switching) on beta.3, with provenance, and the PR19->#21 maintenance rehearsal.

Source map (verify; find more with `git diff --name-status af247e4f4^ af247e4f4`, `gh pr view 19 -R tmad4000/paseo --json files,commits`, and PRs 1, 10, 16): packages/app/src/companion-stream/{feed.tsx,model.ts,model.test.ts}, packages/app/src/artifacts/feed.tsx, packages/protocol/src/companion-stream.ts, packages/protocol/src/messages.artifacts.test.ts, packages/server/src/server/agent/companion-stream{,.test}.ts, packages/server/src/server/agent/artifacts/{collector,collector.test,backfill.test}.ts, packages/cli/src/commands/agent/artifacts-scan.ts, docs/companion-stream.md, and the Stream-specific hunks in shared host files: agent-panel.tsx, workspace-tab-menu.ts, segmented-control.tsx, turn-footer.tsx, message.tsx, agent-stream/view.tsx, protocol messages.ts, session.ts / websocket server, agent storage schema, i18n resources.

Steps:
1. ONNXRUNTIME_NODE_INSTALL=skip npm ci; record baseline typecheck/lint status on the untouched branch.
2. REHEARSAL FIRST COMMIT SERIES: port the Stream feature content as of PR #19 (af247e4f4) onto beta.3: copy the core module files from af247e4f4 and adapt only the host seams needed to compile/run. Commit (trailers Source-Commit: af247e4f4..., Port-Feature: TM-01).
3. Then apply ONLY the Stream changes from af247e4f4..51fb7693d (`git diff af247e4f4 51fb7693d -- <stream paths>`; expect the two feeds, collector, companion-stream and the artifact backfill test, ~+200/-65) through the same seams, plus the Stream-relevant shared-file hunks from #21. Commit separately (Source-Commit: 51fb7693d...). Record: changed paths, conflicts, adaptation effort (time/hunks), and compare each core file blob with `git rev-parse 51fb7693d:<path>` vs `git hash-object <path>`; list every intentional difference with reason.
4. Contracts (plan Stream section), each as separate local-fix commits where they diverge from source:
   - Capture accepted canonical live events after existing stream coalescing; no second timeline owner, no invented history.
   - Bounded moments/excerpts; explicit bounds for pins, manual entries and artifact path metadata (measure, choose, test).
   - Do NOT restore recursive fs.watch (read docs/file-observation.md); end-turn scans bounded.
   - Wire: optional fields only. Feature gate `companionStreamPortV1` in server_info.features; do NOT advertise source's `companionStream`. Rename flat `update_companion_entry_request`/response to `agent.companion.update_entry.request`/`.response`; mutations need workspace.write, reads workspace.read; update every authorization map + client capability default; old clients must not receive unknown top-level events; release observations when the owning view closes. Tag any compat code `// COMPAT(companionStreamPortV1): added in v0.11.0-beta.3-fork, remove after 2027-04-01`.
   - Keep Chat mounted when switching to Stream (drafts, attachments, scroll, active agent preserved); selecting a moment never sends/cancels/grants.
   - Surface failed pin/triage mutations (no silent catch). Localize labels in EVERY locale under packages/app/src/i18n/resources (incl. ko); label is "Stream pins" (distinct from IP-11's "Pinned prompt", which is not in this branch).
   - Preserve the source tab-menu "View Stream" action alongside existing upstream menu items. If something can ONLY compile with custom/infi code, do NOT add it here: list it in the report as a TM-01B bridge requirement.
   - Native Find is NOT part of this branch (separate TM-07). Don't port chat-find.
5. Tests: carry source tests (companion model, server companion, collector, backfill, protocol artifacts schema). Add tests for bounds, the renamed RPC, authorization entries, capability-absent behavior. Run each specific file, plus authorization/index.test.ts. npm run build:server, typecheck, lint, format.
6. UI evidence is a later step; but do a quick sanity check that the app typechecks and, if feasible, describe how to reach Stream in the UI in your report.
7. Verify `git merge-base --is-ancestor origin/custom HEAD` is FALSE and same for `mine`.

Report per COMMON.md, including the rehearsal metrics and the seam table (agent-panel integration, accepted-event capture, storage/projections, protocol delivery, file navigation: source location -> port location -> why different).
