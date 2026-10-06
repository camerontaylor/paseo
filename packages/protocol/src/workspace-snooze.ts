import { z } from "zod";

export const WorkspaceSnoozeInputSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("time"), wakeAt: z.string().datetime(), timezone: z.string().min(1) }),
  z.object({
    mode: z.literal("ai"),
    prompt: z.string().min(1).max(8000),
    intervalHours: z.union([z.literal(1), z.literal(24)]),
  }),
]);
export const WorkspaceSnoozeResultSchema = z.object({
  status: z.enum(["blocked", "unblocked", "unknown"]),
  reason: z.string().min(1).max(2000),
});
export const WorkspaceSnoozeSchema = z.object({
  id: z.string(),
  createdAt: z.string().datetime(),
  config: WorkspaceSnoozeInputSchema,
  nextCheckAt: z.string().datetime(),
  lastCheck: WorkspaceSnoozeResultSchema.extend({ checkedAt: z.string().datetime() }).nullable(),
});
export type WorkspaceSnoozeInput = z.infer<typeof WorkspaceSnoozeInputSchema>;
export type WorkspaceSnooze = z.infer<typeof WorkspaceSnoozeSchema>;
export type WorkspaceSnoozeResult = z.infer<typeof WorkspaceSnoozeResultSchema>;

export const WorkspaceSnoozeSetRequestSchema = z.object({
  type: z.literal("workspace.snooze.set.request"),
  requestId: z.string(),
  workspaceId: z.string(),
  snooze: WorkspaceSnoozeInputSchema.nullable(),
});
export const WorkspaceSnoozeCheckRequestSchema = z.object({
  type: z.literal("workspace.snooze.check.request"),
  requestId: z.string(),
  workspaceId: z.string(),
});
const ResponsePayloadSchema = z.object({
  requestId: z.string(),
  workspaceId: z.string(),
  success: z.boolean(),
  error: z.string().nullable(),
});
export const WorkspaceSnoozeSetResponseSchema = z.object({
  type: z.literal("workspace.snooze.set.response"),
  payload: ResponsePayloadSchema,
});
export const WorkspaceSnoozeCheckResponseSchema = z.object({
  type: z.literal("workspace.snooze.check.response"),
  payload: ResponsePayloadSchema,
});
export const WorkspaceSnoozeWokeSchema = z.object({
  type: z.literal("workspace.snooze.woke"),
  payload: z.object({
    id: z.string(),
    serverId: z.string(),
    workspaceId: z.string(),
    title: z.string(),
    body: z.string(),
    shouldNotify: z.boolean(),
  }),
});
