import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

// goHistory takes its deps by injection; these mocks only keep the default-deps module graph
// (expo-router, the persisted layout store) from loading native code under vitest.
vi.mock("expo-router", () => ({
  router: { navigate: vi.fn(), push: vi.fn(), replace: vi.fn(), dismissTo: vi.fn() },
}));
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

import type { HistoryEntry } from "./model";
import { goHistory, type HistoryReplayDeps } from "./replay";
import { createNavigationHistoryStore } from "./store";

const ws = (
  workspaceId: string,
  tabId: string | null,
  target: Extract<HistoryEntry, { kind: "workspace" }>["target"] = null,
): HistoryEntry => ({ kind: "workspace", serverId: "srv", workspaceId, tabId, target });

const route = (path: string): HistoryEntry => ({ kind: "route", path });

function createFakeDeps(overrides: Partial<HistoryReplayDeps> = {}) {
  const calls: string[] = [];
  const deps: HistoryReplayDeps = {
    navigateToWorkspace: (input) =>
      calls.push(`navigate:${input.workspaceId}:${input.target ? input.target.kind : "no-target"}`),
    focusTab: (workspaceKey, tabId) => calls.push(`focus:${workspaceKey}:${tabId}`),
    getFocusedTabId: () => "files",
    navigateToRoute: (path) => calls.push(`route:${path}`),
    workspaceExists: () => true,
    tabExists: () => true,
    agentExists: () => true,
    ...overrides,
  };
  return { deps, calls };
}

function storeWith(entries: HistoryEntry[], index = entries.length - 1) {
  const store = createNavigationHistoryStore();
  for (const entry of entries) {
    store.record(entry);
  }
  store.setIndex(index);
  return store;
}

describe("goHistory", () => {
  it("returns false at the ends without navigating", () => {
    const { deps, calls } = createFakeDeps();
    const store = storeWith([ws("a", "t1")]);

    expect(goHistory(-1, store, deps)).toBe(false);
    expect(goHistory(1, store, deps)).toBe(false);
    expect(calls).toEqual([]);
    expect(store.getState().index).toBe(0);
  });

  it("moves the index before navigating, then navigates with the target and focuses the exact tab", () => {
    const observedIndexAtNavigate: number[] = [];
    const store = storeWith([ws("a", "tab_dup", { kind: "agent", agentId: "ag" }), ws("b", "t2")]);
    const { deps, calls } = createFakeDeps({
      navigateToWorkspace: (input) => {
        observedIndexAtNavigate.push(store.getState().index);
        calls.push(`navigate:${input.workspaceId}:${input.target?.kind ?? "no-target"}`);
      },
    });

    expect(goHistory(-1, store, deps)).toBe(true);

    expect(observedIndexAtNavigate).toEqual([0]);
    expect(calls).toEqual(["navigate:a:agent", "focus:srv:a:tab_dup"]);
  });

  it("navigates without a target when the entry has none, and does not focus", () => {
    const store = storeWith([ws("a", null), ws("b", "t2")]);
    const { deps, calls } = createFakeDeps({ tabExists: () => false });

    expect(goHistory(-1, store, deps)).toBe(true);

    expect(calls).toEqual(["navigate:a:no-target"]);
  });

  it("re-opens a closed tab through its target and rewrites the entry to the deterministic id", () => {
    const store = storeWith([ws("a", "tab_random", { kind: "files" }), ws("b", "t2")]);
    const { deps, calls } = createFakeDeps({ tabExists: () => false });

    expect(goHistory(-1, store, deps)).toBe(true);

    expect(calls).toEqual(["navigate:a:files"]);
    expect(store.getState().entries[0]).toEqual(ws("a", "files", { kind: "files" }));
    expect(store.getState().index).toBe(0);
  });

  it("keeps Forward when reveal focuses a duplicate tab with the same target", () => {
    const store = storeWith([
      ws("a", "closed-agent-tab", { kind: "agent", agentId: "ag" }),
      route("/settings/general"),
    ]);
    const { deps, calls } = createFakeDeps({
      tabExists: () => false,
      getFocusedTabId: () => "other-agent-tab",
    });

    expect(goHistory(-1, store, deps)).toBe(true);
    expect(calls).toEqual(["navigate:a:agent"]);
    expect(store.getState().entries[0]).toEqual(
      ws("a", "other-agent-tab", { kind: "agent", agentId: "ag" }),
    );
    expect(store.getState().entries[1]).toEqual(route("/settings/general"));
    expect(goHistory(1, store, deps)).toBe(true);
    expect(calls).toEqual(["navigate:a:agent", "route:/settings/general"]);
  });

  it("skips closed transient tabs and lands on archived workspace recovery", () => {
    const store = storeWith([
      ws("alive", "t0"),
      ws("archived", "t1"),
      ws("closed-terminal", "gone", { kind: "terminal", terminalId: "term" }),
      ws("current", "t3"),
    ]);
    const { deps, calls } = createFakeDeps({
      workspaceExists: (_serverId, workspaceId) => workspaceId !== "archived",
      tabExists: (_key, tabId) => tabId !== "gone",
    });

    expect(goHistory(-1, store, deps)).toBe(true);

    expect(store.getState().index).toBe(1);
    expect(calls).toEqual(["navigate:archived:no-target"]);
  });

  it("routes an absent workspace without changing archive state", () => {
    const store = storeWith([ws("archived", "t1"), ws("current", "t3")]);
    const { deps, calls } = createFakeDeps({ workspaceExists: () => false });

    expect(goHistory(-1, store, deps)).toBe(true);
    expect(calls).toEqual(["navigate:archived:no-target"]);
    expect(store.getState().index).toBe(0);
  });

  it("replays route entries through navigateToRoute", () => {
    const store = storeWith([ws("a", "t1"), route("/settings/general")], 0);
    const { deps, calls } = createFakeDeps();

    expect(goHistory(1, store, deps)).toBe(true);

    expect(calls).toEqual(["route:/settings/general"]);
    expect(store.getState().index).toBe(1);
  });

  it("walks forward and back symmetrically", () => {
    const store = storeWith([ws("a", "t1"), ws("b", "t2"), ws("c", "t3")]);
    const { deps } = createFakeDeps();

    goHistory(-1, store, deps);
    goHistory(-1, store, deps);
    expect(store.getState().index).toBe(0);
    goHistory(1, store, deps);
    expect(store.getState().index).toBe(1);
    goHistory(1, store, deps);
    expect(store.getState().index).toBe(2);
    expect(goHistory(1, store, deps)).toBe(false);
  });

  it("uses a fresh spy to prove focus follows navigate in call order", () => {
    const order = vi.fn<(step: string) => void>();
    const store = storeWith([ws("a", "t1", { kind: "files" }), ws("b", "t2")]);
    const { deps } = createFakeDeps({
      navigateToWorkspace: () => order("navigate"),
      focusTab: () => order("focus"),
    });

    goHistory(-1, store, deps);

    expect(order.mock.calls.map(([step]) => step)).toEqual(["navigate", "focus"]);
  });
});
