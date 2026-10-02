import { mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import {
  AgentAttachmentWireSchema,
  QueuedAgentDeliveryIntentSchema,
  QueuedAgentMessageDeliveryStateSchema,
  QueuedComposerAttachmentSchema,
  type AgentQueueSnapshot,
} from "@getpaseo/protocol/messages";
import { writeJsonFileAtomic } from "../atomic-file.js";

/**
 * Image bytes are held here and never broadcast. See docs/queue-mirroring.md for
 * why a queued image cannot mirror by reference.
 */
const StoredQueuedImageSchema = z.object({
  id: z.string(),
  mimeType: z.string(),
  fileName: z.string().nullable().optional(),
  data: z.string(),
});

const StoredQueuedMessageSchema = z.object({
  id: z.string(),
  text: z.string(),
  // TM-02 adaptation: delivery bookkeeping is part of the durable record, so a
  // restart can tell a never-dispatched item from an ambiguous one. The source
  // store did not track it; every item this daemon writes carries all of these.
  // `attempts` is the user-visible streak and resets on retry; `attemptSeq`
  // never resets, so each dispatch gets its own receipt key and a retry can
  // never collide with the previous attempt's receipt.
  intent: QueuedAgentDeliveryIntentSchema,
  deliveryState: QueuedAgentMessageDeliveryStateSchema,
  attempts: z.number().int().nonnegative(),
  attemptSeq: z.number().int().nonnegative(),
  lastError: z.string().nullable().optional(),
  attachments: z.array(AgentAttachmentWireSchema).optional(),
  composerAttachments: z.array(QueuedComposerAttachmentSchema).optional(),
  images: z.array(StoredQueuedImageSchema).optional(),
  createdAt: z.string(),
});

const StoredAgentQueueSchema = z.object({
  agentId: z.string(),
  revision: z.number().int().nonnegative(),
  items: z.array(StoredQueuedMessageSchema),
  // Ids of items that have already been drained. An enqueue retry (same id) that
  // arrives after its item was delivered must be a no-op, not a resend.
  drainedIds: z.array(z.string()).optional(),
});

export type StoredQueuedImage = z.infer<typeof StoredQueuedImageSchema>;
export type StoredQueuedMessage = z.infer<typeof StoredQueuedMessageSchema>;
export type StoredAgentQueue = z.infer<typeof StoredAgentQueueSchema>;

export function emptyAgentQueue(agentId: string): StoredAgentQueue {
  return { agentId, revision: 0, items: [] };
}

/**
 * The window only has to outlast a client's retry horizon, not history: a
 * retry always targets a recent item, so a small bound is plenty and keeps the
 * queue file from growing forever.
 */
export const MAX_REMEMBERED_DRAINED_IDS = 100;

export function recordDrainedId(ids: readonly string[] | undefined, id: string): string[] {
  const next = [...(ids ?? []).filter((existing) => existing !== id), id];
  return next.slice(-MAX_REMEMBERED_DRAINED_IDS);
}

/**
 * Thrown by {@link AgentQueueStore.mutateWithExpectedRevision} when a client
 * mutation names a revision it has not seen. The queue is left untouched so a
 * stale device can never overwrite another device's edit.
 */
export class QueueRevisionConflictError extends Error {
  readonly code = "queue_revision_conflict";

  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(`Queue revision conflict: expected ${expectedRevision}, current ${actualRevision}`);
    this.name = "QueueRevisionConflictError";
  }
}

/** Projects the stored queue onto the wire, replacing image bytes with descriptors. */
export function toAgentQueueSnapshot(queue: StoredAgentQueue): AgentQueueSnapshot {
  return {
    agentId: queue.agentId,
    revision: queue.revision,
    items: queue.items.map((item) => ({
      id: item.id,
      text: item.text,
      intent: item.intent,
      deliveryState: item.deliveryState,
      attempts: item.attempts,
      ...(item.lastError !== undefined ? { lastError: item.lastError } : {}),
      createdAt: item.createdAt,
      ...(item.attachments?.length ? { attachments: item.attachments } : {}),
      ...(item.composerAttachments?.length
        ? { composerAttachments: item.composerAttachments }
        : {}),
      ...(item.images?.length
        ? {
            images: item.images.map((image) => ({
              id: image.id,
              mimeType: image.mimeType,
              fileName: image.fileName ?? null,
              byteSize: approximateBase64ByteSize(image.data),
            })),
          }
        : {}),
    })),
  };
}

function approximateBase64ByteSize(data: string): number {
  let padding = 0;
  if (data.endsWith("==")) {
    padding = 2;
  } else if (data.endsWith("=")) {
    padding = 1;
  }
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

type QueueMutator = (current: StoredAgentQueue) => StoredAgentQueue;

export interface AgentQueueMutationResult {
  queue: StoredAgentQueue;
  changed: boolean;
}

/** Each record retains both sides of a mutation for manual recovery. */
export interface AgentQueueJournalEntry {
  recordedAt: string;
  before: StoredAgentQueue;
  after: StoredAgentQueue;
}

/**
 * Journal entries describe images instead of copying their bytes: the queue
 * file already holds the payload, and the journal is the recovery aid, not a
 * second copy of user data.
 */
function elideJournalImageBytes(queue: StoredAgentQueue): StoredAgentQueue {
  return {
    ...queue,
    items: queue.items.map((item) =>
      item.images?.length
        ? {
            ...item,
            images: item.images.map(({ data, ...descriptor }) => ({
              ...descriptor,
              data: `<elided ${data.length} base64 chars>`,
            })),
          }
        : item,
    ),
  };
}

export class AgentQueueStore {
  private readonly mutations = new Map<string, Promise<unknown>>();

  constructor(
    private readonly dir: string,
    /**
     * Appends stop rotating once the current journal passes this size; the
     * previous generation is kept so a rotation itself cannot lose both copies.
     * Queue payloads can be large, so the default stays well above any honest
     * queue while still bounding disk use.
     */
    private readonly maxJournalBytes = 64 * 1024 * 1024,
  ) {}

  /** Every agent id that has a persisted queue file. Startup recovery walks it. */
  async ids(): Promise<string[]> {
    await this.ensureDir();
    const entries = await readdir(this.dir);
    return entries
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -".json".length));
  }

  async get(agentId: string): Promise<StoredAgentQueue> {
    await this.ensureDir();
    try {
      const content = await readFile(this.filePath(agentId), "utf-8");
      return StoredAgentQueueSchema.parse(JSON.parse(content));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyAgentQueue(agentId);
      }
      throw error;
    }
  }

  /**
   * Read-modify-write under a per-agent lock. A mutator that returns its input
   * unchanged does not bump `revision` and reports `changed: false`, so a no-op
   * never triggers a broadcast.
   *
   * The record survives an empty queue because `revision` has to stay monotonic:
   * deleting the file would restart it at 0 and make clients drop later updates
   * as stale.
   */
  async mutate(agentId: string, mutate: QueueMutator): Promise<AgentQueueMutationResult> {
    return this.serialize(agentId, async () => {
      const current = await this.get(agentId);
      return this.apply(agentId, current, mutate(current));
    });
  }

  /**
   * {@link mutate} guarded by the revision the caller last saw. Used by every
   * client-facing mutation; internal queue mechanics (claim, recovery) use the
   * unguarded form because they act on the state they just read.
   */
  async mutateWithExpectedRevision(
    agentId: string,
    expectedRevision: number,
    mutate: QueueMutator,
  ): Promise<AgentQueueMutationResult> {
    return this.serialize(agentId, async () => {
      const current = await this.get(agentId);
      if (current.revision !== expectedRevision) {
        throw new QueueRevisionConflictError(expectedRevision, current.revision);
      }
      return this.apply(agentId, current, mutate(current));
    });
  }

  async delete(agentId: string): Promise<void> {
    await this.serialize(agentId, async () => {
      await this.ensureDir();
      await rm(this.filePath(agentId), { force: true });
      await rm(this.journalPath(agentId), { force: true });
      await rm(this.previousJournalPath(agentId), { force: true });
    });
  }

  private async apply(
    agentId: string,
    current: StoredAgentQueue,
    next: StoredAgentQueue,
  ): Promise<AgentQueueMutationResult> {
    if (next === current) {
      return { queue: current, changed: false };
    }
    const updated = StoredAgentQueueSchema.parse({
      ...next,
      agentId,
      revision: current.revision + 1,
    });
    // Record the recoverable state before replacing the queue file. If the
    // journal cannot be written, leave the existing queue untouched.
    await this.appendJournal({
      recordedAt: new Date().toISOString(),
      before: current,
      after: updated,
    });
    await this.write(updated);
    return { queue: updated, changed: true };
  }

  private filePath(agentId: string): string {
    return join(this.dir, `${agentId}.json`);
  }

  private journalPath(agentId: string): string {
    return join(this.dir, `${agentId}.journal.jsonl`);
  }

  private previousJournalPath(agentId: string): string {
    return join(this.dir, `${agentId}.journal.previous.jsonl`);
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  private async write(queue: StoredAgentQueue): Promise<void> {
    await this.ensureDir();
    // Queue text, attachments and image payloads are user data; they get the
    // same 0600 treatment as the daemon keypair and receipts.
    await writeJsonFileAtomic(this.filePath(queue.agentId), queue, { mode: 0o600 });
  }

  private async appendJournal(entry: AgentQueueJournalEntry): Promise<void> {
    const journalPath = this.journalPath(entry.after.agentId);
    const line = `${JSON.stringify({
      recordedAt: entry.recordedAt,
      before: elideJournalImageBytes(entry.before),
      after: elideJournalImageBytes(entry.after),
    })}\n`;
    let size = 0;
    try {
      size = (await stat(journalPath)).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (size > 0 && size + Buffer.byteLength(line) > this.maxJournalBytes) {
      const previousPath = this.previousJournalPath(entry.after.agentId);
      await rm(previousPath, { force: true });
      await rename(journalPath, previousPath);
    }
    const file = await open(journalPath, "a", 0o600);
    try {
      await file.writeFile(line);
      await file.sync();
    } finally {
      await file.close();
    }
  }

  private async serialize<T>(agentId: string, mutation: () => Promise<T>): Promise<T> {
    const previous = this.mutations.get(agentId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(mutation);
    this.mutations.set(agentId, next);
    try {
      return await next;
    } finally {
      if (this.mutations.get(agentId) === next) {
        this.mutations.delete(agentId);
      }
    }
  }
}
