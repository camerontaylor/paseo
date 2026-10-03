import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { WorkspaceTab, WorkspaceTabScope, WorkspaceTabTarget } from "@/workspace-tabs/model";
import {
  closePaneInLayout,
  closeTabInLayout,
  collectAllTabs,
  findPaneById,
  focusPaneInLayout,
  focusTabInLayout,
  moveTabToPaneInLayout,
  normalizeLayout,
  openTabInLayoutFocused,
  reorderPaneTabsInLayout,
  resizeSplitInLayout,
  selectTabInPaneInLayout,
  splitPaneEmptyInLayout,
  splitPaneInLayout,
  type WorkspaceLayout,
  type WorkspaceTabPlacement,
} from "@/stores/workspace-layout-actions";
import { defaultWorkspaceLayoutIds } from "@/stores/workspace-layout-ids";
import { WorkspaceLayoutStorageSchema } from "@/stores/workspace-layout-storage";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

/**
 * Views are cross-workspace split layouts: every tab is a session that lives in some
 * workspace on some host, shown here by reference. A View never owns its sessions —
 * closing a tab only removes it from the View. See docs/cross-project-views.md.
 */
export interface PaseoView {
  id: string;
  name: string;
  createdAt: number;
  layout: WorkspaceLayout;
  scopeByTabId: Record<string, WorkspaceTabScope>;
}

/** Only targets with globally unique ids can be shown outside their workspace. */
export type ViewTabTarget = Extract<WorkspaceTabTarget, { kind: "agent" | "terminal" }>;

export interface ViewTabInput {
  scope: WorkspaceTabScope;
  target: ViewTabTarget;
}

type SplitPosition = "left" | "right" | "top" | "bottom";

const VIEW_PANE_ID = "main";
const MAX_VIEW_TREE_DEPTH = 4;
export const VIEW_LAYOUT_KEY_PREFIX = "view:";

export function buildViewLayoutKey(viewId: string): string {
  return `${VIEW_LAYOUT_KEY_PREFIX}${viewId}`;
}

export function isViewTabTarget(target: WorkspaceTabTarget): target is ViewTabTarget {
  return target.kind === "agent" || target.kind === "terminal";
}

function createEmptyViewLayout(): WorkspaceLayout {
  return normalizeLayout({
    root: { kind: "pane", pane: { id: VIEW_PANE_ID, tabIds: [], focusedTabId: null, tabs: [] } },
    focusedPaneId: VIEW_PANE_ID,
  });
}

function createViewId(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Drops scope entries whose tab is no longer anywhere in the layout. */
function pruneScopes(
  layout: WorkspaceLayout,
  scopeByTabId: Record<string, WorkspaceTabScope>,
): Record<string, WorkspaceTabScope> {
  const openTabIds = new Set(collectAllTabs(layout.root).map((tab) => tab.tabId));
  const next: Record<string, WorkspaceTabScope> = {};
  let changed = false;
  for (const [tabId, scope] of Object.entries(scopeByTabId)) {
    if (openTabIds.has(tabId)) {
      next[tabId] = scope;
    } else {
      changed = true;
    }
  }
  return changed ? next : scopeByTabId;
}

/** A View's tabs with their owning host/workspace attached, ready for the split container. */
export function collectViewTabs(view: PaseoView): WorkspaceTab[] {
  return collectAllTabs(view.layout.root).flatMap((tab) => {
    const scope = view.scopeByTabId[tab.tabId];
    return scope ? [{ ...tab, scope }] : [];
  });
}

export function nextViewName(views: Record<string, PaseoView>): string {
  const names = new Set(Object.values(views).map((view) => view.name));
  for (let index = 1; ; index += 1) {
    const candidate = `View ${index}`;
    if (!names.has(candidate)) return candidate;
  }
}

interface ViewsState {
  views: Record<string, PaseoView>;
  order: string[];
  createView: (input?: { name?: string; tabs?: ViewTabInput[] }) => string;
  renameView: (viewId: string, name: string) => void;
  deleteView: (viewId: string) => void;
  openTab: (viewId: string, input: ViewTabInput & { paneId?: string | null }) => string | null;
  openTabInNewSplit: (
    viewId: string,
    input: ViewTabInput & { targetPaneId?: string | null; position: SplitPosition },
  ) => string | null;
  closeTab: (viewId: string, tabId: string) => void;
  closePane: (viewId: string, paneId: string) => void;
  focusTab: (viewId: string, tabId: string) => void;
  selectTabInPane: (viewId: string, paneId: string, tabId: string) => void;
  focusPane: (viewId: string, paneId: string) => void;
  splitPane: (
    viewId: string,
    input: { tabId: string; targetPaneId: string; position: SplitPosition },
  ) => string | null;
  splitPaneEmpty: (
    viewId: string,
    input: { targetPaneId: string; position: SplitPosition },
  ) => string | null;
  moveTabToPane: (viewId: string, tabId: string, toPaneId: string) => void;
  reorderTabsInPane: (viewId: string, paneId: string, tabIds: string[]) => void;
  resizeSplit: (viewId: string, groupId: string, sizes: number[]) => void;
}

const WorkspaceTabScopeSchema = z.strictObject({
  serverId: z.string(),
  workspaceId: z.string(),
});

const PaseoViewStorageSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  layout: WorkspaceLayoutStorageSchema,
  scopeByTabId: z.record(z.string(), WorkspaceTabScopeSchema),
});

const ViewsPersistedStateSchema = z.strictObject({
  views: z.record(z.string(), PaseoViewStorageSchema),
  order: z.array(z.string()),
});

type ViewsPersistedState = z.infer<typeof ViewsPersistedStateSchema>;

function openTabInViewLayout(
  view: PaseoView,
  input: ViewTabInput & { placement: WorkspaceTabPlacement },
): { view: PaseoView; tabId: string } | null {
  const result = openTabInLayoutFocused({
    layout: view.layout,
    target: input.target,
    now: Date.now(),
    placement: input.placement,
    explorerSidebarPaneId: null,
  });
  if (!result) return null;
  return {
    tabId: result.tabId,
    view: {
      ...view,
      layout: result.layout,
      scopeByTabId: pruneScopes(result.layout, {
        ...view.scopeByTabId,
        [result.tabId]: input.scope,
      }),
    },
  };
}

export const useViewsStore = create<ViewsState>()(
  persist(
    (set, get) => {
      const updateView = (
        viewId: string,
        updater: (view: PaseoView) => PaseoView | null,
      ): PaseoView | null => {
        const view = get().views[viewId];
        if (!view) return null;
        const next = updater(view);
        if (!next || next === view) return null;
        set((state) => ({ views: { ...state.views, [viewId]: next } }));
        return next;
      };

      const updateLayout = (
        viewId: string,
        compute: (layout: WorkspaceLayout) => WorkspaceLayout | null,
      ) =>
        updateView(viewId, (view) => {
          const layout = compute(view.layout);
          if (!layout) return null;
          return { ...view, layout, scopeByTabId: pruneScopes(layout, view.scopeByTabId) };
        });

      return {
        views: {},
        order: [],

        createView: (input) => {
          const id = createViewId();
          let view: PaseoView = {
            id,
            name: input?.name?.trim() || nextViewName(get().views),
            createdAt: Date.now(),
            layout: createEmptyViewLayout(),
            scopeByTabId: {},
          };
          (input?.tabs ?? []).forEach((tab, index) => {
            if (index === 0) {
              view =
                openTabInViewLayout(view, { ...tab, placement: { mode: "focused" } })?.view ?? view;
              return;
            }
            const split = splitPaneEmptyInLayout({
              layout: view.layout,
              targetPaneId: view.layout.focusedPaneId ?? VIEW_PANE_ID,
              position: "right",
              createNodeId: defaultWorkspaceLayoutIds.createNodeId,
              maxTreeDepth: MAX_VIEW_TREE_DEPTH,
            });
            const withPane = split ? { ...view, layout: split.layout } : view;
            view =
              openTabInViewLayout(withPane, {
                ...tab,
                placement: split ? { mode: "pane", paneId: split.paneId } : { mode: "focused" },
              })?.view ?? view;
          });
          set((state) => ({
            views: { ...state.views, [id]: view },
            order: [...state.order, id],
          }));
          return id;
        },

        renameView: (viewId, name) => {
          const trimmed = name.trim();
          if (!trimmed) return;
          updateView(viewId, (view) => (view.name === trimmed ? null : { ...view, name: trimmed }));
        },

        deleteView: (viewId) => {
          set((state) => {
            if (!state.views[viewId]) return state;
            const { [viewId]: _removed, ...views } = state.views;
            return { views, order: state.order.filter((id) => id !== viewId) };
          });
        },

        openTab: (viewId, input) => {
          let tabId: string | null = null;
          updateView(viewId, (view) => {
            const paneId =
              input.paneId && findPaneById(view.layout.root, input.paneId) ? input.paneId : null;
            const result = openTabInViewLayout(view, {
              ...input,
              placement: paneId ? { mode: "pane", paneId } : { mode: "focused" },
            });
            tabId = result?.tabId ?? null;
            return result?.view ?? null;
          });
          return tabId;
        },

        openTabInNewSplit: (viewId, input) => {
          let tabId: string | null = null;
          updateView(viewId, (view) => {
            const targetPaneId =
              (input.targetPaneId && findPaneById(view.layout.root, input.targetPaneId)?.id) ??
              view.layout.focusedPaneId ??
              VIEW_PANE_ID;
            const split = splitPaneEmptyInLayout({
              layout: view.layout,
              targetPaneId,
              position: input.position,
              createNodeId: defaultWorkspaceLayoutIds.createNodeId,
              maxTreeDepth: MAX_VIEW_TREE_DEPTH,
            });
            const base = split ? { ...view, layout: split.layout } : view;
            const result = openTabInViewLayout(base, {
              ...input,
              placement: split ? { mode: "pane", paneId: split.paneId } : { mode: "focused" },
            });
            tabId = result?.tabId ?? null;
            return result?.view ?? null;
          });
          return tabId;
        },

        closeTab: (viewId, tabId) => {
          updateLayout(viewId, (layout) =>
            closeTabInLayout({ layout, tabId, explorerSidebarPaneId: null }),
          );
        },

        closePane: (viewId, paneId) => {
          updateLayout(viewId, (layout) => closePaneInLayout({ layout, paneId }));
        },

        focusTab: (viewId, tabId) => {
          updateLayout(viewId, (layout) => focusTabInLayout({ layout, tabId }));
        },

        selectTabInPane: (viewId, paneId, tabId) => {
          updateLayout(viewId, (layout) => selectTabInPaneInLayout({ layout, paneId, tabId }));
        },

        focusPane: (viewId, paneId) => {
          updateLayout(viewId, (layout) => focusPaneInLayout({ layout, paneId }));
        },

        splitPane: (viewId, input) => {
          let paneId: string | null = null;
          updateLayout(viewId, (layout) => {
            const result = splitPaneInLayout({
              layout,
              ...input,
              createNodeId: defaultWorkspaceLayoutIds.createNodeId,
              maxTreeDepth: MAX_VIEW_TREE_DEPTH,
            });
            paneId = result?.paneId ?? null;
            return result?.layout ?? null;
          });
          return paneId;
        },

        splitPaneEmpty: (viewId, input) => {
          let paneId: string | null = null;
          updateLayout(viewId, (layout) => {
            const result = splitPaneEmptyInLayout({
              layout,
              ...input,
              createNodeId: defaultWorkspaceLayoutIds.createNodeId,
              maxTreeDepth: MAX_VIEW_TREE_DEPTH,
            });
            paneId = result?.paneId ?? null;
            return result?.layout ?? null;
          });
          return paneId;
        },

        moveTabToPane: (viewId, tabId, toPaneId) => {
          updateLayout(viewId, (layout) =>
            moveTabToPaneInLayout({ layout, tabId, toPaneId, explorerSidebarPaneId: null }),
          );
        },

        reorderTabsInPane: (viewId, paneId, tabIds) => {
          updateLayout(viewId, (layout) => reorderPaneTabsInLayout({ layout, paneId, tabIds }));
        },

        resizeSplit: (viewId, groupId, sizes) => {
          updateLayout(viewId, (layout) => resizeSplitInLayout({ layout, groupId, sizes }));
        },
      };
    },
    {
      name: "paseo-views",
      version: 1,
      storage: createValidatedPersistStorage<ViewsPersistedState>(
        AsyncStorage,
        ViewsPersistedStateSchema,
      ),
      partialize: (state): ViewsPersistedState => ({
        views: Object.fromEntries(
          Object.entries(state.views).map(([id, view]) => [
            id,
            { ...view, layout: normalizeLayout(view.layout) },
          ]),
        ),
        order: state.order,
      }),
      merge: (persisted, current) => {
        const result = ViewsPersistedStateSchema.safeParse(persisted);
        if (!result.success) return current;
        const views: Record<string, PaseoView> = {};
        for (const [id, view] of Object.entries(result.data.views)) {
          const layout = normalizeLayout(view.layout);
          views[id] = { ...view, layout, scopeByTabId: pruneScopes(layout, view.scopeByTabId) };
        }
        const order = result.data.order.filter((id) => id in views);
        for (const id of Object.keys(views)) {
          if (!order.includes(id)) order.push(id);
        }
        return { ...current, views, order };
      },
    },
  ),
);

/**
 * Agents shown in any View for a host, so timeline sync keeps their chats live even
 * when no workspace tab has them open.
 */
export function observeViewAgentIds(
  serverId: string,
  listener: (agentIds: string[]) => void,
): () => void {
  let previous: string[] | undefined;
  const publish = (views: Record<string, PaseoView>) => {
    const ids = new Set<string>();
    for (const view of Object.values(views)) {
      for (const tab of collectViewTabs(view)) {
        if (tab.scope?.serverId === serverId && tab.target.kind === "agent") {
          ids.add(tab.target.agentId);
        }
      }
    }
    const next = [...ids].sort();
    if (previous?.length === next.length && previous.every((id, index) => id === next[index])) {
      return;
    }
    previous = next;
    listener(next);
  };
  const unsubscribe = useViewsStore.subscribe((state, before) => {
    if (state.views !== before.views) publish(state.views);
  });
  publish(useViewsStore.getState().views);
  return unsubscribe;
}
