import type {
  AgentQueueSnapshot,
  QueuedAgentMessage,
  QueuedComposerAttachment,
} from "@getpaseo/protocol/messages";

import type { ComposerAttachment, UserComposerAttachment } from "@/attachments/types";
import { userAttachmentsOnly } from "@/attachments/workspace-attachment-utils";
import type { QueuedComposerMessage } from "@/composer/actions";
import type { PendingQueueEnqueue } from "@/stores/queue-outbox-store/model";

/**
 * Reconciliation between the daemon-owned queue and the local optimistic copy.
 * See docs/queue-mirroring.md — the server is authoritative and snapshots replace
 * the local list wholesale.
 */

/**
 * Composer attachments a queued message can carry across devices. Images are
 * absent: their bytes live on the daemon and are fetched on demand.
 */
export function toComposerAttachments(
  attachments: readonly QueuedComposerAttachment[] | undefined,
): UserComposerAttachment[] {
  return [...(attachments ?? [])];
}

/** The inverse, for the enqueue payload. Image attachments are sent as bytes instead. */
export function toQueuedComposerAttachments(
  attachments: readonly ComposerAttachment[],
): QueuedComposerAttachment[] {
  const result: QueuedComposerAttachment[] = [];
  for (const attachment of userAttachmentsOnly(attachments)) {
    if (attachment.kind === "image") {
      continue;
    }
    // Plugin resources are not part of the daemon queue wire schema; their bytes
    // live in the plugin, so they are dropped from the queued payload.
    if (attachment.kind === "plugin_resource") {
      continue;
    }
    result.push(attachment);
  }
  return result;
}

export function toQueuedComposerMessage(item: QueuedAgentMessage): QueuedComposerMessage {
  return {
    id: item.id,
    text: item.text,
    attachments: toComposerAttachments(item.composerAttachments),
    deliveryState: item.deliveryState,
    lastError: item.lastError,
  };
}

export function toQueuedComposerMessages(snapshot: AgentQueueSnapshot): QueuedComposerMessage[] {
  return snapshot.items.map(toQueuedComposerMessage);
}

export function queuedMessageHasImages(item: QueuedAgentMessage): boolean {
  return (item.images?.length ?? 0) > 0;
}

/**
 * Decides whether a snapshot should replace what the client is showing. Local
 * optimistic writes never bump the revision, so a snapshot that is newer than the
 * last one applied always wins, and an older one that raced past a local write is
 * dropped rather than briefly erasing it.
 */
export function shouldApplyAgentQueueSnapshot(input: {
  incomingRevision: number;
  appliedRevision: number | undefined;
}): boolean {
  return input.appliedRevision === undefined || input.incomingRevision > input.appliedRevision;
}

/**
 * The one exception to snapshots-replace-wholesale: an un-acked enqueue is a
 * write the server does not know about yet, so a snapshot cannot be allowed to
 * erase its row. Entries the snapshot already contains are dropped — the ack
 * raced the broadcast — and the rest are re-appended in enqueue order, marked
 * with their outbox state so the queue track can show a failed entry (one that
 * exhausted its retries without a daemon acknowledgement) instead of dropping
 * it.
 */
export function appendPendingQueueRows(
  items: QueuedComposerMessage[],
  pending: readonly PendingQueueEnqueue[],
): QueuedComposerMessage[] {
  const present = new Set(items.map((item) => item.id));
  const rows = pending
    .filter((entry) => !present.has(entry.itemId))
    .map((entry) => ({
      id: entry.itemId,
      text: entry.text,
      attachments: toComposerAttachments(entry.composerAttachments),
      syncState: entry.failedAt === undefined ? ("pending" as const) : ("failed" as const),
    }));
  return rows.length === 0 ? items : [...items, ...rows];
}

/**
 * Outbox entry ids the daemon has not acknowledged yet. These rows render as
 * waiting-to-sync and cannot be edited or sent until a snapshot includes them.
 */
export function getPendingQueueMessageIds(
  pending: readonly PendingQueueEnqueue[],
  acceptedIds: ReadonlySet<string> | undefined,
): ReadonlySet<string> {
  return new Set(
    pending.filter((entry) => !acceptedIds?.has(entry.itemId)).map((entry) => entry.itemId),
  );
}

/**
 * The queue track's single reconciliation point: stored rows are snapshot rows
 * only, so the composer overlays the durable outbox here. Failed entries
 * annotate their rows (and re-append rows this device lost, e.g. after a
 * restart) so an enqueue that exhausted its retries stays visible with
 * explicit retry/discard instead of dropping.
 */
export function annotateQueueRows(input: {
  rows: readonly QueuedComposerMessage[];
  entries: readonly PendingQueueEnqueue[];
}): QueuedComposerMessage[] {
  const failedIds = new Set(
    input.entries.filter((entry) => entry.failedAt !== undefined).map((entry) => entry.itemId),
  );
  const annotated = input.rows.map((row) =>
    failedIds.has(row.id) && row.syncState !== "failed"
      ? { ...row, syncState: "failed" as const }
      : row,
  );
  return appendPendingQueueRows(annotated, input.entries);
}

export interface QueueStorageErrorRow {
  id: "queue-storage-error";
  messageKey: "composer.errors.queuedPersistFailed";
  entryText: string | null;
}

/**
 * The rendered storage-error descriptor for the queue track: presence means the
 * track shows the error row with retry/dismiss affordances, even when no queue
 * rows are visible.
 */
export function resolveQueueStorageErrorRow(
  storageError: { itemId: string | null } | null | undefined,
  entries: readonly PendingQueueEnqueue[],
): QueueStorageErrorRow | null {
  if (!storageError) return null;
  const entry = storageError.itemId
    ? entries.find((candidate) => candidate.itemId === storageError.itemId)
    : undefined;
  return {
    id: "queue-storage-error",
    messageKey: "composer.errors.queuedPersistFailed",
    entryText: entry?.text ?? null,
  };
}
