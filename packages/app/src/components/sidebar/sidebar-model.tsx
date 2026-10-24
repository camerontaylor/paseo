import { useTranslation } from "react-i18next";
import { shallow } from "zustand/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useSessionStore, type Agent } from "@/stores/session-store";
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  useSidebarWorkspacesList,
  type SidebarProjectEntry,
  type SidebarWorkspaceEntry,
  type SidebarWorkspacesListResult,
} from "@/hooks/use-sidebar-workspaces-list";
import { useSidebarWorkspaceEntries } from "@/hooks/use-sidebar-workspace-entries";
import { usePinnedSidebarKeys, type PinnedSidebarGroups } from "@/hooks/use-sidebar-pins";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import {
  hasActiveSidebarLabelFilter,
  useSidebarViewStore,
  type SidebarGroupMode,
} from "@/stores/sidebar-view-store";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import type { SidebarShortcutModel } from "@/utils/sidebar-shortcuts";
import { buildSidebarProjection } from "./sidebar-projection";
import { effectiveSidebarSortMode, messageSortAvailability } from "./message-sort-capability";
import { useHosts } from "@/runtime/host-runtime";
import type { SidebarProjectIconTarget } from "@/utils/sidebar-project-row-model";
import { filterWorkspacesByLabels, type SidebarWorkspaceGroup } from "./sidebar-labels";
import { filterWorkspacesByProjects, resolveActiveProjectFilters } from "./sidebar-project-filter";
import {
  normalizeSidebarQuery,
  workspaceMatchesSidebarFilter,
  filterAndSortSidebarProjects,
} from "./sidebar-filter-sort";
import {
  areSidebarTabMatchesEqual,
  collectSidebarTabTitles,
  EMPTY_SIDEBAR_TAB_MATCHES,
  matchSidebarTabTitles,
  type SidebarTabMatches,
} from "./sidebar-filter-matches";
import {
  buildSidebarMessageSearchScope,
  EMPTY_SIDEBAR_MESSAGE_SEARCH_SCOPE,
  SidebarMessageSearchProvider,
  SidebarTabMatchesProvider,
  type SidebarMessageSearchScope,
} from "./sidebar-filter-context";
import { useSidebarFilterRequestStore } from "./sidebar-filter-request";
import { pickUniqueSessionIdMatch, type SessionTarget } from "./find-or-start";
import { orderProjectsWithPins } from "@/default-project/model";
import { useProjectPinStates } from "@/default-project/hooks";
import { usePinnedProjectOrderStore } from "@/default-project/pinned-project-order-store";
import {
  hasAuthoritativeWorkspaceLabelCatalog,
  useWorkspaceLabelProjection,
} from "@/workspace-labels";

interface SidebarModel extends SidebarWorkspacesListResult {
  serverIds: string[];
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  /**
   * Every project the sidebar could show, before any filter narrows it.
   *
   * `projects` is the FILTERED list. A surface that offers a filter picker must read this one, or
   * narrowing the filter deletes the rows that would undo it.
   */
  allProjects: SidebarProjectEntry[];
  /** The project filter as it is actually being applied — see `resolveActiveProjectFilters`. */
  resolvedProjectFilters: readonly string[];
  hasProjectsBeforeFilter: boolean;
  groupMode: SidebarGroupMode;
  workspaceGroups: SidebarWorkspaceGroup[];
  projectIconTargets: SidebarProjectIconTarget[];
  pinnedGroups: PinnedSidebarGroups;
  pinnedProjectViewKeys: ReadonlySet<string>;
  collapsedProjectKeys: ReadonlySet<string>;
  toggleProjectCollapsed: (projectViewKey: string) => void;
  shortcutModel: SidebarShortcutModel;
}

const SidebarModelContext = createContext<SidebarModel | null>(null);

const NO_AGENT_MAPS: ReadonlyArray<ReadonlyMap<string, Agent> | undefined> = [];

function useSidebarTabMatches(
  serverIds: readonly string[],
  normalizedQuery: string,
): SidebarTabMatches {
  const agentMaps = useStoreWithEqualityFn(
    useSessionStore,
    (state) =>
      normalizedQuery
        ? serverIds.map((serverId) => state.sessions[serverId]?.agents)
        : NO_AGENT_MAPS,
    shallow,
  );
  const tabTitles = useMemo(
    () =>
      collectSidebarTabTitles(
        serverIds.map((serverId, index) => ({ serverId, agents: agentMaps[index] })),
      ),
    [agentMaps, serverIds],
  );
  const previousRef = useRef<SidebarTabMatches>(EMPTY_SIDEBAR_TAB_MATCHES);
  return useMemo(() => {
    const next = matchSidebarTabTitles(tabTitles, normalizedQuery);
    if (areSidebarTabMatchesEqual(previousRef.current, next)) return previousRef.current;
    previousRef.current = next;
    return next;
  }, [normalizedQuery, tabTitles]);
}

function useUniqueSessionIdMatch(
  tabMatches: SidebarTabMatches,
  visibleWorkspaceKeys: ReadonlySet<string>,
  normalizedQuery: string,
): SessionTarget | null {
  const previousRef = useRef<SessionTarget | null>(null);
  return useMemo(() => {
    const next = pickUniqueSessionIdMatch(tabMatches, visibleWorkspaceKeys, normalizedQuery);
    const previous = previousRef.current;
    if (
      next &&
      previous &&
      next.serverId === previous.serverId &&
      next.agentId === previous.agentId &&
      next.workspaceId === previous.workspaceId &&
      next.title === previous.title
    )
      return previous;
    previousRef.current = next;
    return next;
  }, [normalizedQuery, tabMatches, visibleWorkspaceKeys]);
}

export function SidebarModelProvider({
  active,
  children,
}: {
  active?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const filterScope = useSidebarViewStore((state) => state.filterScope);
  const filterRequest = useSidebarFilterRequestStore((state) => state.request);
  useEffect(() => {
    if (filterRequest) setSearchQuery(filterRequest.query);
  }, [filterRequest]);
  const normalizedQuery = useMemo(() => normalizeSidebarQuery(searchQuery), [searchQuery]);
  const list = useSidebarWorkspacesList({ enabled: active });
  const serverIds = useMemo(
    () => [...new Set(list.workspacePlacements.map((item) => item.serverId))],
    [list.workspacePlacements],
  );
  const showBackground = useSidebarViewStore((state) => state.showBackground);
  const groupMode = useSidebarViewStore((state) => state.groupMode);
  const selectedSortMode = useSidebarViewStore((state) => state.sortMode);
  const hostFilters = useSidebarViewStore((state) => state.hostFilters);
  const hosts = useHosts();
  const sortSupport = useSessionStore((state) =>
    hosts
      .filter((host) => hostFilters.length === 0 || hostFilters.includes(host.serverId))
      .map(({ serverId }) =>
        state.sessions[serverId]?.serverInfo?.features?.conversationMessageActivity === true
          ? "1"
          : "0",
      )
      .join(""),
  );
  const sortMode = effectiveSidebarSortMode(
    selectedSortMode,
    messageSortAvailability(sortSupport.split("").map((value) => value === "1")),
  );
  const labelFilter = useSidebarViewStore((state) => state.labelFilter);
  const projectFilters = useSidebarViewStore((state) => state.projectFilters);
  const reconcileLabelFilter = useSidebarViewStore((state) => state.reconcileLabelFilter);
  const { hosts: labelHosts } = useWorkspaceLabelProjection();
  const collapsedProjectKeys = useSidebarCollapsedSectionsStore(
    (state) => state.collapsedProjectKeys,
  );
  const collapsedWorkspaceGroupKeys = useSidebarCollapsedSectionsStore(
    (state) => state.collapsedWorkspaceGroupKeys,
  );
  const pinnedCollapsed = useSidebarCollapsedSectionsStore((state) => state.collapsedPinned);
  const pinnedWorkspaceOrder = useSidebarOrderStore((state) => state.pinnedWorkspaceOrder);
  const toggleProjectCollapsed = useSidebarCollapsedSectionsStore(
    (state) => state.toggleProjectCollapsed,
  );
  const availableLabelNames = useMemo(
    () => labelHosts.flatMap((host) => host.labels.map((label) => label.name)),
    [labelHosts],
  );
  const hasAuthoritativeLabelCatalog = hasAuthoritativeWorkspaceLabelCatalog(labelHosts);
  useEffect(() => {
    if (!hasAuthoritativeLabelCatalog) return;
    reconcileLabelFilter(availableLabelNames);
  }, [availableLabelNames, hasAuthoritativeLabelCatalog, reconcileLabelFilter]);
  const hasActiveLabelFilter = hasActiveSidebarLabelFilter(labelFilter);
  const resolvedProjectFilters = useMemo(
    () =>
      resolveActiveProjectFilters(
        projectFilters,
        new Set(list.projects.map((project) => project.viewKey)),
      ),
    [projectFilters, list.projects],
  );
  const hasActiveProjectFilter = resolvedProjectFilters.length > 0;
  // The project filter is deliberately absent from this gate. It reads `projectViewKey`, which
  // lives on the project and the placement, so it can narrow the project list without hydrating
  // anything; the label filter reads `labels`, which only exists on an entry. Hydration opens a
  // live session-store subscription over every workspace on every visible host, so widening this
  // for a filter that does not need it costs a retained-but-inactive sidebar real work.
  const needsWorkspaceEntries =
    groupMode !== "project" || hasActiveLabelFilter || Boolean(normalizedQuery);
  const workspaceEntriesByKey = useSidebarWorkspaceEntries(
    list.workspacePlacements,
    active !== false || needsWorkspaceEntries,
  );
  const tabMatches = useSidebarTabMatches(serverIds, normalizedQuery);
  const tabMatchedWorkspaceKeys = useMemo(() => new Set(tabMatches.keys()), [tabMatches]);
  const scopedWorkspaces = useMemo(() => {
    const byProject = filterWorkspacesByProjects({
      workspaces: [...workspaceEntriesByKey.values()],
      projectFilters: resolvedProjectFilters,
    });
    return filterWorkspacesByLabels({
      workspaces: byProject.filter((workspace) => showBackground || !workspace.background),
      ...labelFilter,
    });
  }, [showBackground, labelFilter, resolvedProjectFilters, workspaceEntriesByKey]);
  const filteredWorkspaceEntriesByKey = useMemo(
    () =>
      new Map(
        scopedWorkspaces
          .filter((workspace) =>
            workspaceMatchesSidebarFilter(workspace, normalizedQuery, tabMatchedWorkspaceKeys),
          )
          .map((workspace) => [workspace.workspaceKey, workspace]),
      ),
    [scopedWorkspaces, normalizedQuery, tabMatchedWorkspaceKeys],
  );
  const messageSearchScopeRef = useRef<SidebarMessageSearchScope>(
    EMPTY_SIDEBAR_MESSAGE_SEARCH_SCOPE,
  );
  const messageSearchScope = useMemo(() => {
    if (!normalizedQuery) return messageSearchScopeRef.current;
    const next = buildSidebarMessageSearchScope(scopedWorkspaces);
    if (next.key === messageSearchScopeRef.current.key) return messageSearchScopeRef.current;
    messageSearchScopeRef.current = next;
    return next;
  }, [normalizedQuery, scopedWorkspaces]);
  const visibleWorkspaceKeys = useMemo(
    () => new Set(filteredWorkspaceEntriesByKey.keys()),
    [filteredWorkspaceEntriesByKey],
  );
  const uniqueSession = useUniqueSessionIdMatch(tabMatches, visibleWorkspaceKeys, normalizedQuery);
  // The two filters prune differently on purpose. The project filter is a membership test on the
  // project itself, so a project you filtered TO survives even with no workspaces — it still owns
  // a header row you can create your first workspace under. The label filter can only ask about
  // workspaces, so a project it empties has nothing left to show.
  const filteredProjects = useMemo(() => {
    let projects = list.projects;
    if (hasActiveProjectFilter) {
      const included = new Set(resolvedProjectFilters);
      projects = projects.filter((project) => included.has(project.viewKey));
    }
    if (hasActiveLabelFilter || normalizedQuery || !showBackground) {
      projects = projects.flatMap((project) => {
        const workspaces = project.workspaces.filter((workspace) =>
          visibleWorkspaceKeys.has(workspace.workspaceKey),
        );
        const projectNameMatches = project.projectName
          .normalize("NFKC")
          .toLocaleLowerCase()
          .includes(normalizedQuery);
        return workspaces.length > 0 ||
          (!hasActiveLabelFilter && normalizedQuery && projectNameMatches) ||
          (!normalizedQuery && !hasActiveLabelFilter && project.workspaces.length === 0)
          ? [{ ...project, workspaces }]
          : [];
      });
    }
    return filterAndSortSidebarProjects({
      projects,
      entries: filteredWorkspaceEntriesByKey,
      query: normalizedQuery,
      mode: sortMode,
      tabMatchedWorkspaceKeys,
    });
  }, [
    sortMode,
    normalizedQuery,
    tabMatchedWorkspaceKeys,
    filteredWorkspaceEntriesByKey,
    showBackground,
    hasActiveLabelFilter,
    hasActiveProjectFilter,
    resolvedProjectFilters,
    list.projects,
    visibleWorkspaceKeys,
  ]);
  const projectPinStates = useProjectPinStates(list.projects);
  const pinnedProjectOrder = usePinnedProjectOrderStore((state) => state.pinnedProjectOrder);
  const pinOrdered = useMemo(
    () =>
      orderProjectsWithPins({
        projects: filteredProjects,
        pinStates: projectPinStates,
        pinnedProjectOrder,
      }),
    [filteredProjects, projectPinStates, pinnedProjectOrder],
  );
  const orderedProjects = pinOrdered.projects;
  const pinnedKeys = usePinnedSidebarKeys(orderedProjects);
  const projectionInput = useMemo(
    () => ({
      projects: orderedProjects,
      pinnedKeys,
      pinnedWorkspaceOrder,
      workspaceEntriesByKey: filteredWorkspaceEntriesByKey,
      projectNamesByViewKey: list.projectNamesByViewKey,
      groupMode,
      sortMode,
      pinnedCollapsed,
      collapsedProjectKeys,
      collapsedWorkspaceGroupKeys,
      t,
    }),
    [
      collapsedProjectKeys,
      collapsedWorkspaceGroupKeys,
      groupMode,
      sortMode,
      list.projectNamesByViewKey,
      orderedProjects,
      pinnedCollapsed,
      pinnedKeys,
      pinnedWorkspaceOrder,
      filteredWorkspaceEntriesByKey,
      t,
    ],
  );
  const projection = useMemo(() => buildSidebarProjection(projectionInput), [projectionInput]);
  const value = useMemo(
    () => ({
      ...list,
      serverIds,
      projects: orderedProjects,
      allProjects: list.projects,
      resolvedProjectFilters,
      hasProjectsBeforeFilter: list.projects.length > 0,
      searchQuery,
      setSearchQuery,
      workspaceEntriesByKey: filteredWorkspaceEntriesByKey,
      groupMode,
      workspaceGroups: projection.workspaceGroups,
      projectIconTargets: projection.projectIconTargets,
      pinnedGroups: projection.pinnedGroups,
      pinnedProjectViewKeys: pinOrdered.pinnedViewKeys,
      collapsedProjectKeys,
      toggleProjectCollapsed,
      shortcutModel: projection.shortcutModel,
    }),
    [
      resolvedProjectFilters,
      searchQuery,
      collapsedProjectKeys,
      groupMode,
      list,
      serverIds,
      orderedProjects,
      pinOrdered.pinnedViewKeys,
      projection,
      toggleProjectCollapsed,
      filteredWorkspaceEntriesByKey,
    ],
  );

  return (
    <SidebarModelContext.Provider value={value}>
      <SidebarTabMatchesProvider tabMatches={tabMatches} uniqueSession={uniqueSession}>
        <SidebarMessageSearchProvider
          rawQuery={searchQuery}
          normalizedQuery={normalizedQuery}
          scope={messageSearchScope}
          messagesEnabled={filterScope === "messages"}
        >
          {children}
        </SidebarMessageSearchProvider>
      </SidebarTabMatchesProvider>
    </SidebarModelContext.Provider>
  );
}

export function useSidebarModel(): SidebarModel {
  const model = useContext(SidebarModelContext);
  if (!model) throw new Error("SidebarModelProvider is required");
  return model;
}
