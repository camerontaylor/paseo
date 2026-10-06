import { expect, test } from "vitest";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";
import { SessionSearchWriteBuffer } from "./session-search-write-buffer.js";

test("search write buffer releases successful chunks while retaining complete failed coverage", () => {
  const buffer = new SessionSearchWriteBuffer();
  const failed: AgentTimelineRow[] = [];
  for (let seq = 1; seq <= 1000; seq++) {
    const row: AgentTimelineRow = {
      seq,
      timestamp: "2026-10-04T00:00:00Z",
      item: { type: "assistant_message", text: `chunk ${seq}` },
    };
    buffer.retain([row]);
    if (seq % 2 === 0) buffer.release([row]);
    else failed.push(row);
  }
  expect(buffer.snapshot()).toEqual(failed);
  for (let seq = 1001; seq <= 1399; seq++) {
    const row: AgentTimelineRow = {
      seq,
      timestamp: "2026-10-04T00:00:00Z",
      item: { type: "notification", level: "info", message: "Progress" },
    };
    buffer.retain([row]);
    buffer.release([row]);
  }
  expect(buffer.snapshot()).toEqual(failed);
  const boundary: AgentTimelineRow = {
    seq: 1400,
    timestamp: "2026-10-04T00:00:00Z",
    item: { type: "user_message", text: "Next" },
  };
  buffer.retain([boundary]);
  expect(buffer.snapshot()).toEqual([boundary]);
  buffer.release([boundary]);
  expect(buffer.snapshot()).toEqual([]);
});
