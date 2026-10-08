import { createHash } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { writeJsonFileAtomic } from "../atomic-file.js";

const ReceiptSchema = z.object({
  fingerprint: z.string(),
  state: z.enum(["pending", "completed", "removed"]),
  agentId: z.string(),
  /** Queue item id a voice receipt belongs to; absent on legacy direct-send receipts. */
  messageId: z.string().optional(),
  attachmentId: z.string().optional(),
  voiceOwner: z.string().optional(),
  createdAt: z.string().optional(),
});
interface VoiceInputReceipt {
  messageId: string;
  state: "pending" | "sending" | "completed" | "removed";
  createdAt: string;
}

interface SendMessageInput {
  agentId: string;
  messageId: string;
  request: unknown;
  /** Voice delivery metadata recorded on the receipt for attachment reads. */
  attachment?: {
    messageId: string;
    attachmentId: string;
    voiceOwner?: string;
    createdAt?: string;
  };
  send: () => Promise<void>;
  prepare?: () => Promise<void>;
}

/** Owns message delivery receipts; creation is owned by CreationService. */
export class MessageReceipts {
  private readonly pending = new Map<string, Promise<void>>();
  /** Logical message ids with a dispatch in flight, for attachment read state. */
  private readonly sending = new Set<string>();
  constructor(private readonly directory: string) {}

  send(input: SendMessageInput): Promise<void> {
    // Preserve the existing on-disk identity and shape across daemon upgrades.
    const key = digest(["send", input.agentId, input.messageId]);
    const previous = this.pending.get(key);
    const result = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(() =>
      this.sendOnce(key, input),
    );
    this.pending.set(key, result);
    if (input.attachment) this.sending.add(`${input.agentId}\u0000${input.attachment.messageId}`);
    void result
      .finally(() => {
        if (this.pending.get(key) === result) this.pending.delete(key);
        if (input.attachment)
          this.sending.delete(`${input.agentId}\u0000${input.attachment.messageId}`);
      })
      .catch(() => undefined);
    return result;
  }

  /**
   * The persisted outcome of a send, without sending: `null` when no receipt
   * exists. Startup recovery for queued dispatch claims reads this to tell a
   * never-dispatched attempt from one whose provider acceptance is unknown.
   * `removed` marks speech the user deleted; re-admitting its id is a no-op.
   */
  async outcome(
    agentId: string,
    messageId: string,
  ): Promise<"pending" | "completed" | "removed" | null> {
    const key = digest(["send", agentId, messageId]);
    const file = path.join(this.directory, `${key}.json`);
    try {
      const existing = await readReceipt(file);
      return existing?.state ?? null;
    } catch {
      // An unreadable receipt is no evidence; the caller holds the claim as
      // ambiguous instead of resending.
      return null;
    }
  }

  /**
   * Delivery records for one voice attachment, newest-context per message. Only
   * receipts carrying the attachment metadata answer; legacy direct sends and
   * typed queue attempts are invisible here.
   */
  async listForAttachment(input: {
    agentId: string;
    attachmentId: string;
    voiceOwner?: string;
  }): Promise<VoiceInputReceipt[]> {
    const files = await readdir(this.directory).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    });
    const records = await Promise.all(
      files
        .filter((name) => name.endsWith(".json"))
        .map((name) => readReceipt(path.join(this.directory, name))),
    );
    const byId = new Map<string, VoiceInputReceipt>();
    const priority = { pending: 0, sending: 1, completed: 2, removed: 3 };
    for (const record of records) {
      if (
        !record ||
        record.agentId !== input.agentId ||
        record.attachmentId !== input.attachmentId ||
        record.voiceOwner !== input.voiceOwner ||
        !record.messageId
      )
        continue;
      const state =
        record.state === "pending" && this.sending.has(`${record.agentId}\u0000${record.messageId}`)
          ? "sending"
          : record.state;
      const previous = byId.get(record.messageId);
      if (previous && priority[previous.state] >= priority[state]) continue;
      byId.set(record.messageId, {
        messageId: record.messageId,
        state,
        createdAt: record.createdAt ?? "",
      });
    }
    return [...byId.values()];
  }

  /**
   * Records that one queued item was deleted before delivery, so a later
   * admission of the same speech id stays removed. Refuses while a dispatch is
   * in flight — the outcome is not the user's to declare yet.
   */
  async recordRemoved(input: {
    agentId: string;
    messageId: string;
    attachmentId?: string;
    voiceOwner?: string;
    createdAt?: string;
  }): Promise<boolean> {
    const key = digest(["send", input.agentId, input.messageId]);
    const previous = this.pending.get(key);
    const result = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(
      async () => {
        const file = path.join(this.directory, `${key}.json`);
        const existing = await readReceipt(file);
        if (existing) {
          return existing.state === "removed";
        }
        await writeJsonFileAtomic(file, {
          fingerprint: digest({ removed: true }),
          state: "removed",
          agentId: input.agentId,
          messageId: input.messageId,
          ...(input.attachmentId
            ? { attachmentId: input.attachmentId, voiceOwner: input.voiceOwner }
            : {}),
          createdAt: input.createdAt ?? new Date().toISOString(),
        });
        return true;
      },
    );
    const tracked = result.then(() => undefined);
    void tracked.catch(() => undefined);
    this.pending.set(key, tracked);
    try {
      return await result;
    } finally {
      if (this.pending.get(key) === tracked) this.pending.delete(key);
    }
  }

  private async sendOnce(key: string, input: SendMessageInput): Promise<void> {
    const file = path.join(this.directory, `${key}.json`);
    const fingerprint = digest(input.request);
    const existing = await readReceipt(file);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error("agent_request_key_conflict");
      if (existing.state === "completed" || existing.state === "removed") return;
      // A provider may have accepted the message before its receipt was committed.
      throw new Error("agent_request_outcome_unknown");
    }
    await input.prepare?.();
    const receipt = {
      fingerprint,
      agentId: input.agentId,
      ...(input.attachment
        ? {
            messageId: input.attachment.messageId,
            attachmentId: input.attachment.attachmentId,
            ...(input.attachment.voiceOwner ? { voiceOwner: input.attachment.voiceOwner } : {}),
            createdAt: input.attachment.createdAt ?? new Date().toISOString(),
          }
        : {}),
    };
    await writeJsonFileAtomic(file, { ...receipt, state: "pending" });
    try {
      await input.send();
    } catch (error) {
      // A competing run rejected the synchronous reservation before provider
      // dispatch. This is the only post-receipt error safe to retry: the
      // receipt would otherwise make the next attempt look ambiguous.
      if (
        error instanceof Error &&
        "code" in error &&
        (error.code === "AGENT_RUN_BUSY" || error.code === "AGENT_PROMPT_NOT_SUBMITTED")
      ) {
        await rm(file, { force: true });
      }
      throw error;
    }
    if (input.attachment && input.attachment.messageId !== input.messageId) {
      // Keep the logical speech identity after the queue's bounded drained-id
      // window expires. Write this before completing the attempt so a crash
      // cannot drain the queue without retaining the logical identity.
      const logicalKey = digest(["send", input.agentId, input.attachment.messageId]);
      await writeJsonFileAtomic(path.join(this.directory, `${logicalKey}.json`), {
        ...receipt,
        state: "completed",
      });
    }
    await writeJsonFileAtomic(file, { ...receipt, state: "completed" });
  }
}

async function readReceipt(file: string): Promise<z.infer<typeof ReceiptSchema> | null> {
  try {
    return ReceiptSchema.parse(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function digest(value: unknown): string {
  return createHash("sha256")
    .update(
      JSON.stringify(value, (_key, candidate: unknown) => {
        if (candidate !== null && typeof candidate === "object" && !Array.isArray(candidate)) {
          return Object.fromEntries(
            Object.entries(candidate).sort(([a], [b]) => a.localeCompare(b)),
          );
        }
        return candidate;
      }),
    )
    .digest("hex");
}
