import { createContext, useContext, type ReactNode } from "react";

/**
 * Lets a cross-workspace View replace the workspace "new tab" launcher. A View has no single
 * workspace to launch into, so its "+" button and empty panes open the session picker instead.
 */
export interface ViewPaneActions {
  addTabLabel: string;
  onAddTab: (paneId: string) => void;
  renderEmptyPane: (paneId: string) => ReactNode;
}

const ViewPaneActionsContext = createContext<ViewPaneActions | null>(null);

export const ViewPaneActionsProvider = ViewPaneActionsContext.Provider;

export function useViewPaneActions(): ViewPaneActions | null {
  return useContext(ViewPaneActionsContext);
}
