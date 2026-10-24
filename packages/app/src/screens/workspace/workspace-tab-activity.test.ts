import { describe, expect, it } from "vitest";
import type { WorkspaceTabDescriptor } from "./workspace-tabs-types";
import { reconcileTabActivity, sortTabsByActivity } from "./workspace-tab-activity";

function agentTab(id: string): WorkspaceTabDescriptor {
  return { key: id, tabId: id, kind: "agent", target: { kind: "agent", agentId: id } };
}

const tabs = [agentTab("a"), agentTab("b"), agentTab("c")];

describe("workspace tab activity", () => {
  it("marks only background activity unread and clears it on visit", () => {
    const baseline = reconcileTabActivity(
      new Map(),
      tabs,
      new Map([
        ["a", 10],
        ["b", 10],
      ]),
      new Set(["a"]),
    );
    expect([...baseline.values()].map((state) => state.unread)).toEqual([false, false, false]);

    const changed = reconcileTabActivity(
      baseline,
      tabs,
      new Map([
        ["a", 20],
        ["b", 20],
      ]),
      new Set(["a"]),
    );
    expect(changed.get("a")?.unread).toBe(false);
    expect(changed.get("b")?.unread).toBe(true);

    const visited = reconcileTabActivity(
      changed,
      tabs,
      new Map([
        ["a", 20],
        ["b", 20],
      ]),
      new Set(["b"]),
    );
    expect(visited.get("b")?.unread).toBe(false);
    expect(
      reconcileTabActivity(visited, tabs, new Map([["b", 20]]), new Set(["a"])).get("b")?.unread,
    ).toBe(false);
  });

  it("keeps equal agent IDs in different hosts independent by tab", () => {
    const duplicateTabs: WorkspaceTabDescriptor[] = [
      { ...agentTab("left"), target: { kind: "agent", agentId: "shared" } },
      { ...agentTab("right"), target: { kind: "agent", agentId: "shared" } },
    ];
    const before = reconcileTabActivity(
      new Map(),
      duplicateTabs,
      new Map([["shared", 10]]),
      new Set(["left"]),
      new Map([
        ["left", 10],
        ["right", 10],
      ]),
    );
    const changed = reconcileTabActivity(
      before,
      duplicateTabs,
      new Map([["shared", 20]]),
      new Set(["left"]),
      new Map([
        ["left", 10],
        ["right", 20],
      ]),
    );
    expect(changed.get("left")?.unread).toBe(false);
    expect(changed.get("right")?.unread).toBe(true);
    expect(
      sortTabsByActivity(
        duplicateTabs.map((tab) => ({ tab })),
        new Map(),
        new Map([
          ["left", 10],
          ["right", 20],
        ]),
      ).map(({ tab }) => tab.tabId),
    ).toEqual(["right", "left"]);
  });

  it("orders recent agent tabs first and preserves ties and missing timestamps", () => {
    const items = tabs.map((tab) => ({ tab }));
    expect(
      sortTabsByActivity(
        items,
        new Map([
          ["b", 20],
          ["c", 20],
          ["a", 10],
        ]),
      ).map(({ tab }) => tab.tabId),
    ).toEqual(["b", "c", "a"]);
    expect(sortTabsByActivity(items, new Map()).map(({ tab }) => tab.tabId)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("scoped view tab activity", () => {
  it("keeps same agent id on different hosts independent", () => {
    const scopedTabs = ["host-a", "host-b"].map(
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
      scopedTabs,
      new Map(),
      new Set(["host-a"]),
      new Map([
        ["host-a", 10],
        ["host-b", 10],
      ]),
    );
    const next = reconcileTabActivity(
      first,
      scopedTabs,
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
      scopedTabs,
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
