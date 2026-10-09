import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => {
  const storage = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        storage.delete(key);
      }),
    },
  };
});

import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { AgentQueueSnapshot, WorkspaceDescriptorPayload } from "@getpaseo/protocol/messages";
import { outboxPersistedStorage, useQueueOutboxStore } from "./queue-outbox-store";

import {
  normalizeWorkspaceDescriptor,
  selectAgentTurnPresentation,
  selectAgentTimelineState,
  useSessionStore,
  type Agent,
  type WorkspaceDescriptor,
} from "./session-store";
import type { StreamItem } from "../types/stream";
import { reduceTurnLiveness, type TurnLivenessTransition } from "@/timeline/turn-liveness";

function createTestAgent(agentId: string): Agent {
  return {
    serverId: "test-server",
    id: agentId,
    provider: "codex",
    status: "idle",
    turn: { phase: "idle", cancellationRequestId: null },
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastUserMessageAt: null,
    lastActivityAt: new Date(0),
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: false,
      supportsMcpServers: false,
      supportsReasoningStream: false,
      supportsToolInvocations: false,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: null,
    cwd: "/repo",
    model: null,
    parentAgentId: null,
    labels: {},
  };
}

function applyTestTurn(
  serverId: string,
  agentId: string,
  transition: TurnLivenessTransition | readonly TurnLivenessTransition[],
): void {
  useSessionStore.getState().setAgents(serverId, (agents) => {
    const agent = agents.get(agentId) ?? createTestAgent(agentId);
    const transitions = Array.isArray(transition) ? transition : [transition];
    const turn = transitions.reduce(reduceTurnLiveness, agent.turn);
    const next = new Map(agents);
    next.set(agentId, { ...agent, status: turn.phase === "open" ? "running" : "idle", turn });
    return next;
  });
}

function createWorkspace(
  input: Partial<WorkspaceDescriptor> & Pick<WorkspaceDescriptor, "id">,
): WorkspaceDescriptor {
  return {
    id: input.id,
    projectId: input.projectId ?? "project-1",
    projectDisplayName: input.projectDisplayName ?? "Project 1",
    projectCustomName: input.projectCustomName ?? null,
    projectRootPath: input.projectRootPath ?? "/repo",
    workspaceDirectory: input.workspaceDirectory ?? "/repo",
    projectKind: input.projectKind ?? "git",
    workspaceKind: input.workspaceKind ?? "local_checkout",
    name: input.name ?? "main",
    status: input.status ?? "done",
    statusEnteredAt: input.statusEnteredAt ?? null,
    archivingAt: input.archivingAt ?? null,
    diffStat: input.diffStat ?? null,
    scripts: input.scripts ?? [],
  };
}

afterEach(() => {
  useSessionStore.getState().clearSession("test-server");
});

function initializeTestSession(): void {
  useSessionStore.getState().initializeSession("test-server", null as unknown as DaemonClient);
}

function getTestSessionReferences() {
  const state = useSessionStore.getState();
  const session = state.sessions["test-server"];
  if (!session) {
    throw new Error("test session is not initialized");
  }
  return {
    sessions: state.sessions,
    session,
    workspaces: session.workspaces,
  };
}

function submittedMessage(clientMessageId: string): Extract<StreamItem, { kind: "user_message" }> {
  return {
    kind: "user_message",
    id: clientMessageId,
    clientMessageId,
    text: clientMessageId,
    timestamp: new Date("2026-07-31T10:00:00.000Z"),
  };
}

function hasSubmittedMessage(items: readonly StreamItem[] | undefined, clientMessageId: string) {
  return items?.some(
    (item) => item.kind === "user_message" && item.clientMessageId === clientMessageId,
  );
}

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length === 0) return [[]];
  return values.flatMap((value, index) =>
    permutations([...values.slice(0, index), ...values.slice(index + 1)]).map((suffix) =>
      [value].concat(suffix),
    ),
  );
}

function taskTexts(tasks: ReadonlyArray<{ text: string }>): string[] {
  return tasks.map((task) => task.text);
}

describe("agent task state", () => {
  it("notifies the task subscriber only when its task snapshot changes", () => {
    initializeTestSession();
    const snapshots: string[][] = [];
    const unsubscribe = useSessionStore.subscribe(
      (state) => state.sessions["test-server"]?.agentTasks.get("agent-1") ?? [],
      (tasks) => snapshots.push(taskTexts(tasks)),
    );

    const tasks = [{ id: "1", text: "Inspect", status: "pending" as const, completed: false }];
    useSessionStore
      .getState()
      .setAgentStreamState("test-server", "agent-1", { taskSnapshot: tasks });
    useSessionStore.getState().setIsPlayingAudio("test-server", true);
    useSessionStore
      .getState()
      .setAgentStreamState("test-server", "agent-1", { taskSnapshot: [...tasks] });
    useSessionStore.getState().setAgentStreamState("test-server", "agent-1", {
      taskSnapshot: [{ ...tasks[0], status: "completed", completed: true }],
    });
    unsubscribe();

    expect(snapshots).toEqual([["Inspect"], ["Inspect"]]);
  });

  it("restores the latest task snapshot from an authoritative timeline", () => {
    initializeTestSession();
    const todo: StreamItem = {
      kind: "todo_list",
      id: "todo-1",
      provider: "codex",
      timestamp: new Date("2026-08-11T10:00:00.000Z"),
      activity: { type: "started", task: "Verify" },
      items: [{ text: "Verify", status: "in_progress", completed: false }],
    };

    useSessionStore.getState().applyAgentTimelineResponseState("test-server", "agent-1", {
      items: [todo],
      head: [],
      range: null,
      older: "none",
      newer: false,
      synchronized: true,
      acknowledgedClientMessageIds: [],
    });

    expect(useSessionStore.getState().sessions["test-server"]?.agentTasks.get("agent-1")).toEqual(
      todo.items,
    );
  });
});

describe("agent timeline state", () => {
  it("commits canonical items, range, and older availability as one synced state", () => {
    initializeTestSession();
    const items: StreamItem[] = [
      {
        kind: "assistant_message",
        id: "canonical-row",
        text: "canonical",
        timestamp: new Date("2026-07-27T10:00:00.000Z"),
      },
    ];

    useSessionStore.getState().applyAgentTimelineResponseState("test-server", "agent-1", {
      items,
      head: [],
      range: { epoch: "epoch-1", startSeq: 51, endSeq: 100 },
      older: "available",
      newer: false,
      synchronized: true,
      acknowledgedClientMessageIds: [],
    });

    expect(
      selectAgentTimelineState(useSessionStore.getState().sessions["test-server"], "agent-1"),
    ).toEqual({
      status: "synced",
      items,
      range: { epoch: "epoch-1", startSeq: 51, endSeq: 100 },
      older: "available",
      newer: "none",
    });
  });

  it("represents an empty authoritative timeline without inventing a range", () => {
    initializeTestSession();
    useSessionStore.getState().applyAgentTimelineResponseState("test-server", "agent-1", {
      items: [],
      head: [],
      range: null,
      older: "none",
      newer: false,
      synchronized: true,
      acknowledgedClientMessageIds: [],
    });

    expect(
      selectAgentTimelineState(useSessionStore.getState().sessions["test-server"], "agent-1"),
    ).toEqual({ status: "synced", items: [], range: null, older: "none", newer: "none" });
  });

  it("preserves older availability when an applied response leaves it unchanged", () => {
    initializeTestSession();
    const store = useSessionStore.getState();
    store.applyAgentTimelineResponseState("test-server", "agent-1", {
      items: [],
      head: [],
      range: { epoch: "epoch-1", startSeq: 200, endSeq: 240 },
      older: "available",
      newer: false,
      synchronized: true,
      acknowledgedClientMessageIds: [],
    });

    store.applyAgentTimelineResponseState("test-server", "agent-1", {
      items: [],
      head: [],
      range: { epoch: "epoch-1", startSeq: 200, endSeq: 240 },
      older: "unchanged",
      newer: false,
      synchronized: false,
      acknowledgedClientMessageIds: [],
    });

    expect(
      selectAgentTimelineState(useSessionStore.getState().sessions["test-server"], "agent-1"),
    ).toEqual({
      status: "synced",
      items: [],
      range: { epoch: "epoch-1", startSeq: 200, endSeq: 240 },
      older: "available",
      newer: "none",
    });
  });

  it("stores turn liveness transitions without duplicating their policy", () => {
    initializeTestSession();
    const store = useSessionStore.getState();
    applyTestTurn("test-server", "agent-1", {
      type: "snapshot",
      activeTurn: { turnId: "turn-1", startedAt: null },
    });
    expect(store.getSession("test-server")?.agents.get("agent-1")?.turn).toEqual({
      phase: "open",
      turnId: "turn-1",
      startedAt: null,
      cancellationRequestId: null,
    });

    applyTestTurn("test-server", "agent-1", {
      type: "snapshot",
      activeTurn: null,
    });
    expect(store.getSession("test-server")?.agents.get("agent-1")?.turn).toEqual({
      phase: "idle",
      cancellationRequestId: null,
    });
  });
});

describe("message submission ordering", () => {
  const agentId = "agent-1";
  const clientMessageId = "client-1";
  const startedAt = new Date("2026-07-31T10:00:01.000Z");
  const steps = [
    "accept",
    "canonical-row",
    "stream-open",
    "snapshot-idle",
    "snapshot-open",
    "stream-close",
  ] as const;

  function applyStep(step: (typeof steps)[number]): void {
    const store = useSessionStore.getState();
    if (step === "accept") {
      store.acceptAgentMessageSubmission("test-server", agentId, clientMessageId);
      return;
    }
    if (step === "canonical-row") {
      store.setAgentStreamState("test-server", agentId, {
        acknowledgedClientMessageIds: [clientMessageId],
      });
      return;
    }
    if (step === "stream-open") {
      applyTestTurn("test-server", agentId, {
        type: "stream_open",
        turn: { turnId: "turn-1", startedAt },
      });
      return;
    }
    if (step === "snapshot-open") {
      applyTestTurn("test-server", agentId, {
        type: "snapshot",
        activeTurn: { turnId: "turn-1", startedAt },
      });
      return;
    }
    if (step === "snapshot-idle") {
      applyTestTurn("test-server", agentId, {
        type: "snapshot",
        activeTurn: null,
      });
      return;
    }
    applyTestTurn("test-server", agentId, {
      type: "stream_close",
      turnId: "turn-1",
    });
  }

  it("keeps every ordering active until its canonical row and settles at quiescence", () => {
    const continuityViolations: string[] = [];
    const settlementViolations: string[] = [];

    for (const ordering of permutations(steps)) {
      useSessionStore.getState().clearSession("test-server");
      initializeTestSession();
      useSessionStore
        .getState()
        .beginAgentMessageSubmission("test-server", agentId, submittedMessage(clientMessageId));
      let canonicalObserved = false;

      for (const step of ordering) {
        applyStep(step);
        canonicalObserved ||= step === "canonical-row";
        const presentation = selectAgentTurnPresentation(
          useSessionStore.getState().sessions["test-server"],
          agentId,
        );
        if (!canonicalObserved && !presentation.isActive) {
          continuityViolations.push(`${ordering.join(" → ")}: inactive after ${step}`);
        }
      }

      const store = useSessionStore.getState();
      store.acceptAgentMessageSubmission("test-server", agentId, clientMessageId);
      store.setAgentStreamState("test-server", agentId, {
        acknowledgedClientMessageIds: [clientMessageId],
      });
      applyTestTurn("test-server", agentId, [
        { type: "stream_close", turnId: "turn-1" },
        { type: "snapshot", activeTurn: null },
      ]);
      const settled = selectAgentTurnPresentation(
        useSessionStore.getState().sessions["test-server"],
        agentId,
      );
      if (settled.isActive) settlementViolations.push(ordering.join(" → "));
    }

    expect({ continuityViolations, settlementViolations }).toEqual({
      continuityViolations: [],
      settlementViolations: [],
    });
  });

  it("publishes the optimistic row and active presentation in one store notification", () => {
    initializeTestSession();
    const notifications: Array<{ hasOptimisticRow: boolean; isActive: boolean }> = [];
    const unsubscribe = useSessionStore.subscribe((state) => {
      const session = state.sessions["test-server"];
      notifications.push({
        hasOptimisticRow:
          hasSubmittedMessage(session?.agentStreamTail.get(agentId), clientMessageId) === true,
        isActive: selectAgentTurnPresentation(session, agentId).isActive,
      });
    });

    useSessionStore
      .getState()
      .beginAgentMessageSubmission("test-server", agentId, submittedMessage(clientMessageId));
    unsubscribe();

    expect(notifications).toEqual([{ hasOptimisticRow: true, isActive: true }]);
  });

  it("keeps another unacknowledged submission active after one row is acknowledged", () => {
    initializeTestSession();
    const store = useSessionStore.getState();
    store.beginAgentMessageSubmission("test-server", agentId, submittedMessage(clientMessageId));
    store.beginAgentMessageSubmission("test-server", agentId, submittedMessage("client-2"));
    store.acceptAgentMessageSubmission("test-server", agentId, clientMessageId);
    store.setAgentStreamState("test-server", agentId, {
      acknowledgedClientMessageIds: [clientMessageId],
    });

    expect(
      selectAgentTurnPresentation(useSessionStore.getState().sessions["test-server"], agentId)
        .isActive,
    ).toBe(true);
  });

  it("reconciles a created-agent row without creating a submission transaction", () => {
    initializeTestSession();
    const message = submittedMessage(clientMessageId);

    const handedOff = useSessionStore
      .getState()
      .handoffCreatedAgentUserMessage("test-server", agentId, message);

    const session = useSessionStore.getState().sessions["test-server"];
    expect({
      handedOff,
      tail: session?.agentStreamTail.get(agentId),
      head: session?.agentStreamHead.get(agentId) ?? [],
      submissions: session?.messageSubmissions.get(agentId) ?? [],
    }).toEqual({
      handedOff: true,
      tail: [message],
      head: [],
      submissions: [],
    });
  });
});

describe("normalizeWorkspaceDescriptor", () => {
  it("normalizes workspace scripts and invalid activity timestamps", () => {
    const scripts = [
      {
        scriptName: "web",
        type: "service" as const,
        hostname: "web.paseo.localhost",
        port: 3000,
        proxyUrl: "http://web.paseo.localhost:6767",
        lifecycle: "running" as const,
        health: "healthy" as const,
        exitCode: null,
        terminalId: null,
      },
    ];
    const workspace = normalizeWorkspaceDescriptor({
      id: "1",
      projectId: "1",
      projectDisplayName: "Project 1",
      projectRootPath: "/repo",
      workspaceDirectory: "/repo",
      projectKind: "git",
      workspaceKind: "checkout",
      name: "main",
      archivingAt: null,
      status: "running",
      statusEnteredAt: null,
      activityAt: "not-a-date",
      diffStat: null,
      scripts,
    });

    expect(workspace.scripts).toEqual([
      {
        scriptName: "web",
        type: "service",
        hostname: "web.paseo.localhost",
        port: 3000,
        proxyUrl: "http://web.paseo.localhost:6767",
        lifecycle: "running",
        health: "healthy",
        exitCode: null,
        terminalId: null,
      },
    ]);
    expect(workspace.scripts).not.toBe(scripts);
  });

  it("canonicalizes the workspace directory and treats a blank one as empty", () => {
    const canonical = normalizeWorkspaceDescriptor({
      id: "1",
      projectId: "1",
      projectDisplayName: "Project 1",
      projectRootPath: "/repo",
      workspaceDirectory: "/repo/app/",
      projectKind: "git",
      workspaceKind: "checkout",
      name: "main",
      archivingAt: null,
      status: "done",
      statusEnteredAt: null,
      activityAt: null,
      diffStat: null,
      scripts: [],
    });
    expect(canonical.workspaceDirectory).toBe("/repo/app");

    const blank = normalizeWorkspaceDescriptor({
      id: "1",
      projectId: "1",
      projectDisplayName: "Project 1",
      projectRootPath: "/repo",
      workspaceDirectory: "   ",
      projectKind: "git",
      workspaceKind: "checkout",
      name: "main",
      archivingAt: null,
      status: "done",
      statusEnteredAt: null,
      activityAt: null,
      diffStat: null,
      scripts: [],
    });
    expect(blank.workspaceDirectory).toBe("");
  });

  it("defaults missing scripts to an empty array", () => {
    const payload = {
      id: "1",
      projectId: "1",
      projectDisplayName: "Project 1",
      projectRootPath: "/repo",
      workspaceDirectory: "/repo",
      projectKind: "git",
      workspaceKind: "checkout",
      name: "main",
      archivingAt: null,
      status: "done",
      statusEnteredAt: null,
      activityAt: null,
      diffStat: null,
      scripts: [],
    } as WorkspaceDescriptorPayload;

    const workspace = normalizeWorkspaceDescriptor(payload);

    expect(workspace.scripts).toEqual([]);
  });

  it("defaults missing archivingAt to null", () => {
    const payload = {
      id: "1",
      projectId: "1",
      projectDisplayName: "Project 1",
      projectRootPath: "/repo",
      workspaceDirectory: "/repo",
      projectKind: "git",
      workspaceKind: "checkout",
      name: "main",
      status: "done",
      activityAt: null,
      diffStat: null,
      scripts: [],
    } as unknown as WorkspaceDescriptorPayload;

    const workspace = normalizeWorkspaceDescriptor(payload);

    expect(workspace.archivingAt).toBeNull();
  });

  it("normalizes statusEnteredAt strings to Date and missing or null values to null", () => {
    const basePayload = {
      id: "1",
      projectId: "1",
      projectDisplayName: "Project 1",
      projectRootPath: "/repo",
      workspaceDirectory: "/repo",
      projectKind: "git",
      workspaceKind: "checkout",
      name: "main",
      status: "running",
      activityAt: null,
      diffStat: null,
      scripts: [],
    } satisfies Omit<WorkspaceDescriptorPayload, "statusEnteredAt" | "archivingAt">;

    const withString = normalizeWorkspaceDescriptor({
      ...basePayload,
      archivingAt: null,
      statusEnteredAt: "2026-05-12T09:30:00.000Z",
    });
    const withNull = normalizeWorkspaceDescriptor({
      ...basePayload,
      archivingAt: null,
      statusEnteredAt: null,
    });
    const missing = normalizeWorkspaceDescriptor({
      ...basePayload,
      archivingAt: null,
    } as unknown as WorkspaceDescriptorPayload);

    expect(withString.statusEnteredAt).toEqual(new Date("2026-05-12T09:30:00.000Z"));
    expect(withNull.statusEnteredAt).toBeNull();
    expect(missing.statusEnteredAt).toBeNull();
  });

  it("preserves project placement from workspace descriptor payloads", () => {
    const workspace = normalizeWorkspaceDescriptor({
      id: "1",
      projectId: "remote:github.com/acme/app",
      projectDisplayName: "acme/app",
      projectRootPath: "/repo/app",
      workspaceDirectory: "/repo/app",
      projectKind: "git",
      workspaceKind: "local_checkout",
      name: "main",
      archivingAt: null,
      status: "done",
      statusEnteredAt: null,
      activityAt: null,
      diffStat: null,
      scripts: [],
      project: {
        projectKey: "remote:github.com/acme/app",
        projectName: "acme/app",
        checkout: {
          cwd: "/repo/app",
          isGit: true,
          currentBranch: "main",
          remoteUrl: "https://github.com/acme/app.git",
          worktreeRoot: "/repo/app",
          isPaseoOwnedWorktree: false,
          mainRepoRoot: null,
        },
      },
    });

    expect(workspace.project).toEqual({
      projectKey: "remote:github.com/acme/app",
      projectName: "acme/app",
      checkout: {
        cwd: "/repo/app",
        isGit: true,
        currentBranch: "main",
        remoteUrl: "https://github.com/acme/app.git",
        worktreeRoot: "/repo/app",
        isPaseoOwnedWorktree: false,
        mainRepoRoot: null,
      },
    });
  });
});

describe("mergeWorkspaces", () => {
  it("preserves scripts on merged workspace entries", () => {
    const store = useSessionStore.getState();
    store.initializeSession("test-server", null as unknown as DaemonClient);
    store.setWorkspaces(
      "test-server",
      new Map([["/repo/main", createWorkspace({ id: "/repo/main", scripts: [] })]]),
    );

    store.mergeWorkspaces("test-server", [
      createWorkspace({
        id: "/repo/main",
        scripts: [
          {
            scriptName: "web",
            type: "service",
            hostname: "web.paseo.localhost",
            port: 3000,
            proxyUrl: "http://web.paseo.localhost:6767",
            lifecycle: "running",
            health: "healthy",
            exitCode: null,
            terminalId: null,
          },
        ],
      }),
    ]);

    expect(store.getSession("test-server")?.workspaces.get("/repo/main")?.scripts).toEqual([
      {
        scriptName: "web",
        type: "service",
        hostname: "web.paseo.localhost",
        port: 3000,
        proxyUrl: "http://web.paseo.localhost:6767",
        lifecycle: "running",
        health: "healthy",
        exitCode: null,
        terminalId: null,
      },
    ]);
  });

  it("preserves identity when merging content-equal workspace descriptors", () => {
    const store = useSessionStore.getState();
    initializeTestSession();
    const workspace = createWorkspace({ id: "/repo/main" });

    store.mergeWorkspaces("test-server", [workspace]);
    const first = getTestSessionReferences();

    store.mergeWorkspaces("test-server", [{ ...workspace, scripts: [...workspace.scripts] }]);
    const second = getTestSessionReferences();

    expect(second.sessions).toBe(first.sessions);
    expect(second.session).toBe(first.session);
    expect(second.workspaces).toBe(first.workspaces);
    expect(second.workspaces.get("/repo/main")).toBe(first.workspaces.get("/repo/main"));
  });

  it("preserves unaffected workspace entry identity when one workspace changes", () => {
    const store = useSessionStore.getState();
    initializeTestSession();
    const workspaceA = createWorkspace({ id: "/repo/a", name: "main" });
    const workspaceB = createWorkspace({ id: "/repo/b", name: "feature" });

    store.mergeWorkspaces("test-server", [workspaceA, workspaceB]);
    const before = getTestSessionReferences();
    const beforeA = before.workspaces.get("/repo/a");
    const beforeB = before.workspaces.get("/repo/b");

    store.mergeWorkspaces("test-server", [{ ...workspaceA, status: "running" }]);
    const after = getTestSessionReferences();

    expect(after.sessions).not.toBe(before.sessions);
    expect(after.session).not.toBe(before.session);
    expect(after.workspaces).not.toBe(before.workspaces);
    expect(after.workspaces.get("/repo/a")).not.toBe(beforeA);
    expect(after.workspaces.get("/repo/b")).toBe(beforeB);
  });

  it("uses incoming null diff stat as authoritative", () => {
    const store = useSessionStore.getState();
    initializeTestSession();
    const workspace = createWorkspace({
      id: "/repo/main",
      diffStat: { additions: 2, deletions: 1 },
    });
    store.mergeWorkspaces("test-server", [workspace]);
    const before = getTestSessionReferences();

    store.mergeWorkspaces("test-server", [{ ...workspace, diffStat: null }]);
    const after = getTestSessionReferences();

    expect(after.sessions).not.toBe(before.sessions);
    expect(after.session).not.toBe(before.session);
    expect(after.workspaces).not.toBe(before.workspaces);
    expect(after.workspaces.get(workspace.id)?.diffStat).toBeNull();
  });
});

describe("setWorkspaces", () => {
  it("preserves identity when replacing workspaces with content-equal entries", () => {
    const store = useSessionStore.getState();
    initializeTestSession();
    const workspace = createWorkspace({ id: "/repo/main" });
    store.setWorkspaces("test-server", new Map([[workspace.id, workspace]]));
    const before = getTestSessionReferences();

    store.setWorkspaces(
      "test-server",
      new Map([[workspace.id, { ...workspace, scripts: [...workspace.scripts] }]]),
    );
    const after = getTestSessionReferences();

    expect(after.sessions).toBe(before.sessions);
    expect(after.session).toBe(before.session);
    expect(after.workspaces).toBe(before.workspaces);
    expect(after.workspaces.get(workspace.id)).toBe(before.workspaces.get(workspace.id));
  });
});

describe("removeWorkspace", () => {
  it("preserves identity when removing a missing workspace", () => {
    const store = useSessionStore.getState();
    initializeTestSession();
    const workspace = createWorkspace({ id: "/repo/main" });
    store.setWorkspaces("test-server", new Map([[workspace.id, workspace]]));
    const before = getTestSessionReferences();

    store.removeWorkspace("test-server", "/repo/missing");
    const after = getTestSessionReferences();

    expect(after.sessions).toBe(before.sessions);
    expect(after.session).toBe(before.session);
    expect(after.workspaces).toBe(before.workspaces);
  });
});

describe("durable agent queue snapshots", () => {
  const agentId = "agent-1";

  function queueSnapshot(overrides: Partial<AgentQueueSnapshot> = {}): AgentQueueSnapshot {
    return {
      agentId,
      revision: 1,
      items: [
        {
          id: "item-1",
          text: "first",
          intent: "queue",
          deliveryState: "pending",
          attempts: 0,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      ...overrides,
    };
  }

  async function seedOutboxEntry(itemId: string): Promise<void> {
    await useQueueOutboxStore.getState().add({
      serverId: "test-server",
      agentId,
      itemId,
      text: "not acked yet",
      intent: "queue",
      images: [],
      attachments: [],
      composerAttachments: [],
    });
  }

  beforeAll(async () => {
    // Persist rehydration resolves after import and would otherwise replace
    // entries added before it landed.
    await useQueueOutboxStore.persist.rehydrate();
  });

  afterEach(() => {
    for (const itemId of Object.keys(useQueueOutboxStore.getState().entries)) {
      useQueueOutboxStore.getState().remove(itemId);
    }
  });

  it("applies a snapshot as queue rows and records the revision", async () => {
    initializeTestSession();

    await useSessionStore.getState().applyAgentQueueSnapshot("test-server", queueSnapshot());

    const session = useSessionStore.getState().sessions["test-server"];
    expect(session?.queuedMessageRevisions.get(agentId)).toBe(1);
    expect(session?.queuedMessages.get(agentId)).toEqual([
      {
        id: "item-1",
        text: "first",
        attachments: [],
        deliveryState: "pending",
        lastError: undefined,
      },
    ]);
  });

  it("stores snapshot rows only; the un-acked outbox row stays in the outbox store", async () => {
    initializeTestSession();
    await seedOutboxEntry("pending-1");

    await useSessionStore.getState().applyAgentQueueSnapshot("test-server", queueSnapshot());

    // The composer overlays the outbox at render time, so stored rows stay
    // snapshot-only: acknowledging or discarding the entry removes its row
    // without needing another snapshot.
    const rows = useSessionStore.getState().sessions["test-server"]?.queuedMessages.get(agentId);
    expect(rows?.map((row) => row.id)).toEqual(["item-1"]);
    expect(useQueueOutboxStore.getState().entries["pending-1"]?.itemId).toBe("pending-1");
    expect(
      useSessionStore.getState().sessions["test-server"]?.acceptedQueueMessageIds.get(agentId),
    ).toEqual(new Set(["item-1"]));
  });

  it("keeps a parked outbox entry out of stored rows and out of the accepted set", async () => {
    initializeTestSession();
    await seedOutboxEntry("pending-1");
    useQueueOutboxStore.getState().bumpAttempts("pending-1");
    useQueueOutboxStore.getState().markFailed("pending-1");

    await useSessionStore.getState().applyAgentQueueSnapshot("test-server", queueSnapshot());

    const rows = useSessionStore.getState().sessions["test-server"]?.queuedMessages.get(agentId);
    expect(rows?.map((row) => row.id)).toEqual(["item-1"]);
    expect(useQueueOutboxStore.getState().entries["pending-1"]?.failedAt).toBeDefined();
  });

  it("drops a snapshot that is older than the applied revision", async () => {
    initializeTestSession();

    await useSessionStore
      .getState()
      .applyAgentQueueSnapshot("test-server", queueSnapshot({ revision: 4 }));
    await useSessionStore
      .getState()
      .applyAgentQueueSnapshot("test-server", queueSnapshot({ revision: 3 }));

    const session = useSessionStore.getState().sessions["test-server"];
    expect(session?.queuedMessageRevisions.get(agentId)).toBe(4);
    expect(session?.queuedMessages.get(agentId)?.[0]?.id).toBe("item-1");
  });

  it("never creates a submitted timeline row: snapshots only touch the queue", async () => {
    initializeTestSession();

    await useSessionStore.getState().applyAgentQueueSnapshot("test-server", queueSnapshot());

    const timeline = selectAgentTimelineState(
      useSessionStore.getState().sessions["test-server"],
      agentId,
    );
    expect(timeline.status).toBe("cold");
    expect(
      useSessionStore.getState().sessions["test-server"]?.agentStreamTail.get(agentId),
    ).toBeUndefined();
  });

  it("is a no-op without a session, leaving local queues to their own meaning", async () => {
    await useSessionStore.getState().applyAgentQueueSnapshot("test-server", queueSnapshot());

    expect(useSessionStore.getState().sessions["test-server"]).toBeUndefined();
    expect(Object.keys(useQueueOutboxStore.getState().entries).length).toBe(0);
  });
});

// The storage stub is the outbox store's live backing store in this suite; the
// acknowledgement-failure tests patch it for the duration of one apply.

/**
 * Patches the outbox store's own persist storage — whichever backing module the
 * graph resolved — so failure/hang injection is graph-independent.
 */
function patchOutboxPersistStorage(
  wrapped: (name: string, value: unknown) => Promise<void>,
): () => void {
  const original = outboxPersistedStorage.setItem.bind(outboxPersistedStorage);
  outboxPersistedStorage.setItem = (name, value) => wrapped(name, value);
  return () => {
    outboxPersistedStorage.setItem = original;
  };
}

function outboxWriteThrough(): (name: string, value: unknown) => Promise<void> {
  return (name, value) =>
    Promise.resolve(outboxPersistedStorage.setItem(name, value as never)).then(() => undefined);
}

describe("durable agent queue snapshot concurrency", () => {
  const agentId = "agent-1";

  function queueSnapshotRevision(revision: number, itemId: string): AgentQueueSnapshot {
    return {
      agentId,
      revision,
      items: [
        {
          id: itemId,
          text: `text for ${itemId}`,
          intent: "queue",
          deliveryState: "pending",
          attempts: 0,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
  }

  it("re-applies an equal-revision snapshot to reconcile against the live outbox", async () => {
    initializeTestSession();
    await useQueueOutboxStore.getState().add({
      serverId: "test-server",
      agentId,
      itemId: "pending-1",
      text: "not acked yet",
      intent: "queue",
      images: [],
      attachments: [],
      composerAttachments: [],
    });

    await useSessionStore
      .getState()
      .applyAgentQueueSnapshot("test-server", queueSnapshotRevision(1, "item-1"));

    // Simulate drift (a raced broadcast), then prove the equal revision still
    // re-applies: the accepted set is recomputed from the snapshot.
    const session = useSessionStore.getState().sessions["test-server"];
    useSessionStore.setState((prev) => ({
      sessions: {
        ...prev.sessions,
        "test-server": {
          ...prev.sessions["test-server"],
          acceptedQueueMessageIds: new Map([[agentId, new Set<string>()]]),
        },
      },
    }));

    await useSessionStore
      .getState()
      .applyAgentQueueSnapshot("test-server", queueSnapshotRevision(1, "item-1"));

    expect(
      useSessionStore.getState().sessions["test-server"]?.acceptedQueueMessageIds.get(agentId),
    ).toEqual(new Set(["item-1"]));
    expect(
      useSessionStore.getState().sessions["test-server"]?.queuedMessageRevisions.get(agentId),
    ).toBe(1);
    void session;
  });

  it("an older snapshot completing after a newer revision does not overwrite rows", async () => {
    initializeTestSession();
    await useQueueOutboxStore.getState().add({
      serverId: "test-server",
      agentId,
      itemId: "item-1",
      text: "acked by the older snapshot",
      intent: "queue",
      images: [],
      attachments: [],
      composerAttachments: [],
    });

    let hangEntered = false;
    const releaseRef: { current: (() => void) | null } = { current: null };
    const through = outboxWriteThrough();
    const restoreStorage = patchOutboxPersistStorage((name, value) => {
      hangEntered = true;
      return new Promise<void>((resolve) => {
        releaseRef.current = () => {
          void through(name, value as never);
          resolve();
        };
      });
    });

    try {
      const olderApply = useSessionStore
        .getState()
        .applyAgentQueueSnapshot("test-server", queueSnapshotRevision(3, "item-1"));
      await vi.waitFor(() => expect(hangEntered).toBe(true));

      await useSessionStore
        .getState()
        .applyAgentQueueSnapshot("test-server", queueSnapshotRevision(5, "newer"));

      releaseRef.current?.();
      await olderApply;

      const session = useSessionStore.getState().sessions["test-server"];
      expect(session?.queuedMessageRevisions.get(agentId)).toBe(5);
      expect(session?.queuedMessages.get(agentId)?.map((row) => row.id)).toEqual(["newer"]);
    } finally {
      releaseRef.current?.();
      restoreStorage();
      useQueueOutboxStore.getState().clearStorageError();
    }
  });

  it("a failed acknowledgement skips the apply per item and reports the storage error", async () => {
    initializeTestSession();
    await useSessionStore
      .getState()
      .applyAgentQueueSnapshot("test-server", queueSnapshotRevision(1, "item-1"));

    await useQueueOutboxStore.getState().add({
      serverId: "test-server",
      agentId,
      itemId: "acked-1",
      text: "first acked",
      intent: "queue",
      images: [],
      attachments: [],
      composerAttachments: [],
    });
    await useQueueOutboxStore.getState().add({
      serverId: "test-server",
      agentId,
      itemId: "acked-2",
      text: "second acked",
      intent: "queue",
      images: [],
      attachments: [],
      composerAttachments: [],
    });

    let failuresLeft = 1;
    const through = outboxWriteThrough();
    const restoreStorage = patchOutboxPersistStorage((name, value) => {
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        return Promise.reject(new Error("Simulated storage failure"));
      }
      return through(name, value as never);
    });

    try {
      await useSessionStore.getState().applyAgentQueueSnapshot("test-server", {
        agentId,
        revision: 2,
        items: [
          {
            id: "acked-1",
            text: "first acked",
            intent: "queue",
            deliveryState: "pending",
            attempts: 0,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "acked-2",
            text: "second acked",
            intent: "queue",
            deliveryState: "pending",
            attempts: 0,
            createdAt: "2026-01-01T00:00:01.000Z",
          },
        ],
      });

      // Apply skipped: nothing newer stored...
      const session = useSessionStore.getState().sessions["test-server"];
      expect(session?.queuedMessageRevisions.get(agentId)).toBe(1);

      // ...but the removals are per-item durable: acked-1's write failed (its
      // entry was restored), acked-2's succeeded (its entry is gone). The
      // second removal settles after the rejected Promise.all, so wait it out.
      await vi.waitFor(() =>
        expect(useQueueOutboxStore.getState().entries["acked-2"]).toBeUndefined(),
      );
      const entries = useQueueOutboxStore.getState().entries;
      expect(entries["acked-1"]?.itemId).toBe("acked-1");
      expect(useQueueOutboxStore.getState().storageError).not.toBeNull();
    } finally {
      restoreStorage();
      for (const itemId of ["acked-1", "acked-2"]) {
        useQueueOutboxStore.getState().remove(itemId);
      }
      useQueueOutboxStore.getState().clearStorageError();
    }
  });
});
