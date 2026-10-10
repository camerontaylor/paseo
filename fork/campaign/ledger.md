# Serial campaign ledger — fork source refresh

One row per schedule slot (plan §4). Sol verdicts are quoted in the linked package log; this ledger records verdict kinds + evidence pointers. Authorization, advisor override, frozen heads, and out-of-scope list live in [execution-start.md](execution-start.md). Equivalence evidence lives in [baseline-equivalence.md](baseline-equivalence.md).

| # | ID | Branch | Base head (recorded) | Worker | Sol verdicts | Package gate | Basket SHA | Status |
| - | -- | ------ | -------------------- | ------ | ------------ | ------------ | ---------- | ------ |
| 0 | baseline/equivalence (§5.3 + A1 s0) | — (control) | — | coordinator | — | — | — | DONE — see baseline-equivalence.md |
| 1 | C1 queue durability | `fork/tmad-refresh-queue-durability-0.11.1` @ `8468e7f55` | `139e0c81e8eb51b0f97551171b2217838c3ebab5` | neptune `24636e40-…` (s1) → uranus `c4cb3dd7-39ca-448d-a16b-abd2b512925e` (s2, s3, gate test) (glm-5.3-flash) | s1 PF APPROVE + ADVANCE `db54e7d71`; s2 PF APPROVE + ADVANCE `272c640d9`; s3 PF APPROVE + ADVANCE `16d04acff` — see logs/C1.log.md | ITERATE → ADVANCE `8468e7f55` | `1e4a4f1039fbdf09df0b59830e8c6d69d23f6b80` (`fork/refresh-basket-c1`; Sol ADVANCE) | DONE 2026-10-11 — open: browser/platform proof, remote CI, s1 drain key-only assertion, legacy `queued: true` unreachable, uncertain case via seeded residue |
| 2 | C2 Stream durability | `fork/tmad-refresh-stream-durability-0.11.1` | tmad `139e0c81e8eb51b0f97551171b2217838c3ebab5` | uranus `7bca4486-de51-42df-961f-09553825a941` (glm-5.3-flash) | pending (PF s2, s4) | pending | pending | IN PROGRESS — dispatched 2026-10-11 |
| 3 | A1 ACP diagnostics | `fork/acp-diagnostics-0.11.1` | custom `cbc2017186b980e7928bc376cfdeabb90ef56aa2` | — | — | — | — | PENDING |
| 4 | A2 quit dialog | `fork/infi-refresh-quit-dialog-0.11.1` | infi-backend `1dd375931a0c4de5e930abb4b2cf2dc52d9cbcc5` | — | — | — | — | PENDING |
| 5 | B9 diff-stat | `fork/infi-refresh-diff-stat-0.11.1` | infi-backend | — | — | — | — | PENDING |
| 6 | A3 TMAD legacy UI | `fork/tmad-refresh-legacy-ui-0.11.1` | tmad | — | — | — | — | PENDING |
| 7 | B1 selection/replies | `fork/infi-refresh-selection-replies-0.11.1` | infi-backend | — | — | — | — | PENDING |
| 8 | B2 agent defaults | `fork/infi-refresh-agent-defaults-0.11.1` | infi-backend | — | — | — | — | PENDING |
| 9 | B3 browser scaling | `fork/infi-refresh-browser-scaling-0.11.1` | infi-ui `133ff0f7e0234da8aa684a23a8da31024531242d` | — | — | — | — | PENDING |
| 10 | B4 transcript drafts | `fork/infi-refresh-transcript-drafts-0.11.1` | infi-backend | — | — | — | — | PENDING |
| 11 | B5 workspace snooze | `fork/infi-refresh-workspace-snooze-0.11.1` | infi-backend | — | — | — | — | PENDING |
| 12 | B6 Linear + PR header | `fork/infi-refresh-linear-header-0.11.1` | infi-backend | — | — | — | — | PENDING |
| 13 | B10 status snooze | `fork/infi-refresh-status-snooze-0.11.1` | B5+B6 combined integration ref (SHA frozen at s0; retained as `refs/research/b10-base-<sha>`) | — | — | — | — | PENDING |
| 14 | B7 tool titles | `fork/infi-refresh-tool-titles-0.11.1` | infi-backend | — | — | — | — | PENDING |
| 15 | B8 sleep delivery | `fork/infi-refresh-sleep-delivery-0.11.1` | infi-backend | — | — | — | — | PENDING |
| 16 | C3 realtime voice | `fork/tmad-refresh-voice-realtime-0.11.1` | tmad | — | — | — | — | PENDING |
| 17 | C4 session UX | `fork/tmad-refresh-session-ux-0.11.1` | tmad | — | — | — | — | PENDING |
| 18 | C5 views | `fork/tmad-refresh-views-0.11.1` | tmad | — | — | — | — | PENDING |
| 19 | C6 prompt routing | `fork/tmad-refresh-prompt-routing-0.11.1` | tmad | — | — | — | — | PENDING |
| 20 | C7 stream review (PR61) | `fork/tmad-refresh-stream-review-0.11.1` | C2 branch head (real dep) | — | — | — | — | PENDING |
| 21 | C8 alias guard | `fork/queue-alias-guard-0.11.1` | tmad | — | — | — | — | PENDING |

## Notes

- 2026-10-10: campaign started. Execution-start + baseline/equivalence recorded. C1 worker dispatched (claude-zai/glm-5.3-flash) in Paseo workspace off `fork/tmad-0.11.1`.
- Rolling basket after every package: disposable basket worktree containing EXACTLY the five frozen heads + accepted overlays; typecheck+lint; seam checks; parent/ref audit; Sol basket verdict; SHA recorded above. The coordinator builds baskets — package workers do not.
- Broader remote-CI / platform-hardware QA evidence is recorded PENDING per package until a real run exists; never claimed green.
- 2026-10-10: host migration neptune → uranus; new Sol `3f2c7ea5-1328-4cd7-85c3-8c3d3ddbe4ff`; Opus 5.5 coordinator. See the re-pin record in execution-start.md. C1 s1 CLOSED (ADVANCE at `db54e7d71`); s2 resumes from `handover/c1-s2-wip-20261010`. Package logs are mirrored under `logs/`.
- 2026-10-11: C1 CLOSED. Package gate ADVANCE at `8468e7f55`; basket `1e4a4f103` ADVANCE; custom re-pin ruling: retain `cbc201718`.
