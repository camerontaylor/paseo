import { beforeEach, describe, expect, it, vi } from "vitest";
import AsyncStorage from "@react-native-async-storage/async-storage";

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

import { collectAllPanes, findPaneContainingTab } from "@/stores/workspace-layout-actions";
import {
  collectViewTabs,
  nextViewName,
  observeViewAgentIds,
  useViewsStore,
  type ViewTabInput,
} from "@/stores/views-store";
import { selectViewVisibleAgentIds } from "@/views/view-visible-agents";

const alphaAgent: ViewTabInput = {
  scope: { serverId: "host-a", workspaceId: "ws-alpha" },
  target: { kind: "agent", agentId: "agent-1" },
};
const betaAgent: ViewTabInput = {
  scope: { serverId: "host-b", workspaceId: "ws-beta" },
  target: { kind: "agent", agentId: "agent-2" },
};
const alphaTerminal: ViewTabInput = {
  scope: { serverId: "host-a", workspaceId: "ws-alpha" },
  target: { kind: "terminal", terminalId: "term-1" },
};

function getView(viewId: string) {
  const view = useViewsStore.getState().views[viewId];
  if (!view) throw new Error(`missing view ${viewId}`);
  return view;
}

describe("views store", () => {
  beforeEach(() => {
    useViewsStore.setState({ views: {}, order: [] });
  });

  it("creates an empty view with a generated name", () => {
    const viewId = useViewsStore.getState().createView();
    const view = getView(viewId);
    expect(view.name).toBe("View 1");
    expect(collectViewTabs(view)).toEqual([]);
    expect(useViewsStore.getState().order).toEqual([viewId]);
    expect(nextViewName(useViewsStore.getState().views)).toBe("View 2");
  });

  it("places sessions from different workspaces and hosts side by side", () => {
    const viewId = useViewsStore.getState().createView({ tabs: [alphaAgent, betaAgent] });
    const view = getView(viewId);
    const panes = collectAllPanes(view.layout.root);
    expect(panes).toHaveLength(2);

    const tabs = collectViewTabs(view);
    expect(tabs.map((tab) => [tab.tabId, tab.scope])).toEqual([
      ["view:host-a:ws-alpha:agent:agent-1", alphaAgent.scope],
      ["view:host-b:ws-beta:agent:agent-2", betaAgent.scope],
    ]);
    expect(
      findPaneContainingTab(view.layout.root, "view:host-a:ws-alpha:agent:agent-1")?.id,
    ).not.toBe(findPaneContainingTab(view.layout.root, "view:host-b:ws-beta:agent:agent-2")?.id);
  });

  it("keeps equal session ids on separate hosts and deduplicates only within a scope", () => {
    const store = useViewsStore.getState();
    const secondHost = {
      scope: { serverId: "host-b", workspaceId: "ws-beta" },
      target: { kind: "agent" as const, agentId: "agent-1" },
    };
    const viewId = store.createView({ tabs: [alphaAgent, secondHost] });
    const initial = collectViewTabs(getView(viewId));
    expect(initial).toHaveLength(2);
    expect(initial.map((tab) => tab.scope?.serverId)).toEqual(["host-a", "host-b"]);
    expect(new Set(initial.map((tab) => tab.tabId)).size).toBe(2);

    expect(store.openTab(viewId, secondHost)).toBe(initial[1]?.tabId);
    expect(collectViewTabs(getView(viewId))).toHaveLength(2);
    store.closeTab(viewId, initial[0]!.tabId);
    expect(collectViewTabs(getView(viewId)).map((tab) => tab.scope?.serverId)).toEqual(["host-b"]);
  });

  it("keeps equal terminal ids on separate hosts with scoped focus and close", () => {
    const store = useViewsStore.getState();
    const otherHost: ViewTabInput = {
      scope: { serverId: "host-b", workspaceId: "ws-beta" },
      target: { kind: "terminal", terminalId: "term-1" },
    };
    const viewId = store.createView({ tabs: [alphaTerminal, otherHost] });
    const tabs = collectViewTabs(getView(viewId));
    expect(tabs).toHaveLength(2);
    expect(tabs.map((tab) => tab.scope?.serverId)).toEqual(["host-a", "host-b"]);
    store.focusTab(viewId, tabs[1]!.tabId);
    expect(getView(viewId).layout.focusedPaneId).toBe(
      findPaneContainingTab(getView(viewId).layout.root, tabs[1]!.tabId)?.id,
    );
    store.closeTab(viewId, tabs[1]!.tabId);
    expect(collectViewTabs(getView(viewId)).map((tab) => tab.scope?.serverId)).toEqual(["host-a"]);
  });

  it("opens a tab into a chosen pane and into a new split", () => {
    const store = useViewsStore.getState();
    const viewId = store.createView({ tabs: [alphaAgent] });
    const firstPaneId = getView(viewId).layout.focusedPaneId;

    store.openTab(viewId, { ...alphaTerminal, paneId: firstPaneId });
    expect(
      findPaneContainingTab(getView(viewId).layout.root, "view:host-a:ws-alpha:terminal:term-1")
        ?.id,
    ).toBe(firstPaneId);

    const tabId = store.openTabInNewSplit(viewId, { ...betaAgent, position: "bottom" });
    expect(tabId).toBe("view:host-b:ws-beta:agent:agent-2");
    const view = getView(viewId);
    expect(collectAllPanes(view.layout.root)).toHaveLength(2);
    expect(view.scopeByTabId["view:host-b:ws-beta:agent:agent-2"]).toEqual(betaAgent.scope);
  });

  it("forgets a closed tab's scope without touching the session", () => {
    const store = useViewsStore.getState();
    const viewId = store.createView({ tabs: [alphaAgent, betaAgent] });
    store.closeTab(viewId, "view:host-b:ws-beta:agent:agent-2");
    const view = getView(viewId);
    expect(view.scopeByTabId).toEqual({ "view:host-a:ws-alpha:agent:agent-1": alphaAgent.scope });
    expect(collectViewTabs(view).map((tab) => tab.tabId)).toEqual([
      "view:host-a:ws-alpha:agent:agent-1",
    ]);
  });

  it("retains a View created while persisted state is still hydrating", async () => {
    const persistedId = useViewsStore.getState().createView({ name: "Saved" });
    const persisted = {
      state: {
        views: { [persistedId]: getView(persistedId) },
        order: [persistedId],
      },
      version: 1,
    };
    useViewsStore.setState({ views: {}, order: [] });

    let finishRead!: (value: string | null) => void;
    const read = new Promise<string | null>((resolve) => {
      finishRead = resolve;
    });
    vi.spyOn(AsyncStorage, "getItem").mockImplementationOnce(async () => read);
    const hydration = useViewsStore.persist.rehydrate();
    const localId = useViewsStore.getState().createView({ name: "New" });
    finishRead(JSON.stringify(persisted));
    await hydration;

    expect(useViewsStore.getState().order).toContain(persistedId);
    expect(useViewsStore.getState().order).toContain(localId);
    expect(getView(localId).name).toBe("New");
    vi.restoreAllMocks();
  });

  it("renames and deletes views", () => {
    const store = useViewsStore.getState();
    const viewId = store.createView({ name: "Pairing" });
    store.renameView(viewId, "  Review  ");
    expect(getView(viewId).name).toBe("Review");
    store.renameView(viewId, "   ");
    expect(getView(viewId).name).toBe("Review");
    store.deleteView(viewId);
    expect(useViewsStore.getState().views).toEqual({});
    expect(useViewsStore.getState().order).toEqual([]);
  });

  it("reports agents shown in views per host", () => {
    const seen: string[][] = [];
    const stop = observeViewAgentIds("host-a", (ids) => seen.push(ids));
    const viewId = useViewsStore.getState().createView({ tabs: [alphaAgent, betaAgent] });
    useViewsStore.getState().openTab(viewId, alphaTerminal);
    useViewsStore.getState().closeTab(viewId, "view:host-a:ws-alpha:agent:agent-1");
    stop();
    expect(seen).toEqual([[], ["agent-1"], []]);
  });
});

describe("view timeline visibility", () => {
  beforeEach(() => {
    useViewsStore.setState({ views: {}, order: [] });
  });

  it("reports each pane's active agent grouped by host", () => {
    const viewId = useViewsStore.getState().createView({ tabs: [alphaAgent, betaAgent] });
    useViewsStore.getState().openTab(viewId, {
      ...alphaTerminal,
      paneId: findPaneContainingTab(
        getView(viewId).layout.root,
        "view:host-a:ws-alpha:agent:agent-1",
      )?.id,
    });
    const view = getView(viewId);
    const visible = selectViewVisibleAgentIds(view.layout, collectViewTabs(view));
    // The alpha pane now shows its terminal, so only beta's agent is on screen.
    expect([...visible]).toEqual([["host-b", ["agent-2"]]]);
  });
});
