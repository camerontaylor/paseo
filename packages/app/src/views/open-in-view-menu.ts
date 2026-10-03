import { useMemo } from "react";
import { router, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import type { WorkspaceTabMenuEntry } from "@/screens/workspace/workspace-tab-menu";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { isViewTabTarget, useViewsStore } from "@/stores/views-store";
import { buildViewRoute } from "@/utils/host-routes";

const MAX_LISTED_VIEWS = 6;

/**
 * Tab context-menu entries that send a workspace session into a cross-workspace View:
 * one per existing View plus "Open in new View". Tabs already in a View get none.
 */
export function useOpenInViewMenuEntries(input: {
  tab: WorkspaceTabDescriptor;
  serverId: string;
  workspaceId: string;
  menuTestIDBase: string;
}): WorkspaceTabMenuEntry[] {
  const { t } = useTranslation();
  const { tab, serverId, workspaceId, menuTestIDBase } = input;
  const order = useViewsStore((state) => state.order);
  const viewsById = useViewsStore((state) => state.views);
  const views = useMemo(
    () =>
      order.slice(0, MAX_LISTED_VIEWS).flatMap((id) => {
        const view = viewsById[id];
        return view ? [{ id, name: view.name }] : [];
      }),
    [order, viewsById],
  );

  return useMemo(() => {
    const target = tab.target;
    if (tab.scope || !isViewTabTarget(target) || !serverId || !workspaceId) return [];
    const scope = { serverId, workspaceId };
    const entries: WorkspaceTabMenuEntry[] = views.map((view) => ({
      kind: "item",
      key: `open-in-view-${view.id}`,
      label: `${t("views.actions.openInView")}: ${view.name}`,
      icon: "layout-panel-left",
      testID: `${menuTestIDBase}-open-in-view-${view.id}`,
      onSelect: () => {
        useViewsStore.getState().openTab(view.id, { scope, target });
        router.push(buildViewRoute(view.id) as Href);
      },
    }));
    entries.push(
      {
        kind: "item",
        key: "open-in-new-view",
        label: t("views.actions.openInNewView"),
        icon: "layout-panel-left",
        testID: `${menuTestIDBase}-open-in-new-view`,
        onSelect: () => {
          const viewId = useViewsStore.getState().createView({ tabs: [{ scope, target }] });
          router.push(buildViewRoute(viewId) as Href);
        },
      },
      { kind: "separator", key: "open-in-view-separator" },
    );
    return entries;
  }, [menuTestIDBase, serverId, t, tab.scope, tab.target, views, workspaceId]);
}
