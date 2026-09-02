import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

import { DEFAULT_APP_SETTINGS } from "@/hooks/use-settings";
import {
  collectAllPanes,
  useWorkspaceLayoutStore,
  type SplitPane,
} from "@/stores/workspace-layout-store";
import { openPreferredWorkspaceTarget } from "@/workspace-tabs/open-beside";

/**
 * `side-conversations/start.ts` calls `openPreferredWorkspaceTarget` with no `canSplit` guard,
 * while `panels/agent-tracks.tsx:71` guards the same call with
 * `supportsDesktopPaneSplits() && !isCompact`. `supportsDesktopPaneSplits()` is `isWeb`
 * (`constants/layout.ts:51`), so a non-compact *native* device — a tablet — reaches the unguarded
 * call with `isCompact: false` and can create a side pane that nothing renders a split for.
 *
 * These tests pin what actually happens on both sides of that boundary. The hazard is bounded, not
 * live: `openInSidePane.subagents` ships off, and the only UI that turns it on is the settings
 * Layout section, which renders `null` outside Electron (`screens/settings-screen.tsx:1451`).
 * Settings live in device-local AsyncStorage under `@paseo:app-settings`, so the preference cannot
 * travel from a desktop install to a phone or tablet either.
 *
 * If someone ever exposes the Layout section on native, the second test is the one that changes.
 */

const WORKSPACE_KEY = "server-1:workspace-1";
const PARENT_AGENT_ID = "parent-1";
const SIDE_CONVERSATION = {
  kind: "side_conversation",
  parentAgentId: PARENT_AGENT_ID,
  threadId: "thread-1",
} as const;

function layout() {
  const value = useWorkspaceLayoutStore.getState().layoutByWorkspace[WORKSPACE_KEY];
  if (!value) throw new Error("workspace layout missing");
  return value;
}

function panes(): SplitPane[] {
  return collectAllPanes(layout().root);
}

function paneHolding(tabId: string): SplitPane {
  const pane = panes().find((candidate) => candidate.tabIds.includes(tabId));
  if (!pane) throw new Error(`no pane holds ${tabId}`);
  return pane;
}

/** Seeds the parent agent tab the way a workspace opens one, before any side conversation exists. */
function openParentAgentTab(): string {
  const tabId = useWorkspaceLayoutStore.getState().openTab({
    workspaceKey: WORKSPACE_KEY,
    target: { kind: "agent", agentId: PARENT_AGENT_ID },
    intent: "reveal",
  });
  if (!tabId) throw new Error("parent agent tab did not open");
  return tabId;
}

/** The one call `useStartSideConversation` makes, with the platform inputs a tablet supplies. */
function startSideConversationOnNativeTablet(
  preferences: typeof DEFAULT_APP_SETTINGS.openInSidePane,
  parentTabId: string,
): string {
  const tabId = openPreferredWorkspaceTarget({
    // A tablet is not compact, and `supportsDesktopPaneSplits()` is never consulted here.
    isCompact: false,
    workspaceKey: WORKSPACE_KEY,
    target: SIDE_CONVERSATION,
    source: "subagents",
    preferences,
    parentTabId,
  });
  if (!tabId) throw new Error("side conversation tab did not open");
  return tabId;
}

beforeEach(() => {
  useWorkspaceLayoutStore.setState({
    layoutByWorkspace: {},
    explorerSidebarPaneIdByWorkspace: {},
    sidePaneIdByWorkspace: {},
    splitSizesByWorkspace: {},
  });
});

describe("starting a side conversation on a device that cannot render pane splits", () => {
  it("keeps the thread in the parent's pane under the settings a native device can reach", () => {
    const parentTabId = openParentAgentTab();

    const threadTabId = startSideConversationOnNativeTablet(
      DEFAULT_APP_SETTINGS.openInSidePane,
      parentTabId,
    );

    // No split, so the tab row and the rendered pane are the same one the parent was already in.
    expect(panes()).toHaveLength(1);
    expect(paneHolding(threadTabId).id).toBe(paneHolding(parentTabId).id);
    expect(paneHolding(threadTabId).id).toBe(layout().focusedPaneId);
    expect(useWorkspaceLayoutStore.getState().sidePaneIdByWorkspace[WORKSPACE_KEY]).toBeUndefined();
  });

  it("splits and moves focus off the parent's pane once the desktop preference is forced on", () => {
    const parentTabId = openParentAgentTab();

    const threadTabId = startSideConversationOnNativeTablet(
      { ...DEFAULT_APP_SETTINGS.openInSidePane, subagents: true },
      parentTabId,
    );

    const sidePaneId = useWorkspaceLayoutStore.getState().sidePaneIdByWorkspace[WORKSPACE_KEY];
    expect(panes()).toHaveLength(2);
    expect(paneHolding(threadTabId).id).toBe(sidePaneId);
    // Focus follows the new pane, so the thread itself is reachable. The parent agent is what is
    // left behind: `workspace-screen.tsx:2068` derives the tab row from the focused pane only, and
    // without `supportsDesktopPaneSplits()` there is no split chrome to click back through.
    expect(layout().focusedPaneId).toBe(sidePaneId);
    expect(paneHolding(parentTabId).id).not.toBe(sidePaneId);
    expect(paneHolding(parentTabId).tabIds).toEqual([parentTabId]);
    expect(paneHolding(threadTabId).tabIds).toEqual([threadTabId]);
  });
});
