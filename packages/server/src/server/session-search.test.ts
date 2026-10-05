import { expect, test, vi } from "vitest";
import {
  searchExistingSessions,
  type SessionSearchCandidate,
  type SessionSearchRanking,
} from "./session-search.js";
const candidate: SessionSearchCandidate = {
  agentId: "chat",
  workspaceId: "workspace",
  projectId: "project",
  projectName: "Paseo",
  title: "Offline indicator",
  cwd: "/fixture",
  updatedAt: "2026-10-01",
  excerpts: ["Offline indicator"],
};
function fixture(matches: SessionSearchRanking["matches"]) {
  return {
    query: "Where were we working on the offline indicator?",
    workspaceIds: ["workspace"],
    candidates: [candidate],
    readContext: vi.fn(async () => ["Relay reconnect investigation"]),
    generate: vi.fn(async () => ({ matches })),
  };
}
test("returns only existing scoped IDs and verbatim evidence", async () => {
  const input = fixture([{ agentId: "chat", confidence: 0.95, excerptIndex: 1 }]);
  input.candidates.push({ ...candidate, agentId: "outside", workspaceId: "other" });
  expect((await searchExistingSessions(input)).results).toEqual([
    {
      agentId: "chat",
      workspaceId: "workspace",
      projectId: "project",
      projectName: "Paseo",
      title: "Offline indicator",
      excerpt: "Relay reconnect investigation",
      confidence: 0.95,
    },
  ]);
  expect(input.readContext).toHaveBeenCalledTimes(1);
});
test("rejects fabricated destinations or evidence", async () => {
  await expect(
    searchExistingSessions(fixture([{ agentId: "invented", confidence: 1, excerptIndex: 0 }])),
  ).rejects.toThrow("invalid conversation");
  await expect(
    searchExistingSessions(fixture([{ agentId: "chat", confidence: 1, excerptIndex: 9 }])),
  ).rejects.toThrow("invalid evidence");
});
test("no matching session is an empty result and empty scope does not generate", async () => {
  expect((await searchExistingSessions(fixture([]))).results).toEqual([]);
  const input = fixture([]);
  input.workspaceIds = [];
  expect(await searchExistingSessions(input)).toEqual({
    results: [],
    searchedCount: 0,
    totalCount: 0,
  });
  expect(input.generate).not.toHaveBeenCalled();
  expect(input.readContext).not.toHaveBeenCalled();
});
test("shortlists before timeline reads and exposes incomplete coverage", async () => {
  const input = fixture([]);
  input.candidates = Array.from({ length: 150 }, (_, i) => ({
    ...candidate,
    agentId: `chat-${i}`,
  }));
  expect(await searchExistingSessions(input)).toMatchObject({
    searchedCount: 100,
    totalCount: 150,
  });
  expect(input.readContext).toHaveBeenCalledTimes(100);
});
