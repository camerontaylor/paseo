import { z } from "zod";
import {
  AgentAttachmentWireSchema,
  QueuedAgentDeliveryIntentSchema,
  QueuedComposerAttachmentSchema,
  type AgentQueueSnapshot,
  type QueuedAgentDeliveryIntent,
} from "@getpaseo/protocol/messages";

/**
 * A queue enqueue the daemon has not acknowledged yet. The entry is the durable
 * copy: it carries the full wire payload (image bytes included) so it can be
 * re-sent verbatim after a reconnect or a fresh app launch, even though the
 * optimistic composer row it mirrors lives only in memory.
 *
 * Re-sending is safe because the daemon treats an enqueue with a known item id —
 * queued or already drained — as a retry and does nothing.
 * See docs/queue-mirroring.md, "The un-acked window".
 */
export const PendingQueueEnqueueSchema = z.object({
  serverId: z.string(),
  agentId: z.string(),
  itemId: z.string(),
  text: z.string(),
  intent: QueuedAgentDeliveryIntentSchema,
  images: z.array(z.object({ data: z.string(), mimeType: z.string() })),
  attachments: z.array(AgentAttachmentWireSchema),
  composerAttachments: z.array(QueuedComposerAttachmentSchema),
  createdAt: z.number(),
  attempts: z.number().int().nonnegative(),
  /**
   * Set when the attempts ran out without a daemon acknowledgement. The entry
   * stays visible as a failed row with explicit retry/discard instead of being
   * dropped — an undelivered prompt is never deleted silently.
   */
  failedAt: z.number().optional(),
});

export type PendingQueueEnqueue = z.infer<typeof PendingQueueEnqueueSchema>;

/**
 * A retry cap, not a timeout: attempts only accrue on reconnects that fail, so
 * a healthy daemon clears the outbox on the first flush and a poisoned entry
 * (one the daemon keeps rejecting) cannot retry forever. Unlike the source,
 * exhaustion parks the entry in a visible failed state; only an explicit
 * retry or discard removes it.
 */
export const QUEUE_OUTBOX_MAX_ATTEMPTS = 8;

export interface QueueOutboxAccess {
  list: (serverId: string) => PendingQueueEnqueue[];
  remove: (itemId: string) => void;
  bumpAttempts: (itemId: string) => void;
  markFailed: (itemId: string) => void;
}

export interface QueueOutboxFlushClient {
  enqueueAgentMessage: (input: {
    agentId: string;
    itemId: string;
    text: string;
    intent: QueuedAgentDeliveryIntent;
    images?: Array<{ data: string; mimeType: string }>;
    attachments?: PendingQueueEnqueue["attachments"];
    composerAttachments?: PendingQueueEnqueue["composerAttachments"];
  }) => Promise<AgentQueueSnapshot>;
}

export interface FlushQueueOutboxInput {
  serverId: string;
  outbox: QueueOutboxAccess;
  client: QueueOutboxFlushClient;
  applySnapshot: (snapshot: AgentQueueSnapshot) => void;
  /**
   * Called when an entry exhausts its attempts. The entry stays in the outbox,
   * visible as failed; this only tells the UI the state changed.
   */
  onEntryExhausted?: (entry: PendingQueueEnqueue) => void;
}

/**
 * Re-sends every un-acked enqueue for one server, oldest first so queue order
 * survives the retry. Success removes the entry; failure bumps its attempt
 * count and parks it in the visible failed state once the cap is reached.
 */
export async function flushQueueOutbox(input: FlushQueueOutboxInput): Promise<void> {
  for (const entry of input.outbox.list(input.serverId)) {
    try {
      const snapshot = await input.client.enqueueAgentMessage({
        agentId: entry.agentId,
        itemId: entry.itemId,
        text: entry.text,
        intent: entry.intent,
        images: entry.images,
        attachments: entry.attachments,
        composerAttachments: entry.composerAttachments,
      });
      input.outbox.remove(entry.itemId);
      input.applySnapshot(snapshot);
    } catch {
      if (entry.attempts + 1 >= QUEUE_OUTBOX_MAX_ATTEMPTS) {
        input.outbox.markFailed(entry.itemId);
        input.onEntryExhausted?.(entry);
      } else {
        input.outbox.bumpAttempts(entry.itemId);
      }
    }
  }
}
