import { expect, test } from "vitest";
import { searchScopedSessions, type SearchHost } from "./search";
import { selectRouteBestMatch } from "./model";

const result = {
  agentId: "a",
  workspaceId: "w",
  projectId: "p",
  projectName: "Project",
  title: "Chat",
  excerpt: "topic",
  excerptSource: "title" as const,
  updatedAt: "2026-10-24T00:00:00Z",
  confidence: 0.96,
};
const host: SearchHost = {
  serverId: "h1",
  label: "Main",
  connected: true,
  directoryReady: true,
  supportsSearch: true,
  search: async () => ({ results: [result], searchedCount: 1, totalCount: 1 }),
};
const placements = [{ serverId: "h1", workspaceId: "w", projectViewKey: "p" }];

test("scoped search maps host identity and never auto-routes after one host fails", async () => {
  const search = await searchScopedSessions({
    query: "topic",
    scope: null,
    placements: [...placements, { serverId: "h2", workspaceId: "w2", projectViewKey: "p" }],
    hostRegistryReady: true,
    hosts: [
      host,
      {
        ...host,
        serverId: "h2",
        search: async () => {
          throw new Error("setup required");
        },
      },
    ],
  });
  expect(search.recipients[0]).toMatchObject({ serverId: "h1", hostLabel: "Main" });
  expect(search.failures).toEqual([{ serverId: "h2", reason: "setup required" }]);
  expect(search.incomplete ? null : selectRouteBestMatch(search.recipients)).toBeNull();
});

test("search rejects a host result outside the selected project", async () => {
  const search = await searchScopedSessions({
    query: "topic",
    scope: "p",
    placements,
    hostRegistryReady: true,
    hosts: [
      {
        ...host,
        search: async () => ({
          results: [{ ...result, workspaceId: "other" }],
          searchedCount: 1,
          totalCount: 1,
        }),
      },
    ],
  });
  expect(search.recipients).toEqual([]);
  expect(search.incomplete).toBe(true);
});
