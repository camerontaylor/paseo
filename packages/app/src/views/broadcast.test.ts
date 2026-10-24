import { DaemonConnectionError, type DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushDirectOutboxForServer, useQueueOutboxStore } from "@/stores/queue-outbox-store";
import { runBroadcast } from "@/views/broadcast";

const persisted = vi.hoisted(() => new Map<string, string>());
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => persisted.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      persisted.set(key, value);
    },
    removeItem: async (key: string) => {
      persisted.delete(key);
    },
  },
}));

const runtime = vi.hoisted(() => ({ client: null as DaemonClient | null }));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({
    getClient: (serverId: string) => (serverId === "host-a" ? runtime.client : null),
  }),
  isHostRuntimeConnected: () => true,
}));

const plan = [{ serverId: "host-a", agentId: "agent-a", delivery: "send" as const }];

beforeEach(async () => {
  persisted.clear();
  await useQueueOutboxStore.persist.rehydrate();
  useQueueOutboxStore.setState({ directEntries: {}, durableHosts: { "host-a": true } });
  runtime.client = null;
});

describe("View broadcast direct delivery", () => {
  it("counts a host-accepted send only after its durable intent clears", async () => {
    const send = vi.fn(async () => ({ queued: false }));
    runtime.client = { sendAgentMessage: send } as unknown as DaemonClient;

    expect(await runBroadcast("hello", plan)).toEqual({
      sent: 1,
      queued: 0,
      skipped: 0,
      failed: 0,
      retryTargets: [],
    });
    expect(send).toHaveBeenCalledOnce();
    expect(Object.values(useQueueOutboxStore.getState().directEntries)).toEqual([]);
  });

  it("preserves a recipient for retry when durable staging fails before network", async () => {
    const send = vi.fn(async () => ({ queued: false }));
    runtime.client = { sendAgentMessage: send } as unknown as DaemonClient;
    const originalAdd = useQueueOutboxStore.getState().addDirect;
    useQueueOutboxStore.setState({
      addDirect: async () => {
        throw new Error("storage failed");
      },
    });
    try {
      expect(await runBroadcast("hello", plan)).toEqual({
        sent: 0,
        queued: 0,
        skipped: 0,
        failed: 1,
        retryTargets: [{ serverId: "host-a", agentId: "agent-a" }],
      });
      expect(send).not.toHaveBeenCalled();
      expect(Object.values(useQueueOutboxStore.getState().directEntries)).toEqual([]);
    } finally {
      useQueueOutboxStore.setState({ addDirect: originalAdd });
    }
  });

  it("reports an uncertain send as pending and retries the same message id", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new DaemonConnectionError("Connection lost"))
      .mockResolvedValueOnce({ queued: false });
    runtime.client = { sendAgentMessage: send } as unknown as DaemonClient;

    expect(await runBroadcast("hello", plan)).toEqual({
      sent: 0,
      queued: 1,
      skipped: 0,
      failed: 0,
      retryTargets: [],
    });
    const pending = Object.values(useQueueOutboxStore.getState().directEntries);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.text).toBe("hello");
    expect(send).toHaveBeenCalledTimes(1);

    await flushDirectOutboxForServer({ serverId: "host-a", client: runtime.client });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[2].messageId).toBe(send.mock.calls[0]?.[2].messageId);
    expect(Object.values(useQueueOutboxStore.getState().directEntries)).toEqual([]);
  });
});
