import type {
  ChatHistoryContextAttachment,
  WorkspaceComposerAttachment,
} from "@/attachments/types";

export interface TranscriptSource {
  agentId: string;
  title: string;
  provider: string;
}

export interface TranscriptPickerState {
  selectedAgentIds: readonly string[];
  pendingAgentIds: readonly string[];
  error: string | null;
}

export interface TranscriptPickerPort {
  serverId: string;
  getAttachments(): readonly WorkspaceComposerAttachment[];
  setAttachments(attachments: readonly WorkspaceComposerAttachment[]): void;
  loadTranscript(source: TranscriptSource): Promise<ChatHistoryContextAttachment>;
  describeError(error: unknown): string;
}

/** Draft attachments own selection; requests only own their pending state. */
export function openTranscriptPicker(port: TranscriptPickerPort) {
  const listeners = new Set<() => void>();
  const pending = new Map<string, symbol>();
  let closed = false;
  let error: string | null = null;
  const matchesSource = (attachment: WorkspaceComposerAttachment, agentId: string) =>
    attachment.kind === "chat_history" &&
    attachment.source.serverId === port.serverId &&
    attachment.source.agentId === agentId;
  const snapshot = (): TranscriptPickerState => ({
    selectedAgentIds: port
      .getAttachments()
      .flatMap((attachment) =>
        attachment.kind === "chat_history" && attachment.source.serverId === port.serverId
          ? [attachment.source.agentId]
          : [],
      ),
    pendingAgentIds: Array.from(pending.keys()),
    error,
  });
  let state = snapshot();
  const publish = () => {
    if (closed) return;
    state = snapshot();
    for (const listener of listeners) listener();
  };
  const toggle = async (source: TranscriptSource) => {
    if (closed) return;
    error = null;
    if (pending.delete(source.agentId)) {
      publish();
      return;
    }
    const attachments = port.getAttachments();
    if (attachments.some((attachment) => matchesSource(attachment, source.agentId))) {
      port.setAttachments(
        attachments.filter((attachment) => !matchesSource(attachment, source.agentId)),
      );
      publish();
      return;
    }
    const request = Symbol(source.agentId);
    pending.set(source.agentId, request);
    publish();
    try {
      const attachment = await port.loadTranscript(source);
      if (closed || pending.get(source.agentId) !== request) return;
      port.setAttachments([
        ...port.getAttachments().filter((existing) => !matchesSource(existing, source.agentId)),
        attachment,
      ]);
    } catch (cause) {
      if (closed || pending.get(source.agentId) !== request) return;
      error = port.describeError(cause);
    } finally {
      if (!closed && pending.get(source.agentId) === request) {
        pending.delete(source.agentId);
        publish();
      }
    }
  };
  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh: publish,
    toggle,
    close: () => {
      closed = true;
      pending.clear();
      listeners.clear();
    },
  };
}
