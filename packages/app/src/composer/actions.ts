import type { SelectedFile } from "@/attachments/selected-file";
import type { ForgeSearchItem } from "@getpaseo/protocol/messages";
import type { ActiveTurnBehavior } from "@getpaseo/protocol/messages";
import type {
  AgentQueueSnapshot,
  QueuedAgentDeliveryIntent,
  QueuedAgentMessageDeliveryState,
  QueuedComposerAttachment,
} from "@getpaseo/protocol/messages";
import type {
  AttachmentMetadata,
  ComposerAttachment,
  UserComposerAttachment,
} from "@/attachments/types";
import {
  isWorkspaceAttachment,
  userAttachmentsOnly,
} from "@/attachments/workspace-attachment-utils";
import {
  splitComposerAttachmentsForSubmit,
  type ComposerAttachmentSubmitFormat,
} from "@/composer/attachments/submit";
import { toQueuedComposerAttachments } from "@/composer/queue-sync";
import {
  QueueRevisionConflictError,
  serializeQueueOperation,
  type QueueOutboxFlushClient,
} from "@/stores/queue-outbox-store/model";
import { createUserMessage, generateMessageId, type UserMessageItem } from "@/types/stream";
import type { MessageSubmissionRejectionOutcome } from "@/composer/submission/model";
import type { PickedImageAttachmentInput } from "@/hooks/image-attachment-picker";
import { i18n } from "@/i18n/i18next";

export interface QueuedComposerMessage {
  id: string;
  text: string;
  attachments: ComposerAttachment[];
  /**
   * Durable queue state, present only on rows mirrored from a daemon snapshot.
   * Local-only rows (old hosts) never set it, which is how the queue track
   * tells the two apart.
   */
  deliveryState?: QueuedAgentMessageDeliveryState;
  lastError?: string | null;
  /**
   * Outbox mirror state: `pending` while the enqueue is un-acked, `failed`
   * once it exhausted its retries without ever reaching the daemon.
   */
  syncState?: "pending" | "failed";
  /**
   * The daemon's wire-form attachments, carried so a text-only inline edit can
   * re-send the full payload (the update RPC clears omitted fields).
   */
  wireAttachments?: import("@getpaseo/protocol/messages").AgentAttachmentWire[];
  /** Durable cancellation intent mirrored from the outbox entry. */
  removalRequested?: boolean;
}

export interface AttachmentPersister {
  persistFromBlob: (input: {
    blob: Blob;
    mimeType: string;
    fileName: string | null;
  }) => Promise<AttachmentMetadata>;
  persistFromFileUri: (input: {
    uri: string;
    mimeType: string;
    fileName: string | null;
  }) => Promise<AttachmentMetadata>;
  persistFromDataUrl: (input: {
    dataUrl: string;
    mimeType: string;
    fileName: string | null;
  }) => Promise<AttachmentMetadata>;
  deleteAttachments: (metadata: AttachmentMetadata[]) => Promise<void> | void;
}

export interface ComposerSendClient {
  sendAgentMessage: (
    agentId: string,
    text: string,
    options: {
      messageId: string;
      activeTurnBehavior?: ActiveTurnBehavior;
      images: Array<{ data: string; mimeType: string }>;
      attachments: ReturnType<typeof splitComposerAttachmentsForSubmit>["attachments"];
    },
  ) => Promise<void>;
  uploadFile: (input: { fileName: string; mimeType: string; bytes: Uint8Array }) => Promise<{
    requestId: string;
    file: {
      type: "uploaded_file";
      id: string;
      fileName: string;
      mimeType: string;
      size: number;
      path: string;
    } | null;
    error: string | null;
  }>;
}

export interface ComposerCancelClient {
  cancelAgent: (agentId: string) => Promise<void> | void;
}

export interface MessageSubmissionWriter {
  begin: (agentId: string, message: UserMessageItem) => void;
  accept: (agentId: string, clientMessageId: string) => void;
  reject: (agentId: string, clientMessageId: string) => MessageSubmissionRejectionOutcome;
}

export interface QueueWriter {
  read: (agentId: string) => QueuedComposerMessage[];
  write: (
    updater: (prev: Map<string, QueuedComposerMessage[]>) => Map<string, QueuedComposerMessage[]>,
  ) => void;
}

export async function pickAndPersistImages(input: {
  pickImages: () => Promise<PickedImageAttachmentInput[] | null>;
  persister: Pick<
    AttachmentPersister,
    "persistFromBlob" | "persistFromFileUri" | "persistFromDataUrl"
  >;
}): Promise<AttachmentMetadata[]> {
  const result = await input.pickImages();
  if (!result?.length) return [];
  return await Promise.all(
    result.map(async (picked) => {
      const fileName = picked.fileName ?? null;
      const mimeType = picked.mimeType;
      if (picked.source.kind === "blob") {
        return await input.persister.persistFromBlob({
          blob: picked.source.blob,
          mimeType,
          fileName,
        });
      }
      if (picked.source.kind === "data_url") {
        return await input.persister.persistFromDataUrl({
          dataUrl: picked.source.dataUrl,
          mimeType,
          fileName,
        });
      }
      return await input.persister.persistFromFileUri({
        uri: picked.source.uri,
        mimeType,
        fileName,
      });
    }),
  );
}

export async function uploadFileAttachments(input: {
  client: ComposerSendClient;
  files: SelectedFile[];
}): Promise<Extract<ComposerAttachment, { kind: "file" }>[]> {
  const result: Extract<ComposerAttachment, { kind: "file" }>[] = [];
  const prepared: Array<{ fileName: string; mimeType: string; bytes: Uint8Array }> = [];

  for (const file of input.files) {
    const bytes = await file.readBytes();
    if (bytes.byteLength > 50 * 1024 * 1024) {
      throw new Error(
        i18n.t("composer.errors.fileTooLarge", { size: "50MB", fileName: file.fileName }),
      );
    }
    prepared.push({
      fileName: file.fileName,
      mimeType: file.mimeType,
      bytes,
    });
  }

  for (const file of prepared) {
    const response = await input.client.uploadFile(file);
    if (response.error || !response.file) {
      throw new Error(response.error ?? "Upload failed.");
    }
    result.push({ kind: "file", attachment: response.file });
  }

  return result;
}

export function removeComposerAttachmentAtIndex<T extends ComposerAttachment>(input: {
  attachments: T[];
  index: number;
  deleteAttachments: AttachmentPersister["deleteAttachments"];
}): T[] {
  const removed = input.attachments[input.index];
  if (removed?.kind === "image") {
    void input.deleteAttachments([removed.metadata]);
  }
  return input.attachments.filter((_, i) => i !== input.index);
}

export interface CancelComposerAgentInput {
  client: ComposerCancelClient | null;
  agentId: string;
  isAgentRunning: boolean;
  isCancellingAgent: boolean;
  isConnected: boolean;
}

export function cancelComposerAgent(input: CancelComposerAgentInput): Promise<void> | null {
  if (!input.isAgentRunning || input.isCancellingAgent) return null;
  if (!input.isConnected || !input.client) return null;
  try {
    return Promise.resolve(input.client.cancelAgent(input.agentId));
  } catch (error) {
    return Promise.reject(error);
  }
}

export interface DispatchComposerAgentMessageInput {
  client: ComposerSendClient;
  agentId: string;
  text: string;
  attachments: ComposerAttachment[];
  attachmentSubmitFormat?: ComposerAttachmentSubmitFormat;
  encodeImages: (
    images: AttachmentMetadata[],
  ) => Promise<Array<{ data: string; mimeType: string }> | undefined>;
  submission: MessageSubmissionWriter;
  activeTurnBehavior?: ActiveTurnBehavior;
  activeTurnId?: string;
}

export async function dispatchComposerAgentMessage(
  input: DispatchComposerAgentMessageInput,
): Promise<void> {
  const wirePayload = splitComposerAttachmentsForSubmit(input.attachments, {
    format: input.attachmentSubmitFormat,
  });
  const clientMessageId = generateMessageId();
  const userMessage = createUserMessage({
    clientMessageId,
    text: input.text,
    timestamp: new Date(),
    images: wirePayload.images,
    attachments: wirePayload.attachments,
    ...(input.activeTurnBehavior === "steer" && input.activeTurnId
      ? { turnId: input.activeTurnId }
      : {}),
  });
  input.submission.begin(input.agentId, userMessage);
  try {
    const imagesData = await input.encodeImages(wirePayload.images);
    await input.client.sendAgentMessage(input.agentId, input.text, {
      messageId: clientMessageId,
      ...(input.activeTurnBehavior ? { activeTurnBehavior: input.activeTurnBehavior } : {}),
      images: imagesData ?? [],
      attachments: wirePayload.attachments,
    });
    input.submission.accept(input.agentId, clientMessageId);
  } catch (error) {
    input.submission.reject(input.agentId, clientMessageId);
    throw error;
  }
}

export interface QueueComposerMessageInput {
  agentId: string;
  text: string;
  attachments: ComposerAttachment[];
  queue: QueueWriter;
}

export interface QueueComposerMessageResult {
  queued: QueuedComposerMessage | null;
}

export function queueComposerMessage(input: QueueComposerMessageInput): QueueComposerMessageResult {
  const trimmed = input.text.trim();
  if (!trimmed && input.attachments.length === 0) {
    return { queued: null };
  }
  const item: QueuedComposerMessage = {
    id: generateMessageId(),
    text: trimmed,
    attachments: input.attachments,
  };
  input.queue.write((prev) => {
    const next = new Map(prev);
    next.set(input.agentId, [...(prev.get(input.agentId) ?? []), item]);
    return next;
  });
  return { queued: item };
}

export interface EditQueuedComposerMessageInput {
  agentId: string;
  messageId: string;
  queue: QueueWriter;
}

export interface EditQueuedComposerMessageResult {
  text: string;
  attachments: UserComposerAttachment[];
}

export function editQueuedComposerMessage(
  input: EditQueuedComposerMessageInput,
): EditQueuedComposerMessageResult | null {
  const item = input.queue.read(input.agentId).find((q) => q.id === input.messageId);
  if (!item) return null;
  input.queue.write((prev) => {
    const next = new Map(prev);
    next.set(
      input.agentId,
      (prev.get(input.agentId) ?? []).filter((q) => q.id !== input.messageId),
    );
    return next;
  });
  return {
    text: item.text,
    attachments: userAttachmentsOnly(item.attachments),
  };
}

export interface SendQueuedComposerMessageNowInput {
  agentId: string;
  messageId: string;
  queue: QueueWriter;
  submitMessage: (input: { text: string; attachments: ComposerAttachment[] }) => Promise<void>;
  failedToSendMessage?: string;
}

export type SendQueuedComposerMessageNowResult =
  | { status: "missing" }
  | { status: "submitted" }
  | { status: "failed"; errorMessage: string };

export async function sendQueuedComposerMessageNow(
  input: SendQueuedComposerMessageNowInput,
): Promise<SendQueuedComposerMessageNowResult> {
  const item = input.queue.read(input.agentId).find((q) => q.id === input.messageId);
  if (!item) return { status: "missing" };
  input.queue.write((prev) => {
    const next = new Map(prev);
    next.set(
      input.agentId,
      (prev.get(input.agentId) ?? []).filter((q) => q.id !== input.messageId),
    );
    return next;
  });
  try {
    await input.submitMessage({ text: item.text, attachments: item.attachments });
    return { status: "submitted" };
  } catch (error) {
    input.queue.write((prev) => {
      const next = new Map(prev);
      next.set(input.agentId, [item, ...(prev.get(input.agentId) ?? [])]);
      return next;
    });
    return {
      status: "failed",
      errorMessage:
        error instanceof Error
          ? error.message
          : (input.failedToSendMessage ?? i18n.t("composer.errors.failedToSend")),
    };
  }
}

export interface OpenComposerAttachmentInput {
  attachment: ComposerAttachment;
  setLightboxMetadata: (metadata: AttachmentMetadata) => void;
  openWorkspaceAttachment: (input: { attachment: ComposerAttachment }) => boolean;
  openExternalUrl: (url: string) => void;
}

export function openComposerAttachment(input: OpenComposerAttachmentInput): void {
  if (input.attachment.kind === "image") {
    input.setLightboxMetadata(input.attachment.metadata);
    return;
  }
  if (input.attachment.kind === "file" || input.attachment.kind === "workspace_file") {
    return;
  }
  if (isWorkspaceAttachment(input.attachment)) {
    input.openWorkspaceAttachment({ attachment: input.attachment });
    return;
  }
  input.openExternalUrl(input.attachment.item.url);
}

export function buildForgeAttachment(item: ForgeSearchItem): UserComposerAttachment {
  return item.kind === "change_request"
    ? { kind: "forge_change_request", item }
    : { kind: "forge_issue", item };
}

function isForgeAttachment(
  attachment: UserComposerAttachment,
): attachment is Extract<
  UserComposerAttachment,
  { kind: "forge_issue" | "forge_change_request" | "github_issue" | "github_pr" }
> {
  return (
    attachment.kind === "forge_issue" ||
    attachment.kind === "forge_change_request" ||
    // COMPAT(githubAttachmentKinds): accept legacy persisted attachment kinds
    // until 2027-01-17, when supported floors are >= v0.2.0 and old drafts no
    // longer require them.
    attachment.kind === "github_issue" ||
    attachment.kind === "github_pr"
  );
}

export function toggleForgeAttachment(
  current: UserComposerAttachment[],
  item: ForgeSearchItem,
): UserComposerAttachment[] {
  const matches = (attachment: UserComposerAttachment) =>
    isForgeAttachment(attachment) &&
    attachment.item.kind === item.kind &&
    attachment.item.number === item.number;
  if (current.some(matches)) {
    return current.filter((attachment) => !matches(attachment));
  }
  return [...current, buildForgeAttachment(item)];
}

interface ToggleForgeAttachmentFromPickerInput {
  current: UserComposerAttachment[];
  item: ForgeSearchItem;
  markForgeAttachmentRemoved: (attachment: UserComposerAttachment) => void;
}

export function toggleForgeAttachmentFromPicker({
  current,
  item,
  markForgeAttachmentRemoved,
}: ToggleForgeAttachmentFromPickerInput): UserComposerAttachment[] {
  const existingAttachment = current.find(
    (attachment) =>
      isForgeAttachment(attachment) &&
      attachment.item.kind === item.kind &&
      attachment.item.number === item.number,
  );
  if (existingAttachment) {
    markForgeAttachmentRemoved(existingAttachment);
  }
  return toggleForgeAttachment(current, item);
}

export function findForgeItemByOption(
  items: readonly ForgeSearchItem[],
  optionId: string,
): ForgeSearchItem | undefined {
  return items.find((candidate) => `${candidate.kind}:${candidate.number}` === optionId);
}

export function isAttachmentSelectedForForgeItem(
  current: readonly ComposerAttachment[],
  item: ForgeSearchItem,
): boolean {
  return userAttachmentsOnly(current).some(
    (attachment) =>
      isForgeAttachment(attachment) &&
      attachment.item.kind === item.kind &&
      attachment.item.number === item.number,
  );
}

// ============================================================================
// Daemon-owned queue — see docs/queue-mirroring.md.
// Only reachable behind server_info.features.durableAgentQueueV1; without the
// flag the composer keeps its local queue, which never leaves this device.
// ============================================================================

export interface ComposerQueueClient {
  enqueueAgentMessage: (input: {
    agentId: string;
    itemId: string;
    text: string;
    intent: QueuedAgentDeliveryIntent;
    images?: Array<{ data: string; mimeType: string }>;
    attachments?: ReturnType<typeof splitComposerAttachmentsForSubmit>["attachments"];
    composerAttachments?: QueuedComposerAttachment[];
  }) => Promise<AgentQueueSnapshot>;
  updateQueuedAgentMessage: (input: {
    agentId: string;
    itemId: string;
    text: string;
    expectedRevision: number;
    images?: Array<{ data: string; mimeType: string }>;
    attachments?: ReturnType<typeof splitComposerAttachmentsForSubmit>["attachments"];
    composerAttachments?: QueuedComposerAttachment[];
  }) => Promise<AgentQueueSnapshot>;
  reorderQueuedAgentMessages: (
    agentId: string,
    itemIds: string[],
    expectedRevision: number,
  ) => Promise<AgentQueueSnapshot>;
  deleteQueuedAgentMessage: (
    agentId: string,
    itemId: string,
    expectedRevision: number,
  ) => Promise<AgentQueueSnapshot>;
  retryQueuedAgentMessage: (
    agentId: string,
    itemId: string,
    expectedRevision: number,
  ) => Promise<AgentQueueSnapshot>;
  getQueuedAgentMessageImages: (
    agentId: string,
    itemId: string,
  ) => Promise<Array<{ id: string; mimeType: string; fileName?: string | null; data: string }>>;
}

/**
 * Durable copy of an enqueue until the daemon acknowledges it. Backed by the
 * queue outbox store; actions only see this narrow writer so they stay pure.
 * `add` resolves only once the entry is persisted; `flush` pushes un-acked
 * entries to the daemon.
 */
export interface QueueOutboxWriter {
  serverId?: string;
  add: (entry: {
    agentId: string;
    itemId: string;
    text: string;
    intent: QueuedAgentDeliveryIntent;
    images: Array<{ data: string; mimeType: string }>;
    attachments: ReturnType<typeof splitComposerAttachmentsForSubmit>["attachments"];
    composerAttachments: QueuedComposerAttachment[];
  }) => void | Promise<void>;
  remove: (itemId: string) => void | Promise<void>;
  flush?: () => Promise<void>;
}

export interface QueueComposerMessageOnServerInput {
  client: ComposerQueueClient;
  agentId: string;
  text: string;
  attachments: ComposerAttachment[];
  attachmentSubmitFormat?: ComposerAttachmentSubmitFormat;
  encodeImages: (
    images: AttachmentMetadata[],
  ) => Promise<Array<{ data: string; mimeType: string }> | undefined>;
  queue: QueueWriter;
  applySnapshot: (snapshot: AgentQueueSnapshot) => void;
  outbox?: QueueOutboxWriter;
}

/**
 * Queues a message on the daemon. The local row appears immediately and is
 * replaced by the daemon's snapshot.
 *
 * With an outbox, the wire payload is written durably before the request goes
 * out: a send the daemon never acknowledged — relay stall, app suspended
 * mid-request — is retried on the next reconnect instead of being lost, so the
 * optimistic row stays. Without one, failure rolls the row back and surfaces
 * the error, as before.
 *
 * Admission only ever appends to the queue writer. No submission writer is
 * involved, so nothing puts a row in the timeline before the daemon has
 * delivered the prompt; the accepted delivery creates the one canonical user
 * row through the normal submission identity system.
 */
export async function queueComposerMessageOnServer(
  input: QueueComposerMessageOnServerInput,
): Promise<QueueComposerMessageResult & { error?: string }> {
  if (input.outbox?.flush && input.outbox.serverId) {
    // Durable path: the full wire payload is persisted before this resolves,
    // and no optimistic row is written — the row renders from the outbox
    // overlay until a snapshot acks the item, so there is exactly one
    // canonical row per admitted message.
    const outbox = input.outbox;
    const flush = input.outbox.flush;
    const serverId = outbox.serverId;
    if (!serverId || !flush) {
      return { queued: null, error: i18n.t("composer.errors.queuedPersistFailed") };
    }
    return serializeQueueOperation(
      JSON.stringify(["prepare", serverId, input.agentId]),
      async () => {
        const text = input.text.trim();
        if (!text && input.attachments.length === 0) return { queued: null };
        const queued = { id: generateMessageId(), text, attachments: input.attachments };
        try {
          const wirePayload = splitComposerAttachmentsForSubmit(input.attachments, {
            format: input.attachmentSubmitFormat,
          });
          const images = await input.encodeImages(wirePayload.images);
          if (wirePayload.images.length > 0 && images?.length !== wirePayload.images.length) {
            throw new Error(i18n.t("composer.errors.queuedPersistFailed"));
          }
          await outbox.add({
            agentId: input.agentId,
            itemId: queued.id,
            text,
            intent: "queue",
            images: images ?? [],
            attachments: wirePayload.attachments,
            composerAttachments: toQueuedComposerAttachments(input.attachments),
          });
        } catch (error) {
          return {
            queued: null,
            error:
              error instanceof Error
                ? error.message
                : i18n.t("composer.errors.queuedPersistFailed"),
          };
        }
        void flush().catch((flushError) => {
          console.error("[queue-outbox] flush failed:", flushError);
        });
        return { queued };
      },
    );
  }

  const optimistic = queueComposerMessage({
    agentId: input.agentId,
    text: input.text,
    attachments: input.attachments,
    queue: input.queue,
  });
  if (!optimistic.queued) {
    return optimistic;
  }

  const rollBack = (error: unknown): QueueComposerMessageResult & { error?: string } => {
    removeQueuedComposerMessageLocally({
      agentId: input.agentId,
      messageId: optimistic.queued!.id,
      queue: input.queue,
    });
    return {
      queued: null,
      error: error instanceof Error ? error.message : i18n.t("composer.errors.failedToSend"),
    };
  };

  const wirePayload = splitComposerAttachmentsForSubmit(input.attachments, {
    format: input.attachmentSubmitFormat,
  });
  let images: Array<{ data: string; mimeType: string }> | undefined;
  try {
    images = await input.encodeImages(wirePayload.images);
  } catch (error) {
    // Encoding is local; its failure is real and retrying would not help.
    return rollBack(error);
  }

  const enqueueInput = {
    agentId: input.agentId,
    itemId: optimistic.queued.id,
    text: optimistic.queued.text,
    intent: "queue" as const,
    images: images ?? [],
    attachments: wirePayload.attachments,
    composerAttachments: toQueuedComposerAttachments(input.attachments),
  };
  try {
    await input.outbox?.add(enqueueInput);
  } catch (error) {
    return rollBack(error);
  }
  try {
    const snapshot = await input.client.enqueueAgentMessage(enqueueInput);
    await input.outbox?.remove(enqueueInput.itemId);
    input.applySnapshot(snapshot);
    return optimistic;
  } catch (error) {
    if (input.outbox) {
      // The durable entry retries on reconnect; keep the row so the message
      // still reads as queued on this device.
      return optimistic;
    }
    return rollBack(error);
  }
}

export interface QueueSubmitClearingDecision {
  clearText: boolean;
  clearAttachments: boolean;
}

/**
 * The liveness decision for clearing after a queue admission: input the user
 * has already replaced during the await survives; input that still matches
 * what was submitted is cleared.
 */
export function resolveQueueSubmitClearing(input: {
  liveText: string;
  submittedText: string;
  liveAttachments: readonly unknown[];
  submittedAttachments: readonly unknown[];
}): QueueSubmitClearingDecision {
  return {
    clearText: input.liveText === input.submittedText,
    clearAttachments: input.liveAttachments === input.submittedAttachments,
  };
}

/**
 * The clearing owner for queue admissions. Runs the submit, then clears only
 * after the queue resolved and only input the user has not replaced. Errors
 * are normalized and rethrown — surfacing belongs to the entry point that
 * invoked the queue path (submit, the queue button, or dictation), exactly
 * once per path.
 */
export interface QueuedSubmissionOwner {
  /**
   * The clearing baseline: the raw live input captured at submit time. The
   * submitted payload may be trimmed or rebuilt (workspace attachments) and
   * must not participate in this comparison.
   */
  submittedText: string;
  submittedAttachments: readonly ComposerAttachment[];
  /** The outgoing payload handed to the queue — the sent-context cleanup receives this. */
  submittedOutgoing?: readonly ComposerAttachment[];
  getLiveText: () => string;
  getLiveAttachments: () => readonly ComposerAttachment[];
  clearText: () => void;
  clearAttachments: () => void;
  resetSuppression?: () => void;
  clearSentAttachments?: (attachments: readonly ComposerAttachment[]) => void;
}

export async function runQueuedSubmission(
  owner: QueuedSubmissionOwner,
  submit: () => Promise<QueueComposerMessageResult & { error?: string }>,
): Promise<void> {
  let result: QueueComposerMessageResult & { error?: string };
  try {
    result = await submit();
  } catch (error) {
    throw error instanceof Error ? error : new Error(i18n.t("composer.errors.queuedPersistFailed"));
  }
  if (result.error) {
    throw new Error(result.error);
  }
  if (!result.queued) return;
  const decision = resolveQueueSubmitClearing({
    liveText: owner.getLiveText(),
    submittedText: owner.submittedText,
    liveAttachments: owner.getLiveAttachments(),
    submittedAttachments: owner.submittedAttachments,
  });
  if (decision.clearText) {
    owner.clearText();
    owner.resetSuppression?.();
  }
  if (decision.clearAttachments) {
    owner.clearAttachments();
  }
  owner.clearSentAttachments?.(owner.submittedOutgoing ?? owner.submittedAttachments);
}

/**
 * The one QueueOutboxFlushClient construction point. Every outbox dispatch
 * entry — the reconnect flush, the composer's flush, and explicit retries —
 * goes through this adapter, so tombstoned removals ride the same
 * revision-checked delete everywhere. A revision conflict refreshes the queue
 * (via onRevisionConflict) and throws QueueRevisionConflictError so the flush
 * lane can re-dispatch with a fresh reservation.
 */
export function createQueueOutboxFlushClient(input: {
  client: ComposerQueueClient;
  getAppliedRevision: (agentId: string) => number;
  onRevisionConflict?: (agentId: string) => void | Promise<void>;
}): QueueOutboxFlushClient {
  return {
    enqueueAgentMessage: (dispatch) => input.client.enqueueAgentMessage(dispatch),
    removeQueuedAgentMessage: async (agentId, itemId) => {
      try {
        return await input.client.deleteQueuedAgentMessage(
          agentId,
          itemId,
          input.getAppliedRevision(agentId),
        );
      } catch (error) {
        if (!isQueueRevisionConflictError(error)) {
          throw error;
        }
        await input.onRevisionConflict?.(agentId);
        throw new QueueRevisionConflictError();
      }
    },
  };
}

export type QueuedEditSaveDecision =
  | { kind: "noop" }
  | { kind: "conflict"; message: string }
  | { kind: "rpc"; revision: number };

/**
 * The queued-edit save decision, made before any RPC: a no-op save (text
 * unchanged from the row), a fresh-snapshot conflict (the applied revision
 * moved past the edit-start baseline — an intervening remote edit), or a
 * revision-checked update. While the conflict fence stands, only an explicit
 * force (the user's "Save anyway") is eligible, and it saves against the
 * current applied revision.
 */
export function resolveQueuedEditSave(input: {
  text: string;
  baselineText: string | undefined;
  baselineRevision: number;
  appliedRevision: number;
  conflicted: boolean;
  force: boolean;
  conflictMessage: string;
}): QueuedEditSaveDecision {
  const baselineRevision = input.force ? input.appliedRevision : input.baselineRevision;
  if (input.conflicted && !input.force) {
    return { kind: "conflict", message: input.conflictMessage };
  }
  if (input.baselineText !== undefined && input.text === input.baselineText && !input.force) {
    return { kind: "noop" };
  }
  if (!input.force && input.appliedRevision > input.baselineRevision) {
    return { kind: "conflict", message: input.conflictMessage };
  }
  return { kind: "rpc", revision: baselineRevision };
}

export function removeQueuedComposerMessageLocally(input: {
  agentId: string;
  messageId: string;
  queue: QueueWriter;
}): QueuedComposerMessage | null {
  const item = input.queue.read(input.agentId).find((q) => q.id === input.messageId);
  if (!item) return null;
  input.queue.write((prev) => {
    const next = new Map(prev);
    next.set(
      input.agentId,
      (prev.get(input.agentId) ?? []).filter((q) => q.id !== input.messageId),
    );
    return next;
  });
  return item;
}

export interface TakeQueuedComposerMessageInput {
  client: ComposerQueueClient;
  agentId: string;
  messageId: string;
  expectedRevision: number;
  queue: QueueWriter;
  persistImage: (input: {
    dataUrl: string;
    mimeType: string;
    fileName: string | null;
  }) => Promise<AttachmentMetadata>;
  applySnapshot: (snapshot: AgentQueueSnapshot) => void;
}

export type TakeQueuedComposerMessageResult =
  | { status: "missing" }
  | { status: "taken"; text: string; attachments: UserComposerAttachment[] }
  | { status: "conflict" }
  | { status: "failed"; errorMessage: string };

/**
 * Removes a queued message from the daemon and hands its content back for the
 * composer. Images are fetched and re-persisted locally because only the device
 * that queued them has the bytes.
 */
export async function takeQueuedComposerMessage(
  input: TakeQueuedComposerMessageInput,
): Promise<TakeQueuedComposerMessageResult> {
  const item = input.queue.read(input.agentId).find((q) => q.id === input.messageId);
  if (!item) return { status: "missing" };

  try {
    const images = await input.client.getQueuedAgentMessageImages(input.agentId, input.messageId);
    const snapshot = await input.client.deleteQueuedAgentMessage(
      input.agentId,
      input.messageId,
      input.expectedRevision,
    );
    input.applySnapshot(snapshot);
    const restoredImages = await Promise.all(
      images.map(async (image) => ({
        kind: "image" as const,
        metadata: await input.persistImage({
          dataUrl: `data:${image.mimeType};base64,${image.data}`,
          mimeType: image.mimeType,
          fileName: image.fileName ?? null,
        }),
      })),
    );
    return {
      status: "taken",
      text: item.text,
      attachments: [...userAttachmentsOnly(item.attachments), ...restoredImages],
    };
  } catch (error) {
    if (isQueueRevisionConflictError(error)) {
      return { status: "conflict" };
    }
    return {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : i18n.t("composer.errors.failedToSend"),
    };
  }
}

/** A mutation the daemon rejected because another device changed the queue first. */
export type QueuedMutationResult =
  | { status: "applied" }
  | { status: "conflict" }
  | { status: "failed"; errorMessage: string };

/**
 * The daemon answers mutation failures with a machine-readable code on the
 * response `error` field (see `agentQueueErrorText` in the session dispatch);
 * the client throws it as the error message.
 */
export function isQueueRevisionConflictError(error: unknown): boolean {
  return error instanceof Error && error.message === "queue_revision_conflict";
}

function queuedMutationResult(error: unknown): QueuedMutationResult {
  if (isQueueRevisionConflictError(error)) {
    return { status: "conflict" };
  }
  return {
    status: "failed",
    errorMessage: error instanceof Error ? error.message : i18n.t("composer.errors.failedToSend"),
  };
}

export interface DeleteQueuedComposerMessageInput {
  client: ComposerQueueClient;
  agentId: string;
  messageId: string;
  expectedRevision: number;
  applySnapshot: (snapshot: AgentQueueSnapshot) => void;
}

/**
 * Discards one durable item after an explicit user decision. The snapshot from
 * the daemon is authoritative; the local map is never edited directly here.
 */
export async function deleteQueuedComposerMessage(
  input: DeleteQueuedComposerMessageInput,
): Promise<QueuedMutationResult> {
  try {
    input.applySnapshot(
      await input.client.deleteQueuedAgentMessage(
        input.agentId,
        input.messageId,
        input.expectedRevision,
      ),
    );
    return { status: "applied" };
  } catch (error) {
    return queuedMutationResult(error);
  }
}

export interface ReorderQueuedComposerMessagesInput {
  client: ComposerQueueClient;
  agentId: string;
  /** Full id list in the desired order, as the reorder wire contract expects. */
  itemIds: string[];
  expectedRevision: number;
  applySnapshot: (snapshot: AgentQueueSnapshot) => void;
}

export async function reorderQueuedComposerMessages(
  input: ReorderQueuedComposerMessagesInput,
): Promise<QueuedMutationResult> {
  try {
    input.applySnapshot(
      await input.client.reorderQueuedAgentMessages(
        input.agentId,
        input.itemIds,
        input.expectedRevision,
      ),
    );
    return { status: "applied" };
  } catch (error) {
    return queuedMutationResult(error);
  }
}

export interface RetryQueuedComposerMessageInput {
  client: ComposerQueueClient;
  agentId: string;
  messageId: string;
  expectedRevision: number;
  applySnapshot: (snapshot: AgentQueueSnapshot) => void;
}

/**
 * The only path that resends an item whose provider acceptance is unknown or
 * whose attempts ran out. Never called automatically; the user pressed retry.
 */
export async function retryQueuedComposerMessage(
  input: RetryQueuedComposerMessageInput,
): Promise<QueuedMutationResult> {
  try {
    input.applySnapshot(
      await input.client.retryQueuedAgentMessage(
        input.agentId,
        input.messageId,
        input.expectedRevision,
      ),
    );
    return { status: "applied" };
  } catch (error) {
    return queuedMutationResult(error);
  }
}
