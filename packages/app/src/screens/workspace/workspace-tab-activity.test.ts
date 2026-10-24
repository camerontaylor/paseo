import { describe, expect, it } from "vitest";
import { reconcileTabActivity } from "./workspace-tab-activity";
import type { WorkspaceTabDescriptor } from "./workspace-tabs-types";

describe("scoped view tab activity", () => {
  it("keeps same agent id on different hosts independent", () => {
    const tabs = ["host-a", "host-b"].map(
      (serverId) =>
        ({
          key: serverId,
          tabId: serverId,
          kind: "agent",
          target: { kind: "agent", agentId: "same-id" },
          scope: { serverId, workspaceId: "work" },
        }) as WorkspaceTabDescriptor,
    );
    const first = reconcileTabActivity(
      new Map(),
      tabs,
      new Map(),
      new Set(["host-a"]),
      new Map([
        ["host-a", 10],
        ["host-b", 10],
      ]),
    );
    const next = reconcileTabActivity(
      first,
      tabs,
      new Map(),
      new Set(["host-a"]),
      new Map([
        ["host-a", 20],
        ["host-b", 10],
      ]),
    );
    expect(next.get("host-a")?.unread).toBe(false);
    expect(next.get("host-b")?.unread).toBe(false);
    const afterOtherHost = reconcileTabActivity(
      next,
      tabs,
      new Map(),
      new Set(["host-a"]),
      new Map([
        ["host-a", 20],
        ["host-b", 30],
      ]),
    );
    expect(afterOtherHost.get("host-a")?.unread).toBe(false);
    expect(afterOtherHost.get("host-b")?.unread).toBe(true);
  });
});
