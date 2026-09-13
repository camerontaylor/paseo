import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

import { DEFAULT_APP_SETTINGS } from "@/hooks/use-settings";
import { usePanelStore } from "@/stores/panel-store";
import {
  collectAllPanes,
  findPaneById,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { openPreferredWorkspaceTarget } from "@/workspace-tabs/open-beside";

const WORKSPACE_KEY = "server-1:workspace-1";
const SIDE_CONVERSATION = {
  kind: "side_conversation",
  parentAgentId: "parent-1",
  threadId: "thread-1",
} as const;

function layout() {
  const value = useWorkspaceLayoutStore.getState().layoutByWorkspace[WORKSPACE_KEY];
  if (!value) throw new Error("workspace layout missing");
  return value;
}

function paneIdHolding(tabId: string): string | undefined {
  return collectAllPanes(layout().root).find((pane) => pane.tabIds.includes(tabId))?.id;
}

function sidePaneId(): string | null {
  return useWorkspaceLayoutStore.getState().sidePaneIdByWorkspace[WORKSPACE_KEY] ?? null;
}

beforeEach(() => {
  usePanelStore.setState({
    mobilePanel: { target: "agent", revision: 0 },
    explorerTab: "files",
    explorerTabByCheckout: {},
  });
  useWorkspaceLayoutStore.setState({
    layoutByWorkspace: {},
    explorerSidebarPaneIdByWorkspace: {},
    sidePaneIdByWorkspace: {},
    splitSizesByWorkspace: {},
  });
});

// Side conversations route on the `subagents` preference rather than one of their own — these
// pin that decision, and stand in for the coverage lost when side-panel.test.ts was deleted.
describe("openPreferredWorkspaceTarget for a side conversation", () => {
  it("opens in the single compact pane, never a second one", () => {
    const tabId = openPreferredWorkspaceTarget({
      isCompact: true,
      workspaceKey: WORKSPACE_KEY,
      target: SIDE_CONVERSATION,
      source: "subagents",
      preferences: { ...DEFAULT_APP_SETTINGS.openInSidePane, subagents: true },
    });

    expect(tabId).not.toBeNull();
    expect(collectAllPanes(layout().root)).toHaveLength(1);
    expect(paneIdHolding(tabId as string)).toBe(layout().focusedPaneId);
  });

  it("opens in the side pane when the subagents preference is on", () => {
    const tabId = openPreferredWorkspaceTarget({
      isCompact: false,
      workspaceKey: WORKSPACE_KEY,
      target: SIDE_CONVERSATION,
      source: "subagents",
      preferences: { ...DEFAULT_APP_SETTINGS.openInSidePane, subagents: true },
    });

    expect(tabId).not.toBeNull();
    expect(paneIdHolding(tabId as string)).toBe(sidePaneId());
    expect(findPaneById(layout().root, sidePaneId())).not.toBeNull();
  });

  it("opens in the focused pane when the subagents preference is off", () => {
    const tabId = openPreferredWorkspaceTarget({
      isCompact: false,
      workspaceKey: WORKSPACE_KEY,
      target: SIDE_CONVERSATION,
      source: "subagents",
      preferences: { ...DEFAULT_APP_SETTINGS.openInSidePane, subagents: false },
    });

    expect(tabId).not.toBeNull();
    expect(paneIdHolding(tabId as string)).toBe(layout().focusedPaneId);
    expect(sidePaneId()).toBeNull();
  });
});
