import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

import { DEFAULT_APP_SETTINGS } from "@/hooks/use-settings";
import { setPanelInstanceAttributes } from "@/panels/panel-instance-attributes";
import { usePanelStore } from "@/stores/panel-store";
import {
  collectAllPanes,
  collectAllTabs,
  findPaneById,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import {
  openPreferredWorkspacePreview,
  openPreferredWorkspaceTarget,
  openWorkspaceTargetBeside,
} from "@/workspace-tabs/open-beside";

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
    layoutMode: "split-panes",
    sheetsByWorkspace: {},
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
    useWorkspaceLayoutStore.getState().setLayoutMode("compact");
    const tabId = openPreferredWorkspaceTarget({
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

describe("openPreferredWorkspacePreview", () => {
  it("opens a compact file preview in the sheet instead of replacing the active file tab", () => {
    const store = useWorkspaceLayoutStore.getState();
    const fileTabId = store.openTab({
      workspaceKey: WORKSPACE_KEY,
      target: { kind: "file", path: "src/open.ts" },
      intent: "reveal",
    });
    store.setLayoutMode("compact");

    const tabId = openPreferredWorkspacePreview({
      workspaceKey: WORKSPACE_KEY,
      serverId: "server-1",
      workspaceId: "workspace-1",
      explorerSidebarPaneId: "explorer",
      lastMainPaneId: "main",
      target: { kind: "file", path: "src/preview.ts" },
      source: "explorerFiles",
      preferences: DEFAULT_APP_SETTINGS.openInSidePane,
    });

    const state = useWorkspaceLayoutStore.getState();
    expect(state.sheetsByWorkspace[WORKSPACE_KEY]?.at(-1)?.tab).toMatchObject({
      tabId,
      target: { kind: "file", path: "src/preview.ts" },
    });
    const root = state.layoutByWorkspace[WORKSPACE_KEY].root;
    expect(findPaneById(root, "main")?.tabIds).toEqual([fileTabId]);
    expect(collectAllTabs(root).find((tab) => tab.tabId === fileTabId)?.target).toEqual({
      kind: "file",
      path: "src/open.ts",
    });
  });
});

describe("previews under a sheet with unsaved work", () => {
  const sheetTarget = { kind: "file" as const, path: "src/draft.ts" };
  let sheetTabId: string | null = null;

  afterEach(() => {
    if (sheetTabId) {
      setPanelInstanceAttributes(
        { serverId: "server-1", workspaceId: "workspace-1", tabId: sheetTabId },
        { modified: false },
      );
    }
    sheetTabId = null;
  });

  function previewFile(path: string): string | null {
    return openPreferredWorkspacePreview({
      workspaceKey: WORKSPACE_KEY,
      serverId: "server-1",
      workspaceId: "workspace-1",
      explorerSidebarPaneId: "explorer",
      lastMainPaneId: "main",
      target: { kind: "file", path },
      source: "explorerFiles",
      preferences: DEFAULT_APP_SETTINGS.openInSidePane,
    });
  }

  it("stacks link previews over the sheet instead of dropping its unsaved work", () => {
    const store = useWorkspaceLayoutStore.getState();
    store.openTab({
      workspaceKey: WORKSPACE_KEY,
      target: { kind: "terminal", terminalId: "term-1" },
      intent: "reveal",
    });
    store.setLayoutMode("compact");
    sheetTabId = store.openTab({
      workspaceKey: WORKSPACE_KEY,
      target: sheetTarget,
      intent: "reveal",
    });
    setPanelInstanceAttributes(
      { serverId: "server-1", workspaceId: "workspace-1", tabId: sheetTabId ?? "" },
      { modified: true },
    );

    previewFile("src/first.ts");
    previewFile("src/second.ts");

    const state = useWorkspaceLayoutStore.getState();
    expect(state.sheetsByWorkspace[WORKSPACE_KEY]?.map((sheet) => sheet.tab.target)).toEqual([
      sheetTarget,
      { kind: "file", path: "src/first.ts" },
      { kind: "file", path: "src/second.ts" },
    ]);
    const root = state.layoutByWorkspace[WORKSPACE_KEY].root;
    expect(findPaneById(root, "main")?.tabIds).toHaveLength(1);
  });
});

describe("opening beside", () => {
  const sidePreference = { ...DEFAULT_APP_SETTINGS.openInSidePane, subagents: true };

  function openSubagentWithSidePreference(): string | null {
    useWorkspaceLayoutStore.getState().openTab({
      workspaceKey: WORKSPACE_KEY,
      target: { kind: "file", path: "src/open.ts" },
      intent: "reveal",
    });
    return openPreferredWorkspaceTarget({
      workspaceKey: WORKSPACE_KEY,
      target: { kind: "file", path: "src/subagent.ts" },
      source: "subagents",
      preferences: sidePreference,
    });
  }

  function paneIdHolding(tabId: string | null): string | undefined {
    const root = useWorkspaceLayoutStore.getState().layoutByWorkspace[WORKSPACE_KEY].root;
    return collectAllPanes(root).find((pane) => pane.tabIds.includes(tabId ?? ""))?.id;
  }

  it("follows the side preference where the workspace renders split panes", () => {
    useWorkspaceLayoutStore.getState().setLayoutMode("split-panes");

    const tabId = openSubagentWithSidePreference();

    const openedSidePaneId =
      useWorkspaceLayoutStore.getState().sidePaneIdByWorkspace[WORKSPACE_KEY];
    expect(openedSidePaneId).toEqual(expect.any(String));
    expect(paneIdHolding(tabId)).toBe(openedSidePaneId);
  });

  it("keeps a single-pane workspace in one pane despite the side preference", () => {
    useWorkspaceLayoutStore.getState().setLayoutMode("single-pane");

    const preferredTabId = openSubagentWithSidePreference();
    const besideTabId = openWorkspaceTargetBeside({
      workspaceKey: WORKSPACE_KEY,
      target: { kind: "file", path: "src/beside.ts" },
    });

    expect(useWorkspaceLayoutStore.getState().sidePaneIdByWorkspace[WORKSPACE_KEY]).toBeFalsy();
    expect(paneIdHolding(preferredTabId)).toBe("main");
    expect(paneIdHolding(besideTabId)).toBe("main");
  });
});
