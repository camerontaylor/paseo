import { describe, expect, it } from "vitest";
import type {
  ChatHistoryContextAttachment,
  WorkspaceComposerAttachment,
} from "@/attachments/types";
import { openTranscriptPicker, type TranscriptPickerPort, type TranscriptSource } from "./model";

const alpha: TranscriptSource = { agentId: "alpha", title: "Chat Alpha", provider: "mock" };
const beta: TranscriptSource = { agentId: "beta", title: "Chat Beta", provider: "mock" };

function transcript(source: TranscriptSource, id = source.agentId): ChatHistoryContextAttachment {
  return {
    kind: "chat_history",
    id,
    source: { serverId: "host", agentId: source.agentId },
    attachment: {
      type: "text",
      mimeType: "text/plain",
      contextKind: "chat_history",
      title: source.title,
      text: `Transcript from ${source.agentId}`,
    },
  };
}

function harness(initial: readonly WorkspaceComposerAttachment[] = []) {
  let attachments = initial;
  const requests: Array<{
    source: TranscriptSource;
    resolve: (value: ChatHistoryContextAttachment) => void;
    reject: (error: Error) => void;
  }> = [];
  const port: TranscriptPickerPort = {
    serverId: "host",
    getAttachments: () => attachments,
    setAttachments: (next) => {
      attachments = next;
    },
    loadTranscript: (source) =>
      new Promise((resolve, reject) => {
        requests.push({ source, resolve, reject });
      }),
    describeError: (error) => (error instanceof Error ? error.message : "Failed"),
  };
  return {
    model: openTranscriptPicker(port),
    requests,
    getAttachments: () => attachments,
    setAttachments: port.setAttachments,
  };
}

describe("draft transcript selection", () => {
  it("combines concurrent snapshots and toggles one without removing other context", async () => {
    const extra: WorkspaceComposerAttachment = {
      kind: "forge.change_request_comment",
      id: "review",
      title: "Review",
      text: "Keep this context",
    };
    const { model, requests, getAttachments } = harness([extra]);
    const first = model.toggle(alpha);
    const second = model.toggle(beta);
    expect(model.getState().pendingAgentIds).toEqual(["alpha", "beta"]);
    requests[1]!.resolve(transcript(beta));
    await second;
    requests[0]!.resolve(transcript(alpha));
    await first;
    expect(new Set(model.getState().selectedAgentIds)).toEqual(new Set(["alpha", "beta"]));
    expect(getAttachments()).toHaveLength(3);
    await model.toggle(alpha);
    expect(model.getState().selectedAgentIds).toEqual(["beta"]);
    expect(getAttachments()).toEqual([extra, transcript(beta)]);
  });

  it("recognizes and removes a preselected fork without requesting another snapshot", async () => {
    const { model, requests, getAttachments } = harness([transcript(alpha, "existing-fork-id")]);
    expect(model.getState().selectedAgentIds).toEqual(["alpha"]);
    await model.toggle(alpha);
    expect(requests).toHaveLength(0);
    expect(getAttachments()).toEqual([]);
  });

  it("ignores a cancelled request when the same source is selected again", async () => {
    const { model, requests, getAttachments } = harness();
    const stale = model.toggle(alpha);
    await model.toggle(alpha);
    const current = model.toggle(alpha);
    requests[0]!.resolve(transcript(alpha, "stale"));
    await stale;
    expect(getAttachments()).toEqual([]);
    expect(model.getState().pendingAgentIds).toEqual(["alpha"]);
    requests[1]!.resolve(transcript(alpha, "fresh"));
    await current;
    expect(getAttachments()[0]).toEqual(transcript(alpha, "fresh"));
  });

  it("does not attach a late response after the draft model closes", async () => {
    const { model, requests, getAttachments } = harness();
    const loading = model.toggle(alpha);
    model.close();
    requests[0]!.resolve(transcript(alpha));
    await loading;
    expect(getAttachments()).toEqual([]);
  });

  it("exposes a failed load without selecting it, then allows retry", async () => {
    const { model, requests, getAttachments } = harness();
    const loading = model.toggle(alpha);
    requests[0]!.reject(new Error("Host disconnected"));
    await loading;
    expect(model.getState()).toEqual({
      selectedAgentIds: [],
      pendingAgentIds: [],
      error: "Host disconnected",
    });
    const retry = model.toggle(alpha);
    expect(model.getState().error).toBeNull();
    requests[1]!.resolve(transcript(alpha));
    await retry;
    expect(getAttachments()).toEqual([transcript(alpha)]);
  });

  it("follows removal through an attachment pill and keeps selections draft-local", async () => {
    const first = harness([transcript(alpha)]);
    const second = harness();
    first.setAttachments([]);
    first.model.refresh();
    expect(first.model.getState().selectedAgentIds).toEqual([]);
    const loading = second.model.toggle(beta);
    second.requests[0]!.resolve(transcript(beta));
    await loading;
    expect(first.getAttachments()).toEqual([]);
    expect(second.model.getState().selectedAgentIds).toEqual(["beta"]);
  });
});
