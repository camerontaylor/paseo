import { describe, expect, it } from "vitest";
import type { WorkspaceTab } from "@/workspace-tabs/model";
import { collectBroadcastTargets, planBroadcast } from "@/views/broadcast-plan";

function tab(tabId: string, target: WorkspaceTab["target"], serverId = "host-a"): WorkspaceTab {
  return { tabId, target, createdAt: 0, scope: { serverId, workspaceId: "ws" } };
}

describe("broadcast planning", () => {
  it("targets each distinct agent once and ignores terminals", () => {
    const targets = collectBroadcastTargets([
      tab("agent_1", { kind: "agent", agentId: "1" }),
      tab("terminal_t", { kind: "terminal", terminalId: "t" }),
      tab("agent_1-dup", { kind: "agent", agentId: "1" }),
      tab("agent_1-b", { kind: "agent", agentId: "1" }, "host-b"),
    ]);
    expect(targets).toEqual([
      { serverId: "host-a", agentId: "1" },
      { serverId: "host-b", agentId: "1" },
    ]);
  });

  it("sends to idle agents, queues for busy ones, and skips what it cannot reach", () => {
    const plan = planBroadcast(
      [
        { serverId: "a", agentId: "idle" },
        { serverId: "a", agentId: "busy" },
        { serverId: "legacy", agentId: "busy" },
        { serverId: "offline", agentId: "idle" },
      ],
      {
        isConnected: (serverId) => serverId !== "offline",
        isBusy: (target) => target.agentId === "busy",
        supportsQueue: (serverId) => serverId === "a",
      },
    );
    expect(plan.map((entry) => `${entry.serverId}/${entry.agentId}:${entry.delivery}`)).toEqual([
      "a/idle:send",
      "a/busy:queue",
      "legacy/busy:skip",
      "offline/idle:skip",
    ]);
  });
});
