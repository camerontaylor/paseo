import { z } from "zod";
import { AgentSnapshotPayloadSchema } from "@getpaseo/protocol/messages";

/**
 * Frozen wire shapes of the released 0.11.1-fork client, independent of the
 * current schemas: the released client knows `artifacts` and
 * `companionEntries`; it does not know the nested `ask` object or the
 * `captureDegraded` snapshot flag. Parsing a real daemon payload through
 * these proves both are stripped on the released reader.
 */

export const ReleasedCompanionEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string(),
    timestamp: z.string(),
    text: z.string(),
    truncated: z.boolean(),
    kind: z.literal("question"),
    status: z.enum(["open", "reviewed", "done", "reply_sent"]),
  }),
  z.object({
    id: z.string(),
    timestamp: z.string(),
    text: z.string(),
    truncated: z.boolean(),
    kind: z.literal("feature_request"),
    status: z.enum(["open", "reviewed", "done"]),
  }),
  z.object({
    id: z.string(),
    timestamp: z.string(),
    text: z.string(),
    truncated: z.boolean(),
    kind: z.literal("permission"),
    requestId: z.string(),
    requestKind: z.enum(["tool", "plan", "question", "mode", "other"]),
    status: z.enum(["pending", "allowed", "denied", "expired"]),
  }),
  z.object({
    id: z.string(),
    timestamp: z.string(),
    text: z.string(),
    truncated: z.boolean(),
    kind: z.literal("outcome"),
    status: z.enum(["completed", "failed", "canceled"]),
  }),
  z.object({
    id: z.string(),
    timestamp: z.string(),
    text: z.string(),
    truncated: z.boolean(),
    kind: z.literal("pin"),
    sourceId: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    timestamp: z.string(),
    text: z.string(),
    truncated: z.boolean(),
    kind: z.literal("q_and_a"),
    answer: z.string().optional(),
    questionMessageId: z.string().optional(),
    answerMessageId: z.string().optional(),
  }),
]);

export const ReleasedAgentSnapshotSchema = AgentSnapshotPayloadSchema.omit({
  captureDegraded: true,
}).extend({
  // The released payload keeps every released field (artifacts and
  // companionEntries included) and strips only what it does not know.
  companionEntries: z.array(ReleasedCompanionEntrySchema).optional(),
});
