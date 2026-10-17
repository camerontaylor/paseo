/**
 * @vitest-environment jsdom
 *
 * Exercises the registered status handler, not the flush function directly: the provider's
 * server-info feed is what decides whether a reconnect resumes the durable queue outbox, so the
 * cases drive that handler through absent, capable and downgraded hosts.
 */
import React from "react";
import { act } from "@testing-library/react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  feedHandlers: new Map<string, (message: unknown) => void>(),
  enqueueAgentMessage: vi.fn(async () => ({
    agentId: "agent-1",
    revision: 1,
    items: [],
  })),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => undefined },
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({}) }));
vi.mock("@/contexts/voice-context", () => ({
  useVoiceRuntimeOptional: () => null,
  useVoiceAudioEngineOptional: () => null,
}));
vi.mock("@/contexts/toast-context", () => ({
  useToast: () => ({ error: vi.fn(), show: vi.fn(), copied: vi.fn() }),
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeIsConnected: () => true,
  getHostRuntimeStore: () => ({
    prepareWorkspaceRoute: vi.fn(async () => undefined),
    prepareAgentTimeline: vi.fn(async () => undefined),
    runProbeCycleNow: vi.fn(),
    fetchAgentTimeline: vi.fn(async () => undefined),
    acquireScriptStatusDemand: vi.fn(() => () => {}),
    createViewedTimelineOwner: () => ({
      replaceVisibleAgentIds: vi.fn(),
      replaceOpenTabAgentIds: vi.fn(),
      enqueueStreamEvent: vi.fn(),
      setConnected: vi.fn(),
      setActive: vi.fn(),
      dispose: vi.fn(),
    }),
  }),
}));
vi.mock("@/hooks/use-client-activity", () => ({ useClientActivity: () => undefined }));
vi.mock("@/hooks/use-app-visible", () => ({ useAppVisible: () => true }));
vi.mock("@/push-notifications", () => ({ startPushNotifications: () => () => {} }));
vi.mock("@/utils/os-notifications", () => ({ sendOsNotification: vi.fn() }));
vi.mock("@/utils/app-visibility", () => ({
  getIsAppActivelyVisible: () => true,
  getIsAppVisible: () => true,
}));

import { SessionProvider } from "./session-context";
import { useQueueOutboxStore } from "@/stores/queue-outbox-store";

function createFakeClient() {
  const feedHandlers = harness.feedHandlers;
  feedHandlers.clear();
  return {
    observeEvents: () => ({
      subscribe: (observer: { snapshot: () => void; update: (message: unknown) => void }) => {
        const key = `feed-${feedHandlers.size}`;
        feedHandlers.set(key, observer.update);
        observer.snapshot();
        return () => feedHandlers.delete(key);
      },
      dispose: () => undefined,
      release: async () => undefined,
    }),
    on: (type: string, handler: (message: unknown) => void) => {
      feedHandlers.set(`on-${type}`, handler);
      return () => feedHandlers.delete(`on-${type}`);
    },
    observeTimeline: () => ({
      subscribe: () => () => undefined,
      release: async () => undefined,
    }),
    enqueueAgentMessage: harness.enqueueAgentMessage,
  };
}

/** Delivers a server-info status through whichever registered feed handles it. */
function deliverServerInfo(features: Record<string, boolean>): void {
  const message = {
    type: "status",
    payload: {
      status: "server_info",
      serverId: "server-1",
      hostname: null,
      version: null,
      features,
    },
  };
  for (const handler of harness.feedHandlers.values()) {
    handler(message);
  }
}

describe("session queue resume", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    // The app's JSX compiles to the classic runtime here, and the provider does not import React.
    vi.stubGlobal("React", React);
    harness.enqueueAgentMessage.mockClear();
    useQueueOutboxStore.setState({ entries: {} });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <SessionProvider
          serverId="server-1"
          client={createFakeClient() as unknown as never}
        >
          {null}
        </SessionProvider>,
      );
    });
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    container?.remove();
    container = null;
    vi.unstubAllGlobals();
  });

  it("holds a pending outbox entry when the host lacks the durable queue", async () => {
    useQueueOutboxStore.getState().add({
      images: [],
      attachments: [],
      composerAttachments: [],
      serverId: "server-1",
      agentId: "agent-1",
      itemId: "item-1",
      text: "queued while offline",
      intent: "queue",
    });

    await act(async () => {
      deliverServerInfo({ ownedSubscriptions: true });
    });

    expect(harness.enqueueAgentMessage).not.toHaveBeenCalled();
    expect(useQueueOutboxStore.getState().entriesForServer("server-1")).toHaveLength(1);
  });

  it("resumes the pending outbox once the host advertises the durable queue", async () => {
    useQueueOutboxStore.getState().add({
      images: [],
      attachments: [],
      composerAttachments: [],
      serverId: "server-1",
      agentId: "agent-1",
      itemId: "item-1",
      text: "queued while offline",
      intent: "queue",
    });

    await act(async () => {
      deliverServerInfo({ ownedSubscriptions: true, durableAgentQueueV1: true });
    });

    expect(harness.enqueueAgentMessage).toHaveBeenCalledTimes(1);
    expect(harness.enqueueAgentMessage.mock.calls[0]?.[0]).toMatchObject({
      agentId: "agent-1",
      itemId: "item-1",
      text: "queued while offline",
      intent: "queue",
    });
  });

  it("stops resuming after a downgrade back to a host without the flag", async () => {
    useQueueOutboxStore.getState().add({
      images: [],
      attachments: [],
      composerAttachments: [],
      serverId: "server-1",
      agentId: "agent-1",
      itemId: "item-1",
      text: "queued while offline",
      intent: "queue",
    });

    await act(async () => {
      deliverServerInfo({ ownedSubscriptions: true, durableAgentQueueV1: true });
    });
    expect(harness.enqueueAgentMessage).toHaveBeenCalledTimes(1);

    harness.enqueueAgentMessage.mockClear();
    useQueueOutboxStore.getState().add({
      images: [],
      attachments: [],
      composerAttachments: [],
      serverId: "server-1",
      agentId: "agent-1",
      itemId: "item-2",
      text: "queued again",
      intent: "queue",
    });
    await act(async () => {
      deliverServerInfo({ ownedSubscriptions: true });
    });

    expect(harness.enqueueAgentMessage).not.toHaveBeenCalled();
  });
});
