You are the voice porter (P5, feature TM-04). Read /tmp/tmad-port/COMMON.md and obey it, then /tmp/tmad-port/plan.md ("Voice and lifecycle" contract, P5) and /tmp/tmad-port/evidence/TM-02.md. Your worktree is on branch `intake/tmad-voice-flow` from intake/tmad-message-queue (TM-02). Only if you find shared UI from TM-03 genuinely required, stop and report it (do not merge TM-03 yourself).
Report ID: TM-04.

Source: source PRs #13, #15, #22, #23 (NOT #14 iOS background = TM-06, NOT #17 mute = TM-05). Files include packages/app/src/voice/{voice-runtime,audio-engine*,microphone-cue,realtime-voice-config}.ts(+tests), contexts/voice-context.tsx, components/realtime-voice-overlay.tsx(+test), packages/server/src/server/session/voice/{index,voice-input-command}.ts(+tests), session.voice-mcp-config.test.ts, providers/claude/agent.voice-history-regression.test.ts. Diff each against cbd1210c7 first; some may already exist upstream — adopt source improvements into existing owners.
Requirements:
- Voice attach/detach, playback interruption, transport loss, STT failure never cancel the agent, pending permissions, children or side conversations. Interruption only via explicit command.
- Speech admission goes through the TM-02 durable queue with a stable item ID; truthful queued/sent/error feedback; never claim provider delivery from a local transcript or socket send.
- Keep attachment ownership + transport-generation checks across reconnects; another device cannot seize an active recording.
- Preserve custom ACP/GJC admission/cancellation fences and provider-wrapper forwarding (run their tests).
Tests: carry source voice runtime/failure/session/turn-controller tests adapted; add survival tests (running turn, pending permission, subagent, side conversation through attach/detach and transport failure). Run each file individually; typecheck, lint, format. Real-provider and physical-device checks are NOT for you: list precisely what a human must verify on device (mic, playback, echo, lock/background, reconnect, owner contention) and per provider (Claude, Codex, ACP/GJC).
Report per COMMON.md.
