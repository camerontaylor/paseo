import { randomUUID } from "node:crypto";
import type { Logger } from "pino";

import type {
  AgentAttachment,
  AgentQueueSnapshot,
  QueuedAgentDeliveryIntent,
  QueuedComposerAttachment,
} from "@getpaseo/protocol/messages";
import type { AgentLifecycleStatus } from "@getpaseo/protocol/agent-lifecycle";

import type { AgentManager } from "../agent/agent-manager.js";
import type { AgentPromptInput } from "../agent/agent-sdk-types.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import { buildAgentPrompt } from "../agent/prompt-attachments.js";
import { sendPromptToAgent, waitForAgentRunStartWithTimeout } from "../agent/agent-prompt.js";
import { wrapSpokenInput } from "../voice-config.js";
import type { MessageReceipts } from "../message-receipts/index.js";
import {
  QueueRevisionConflictError,
  recordDrainedId,
  toAgentQueueSnapshot,
  type AgentQueueMutationResult,
  type AgentQueueStore,
  type StoredQueuedImage,
  type StoredQueuedMessage,
} from "./store.js";

/**
 * A dispatch that fails with a known pre-start error is retried on the next
 * wakeup until the limit; the attempt that passes the limit leaves the item in
 * the visible `failed` state with an explicit retry or discard.
 */
export const DELIVERY_ATTEMPT_LIMIT = 8;

/**
 * Admission bounds. A queue is a holding area for follow-ups, not an archive:
 * past these limits the client gets a machine-readable rejection instead of an
 * unbounded record.
 */
export const MAX_ITEMS_PER_QUEUE = 50;
export const MAX_ITEM_IMAGE_BASE64_CHARS = 16 * 1024 * 1024;

export class QueueFullError extends Error {
  readonly code = "queue_full";

  constructor(readonly limit: number) {
    super(`Agent queue holds at most ${limit} items`);
    this.name = "QueueFullError";
  }
}

export class QueueImagePayloadTooLargeError extends Error {
  readonly code = "image_payload_too_large";

  constructor(readonly limit: number) {
    super(`Queued images exceed ${limit} base64 characters per item`);
    this.name = "QueueImagePayloadTooLargeError";
  }
}

export class QueueItemDispatchingError extends Error {
  readonly code = "queue_item_dispatching";

  constructor(itemId: string) {
    super(`Queued message ${itemId} is being dispatched`);
    this.name = "QueueItemDispatchingError";
  }
}

export class QueueItemUncertainError extends Error {
  readonly code = "queue_item_uncertain";

  constructor(itemId: string) {
    super(`Queued message ${itemId} needs an explicit retry or discard first`);
    this.name = "QueueItemUncertainError";
  }
}

/** A strict steer the provider would not absorb. Never interrupts the turn. */
class QueueSteerRefusedError extends Error {
  constructor(itemId: string) {
    super(`Queued message ${itemId} was not steered into the active turn`);
    this.name = "QueueSteerRefusedError";
  }
}

export type AgentQueueMutationListener = (snapshot: AgentQueueSnapshot) => void;

export interface EnqueueAgentMessageInput {
  agentId: string;
  itemId: string;
  text: string;
  /** Admission is explicit: the daemon never infers a delivery intent. */
  intent: QueuedAgentDeliveryIntent;
  /** Set when the item is spoken input; wraps the prompt and keys receipt reads. */
  origin?: "voice";
  /** The principal/client pair that spoke the item. Required when origin is set. */
  voiceOwner?: string;
  images?: Array<{ data: string; mimeType: string }>;
  attachments?: AgentAttachment[];
  composerAttachments?: QueuedComposerAttachment[];
}

export interface UpdateQueuedMessageInput {
  text: string;
  images?: Array<{ data: string; mimeType: string }>;
  attachments?: AgentAttachment[];
  composerAttachments?: QueuedComposerAttachment[];
}

export interface SendQueuedPromptInput {
  agentId: string;
  prompt: AgentPromptInput;
  messageId: string;
}

/** The queue drains through the same receipt service the legacy send path uses. */
export type AgentQueueReceiptController = Pick<
  MessageReceipts,
  "send" | "outcome" | "listForAttachment" | "recordRemoved"
>;

export interface AgentQueueServiceOptions {
  store: AgentQueueStore;
  agentManager: AgentQueueAgentController;
  agentStorage: AgentStorage;
  logger: Logger;
  /** Correlates dispatch attempts across restarts. Absent only in unit tests. */
  receipts?: AgentQueueReceiptController | null;
  /**
   * Injected so tests can substitute the send without module mocks; defaults to
   * the same sendPromptToAgent the send_agent_message_request handler uses.
   */
  sendPrompt?: (input: SendQueuedPromptInput) => Promise<unknown>;
}

export type AgentQueueAgentController = Pick<
  AgentManager,
  "subscribe" | "getAgent" | "steerAgentRun" | "waitForAgentRunStart"
> &
  Partial<Pick<AgentManager, "getPendingPermissions" | "hasInFlightRun">>;

/**
 * The receipt key of one dispatch attempt. Attempts are keyed individually so a
 * retry after a known failure is not blocked by the previous attempt's receipt.
 */
function attemptReceiptId(itemId: string, attempt: number): string {
  return `${itemId}#${attempt}`;
}

/**
 * Owns the per-agent message queue for the whole daemon: one instance, shared by
 * every connected session, so the queue mirrors across devices and drains even
 * when nothing is connected.
 *
 * Delivery is claim -> provider dispatch -> correlated receipt -> removal. A
 * claimed item stays in the queue in the `dispatching` state, so a crash leaves
 * the state on disk for startup recovery instead of silently dropping or
 * resending the prompt.
 */
export class AgentQueueService {
  private readonly store: AgentQueueStore;
  private readonly agentManager: AgentQueueAgentController;
  private readonly agentStorage: AgentStorage;
  private readonly logger: Logger;
  private readonly receiptsOption: AgentQueueReceiptController | null;
  private receipts: AgentQueueReceiptController | null;
  private readonly sendPrompt: (input: SendQueuedPromptInput) => Promise<unknown>;

  private readonly listeners = new Set<AgentQueueMutationListener>();
  private readonly lastLifecycle = new Map<string, AgentLifecycleStatus>();
  private readonly lastPermissionCount = new Map<string, number>();
  private readonly drainTails = new Map<string, Promise<void>>();
  private unsubscribeAgentEvents: (() => void) | null = null;

  constructor(options: AgentQueueServiceOptions) {
    this.store = options.store;
    this.agentManager = options.agentManager;
    this.agentStorage = options.agentStorage;
    this.logger = options.logger.child({ module: "agent", component: "agent-queue" });
    this.receiptsOption = options.receipts ?? null;
    this.receipts = this.receiptsOption;
    this.sendPrompt =
      options.sendPrompt ??
      ((input) =>
        sendPromptToAgent({
          agentManager: this.agentManager as AgentManager,
          agentStorage: this.agentStorage,
          agentId: input.agentId,
          prompt: input.prompt,
          messageId: input.messageId,
          // A queued follow-up must never cancel and replace a turn that
          // started after the claim; losing the race is a failed attempt.
          replaceRunning: false,
          // And it waits behind a permission wait: answering it is the user's
          // decision, never the queued prompt's.
          blockPendingPermissions: true,
          unarchive: false,
          logger: this.logger,
        }));
  }

  /**
   * Reuse the daemon's direct-send receipt owner once the WebSocket server
   * constructs it. Unit tests may instead inject one through the options.
   */
  setMessageReceipts(receipts: AgentQueueReceiptController): void {
    if (this.receiptsOption) {
      throw new Error("Agent queue receipts were already provided at construction");
    }
    this.receipts = receipts;
  }

  /**
   * Startup recovery: resolve claims left in `dispatching` state, then start
   * lifecycle delivery. Items whose provider acceptance is unknown become
   * `uncertain` and are never dispatched again without an explicit retry.
   *
   * Call once after agents and providers are ready — never during daemon
   * initialization, so loading state and deciding outcomes stay separate.
   */
  async activate(): Promise<void> {
    for (const agentId of await this.store.ids()) {
      const recovered = await this.recoverDispatchingClaims(agentId);
      if (recovered.changed) {
        this.publish(recovered);
      }
    }
    this.start();
    // Wake agents that are already loaded and idle so never-dispatched items
    // resume. Agents that load on demand later drain through their own
    // running-to-idle transition instead of being loaded here.
    for (const agentId of await this.store.ids()) {
      if (this.agentManager.getAgent(agentId)?.lifecycle === "idle") {
        this.scheduleDrain(agentId);
      }
    }
    await this.flushDrains();
  }

  /**
   * Resolves one agent's `dispatching` claims against the receipt record:
   * completed means the provider took the prompt (remove the item), pending
   * means the attempt may have landed (hold as `uncertain`), and no receipt
   * means the attempt never dispatched for `queue` intent — while a strict
   * steer may have reached the provider mid-admission, so it holds as
   * `uncertain` too.
   */
  private async recoverDispatchingClaims(agentId: string): Promise<AgentQueueMutationResult> {
    const queue = await this.store.get(agentId);
    const claimed = queue.items.filter((item) => item.deliveryState === "dispatching");
    if (claimed.length === 0) {
      return { queue, changed: false };
    }
    const outcomes = new Map<string, "pending" | "completed" | "removed" | null>();
    for (const item of claimed) {
      outcomes.set(
        item.id,
        this.receipts
          ? await this.receipts.outcome(agentId, attemptReceiptId(item.id, item.attemptSeq))
          : null,
      );
    }
    return this.store.mutate(agentId, (current) => {
      const items: StoredQueuedMessage[] = [];
      let drainedIds = current.drainedIds;
      let changed = false;
      for (const item of current.items) {
        if (item.deliveryState !== "dispatching") {
          items.push(item);
          continue;
        }
        changed = true;
        const outcome = outcomes.get(item.id);
        if (outcome === "completed") {
          drainedIds = recordDrainedId(drainedIds, item.id);
          continue;
        }
        if (outcome === "pending") {
          items.push({
            ...item,
            deliveryState: "uncertain",
            lastError: "agent_request_outcome_unknown",
          });
          continue;
        }
        // No receipt for the in-flight attempt: the send never happened for
        // queue intent, while a strict steer may have reached the provider
        // mid-admission, so only the steer holds as uncertain.
        if (item.intent === "steer_strict") {
          items.push({
            ...item,
            deliveryState: "uncertain",
            lastError: "queue_claim_interrupted",
          });
          continue;
        }
        items.push({ ...item, deliveryState: "pending" });
      }
      if (!changed) {
        return current;
      }
      return { ...current, items, drainedIds };
    });
  }

  start(): void {
    if (this.unsubscribeAgentEvents) {
      return;
    }
    this.unsubscribeAgentEvents = this.agentManager.subscribe((event) => {
      // A keyed permission resolution is itself a drain wakeup: the head was
      // held only because of the wait, and the run it follows up on may end
      // without another lifecycle transition.
      if (event.type === "agent_stream" && event.event.type === "permission_resolved") {
        this.scheduleDrain(event.agentId);
        return;
      }
      if (event.type !== "agent_state") {
        return;
      }
      const permissionCount = this.pendingPermissionCount(event.agent.id, event.agent);
      const previousCount = this.lastPermissionCount.get(event.agent.id) ?? 0;
      this.lastPermissionCount.set(event.agent.id, permissionCount);
      if (previousCount > 0 && permissionCount === 0) this.scheduleDrain(event.agent.id);
      this.handleAgentState(event.agent.id, event.agent.lifecycle);
    });
  }

  stop(): void {
    this.unsubscribeAgentEvents?.();
    this.unsubscribeAgentEvents = null;
    this.listeners.clear();
    this.lastLifecycle.clear();
    this.lastPermissionCount.clear();
  }

  subscribeToMutations(listener: AgentQueueMutationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async list(agentId: string): Promise<AgentQueueSnapshot> {
    return toAgentQueueSnapshot(await this.store.get(agentId));
  }

  /**
   * This attachment's spoken items still in the queue. Receipt reads merge this
   * with the durable receipt records, so the speaking device sees queued and
   * submitted state that survives its own reconnects.
   */
  async listVoiceInputs(
    agentId: string,
    attachmentId: string,
    voiceOwner?: string,
  ): Promise<StoredQueuedMessage[]> {
    const queue = await this.store.get(agentId);
    return queue.items.filter(
      (item) =>
        item.origin === "voice" &&
        item.voiceOwner === voiceOwner &&
        item.id.startsWith(`${attachmentId}:`),
    );
  }

  async enqueue(input: EnqueueAgentMessageInput): Promise<AgentQueueSnapshot> {
    const text = input.text.trim();
    const attachments = input.attachments ?? [];
    const images = input.images ?? [];
    if (!text && attachments.length === 0 && images.length === 0) {
      throw new Error("Cannot queue an empty message");
    }
    this.assertImagePayloadWithinLimit(images);

    const item: StoredQueuedMessage = {
      id: input.itemId,
      text,
      ...(input.origin ? { origin: input.origin, voiceOwner: input.voiceOwner } : {}),
      intent: input.intent,
      deliveryState: "pending",
      attempts: 0,
      attemptSeq: 0,
      createdAt: new Date().toISOString(),
      ...(attachments.length ? { attachments } : {}),
      ...(input.composerAttachments?.length
        ? { composerAttachments: input.composerAttachments }
        : {}),
      ...(images.length
        ? {
            images: images.map((image) => ({
              id: randomUUID(),
              mimeType: image.mimeType,
              fileName: null,
              data: image.data,
            })),
          }
        : {}),
    };

    const result = await this.store.mutate(input.agentId, async (current) => {
      // Re-enqueueing the same id is a retry, not a duplicate — including a
      // retry that lands after the item was already drained and delivered.
      if (current.items.some((existing) => existing.id === item.id)) {
        return current;
      }
      // The receipt record outlives the bounded drained-id window: a delivered
      // or user-deleted item's id must never admit again.
      if (this.receipts) {
        const outcome = await this.receipts.outcome(input.agentId, item.id);
        if (outcome === "completed" || outcome === "removed") return current;
      }
      if (current.drainedIds?.includes(item.id)) {
        return current;
      }
      if (current.items.length >= MAX_ITEMS_PER_QUEUE) {
        throw new QueueFullError(MAX_ITEMS_PER_QUEUE);
      }
      return { ...current, items: [...current.items, item] };
    });
    this.publish(result);
    this.scheduleDrain(input.agentId);
    return toAgentQueueSnapshot(result.queue);
  }

  /**
   * Replaces one item's content. The replacement is a new admission of the same
   * identity: attempts reset, and a `failed` item becomes deliverable again.
   * A `dispatching` item refuses the edit (the dispatch is in flight) and an
   * `uncertain` item demands an explicit retry or discard first, because
   * rewriting the content cannot tell the user whether the old one arrived.
   */
  async update(
    agentId: string,
    itemId: string,
    expectedRevision: number,
    patch: UpdateQueuedMessageInput,
  ): Promise<AgentQueueSnapshot> {
    const text = patch.text.trim();
    const attachments = patch.attachments ?? [];
    const images = patch.images ?? [];
    if (!text && attachments.length === 0 && images.length === 0) {
      throw new Error("Cannot queue an empty message");
    }
    this.assertImagePayloadWithinLimit(images);

    const result = await this.store.mutateWithExpectedRevision(
      agentId,
      expectedRevision,
      (current) => {
        if (!current.items.some((item) => item.id === itemId)) {
          throw new Error(`Queued message ${itemId} is no longer queued`);
        }
        return {
          ...current,
          items: current.items.map((item) => {
            if (item.id !== itemId) {
              return item;
            }
            if (item.deliveryState === "dispatching") {
              throw new QueueItemDispatchingError(itemId);
            }
            if (item.deliveryState === "uncertain") {
              throw new QueueItemUncertainError(itemId);
            }
            return {
              ...item,
              text,
              deliveryState: "pending",
              attempts: 0,
              // Re-admission with new content: the sequence keeps increasing
              // so the new dispatch never reuses an old attempt's receipt key.
              attemptSeq: item.attemptSeq + 1,
              lastError: undefined,
              ...(attachments.length ? { attachments } : { attachments: undefined }),
              ...(images.length
                ? {
                    images: images.map((image) => ({
                      id: randomUUID(),
                      mimeType: image.mimeType,
                      fileName: null,
                      data: image.data,
                    })),
                  }
                : { images: undefined }),
              ...(patch.composerAttachments?.length
                ? { composerAttachments: patch.composerAttachments }
                : { composerAttachments: undefined }),
            };
          }),
        };
      },
    );
    this.publish(result);
    this.scheduleDrain(agentId);
    return toAgentQueueSnapshot(result.queue);
  }

  /**
   * Deletes one item. A `dispatching` item refuses deletion because the provider
   * dispatch is in flight; `uncertain` and `failed` items are deletable — that
   * is the explicit discard.
   */
  async remove(
    agentId: string,
    itemId: string,
    expectedRevision: number,
  ): Promise<AgentQueueSnapshot> {
    const result = await this.store.mutateWithExpectedRevision(
      agentId,
      expectedRevision,
      async (current) => {
        const item = current.items.find((candidate) => candidate.id === itemId);
        if (!item) {
          return current;
        }
        if (item.deliveryState === "dispatching") {
          throw new QueueItemDispatchingError(itemId);
        }
        // Validate under the queue lock before writing the durable tombstone.
        // A refused stale edit or in-flight deletion cannot change its outcome.
        if (item.origin === "voice" && this.receipts) {
          await this.receipts.recordRemoved({
            agentId,
            messageId: itemId,
            attachmentId: itemId.split(":", 1)[0],
            voiceOwner: item.voiceOwner,
            createdAt: item.createdAt,
          });
        }
        return { ...current, items: current.items.filter((candidate) => candidate.id !== itemId) };
      },
    );
    this.publish(result);
    return toAgentQueueSnapshot(result.queue);
  }

  async reorder(
    agentId: string,
    itemIds: string[],
    expectedRevision: number,
  ): Promise<AgentQueueSnapshot> {
    const result = await this.store.mutateWithExpectedRevision(
      agentId,
      expectedRevision,
      (current) => {
        const byId = new Map(current.items.map((item) => [item.id, item]));
        const ordered: StoredQueuedMessage[] = [];
        for (const id of itemIds) {
          const item = byId.get(id);
          if (item) {
            ordered.push(item);
            byId.delete(id);
          }
        }
        // Ids the caller did not mention keep their relative order at the end.
        ordered.push(...current.items.filter((item) => byId.has(item.id)));
        const unchanged = ordered.every((item, index) => current.items[index]?.id === item.id);
        return unchanged ? current : { ...current, items: ordered };
      },
    );
    this.publish(result);
    return toAgentQueueSnapshot(result.queue);
  }

  /**
   * Explicit user decision to attempt an `uncertain` or `failed` item again —
   * the only path that resends an item whose provider acceptance is unknown.
   */
  async retry(
    agentId: string,
    itemId: string,
    expectedRevision: number,
  ): Promise<AgentQueueSnapshot> {
    const result = await this.store.mutateWithExpectedRevision(
      agentId,
      expectedRevision,
      (current) => ({
        ...current,
        items: current.items.map((item) =>
          item.id === itemId &&
          (item.deliveryState === "failed" || item.deliveryState === "uncertain")
            ? { ...item, deliveryState: "pending", attempts: 0, lastError: undefined }
            : item,
        ),
      }),
    );
    this.publish(result);
    this.scheduleDrain(agentId);
    return toAgentQueueSnapshot(result.queue);
  }

  /**
   * Attempts delivery of one item now instead of waiting for it to reach the
   * head. The response carries the queue after the attempt, so the client can
   * tell a delivered item from one the admission fence refused: a busy or
   * archived agent, or an item that is not `pending`, leaves the queue
   * unchanged.
   */
  async sendNow(
    agentId: string,
    itemId: string,
    expectedRevision: number,
  ): Promise<AgentQueueSnapshot> {
    const current = await this.store.get(agentId);
    if (current.revision !== expectedRevision) {
      throw new QueueRevisionConflictError(expectedRevision, current.revision);
    }
    const item = current.items.find((candidate) => candidate.id === itemId);
    if (!item || item.deliveryState !== "pending") {
      return toAgentQueueSnapshot(current);
    }
    // Dispatch work is serialized per agent with the drain loop, so a send-now
    // cannot interleave with an in-flight drain dispatch; awaiting the tail is
    // what lets the response describe the queue after the attempt.
    await this.runOnAgentTail(agentId, () => this.dispatchPendingItem(agentId, itemId));
    return this.list(agentId);
  }

  /**
   * Returns the stored image bytes for one queued item. Only the device that
   * queued an image has a local copy, so any other device has to ask for it
   * before it can pull the item back into its composer.
   */
  async getItemImages(agentId: string, itemId: string): Promise<StoredQueuedImage[]> {
    const queue = await this.store.get(agentId);
    const item = queue.items.find((candidate) => candidate.id === itemId);
    if (!item) {
      throw new Error(`Queued message ${itemId} is no longer queued`);
    }
    return item.images ?? [];
  }

  async deleteForAgent(agentId: string): Promise<void> {
    await this.store.delete(agentId);
    this.lastLifecycle.delete(agentId);
    this.lastPermissionCount.delete(agentId);
  }

  private assertImagePayloadWithinLimit(images: Array<{ data: string; mimeType: string }>): void {
    const total = images.reduce((sum, image) => sum + image.data.length, 0);
    if (total > MAX_ITEM_IMAGE_BASE64_CHARS) {
      throw new QueueImagePayloadTooLargeError(MAX_ITEM_IMAGE_BASE64_CHARS);
    }
  }

  private async isArchived(agentId: string): Promise<boolean> {
    const record = await this.agentStorage.get(agentId);
    return record?.archivedAt != null;
  }

  private handleAgentState(agentId: string, lifecycle: AgentLifecycleStatus): void {
    const previous = this.lastLifecycle.get(agentId);
    this.lastLifecycle.set(agentId, lifecycle);
    if (previous === "running" && lifecycle === "idle") {
      this.scheduleDrain(agentId);
    }
  }

  /**
   * Follow-ups wait behind a permission the agent is blocked on: answering it
   * is the user's decision, and the queued prompt must never answer for them.
   */
  private pendingPermissionCount(
    agentId: string,
    agent?: { pendingPermissions?: { size: number } },
  ): number {
    if (agent) {
      return (
        agent.pendingPermissions?.size ??
        this.agentManager.getPendingPermissions?.(agentId).length ??
        0
      );
    }
    return this.agentManager.getPendingPermissions?.(agentId).length ?? 0;
  }

  private hasBlockingPermission(agentId: string): boolean {
    const agent = this.agentManager.getAgent(agentId);
    return this.pendingPermissionCount(agentId, agent ?? undefined) > 0;
  }

  /**
   * Drains run one at a time per agent. Chaining rather than dropping the request
   * matters: a wakeup that arrives while a drain is in flight is the wakeup for
   * the next item, and dropping it strands the rest of the queue.
   */
  private scheduleDrain(agentId: string): void {
    void this.runOnAgentTail(agentId, () => this.drain(agentId)).catch((error) => {
      this.logger.warn({ err: error, agentId }, "Failed to drain queued agent message");
    });
  }

  /** Runs one work item on the per-agent tail, serialized with drains. */
  private async runOnAgentTail<T>(agentId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.drainTails.get(agentId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    const tail = next.catch(() => undefined);
    this.drainTails.set(agentId, tail as Promise<void>);
    try {
      return await next;
    } finally {
      if (this.drainTails.get(agentId) === tail) {
        this.drainTails.delete(agentId);
      }
    }
  }

  /** Awaits in-flight drains. Tests and shutdown use it; nothing else should need it. */
  async flushDrains(): Promise<void> {
    while (this.drainTails.size > 0) {
      await Promise.all(Array.from(this.drainTails.values()));
      await Promise.resolve();
    }
  }

  /**
   * Bridge durable admission to the provider run observed by wait-for-finish.
   * Waiters observe the dispatch; they can never cancel it — aborting ends the
   * observation only, and an unresolved queued outcome returns an error instead
   * of a false idle result.
   */
  async waitForPendingDispatch(agentId: string, signal: AbortSignal): Promise<void> {
    const aborted = () => new DOMException("Queue dispatch wait aborted", "AbortError");
    while (true) {
      if (signal.aborted) throw aborted();
      const pending = this.drainTails.get(agentId);
      if (pending) {
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            signal.removeEventListener("abort", onAbort);
            reject(aborted());
          };
          signal.addEventListener("abort", onAbort, { once: true });
          void pending.then(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
            return;
          });
        });
        continue;
      }
      const queue = await this.store.get(agentId);
      if (this.drainTails.has(agentId)) continue;
      if (signal.aborted) throw aborted();
      const agent = this.agentManager.getAgent(agentId);
      if (
        queue.items.length > 0 &&
        (!agent || agent.lifecycle === "idle" || agent.lifecycle === "closed") &&
        !this.agentManager.hasInFlightRun?.(agentId) &&
        !this.hasBlockingPermission(agentId)
      ) {
        // An uncertain or failed dispatch is still queued; it is not completion.
        throw new Error(
          "Queued input has not been confirmed submitted; inspect its delivery outcome",
        );
      }
      return;
    }
  }

  /**
   * Sends the head of the queue when the agent is free. Serialized per agent so a
   * burst of state events cannot send the same item twice.
   *
   * The queue is strictly FIFO: an item that is not `pending` (dispatching,
   * uncertain, failed) holds the line — later items must not silently overtake
   * the message they follow up on.
   */
  private async drain(agentId: string): Promise<void> {
    if (await this.isArchived(agentId)) {
      // Archived agents keep their queue but never auto-run.
      return;
    }
    const agent = this.agentManager.getAgent(agentId);
    if (!agent) {
      return;
    }
    if (this.hasBlockingPermission(agentId)) {
      return;
    }
    if (this.agentManager.hasInFlightRun?.(agentId)) {
      return;
    }
    const queue = await this.store.get(agentId);
    const head = queue.items[0];
    if (!head || head.deliveryState !== "pending") {
      return;
    }
    if (head.intent === "queue" && agent.lifecycle !== "idle" && agent.lifecycle !== "closed") {
      return;
    }
    await this.dispatchPendingItem(agentId, head.id);
  }

  /**
   * One delivery attempt for a `pending` item: claim, dispatch through the
   * receipt service, then remove on success or record the outcome on failure.
   * Callers reach this only through the per-agent work tail, so two attempts on
   * one agent never overlap.
   */
  private async dispatchPendingItem(agentId: string, itemId: string): Promise<void> {
    if (await this.isArchived(agentId)) {
      return;
    }
    const agent = this.agentManager.getAgent(agentId);
    if (!agent) {
      return;
    }
    if (this.hasBlockingPermission(agentId)) {
      return;
    }
    const queue = await this.store.get(agentId);
    const item = queue.items.find((candidate) => candidate.id === itemId);
    if (!item || item.deliveryState !== "pending") {
      return;
    }
    // A queue-intent dispatch needs a free agent; this also refuses a send-now
    // aimed at a busy agent instead of replacing the turn that won the race.
    if (item.intent === "queue" && agent.lifecycle !== "idle" && agent.lifecycle !== "closed") {
      return;
    }

    // Claim before sending so a concurrent drain cannot send the item twice.
    // The claim persists `dispatching`, so a crash here is a recoverable state,
    // not a lost or duplicated prompt.
    const claimed = await this.store.mutate(agentId, (current) => {
      const target = current.items.find((candidate) => candidate.id === itemId);
      if (!target || target.deliveryState !== "pending") {
        return current;
      }
      return {
        ...current,
        items: current.items.map((candidate) =>
          candidate.id === itemId
            ? {
                ...candidate,
                deliveryState: "dispatching",
                attempts: candidate.attempts + 1,
                attemptSeq: candidate.attemptSeq + 1,
              }
            : candidate,
        ),
      };
    });
    if (!claimed.changed) {
      return;
    }
    this.publish(claimed);
    const claimedItem = claimed.queue.items.find((candidate) => candidate.id === itemId);
    if (!claimedItem) {
      return;
    }

    const prompt = buildAgentPrompt(
      claimedItem.origin === "voice" ? wrapSpokenInput(claimedItem.text) : claimedItem.text,
      claimedItem.images?.map(({ data, mimeType }) => ({ data, mimeType })),
      claimedItem.attachments as AgentAttachment[] | undefined,
    );

    try {
      if (claimedItem.intent === "steer_strict" && agent.lifecycle === "running") {
        await this.deliverStrictSteer(agentId, claimedItem, prompt);
      } else {
        await this.deliverAsRun(agentId, claimedItem, prompt);
      }
    } catch (error) {
      if (error instanceof QueueSteerRefusedError) {
        // The provider would not absorb the prompt and the turn kept running:
        // not a dispatch attempt. Un-claim without burning an attempt; the next
        // wakeup tries again, and a later turn end delivers it as a new run.
        const reverted = await this.store.mutate(agentId, (current) => ({
          ...current,
          items: current.items.map((candidate) =>
            candidate.id === itemId && candidate.deliveryState === "dispatching"
              ? { ...candidate, deliveryState: "pending", attempts: candidate.attempts - 1 }
              : candidate,
          ),
        }));
        this.publish(reverted);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn({ err: error, agentId, itemId }, "Queued agent message failed to send");
      const failed = await this.store.mutate(agentId, (current) => ({
        ...current,
        items: current.items.map((candidate) => {
          if (candidate.id !== itemId || candidate.deliveryState !== "dispatching") {
            return candidate;
          }
          if (candidate.attempts >= DELIVERY_ATTEMPT_LIMIT) {
            return { ...candidate, deliveryState: "failed", lastError: message };
          }
          return { ...candidate, deliveryState: "pending", lastError: message };
        }),
      }));
      this.publish(failed);
      return;
    }

    const delivered = await this.store.mutate(agentId, (current) => {
      if (!current.items.some((candidate) => candidate.id === itemId)) {
        return current;
      }
      return {
        ...current,
        items: current.items.filter((candidate) => candidate.id !== itemId),
        drainedIds: recordDrainedId(current.drainedIds, itemId),
      };
    });
    this.publish(delivered);
  }

  /**
   * Normal run delivery for a free agent. A run that was reported started but
   * never confirmed within the start budget is `uncertain`, not failed: the
   * provider may still be working on the prompt.
   */
  private async deliverAsRun(
    agentId: string,
    item: StoredQueuedMessage,
    prompt: AgentPromptInput,
  ): Promise<void> {
    const send = async () => {
      const result = (await this.sendPrompt({
        agentId,
        prompt,
        messageId: item.id,
      })) as { disposition?: string } | undefined;
      if (result?.disposition === "turn_started") {
        await waitForAgentRunStartWithTimeout(this.agentManager as AgentManager, agentId);
      }
    };
    if (this.receipts) {
      await this.receipts.send({
        agentId,
        messageId: attemptReceiptId(item.id, item.attemptSeq),
        request: { prompt, intent: item.intent },
        ...(item.origin === "voice"
          ? {
              attachment: {
                messageId: item.id,
                attachmentId: item.id.split(":", 1)[0],
                voiceOwner: item.voiceOwner,
                createdAt: item.createdAt,
              },
            }
          : {}),
        send,
      });
      return;
    }
    await send();
  }

  /**
   * Strict steering for a running agent: the active turn is asked to absorb the
   * prompt through the shared admission, and refusal leaves the turn untouched.
   * Steer attempts write no receipt — a refused attempt un-claims instead, so
   * only the ambiguous crash window lands in recovery as `uncertain`.
   */
  private async deliverStrictSteer(
    agentId: string,
    item: StoredQueuedMessage,
    prompt: AgentPromptInput,
  ): Promise<void> {
    const result = await this.agentManager.steerAgentRun(agentId, prompt, {
      clientMessageId: item.id,
    });
    if (result.status !== "accepted") {
      throw new QueueSteerRefusedError(item.id);
    }
  }

  private publish(result: AgentQueueMutationResult): void {
    if (!result.changed) {
      return;
    }
    const snapshot = toAgentQueueSnapshot(result.queue);
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        this.logger.warn(
          { err: error, agentId: result.queue.agentId },
          "Agent queue listener failed",
        );
      }
    }
  }
}
