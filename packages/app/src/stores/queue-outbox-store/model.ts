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
 * A retry cap, not a timeout: every automatic send first reserves its attempt
 * number with a durable write, so a healthy daemon clears the outbox on the
 * first flush and a poisoned entry (one the daemon keeps rejecting) cannot
 * retry forever — neither within a process nor across restarts, because a send
 * only ever happens with its attempt number already persisted. Unlike the
 * source, exhaustion parks the entry in a visible failed state; only an
 * explicit retry or discard removes it.
 */
export const QUEUE_OUTBOX_MAX_ATTEMPTS = 8;

export interface QueueOutboxAccess {
  list: (serverId: string) => PendingQueueEnqueue[];
  remove: (itemId: string) => void | Promise<void>;
  bumpAttempts: (itemId: string) => void | Promise<void>;
  markFailed: (itemId: string) => void | Promise<void>;
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
 * Serializes operations that share a key (per-agent dispatch lanes, outbox
 * mutations). A rejected operation never poisons the chain for the next one.
 */
const queueOperations = new Map<string, Promise<unknown>>();

export async function serializeQueueOperation<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = queueOperations.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  queueOperations.set(key, current);
  try {
    return await current;
  } finally {
    if (queueOperations.get(key) === current) queueOperations.delete(key);
  }
}

/**
 * Re-sends every un-acked enqueue for one server, oldest first within each
 * agent so queue order survives the retry. Dispatch is serialized per agent:
 * an earlier failure blocks later items for that agent only, while other
 * agents' lanes keep advancing. Only an acknowledgement removes the durable
 * entry; a failure parks the entry once its attempts run out.
 */
export async function flushQueueOutbox(input: FlushQueueOutboxInput): Promise<void> {
  const agents = new Set(input.outbox.list(input.serverId).map((entry) => entry.agentId));
  await Promise.all(
    [...agents].map((agentId) =>
      serializeQueueOperation(JSON.stringify(["dispatch", input.serverId, agentId]), async () => {
        for (const candidate of input.outbox
          .list(input.serverId)
          .filter((item) => item.agentId === agentId)) {
          const current = input.outbox
            .list(input.serverId)
            .find((pending) => pending.itemId === candidate.itemId);
          // A park or removal that landed after this listing must not send.
          if (!current || current.failedAt !== undefined) continue;
          if (current.attempts >= QUEUE_OUTBOX_MAX_ATTEMPTS) {
            // Parked-on-sight: an entry already at the cap (for example after a
            // restart that lost a failed park write) is never sent again.
            try {
              await input.outbox.markFailed(current.itemId);
            } catch {
              // The accessor surfaced the storage error and kept the in-memory
              // fence; the next flush parks on sight again.
            }
            input.onEntryExhausted?.(current);
            continue;
          }
          try {
            // Reserve the attempt durably before sending. A send only ever
            // follows a successfully persisted reservation, so neither a
            // storage failure nor a restart can push an entry past eight
            // automatic attempts.
            await input.outbox.bumpAttempts(current.itemId);
          } catch {
            break;
          }
          const reserved = input.outbox
            .list(input.serverId)
            .find((pending) => pending.itemId === current.itemId);
          if (!reserved || reserved.failedAt !== undefined) continue;
          try {
            const snapshot = await input.client.enqueueAgentMessage({
              agentId: reserved.agentId,
              itemId: reserved.itemId,
              text: reserved.text,
              intent: reserved.intent,
              images: reserved.images,
              attachments: reserved.attachments,
              composerAttachments: reserved.composerAttachments,
            });
            await input.outbox.remove(reserved.itemId);
            input.applySnapshot(snapshot);
          } catch {
            if (reserved.attempts >= QUEUE_OUTBOX_MAX_ATTEMPTS) {
              try {
                await input.outbox.markFailed(reserved.itemId);
              } catch {
                // surfaced by the accessor; the in-memory fence stays set
              }
              input.onEntryExhausted?.(reserved);
            }
            // A failed predecessor blocks later items for this agent only;
            // other agents' lanes advance independently.
            break;
          }
        }
      }),
    ),
  );
}
