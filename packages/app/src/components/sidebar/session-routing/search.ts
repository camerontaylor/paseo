import type { SessionSearchResult } from "@getpaseo/protocol/messages";
import type { Recipient } from "./model";

export interface SearchHost {
  serverId: string;
  label: string;
  connected: boolean;
  directoryReady: boolean;
  supportsSearch: boolean;
  search: (
    query: string,
    workspaceIds: string[],
  ) => Promise<{
    results: SessionSearchResult[];
    searchedCount: number;
    totalCount: number;
  }>;
}

export interface SearchPlacement {
  serverId: string;
  workspaceId: string;
  projectViewKey: string;
}

export interface ScopedSearchResult {
  recipients: Recipient[];
  searchedCount: number;
  totalCount: number;
  incomplete: boolean;
  failures: { serverId: string; reason: string }[];
}

/** Search each selected host, retaining failures so Route can never auto-select from partial evidence. */
export async function searchScopedSessions(input: {
  query: string;
  scope: string | null;
  hosts: readonly SearchHost[];
  placements: readonly SearchPlacement[];
  hostRegistryReady: boolean;
}): Promise<ScopedSearchResult> {
  const placements = input.placements.filter(
    (placement) => input.scope === null || placement.projectViewKey === input.scope,
  );
  const byWorkspace = new Map(
    placements.map((placement) => [
      JSON.stringify([placement.serverId, placement.workspaceId]),
      placement,
    ]),
  );
  const outcomes = await Promise.allSettled(
    input.hosts.map(async (host) => {
      if (!host.directoryReady) throw new Error("Conversation directory is unavailable.");
      const workspaceIds = placements
        .filter((placement) => placement.serverId === host.serverId)
        .map((placement) => placement.workspaceId);
      if (workspaceIds.length === 0)
        return { recipients: [] as Recipient[], searchedCount: 0, totalCount: 0 };
      if (!host.connected) throw new Error("Host is offline.");
      if (!host.supportsSearch) throw new Error("Update this host to search conversations.");
      const response = await host.search(input.query, workspaceIds);
      const recipients = response.results.map((result): Recipient => {
        const placement = byWorkspace.get(JSON.stringify([host.serverId, result.workspaceId]));
        if (!placement) throw new Error("Host returned a conversation outside the selected scope.");
        return {
          ...result,
          serverId: host.serverId,
          hostLabel: host.label,
          projectViewKey: placement.projectViewKey,
        };
      });
      return { recipients, searchedCount: response.searchedCount, totalCount: response.totalCount };
    }),
  );
  const failures: ScopedSearchResult["failures"] = input.hostRegistryReady
    ? []
    : [{ serverId: "", reason: "Host directory has not loaded." }];
  const recipients: Recipient[] = [];
  let searchedCount = 0;
  let totalCount = 0;
  outcomes.forEach((outcome, index) => {
    if (outcome.status === "rejected") {
      failures.push({
        serverId: input.hosts[index]!.serverId,
        reason: outcome.reason instanceof Error ? outcome.reason.message : "Search failed.",
      });
      return;
    }
    recipients.push(...outcome.value.recipients);
    searchedCount += outcome.value.searchedCount;
    totalCount += outcome.value.totalCount;
  });
  recipients.sort((left, right) => right.confidence - left.confidence);
  return { recipients, searchedCount, totalCount, failures, incomplete: failures.length > 0 };
}
