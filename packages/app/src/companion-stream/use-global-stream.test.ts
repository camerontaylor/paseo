import { describe, expect, it, vi } from "vitest";
vi.mock("@/runtime/host-runtime", () => ({}));
vi.mock("@/stores/session-store", () => ({}));
vi.mock("@/data/query", () => ({}));
import type { StreamListOptions } from "@getpaseo/protocol/global-stream";
import {
  advanceStreamDepth,
  effectiveStreamDepth,
  streamQueryIdentity,
  summarizeHostPages,
  type HostPage,
} from "./use-global-stream";

const page = (total: number, coverage: HostPage["coverage"] = "loaded_history"): HostPage => ({
  rows: [],
  hasMore: false,
  coverage,
  counts: {
    total,
    open: total,
    done: 0,
    user: total,
    agent: 0,
    unknown: 0,
    matching: total,
  },
});

describe("global Stream host summaries", () => {
  it("sums complete hosts and does not present a partial host as a global total", () => {
    expect(summarizeHostPages([page(2), page(3)], ["online", "online"], [null, null])).toEqual({
      counts: {
        total: 5,
        open: 5,
        done: 0,
        user: 5,
        agent: 0,
        unknown: 0,
        matching: 5,
      },
      coverage: "loaded_history",
      incompleteHostCount: 0,
    });
    const offline = summarizeHostPages([page(2), undefined], ["online", "offline"], [null, null]);
    expect(offline).toEqual({
      counts: undefined,
      coverage: "not_loaded",
      incompleteHostCount: 1,
    });
    const failed = summarizeHostPages(
      [page(2), page(3)],
      ["online", "online"],
      [null, new Error("failed")],
    );
    expect(failed.counts).toBeUndefined();
    expect(failed.coverage).toBe("not_loaded");
    expect(failed.incompleteHostCount).toBe(1);
  });

  it("resets page depth when a filter or selected host changes", () => {
    const options: StreamListOptions & { serverId: string | null } = {
      serverId: null,
      filter: "all",
    };
    const initial = streamQueryIdentity(options, ["a", "b"]);
    const loaded = advanceStreamDepth(
      advanceStreamDepth({ identity: initial, depth: 1 }, initial),
      initial,
    );
    expect(effectiveStreamDepth(loaded, initial)).toBe(3);
    const searched = streamQueryIdentity({ ...options, search: "needle" }, ["a", "b"]);
    expect(effectiveStreamDepth(loaded, searched)).toBe(1);
    expect(advanceStreamDepth(loaded, searched)).toEqual({ identity: searched, depth: 2 });
    const oneHost = streamQueryIdentity(options, ["a"]);
    expect(effectiveStreamDepth(loaded, oneHost)).toBe(1);
  });
});
