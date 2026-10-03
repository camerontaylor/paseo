import { useCallback } from "react";
import { useIsFocused } from "@react-navigation/native";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import { collectAllPanes, findPaneById } from "@/stores/workspace-layout-actions";
import { useViewsStore } from "@/stores/views-store";
import { findAdjacentPane } from "@/utils/split-navigation";

type PaneDirection = "left" | "right" | "up" | "down";

function parsePaneDirection(actionId: string): PaneDirection | null {
  const direction = actionId.split(".").pop();
  return direction === "left" || direction === "right" || direction === "up" || direction === "down"
    ? direction
    : null;
}

const VIEW_PANE_ACTIONS = [
  "workspace.pane.split.right",
  "workspace.pane.split.down",
  "workspace.pane.focus.left",
  "workspace.pane.focus.right",
  "workspace.pane.focus.up",
  "workspace.pane.focus.down",
  "workspace.pane.move-tab.left",
  "workspace.pane.move-tab.right",
  "workspace.pane.move-tab.up",
  "workspace.pane.move-tab.down",
  "workspace.pane.close",
  "workspace.tab.close-current",
] as const;

/**
 * The workspace pane shortcuts, applied to a View. Splitting asks which session goes in the
 * new pane (the picker), the way iTerm asks what to run in a new split.
 */
export function useViewKeyboard(input: {
  viewId: string;
  onSplitWithSession: (position: "right" | "bottom", paneId: string) => void;
}): void {
  const { viewId, onSplitWithSession } = input;
  const isFocused = useIsFocused();

  const handle = useCallback(
    (action: KeyboardActionDefinition): boolean => {
      const store = useViewsStore.getState();
      const view = store.views[viewId];
      if (!view) return true;
      const focusedPane =
        findPaneById(view.layout.root, view.layout.focusedPaneId) ??
        collectAllPanes(view.layout.root)[0] ??
        null;
      if (!focusedPane) return true;

      if (action.id === "workspace.pane.split.right") {
        onSplitWithSession("right", focusedPane.id);
        return true;
      }
      if (action.id === "workspace.pane.split.down") {
        onSplitWithSession("bottom", focusedPane.id);
        return true;
      }
      if (action.id === "workspace.pane.close") {
        store.closePane(viewId, focusedPane.id);
        return true;
      }
      if (action.id === "workspace.tab.close-current") {
        if (focusedPane.focusedTabId) store.closeTab(viewId, focusedPane.focusedTabId);
        return true;
      }
      const direction = parsePaneDirection(action.id);
      if (!direction) return false;
      const adjacentPaneId = findAdjacentPane(view.layout.root, focusedPane.id, direction);
      if (!adjacentPaneId) return true;
      if (action.id.startsWith("workspace.pane.focus.")) {
        store.focusPane(viewId, adjacentPaneId);
        return true;
      }
      if (action.id.startsWith("workspace.pane.move-tab.") && focusedPane.focusedTabId) {
        store.moveTabToPane(viewId, focusedPane.focusedTabId, adjacentPaneId);
        return true;
      }
      return false;
    },
    [onSplitWithSession, viewId],
  );

  useKeyboardActionHandler({
    handlerId: `view-pane-actions:${viewId}`,
    actions: VIEW_PANE_ACTIONS,
    enabled: isFocused,
    priority: 100,
    isActive: () => true,
    handle,
  });
}
