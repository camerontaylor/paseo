import { createServer, type Server as HTTPServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentManager } from "./agent/agent-manager.js";
import { AgentStorage, type StoredAgentRecord } from "./agent/agent-storage.js";
import type { CheckoutDiffManager } from "./checkout-diff-manager.js";
import { DaemonConfigStore } from "./daemon-config-store.js";
import type { DownloadTokenStore } from "./file-download/token-store.js";
import type { ScheduleService } from "./schedule/service.js";
import { createStub } from "./test-utils/class-mocks.js";
import { createProviderSnapshotManagerStub } from "./test-utils/session-stubs.js";
import { createTestLogger } from "../test-utils/test-logger.js";
import { VoiceAssistantWebSocketServer } from "./websocket-server.js";
import type { WorkspaceAutoName } from "./workspace-auto-name.js";

interface ProviderRenameHarness {
  configStore: DaemonConfigStore;
  agentStorage: AgentStorage;
  wsServer: VoiceAssistantWebSocketServer;
  httpServer: HTTPServer;
  renameProviderOnLiveAgents: ReturnType<typeof vi.fn>;
  stop(): Promise<void>;
}

const harnesses: ProviderRenameHarness[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.stop()));
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function storedRecord(overrides: Partial<StoredAgentRecord>): StoredAgentRecord {
  return {
    id: "agent-1",
    provider: "claude-work",
    cwd: "/tmp/project",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    labels: {},
    lastStatus: "closed",
    config: null,
    runtimeInfo: { provider: "claude-work", sessionId: "session-1" },
    persistence: { provider: "claude-work", sessionId: "session-1" },
    ...overrides,
  };
}

function createWebSocketServer(params: {
  httpServer: HTTPServer;
  paseoHome: string;
  agentStorage: AgentStorage;
  configStore: DaemonConfigStore;
  renameProviderOnLiveAgents: ReturnType<typeof vi.fn>;
}): VoiceAssistantWebSocketServer {
  const agentManager = {
    setAgentAttentionCallback() {},
    subscribe: () => () => {},
    updateProviderRegistry() {},
    renameProviderOnLiveAgents: params.renameProviderOnLiveAgents,
    getMetricsSnapshot: () => ({
      total: 0,
      byLifecycle: {},
      withActiveForegroundTurn: 0,
      timelineStats: { totalItems: 0, maxItemsPerAgent: 0 },
    }),
  };

  return new VoiceAssistantWebSocketServer(
    params.httpServer,
    createStub<pino.Logger>(createTestLogger()),
    "srv-test",
    createStub<AgentManager>(agentManager),
    params.agentStorage,
    createStub<DownloadTokenStore>({}),
    params.paseoHome,
    params.configStore,
    null,
    { allowedOrigins: new Set(["*"]) },
    createStub<WorkspaceAutoName>({
      scheduleForWorktree: () => {},
      scheduleForDirectory: () => {},
    }),
    undefined,
    undefined,
    undefined,
    undefined,
    "1.2.3-test",
    undefined,
    undefined,
    undefined,
    createStub<ScheduleService>({}),
    createStub<CheckoutDiffManager>({
      subscribe: () => {},
      scheduleRefreshForCwd: () => {},
      getMetrics: () => ({
        checkoutDiffTargetCount: 0,
        checkoutDiffSubscriptionCount: 0,
        checkoutDiffWatcherCount: 0,
        checkoutDiffFallbackRefreshTargetCount: 0,
      }),
      dispose: () => {},
    }),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    createProviderSnapshotManagerStub().manager,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  );
}

async function startHarness(): Promise<ProviderRenameHarness> {
  const paseoHome = mkdtempSync(path.join(tmpdir(), "paseo-provider-rename-"));
  tempDirs.push(paseoHome);

  const agentStorage = new AgentStorage(path.join(paseoHome, "agents"), createTestLogger());
  const configStore = new DaemonConfigStore(paseoHome, {
    mcp: { injectIntoAgents: false },
    browserTools: { enabled: false },
    providers: { "claude-work": { extends: "claude", label: "Work" } },
    metadataGeneration: { providers: [] },
    autoArchiveAfterMerge: false,
    enableTerminalAgentHooks: false,
    appendSystemPrompt: "",
  });
  const renameProviderOnLiveAgents = vi.fn();

  const httpServer = createServer();
  const wsServer = createWebSocketServer({
    httpServer,
    paseoHome,
    agentStorage,
    configStore,
    renameProviderOnLiveAgents,
  });

  const harness: ProviderRenameHarness = {
    configStore,
    agentStorage,
    wsServer,
    httpServer,
    renameProviderOnLiveAgents,
    async stop() {
      await wsServer.close();
      httpServer.close();
    },
  };
  harnesses.push(harness);
  return harness;
}

describe("provider rename migration wiring", () => {
  it("migrates persisted agents and repoints live agents when a provider is renamed", async () => {
    const harness = await startHarness();
    await harness.agentStorage.upsert(storedRecord({ id: "agent-renamed" }));
    await harness.agentStorage.upsert(
      storedRecord({
        id: "agent-other",
        provider: "claude",
        runtimeInfo: { provider: "claude", sessionId: "session-2" },
        persistence: { provider: "claude", sessionId: "session-2" },
      }),
    );

    harness.configStore.patch({
      replaceProviders: { "claude-job": { extends: "claude", label: "Job" } },
      removeProviders: ["claude-work"],
      renameProviders: { "claude-work": "claude-job" },
    });

    expect(harness.renameProviderOnLiveAgents).toHaveBeenCalledWith("claude-work", "claude-job");

    await vi.waitFor(async () => {
      const record = await harness.agentStorage.get("agent-renamed");
      expect(record?.provider).toBe("claude-job");
    });

    const record = await harness.agentStorage.get("agent-renamed");
    expect(record?.runtimeInfo?.provider).toBe("claude-job");
    expect(record?.persistence?.provider).toBe("claude-job");

    const other = await harness.agentStorage.get("agent-other");
    expect(other?.provider).toBe("claude");
  });
});

/** Blocks the first storage migration so a second config change can land while it runs. */
function gateRenameProvider(agentStorage: AgentStorage): {
  release: () => void;
  calls: () => number;
} {
  const original = agentStorage.renameProvider.bind(agentStorage);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  agentStorage.renameProvider = (async (from: string, to: string) => {
    calls += 1;
    if (calls === 1) await gate;
    return original(from, to);
  }) as AgentStorage["renameProvider"];
  return { release: () => release(), calls: () => calls };
}

function captureConfigBroadcasts(wsServer: VoiceAssistantWebSocketServer): Array<{
  providers?: Record<string, unknown>;
}> {
  const configs: Array<{ providers?: Record<string, unknown> }> = [];
  const target = wsServer as unknown as {
    broadcastDaemonConfigChanged: (config: { providers?: Record<string, unknown> }) => void;
  };
  const original = target.broadcastDaemonConfigChanged.bind(wsServer);
  vi.spyOn(target, "broadcastDaemonConfigChanged").mockImplementation((config) => {
    configs.push(config);
    original(config);
  });
  return configs;
}

describe("provider rename migration ordering", () => {
  it("keeps successive renames ordered when the first storage migration is delayed", async () => {
    const harness = await startHarness();
    await harness.agentStorage.upsert(storedRecord({ id: "agent-renamed" }));
    const broadcasts = captureConfigBroadcasts(harness.wsServer);
    const gate = gateRenameProvider(harness.agentStorage);

    harness.configStore.patch({
      replaceProviders: { "claude-job": { extends: "claude", label: "Job" } },
      removeProviders: ["claude-work"],
      renameProviders: { "claude-work": "claude-job" },
    });
    await vi.waitFor(() => expect(gate.calls()).toBe(1));

    // The second change lands while the first migration is blocked inside storage.
    harness.configStore.patch({
      replaceProviders: { "claude-final": { extends: "claude", label: "Final" } },
      removeProviders: ["claude-job"],
      renameProviders: { "claude-job": "claude-final" },
    });
    const broadcastsBeforeRelease = broadcasts.length;

    gate.release();
    await vi.waitFor(async () => {
      const record = await harness.agentStorage.get("agent-renamed");
      expect(record?.provider).toBe("claude-final");
    });

    const record = await harness.agentStorage.get("agent-renamed");
    expect(record?.runtimeInfo?.provider).toBe("claude-final");
    expect(record?.persistence?.provider).toBe("claude-final");

    // Nothing republishes the superseded config once claude-final is live.
    const afterRelease = broadcasts.slice(broadcastsBeforeRelease);
    expect(afterRelease.some((config) => config.providers?.["claude-final"])).toBe(true);
    expect(afterRelease.every((config) => !config.providers?.["claude-job"])).toBe(true);
  });

  it("drains a queued rename migration before close resolves", async () => {
    const harness = await startHarness();
    harnesses.splice(harnesses.indexOf(harness), 1);
    await harness.agentStorage.upsert(storedRecord({ id: "agent-drained" }));
    const gate = gateRenameProvider(harness.agentStorage);

    harness.configStore.patch({
      replaceProviders: { "claude-job": { extends: "claude", label: "Job" } },
      removeProviders: ["claude-work"],
      renameProviders: { "claude-work": "claude-job" },
    });
    await vi.waitFor(() => expect(gate.calls()).toBe(1));

    let closed = false;
    const closing = harness.wsServer.close().then(() => {
      closed = true;
      return undefined;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closed).toBe(false);

    gate.release();
    await closing;
    const record = await harness.agentStorage.get("agent-drained");
    expect(record?.provider).toBe("claude-job");
    await new Promise<void>((resolve) => harness.httpServer.close(() => resolve()));
  });

  it("does not wedge later migrations when one batch fails", async () => {
    const harness = await startHarness();
    await harness.agentStorage.upsert(storedRecord({ id: "agent-failed" }));
    await harness.agentStorage.upsert(
      storedRecord({
        id: "agent-codex",
        provider: "codex-work",
        runtimeInfo: { provider: "codex-work", sessionId: "session-codex" },
        persistence: { provider: "codex-work", sessionId: "session-codex" },
      }),
    );
    harness.configStore.patch({
      replaceProviders: { "codex-work": { extends: "codex", label: "Codex Work" } },
    });

    const original = harness.agentStorage.renameProvider.bind(harness.agentStorage);
    let calls = 0;
    harness.agentStorage.renameProvider = (async (from: string, to: string) => {
      calls += 1;
      if (calls === 1) throw new Error("storage unavailable");
      return original(from, to);
    }) as AgentStorage["renameProvider"];

    harness.configStore.patch({
      replaceProviders: { "claude-job": { extends: "claude", label: "Job" } },
      removeProviders: ["claude-work"],
      renameProviders: { "claude-work": "claude-job" },
    });
    await vi.waitFor(() => expect(calls).toBe(1));

    // The failed batch keeps its record and the tail still runs the next change.
    harness.configStore.patch({
      replaceProviders: { "codex-final": { extends: "codex", label: "Codex Final" } },
      removeProviders: ["codex-work"],
      renameProviders: { "codex-work": "codex-final" },
    });
    await vi.waitFor(async () => {
      const record = await harness.agentStorage.get("agent-codex");
      expect(record?.provider).toBe("codex-final");
    });
    const failed = await harness.agentStorage.get("agent-failed");
    expect(failed?.provider).toBe("claude-work");
  });
});
