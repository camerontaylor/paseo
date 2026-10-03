import { beforeEach, describe, expect, it, vi } from "vitest";

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
      ["agent_agent-1", alphaAgent.scope],
      ["agent_agent-2", betaAgent.scope],
    ]);
    expect(findPaneContainingTab(view.layout.root, "agent_agent-1")?.id).not.toBe(
      findPaneContainingTab(view.layout.root, "agent_agent-2")?.id,
    );
  });

  it("opens a tab into a chosen pane and into a new split", () => {
    const store = useViewsStore.getState();
    const viewId = store.createView({ tabs: [alphaAgent] });
    const firstPaneId = getView(viewId).layout.focusedPaneId;

    store.openTab(viewId, { ...alphaTerminal, paneId: firstPaneId });
    expect(findPaneContainingTab(getView(viewId).layout.root, "terminal_term-1")?.id).toBe(
      firstPaneId,
    );

    const tabId = store.openTabInNewSplit(viewId, { ...betaAgent, position: "bottom" });
    expect(tabId).toBe("agent_agent-2");
    const view = getView(viewId);
    expect(collectAllPanes(view.layout.root)).toHaveLength(2);
    expect(view.scopeByTabId["agent_agent-2"]).toEqual(betaAgent.scope);
  });

  it("forgets a closed tab's scope without touching the session", () => {
    const store = useViewsStore.getState();
    const viewId = store.createView({ tabs: [alphaAgent, betaAgent] });
    store.closeTab(viewId, "agent_agent-2");
    const view = getView(viewId);
    expect(view.scopeByTabId).toEqual({ "agent_agent-1": alphaAgent.scope });
    expect(collectViewTabs(view).map((tab) => tab.tabId)).toEqual(["agent_agent-1"]);
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
    useViewsStore.getState().closeTab(viewId, "agent_agent-1");
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
      paneId: findPaneContainingTab(getView(viewId).layout.root, "agent_agent-1")?.id,
    });
    const view = getView(viewId);
    const visible = selectViewVisibleAgentIds(view.layout, collectViewTabs(view));
    // The alpha pane now shows its terminal, so only beta's agent is on screen.
    expect([...visible]).toEqual([["host-b", ["agent-2"]]]);
  });
});
