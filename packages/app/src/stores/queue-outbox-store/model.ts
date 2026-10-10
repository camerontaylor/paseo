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
  /**
   * Durable cancellation intent: the entry's host row must be removed. A
   * tombstoned entry flushes as a removal, never an enqueue, and a snapshot
   * containing the item does not acknowledge it.
   */
  removalRequested: z.boolean().optional(),
  /**
   * Set when the most recent REMOVAL dispatch failed. Distinct from the
   * attempt reservation count: attempts only prove a dispatch was reserved.
   */
  removalFailedAt: z.number().optional(),
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

/**
 * Thrown when the host rejected a dispatch because the queue moved (revision
 * conflict). The flush lane re-dispatches the entry with a fresh reservation
 * instead of parking it — the entry itself did nothing wrong.
 */
export class QueueRevisionConflictError extends Error {
  constructor(message = "queue_revision_conflict") {
    super(message);
    this.name = "QueueRevisionConflictError";
  }
}

export interface QueueOutboxAccess {
  list: (serverId: string) => PendingQueueEnqueue[];
  remove: (itemId: string, preserveRemovalIntent?: boolean) => void | Promise<void>;
  get?: (itemId: string) => PendingQueueEnqueue | undefined;
  bumpAttempts: (itemId: string) => void | Promise<void>;
  markFailed: (itemId: string) => void | Promise<void>;
  markRemovalFailed?: (itemId: string) => void | Promise<void>;
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
  /** Resolves the host removal for a tombstoned entry. Absent = removals fail. */
  removeQueuedAgentMessage?: (agentId: string, itemId: string) => Promise<AgentQueueSnapshot>;
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
 * Resolves the CURRENT durable state of one entry (a park, tombstone, or
 * removal may have landed since the listing).
 */
function resolveCurrentEntry(
  input: FlushQueueOutboxInput,
  itemId: string,
): PendingQueueEnqueue | undefined {
  return input.outbox.get
    ? input.outbox.get(itemId)
    : input.outbox.list(input.serverId).find((pending) => pending.itemId === itemId);
}

/**
 * Settles a dispatched entry: a plain removal removes without preserve; an
 * enqueue removes with preserve-removal-intent and, when a tombstone raced
 * the acknowledgement, dispatches the host removal before settling.
 */
async function settleDispatch(
  input: FlushQueueOutboxInput,
  reserved: PendingQueueEnqueue,
  snapshot: AgentQueueSnapshot,
): Promise<void> {
  const resolveCurrent = (itemId: string): PendingQueueEnqueue | undefined =>
    input.outbox.get
      ? input.outbox.get(itemId)
      : input.outbox.list(input.serverId).find((pending) => pending.itemId === itemId);
  if (reserved.removalRequested) {
    await input.outbox.remove(reserved.itemId);
    input.applySnapshot(snapshot);
    return;
  }
  // A cancellation that raced the acknowledgement must survive: the removal
  // happens with preserve-removal-intent, and a tombstone that appeared
  // mid-flight is dispatched before the entry settles.
  await input.outbox.remove(reserved.itemId, true);
  const latest = resolveCurrent(reserved.itemId);
  if (!latest?.removalRequested) {
    input.applySnapshot(snapshot);
    return;
  }
  if (!input.client.removeQueuedAgentMessage) {
    throw new Error("Queue removal unavailable");
  }
  // The raced tombstone is its own dispatch: it reserves an attempt first,
  // and the eight-attempt cap bounds it like any other dispatch. At the cap
  // it parks instead, and explicit retry remains available.
  if (reserved.attempts >= QUEUE_OUTBOX_MAX_ATTEMPTS) {
    try {
      await input.outbox.markFailed(reserved.itemId);
    } catch {
      // surfaced by the accessor; the in-memory fence stays set
    }
    input.onEntryExhausted?.(reserved);
    return;
  }
  try {
    await input.outbox.bumpAttempts(reserved.itemId);
  } catch {
    // No reservation, no dispatch: the tombstone stays pending for the next
    // flush, and the lane breaks so nothing behind it races the write.
    throw new Error("Queue removal reservation failed");
  }
  const reservedRemoval = resolveCurrent(reserved.itemId);
  if (!reservedRemoval?.removalRequested || reservedRemoval.failedAt !== undefined) {
    return;
  }
  let removalSnapshot: AgentQueueSnapshot;
  try {
    removalSnapshot = await input.client.removeQueuedAgentMessage(
      reservedRemoval.agentId,
      reservedRemoval.itemId,
    );
  } catch (error) {
    // The removal outcome is recorded on the surviving tombstone, distinct
    // from the attempt counter.
    try {
      await input.outbox.markRemovalFailed?.(reservedRemoval.itemId);
    } catch {
      // surfaced by the accessor
    }
    throw error;
  }
  await input.outbox.remove(reservedRemoval.itemId);
  input.applySnapshot(removalSnapshot);
}

type LaneOutcome = "conflict" | "failure" | "settled";

/**
 * Reserves, then dispatches ONE entry (enqueue or host removal) and settles
 * it. "conflict" tells the lane the queue moved (already refreshed) and the
 * entry should re-dispatch with a fresh reservation; "failure" blocks the
 * agent's lane; "settled" continues normally.
 */
async function dispatchOne(
  input: FlushQueueOutboxInput,
  current: PendingQueueEnqueue,
): Promise<LaneOutcome> {
  try {
    // Reserve the attempt durably before dispatching — every host dispatch
    // (enqueue or removal) reserves first, so neither a storage failure nor a
    // restart can push an entry past eight automatic attempts.
    await input.outbox.bumpAttempts(current.itemId);
  } catch {
    return "failure";
  }
  const reserved = input.outbox.get
    ? input.outbox.get(current.itemId)
    : input.outbox.list(input.serverId).find((pending) => pending.itemId === current.itemId);
  if (!reserved || reserved.failedAt !== undefined) return "settled";
  try {
    let snapshot: AgentQueueSnapshot;
    if (reserved.removalRequested) {
      // A tombstone dispatches a host removal, never an enqueue.
      if (!input.client.removeQueuedAgentMessage) {
        throw new Error("Queue removal unavailable");
      }
      snapshot = await input.client.removeQueuedAgentMessage(reserved.agentId, reserved.itemId);
    } else {
      snapshot = await input.client.enqueueAgentMessage({
        agentId: reserved.agentId,
        itemId: reserved.itemId,
        text: reserved.text,
        intent: reserved.intent,
        images: reserved.images,
        attachments: reserved.attachments,
        composerAttachments: reserved.composerAttachments,
      });
    }
    await settleDispatch(input, reserved, snapshot);
    return "settled";
  } catch (error) {
    if (error instanceof QueueRevisionConflictError) {
      // The queue moved under us (another device mutated it). The refresh
      // already ran; the lane re-dispatches with a fresh reservation — the
      // cap still bounds the total attempts.
      return "conflict";
    }
    if (reserved.removalRequested) {
      // The removal outcome, distinct from the reservation counter.
      await input.outbox.markRemovalFailed?.(reserved.itemId);
    }
    if (reserved.attempts >= QUEUE_OUTBOX_MAX_ATTEMPTS) {
      try {
        await input.outbox.markFailed(reserved.itemId);
      } catch {
        // surfaced by the accessor; the in-memory fence stays set
      }
      input.onEntryExhausted?.(reserved);
    }
    return "failure";
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
        let laneBroken = false;
        for (const candidate of input.outbox
          .list(input.serverId)
          .filter((item) => item.agentId === agentId)) {
          if (laneBroken) break;
          // A revision conflict re-dispatches the SAME entry with a fresh
          // reservation (the refresh already ran); the attempt cap bounds the
          // retries — attempt seven → eight, never nine, and the conflict at
          // the cap parks.
          for (;;) {
            const current = resolveCurrentEntry(input, candidate.itemId);
            // A park or removal that landed after this listing must not send.
            if (!current || current.failedAt !== undefined) break;
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
              break;
            }
            const outcome = await dispatchOne(input, current);
            if (outcome === "conflict") continue;
            if (outcome === "failure") laneBroken = true;
            break;
          }
        }
      }),
    ),
  );
}
