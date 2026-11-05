import type { AcpTransformer } from "@getpaseo/plugin/server/acp";
import { z } from "zod";

// jcode reports the lifecycle of turns another attached client started (normally a TUI window)
// as `_jcode/turn`. The turn's content arrives as ordinary `session/update` notifications, so
// only the lifecycle is translated here; emitting timeline items would duplicate the peer's
// user message and output.
const peerTurnSchema = z.object({
  sessionId: z.string(),
  turnId: z.string().min(1),
  state: z.enum(["started", "completed", "failed", "canceled"]),
  origin: z.object({ kind: z.string(), clientInstanceId: z.string().optional() }).optional(),
  error: z.object({ message: z.string() }).optional(),
});

const PEER_TURN_METHOD = "_jcode/turn";

export const jcodePeerTurns: AcpTransformer = {
  notification({ method, params }) {
    if (method !== PEER_TURN_METHOD) return null;
    const turn = peerTurnSchema.safeParse(params);
    if (!turn.success) return null;
    const { turnId, state, error } = turn.data;
    // The payload's sessionId is jcode's native id, which the ACP context does not expose.
    // One connection serves one boundary session, so no session filter is needed.
    return { type: "turn", turnId, state, ...(error ? { error } : {}) };
  },
};
