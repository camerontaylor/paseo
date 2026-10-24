import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import type { StreamListOptions, StreamRow } from "@getpaseo/protocol/global-stream";
import { getHostRuntimeStore, isHostRuntimeConnected, useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useFetchQueries } from "@/data/query";

export type GlobalStreamRow = StreamRow & { serverId: string; serverLabel: string };
export interface HostPage {
  rows: StreamRow[];
  hasMore: boolean;
  counts?: {
    total: number;
    open: number;
    done: number;
    user: number;
    agent: number;
    unknown: number;
    matching: number;
  };
  coverage?: "loaded_history" | "not_loaded";
}

export interface StreamPagination {
  identity: string;
  depth: number;
}

export function streamQueryIdentity(
  options: StreamListOptions & { serverId: string | null },
  hostIds: string[],
): string {
  return JSON.stringify([
    options.serverId,
    options.agentId,
    options.asksOnly,
    options.includeMessageInventory,
    options.sourceRole,
    options.state,
    options.filter,
    options.search,
    options.includeArchived,
    hostIds,
  ]);
}

export function effectiveStreamDepth(pagination: StreamPagination, identity: string): number {
  return pagination.identity === identity ? pagination.depth : 1;
}

export function advanceStreamDepth(
  pagination: StreamPagination,
  identity: string,
): StreamPagination {
  return { identity, depth: effectiveStreamDepth(pagination, identity) + 1 };
}

export function summarizeHostPages(
  pages: readonly (HostPage | undefined)[],
  availability: readonly string[],
  errors: readonly (Error | null | undefined)[],
): {
  counts: HostPage["counts"];
  coverage: NonNullable<HostPage["coverage"]>;
  incompleteHostCount: number;
} {
  const incompleteHostCount = pages.filter(
    (page, index) => availability[index] !== "online" || Boolean(errors[index]) || !page,
  ).length;
  const complete = pages.length > 0 && incompleteHostCount === 0;
  const counts =
    complete && pages.every((page) => page?.counts)
      ? pages.reduce<NonNullable<HostPage["counts"]>>(
          (total, page) => ({
            total: total.total + page!.counts!.total,
            open: total.open + page!.counts!.open,
            done: total.done + page!.counts!.done,
            user: total.user + page!.counts!.user,
            agent: total.agent + page!.counts!.agent,
            unknown: total.unknown + page!.counts!.unknown,
            matching: total.matching + page!.counts!.matching,
          }),
          { total: 0, open: 0, done: 0, user: 0, agent: 0, unknown: 0, matching: 0 },
        )
      : undefined;
  const coverage =
    complete && pages.every((page) => page?.coverage === "loaded_history")
      ? "loaded_history"
      : "not_loaded";
  return { counts, coverage, incompleteHostCount };
}

export function useGlobalStream(
  options: StreamListOptions & { serverId: string | null; enabled: boolean },
) {
  const hosts = useHosts();
  const queryClient = useQueryClient();
  const runtime = getHostRuntimeStore();
  useSyncExternalStore(
    (notify) => runtime.subscribeAll(notify),
    () => runtime.getVersion(),
    () => runtime.getVersion(),
  );
  const sessions = useSessionStore((state) => state.sessions);
  const selected = hosts.filter((host) => !options.serverId || host.serverId === options.serverId);
  const identity = streamQueryIdentity(
    options,
    selected.map((host) => host.serverId),
  );
  const [pagination, setPagination] = useState<StreamPagination>({ identity, depth: 1 });
  const depth = effectiveStreamDepth(pagination, identity);
  const availability = selected.map((host) => {
    if (!isHostRuntimeConnected(runtime.getSnapshot(host.serverId))) return "offline";
    // COMPAT(globalStream): TMAD intake 2026-10-24; remove after 2027-04-24.
    const features = sessions[host.serverId]?.serverInfo?.features;
    if (!(options.agentId ? features?.trackedAsks : features?.globalStream)) return "upgrade";
    if (options.includeMessageInventory && !features?.streamMessageInventory) return "upgrade";
    return "online";
  });
  const results = useFetchQueries<HostPage>(
    selected.map((host, index) => ({
      queryKey: [
        "global-stream",
        host.serverId,
        options.agentId,
        options.asksOnly,
        options.includeMessageInventory,
        options.sourceRole,
        options.state,
        options.filter,
        options.search,
        options.includeArchived,
        depth,
      ],
      dataShape: "value",
      staleTimeMs: 10_000,
      enabled: options.enabled && availability[index] === "online",
      refetchInterval: options.enabled && availability[index] === "online" ? 15_000 : false,
      queryFn: async () => {
        const client = runtime.getClient(host.serverId);
        if (!client) throw new Error("Host disconnected");
        const rows: StreamRow[] = [];
        let cursor: string | undefined;
        let counts: HostPage["counts"];
        let coverage: HostPage["coverage"];
        for (let page = 0; page < depth; page++) {
          const result = await client.listGlobalStream({
            agentId: options.agentId,
            asksOnly: options.asksOnly,
            includeMessageInventory: options.includeMessageInventory,
            sourceRole: options.sourceRole,
            state: options.state,
            filter: options.filter,
            search: options.search,
            includeArchived: options.includeArchived,
            cursor,
            limit: 50,
          });
          rows.push(...result.rows);
          counts = result.counts;
          coverage = result.coverage;
          cursor = result.nextCursor ?? undefined;
          if (!cursor) break;
        }
        return { rows, counts, coverage, hasMore: Boolean(cursor) };
      },
    })),
  );
  const rows = useMemo(() => {
    const byId = new Map<string, GlobalStreamRow>();
    for (const [index, result] of results.entries()) {
      const host = selected[index];
      let data = result.data;
      for (let prior = depth - 1; !data && prior > 0; prior--) {
        data = queryClient.getQueryData<HostPage>([
          "global-stream",
          host.serverId,
          options.agentId,
          options.asksOnly,
          options.includeMessageInventory,
          options.sourceRole,
          options.state,
          options.filter,
          options.search,
          options.includeArchived,
          prior,
        ]);
      }
      for (const row of data?.rows ?? [])
        byId.set(
          JSON.stringify([host.serverId, row.id]),
          Object.assign({}, row, { serverId: host.serverId, serverLabel: host.label }),
        );
    }
    return [...byId.values()].sort(
      (a, b) =>
        b.timestamp.localeCompare(a.timestamp) ||
        a.serverId.localeCompare(b.serverId) ||
        a.id.localeCompare(b.id),
    );
  }, [
    results,
    selected,
    depth,
    queryClient,
    options.agentId,
    options.asksOnly,
    options.includeMessageInventory,
    options.sourceRole,
    options.state,
    options.filter,
    options.search,
    options.includeArchived,
  ]);
  const notices = selected.flatMap((host, index) => {
    if (availability[index] === "offline")
      return [`${host.label}: offline — cached items may be out of date`];
    if (availability[index] === "upgrade")
      return [`${host.label}: update this host to use global Stream`];
    const error = results[index].error;
    return error ? [`${host.label}: ${error.message}`] : [];
  });
  const refetch = useCallback(
    () =>
      Promise.all(
        results.map((result, index) =>
          availability[index] === "online" ? result.refetch() : Promise.resolve(),
        ),
      ),
    [results, availability],
  );
  const summary = summarizeHostPages(
    results.map((result) => result.data),
    availability,
    results.map((result) => result.error),
  );
  const fetchNextPage = useCallback(
    () => setPagination((value) => advanceStreamDepth(value, identity)),
    [identity],
  );
  return {
    rows,
    counts: summary.counts,
    coverage: summary.coverage,
    incompleteHostCount: summary.incompleteHostCount,
    notices,
    refetch,
    fetchNextPage,
    isLoading: results.some((result) => result.isLoading),
    isFetching: results.some((result) => result.isFetching),
    isFetchingNextPage: depth > 1 && results.some((result) => result.isFetching),
    hasNextPage: results.some((result) => result.data?.hasMore),
  };
}
