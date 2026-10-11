# Serial campaign ledger — fork source refresh

One row per schedule slot (plan §4). Sol verdicts are quoted in the linked package log; this ledger records verdict kinds + evidence pointers. Authorization, advisor override, frozen heads, and out-of-scope list live in [execution-start.md](execution-start.md). Equivalence evidence lives in [baseline-equivalence.md](baseline-equivalence.md).

| # | ID | Branch | Base head (recorded) | Worker | Sol verdicts | Package gate | Basket SHA | Status |
| - | -- | ------ | -------------------- | ------ | ------------ | ------------ | ---------- | ------ |
| 0 | baseline/equivalence (§5.3 + A1 s0) | — (control) | — | coordinator | — | — | — | DONE — see baseline-equivalence.md |
| 1 | C1 queue durability | `fork/tmad-refresh-queue-durability-0.11.1` @ `8468e7f55` | `139e0c81e8eb51b0f97551171b2217838c3ebab5` | neptune `24636e40-…` (s1) → uranus `c4cb3dd7-39ca-448d-a16b-abd2b512925e` (s2, s3, gate test) (glm-5.3-flash) | s1 PF APPROVE + ADVANCE `db54e7d71`; s2 PF APPROVE + ADVANCE `272c640d9`; s3 PF APPROVE + ADVANCE `16d04acff` — see logs/C1.log.md | ITERATE → ADVANCE `8468e7f55` | `1e4a4f1039fbdf09df0b59830e8c6d69d23f6b80` (`fork/refresh-basket-c1`; Sol ADVANCE) | DONE 2026-10-11 — open: browser/platform proof, remote CI, s1 drain key-only assertion, legacy `queued: true` unreachable, uncertain case via seeded residue |
| 2 | C2 Stream durability | `fork/tmad-refresh-stream-durability-0.11.1` @ `94fbbd6a4` | tmad `139e0c81e8eb51b0f97551171b2217838c3ebab5` | GLM `7bca4486-…` (s1–s4) → DeepSeek `a6214735-…` (s4–s5, gate EXC-1/2, died on jcode disconnect) → DeepSeek `23a75336-3f63-402c-88ef-cec09602a3dc` (gate tests) | s1 ADVANCE `49a16f058`; s2 PF APPROVE + ADVANCE `c9fef7739`; s3 ADVANCE `2afcbc82e`; s4 PF APPROVE + ADVANCE `bc2a2fa2f`; s5 ADVANCE `e28a3f216` — see logs/C2.log.md | ITERATE ×2 → ADVANCE `da6a6452c` (carry-test exceptions C2-GATE-EXC-1/2) | `8528d3aec94d1ea9e22a0f882d114bd0b8376859` (`fork/refresh-basket-c2`; ITERATE ×3 → ADVANCE) | DONE 2026-10-11; EXC-3 ADVANCE `94fbbd6a4` pending basket integration; publication HOLD for browser repair, see [delivery](deployment-20261012.md); open: native iOS/Android, remote CI, locale screenshots, real disk-full, conflict-across-restart |
| 3 | A1 ACP diagnostics | `fork/acp-diagnostics-0.11.1` @ `831f6a858` | custom `cbc2017186b980e7928bc376cfdeabb90ef56aa2` | DeepSeek `70f1d590-c046-46b3-8aee-286c9eee0e0f` (jcode) | s0 ADVANCE; s1 ADVANCE `09beed6e2`; s2 ADVANCE `831f6a858` | ADVANCE `831f6a858` | `9d2fdd0d243272794756eabf78243bb0ee85d5c7` (`fork/refresh-basket-a1`; Sol ADVANCE) | DONE 2026-10-12 local time; 143 ACP + 12 creation + 15 diagnostic tests independently passing |
| 4 | A2 quit dialog | `fork/infi-refresh-quit-dialog-0.11.1` | infi-backend `1dd375931a0c4de5e930abb4b2cf2dc52d9cbcc5` | DeepSeek `3af10474-80e6-4085-8371-62a4d4b7b062` (jcode, high) | s0 ADVANCE at frozen base | pending | pending | HELD before s1 during release-regression repair; author missing recycled-PID/changed-after-confirm tests, source doc relocates to fork/feature-ledger.md; s2 preflight still required |
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
- 2026-10-11: workers switched to DeepSeek V4.1 Flash via jcode (Cameron). C2 handed over mid s4.
- 2026-10-11: C2 CLOSED. Baseline e2e failures found on the frozen-only basket `d4be3d126` (pre-campaign; carried as a campaign-wide limitation): `daemon-e2e/agent-basics.e2e.test.ts` "creates agent and receives response", `creation/creation.e2e.test.ts` "legacy keyed creation preserves checkout error codes".
