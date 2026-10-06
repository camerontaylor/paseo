import { describe, expect, it } from "vitest";
import {
  advanceMessageActivity,
  deriveHistoricalMessageActivity,
  emptyMessageActivity,
} from "./message-activity.js";

describe("message activity clocks", () => {
  it("advances the selected role without moving the other role backwards", () => {
    const user = advanceMessageActivity(emptyMessageActivity(), "user", "2026-10-01T10:00:00Z");
    const reply = advanceMessageActivity(user, "assistant", new Date("2026-10-01T10:01:00Z"));
    expect(reply).toEqual({
      lastUserMessageAt: "2026-10-01T10:00:00.000Z",
      lastAssistantMessageAt: "2026-10-01T10:01:00.000Z",
    });
    expect(advanceMessageActivity(reply, "user", "2026-09-01T00:00:00Z")).toBe(reply);
    expect(advanceMessageActivity(reply, "assistant", "2026-10-01T10:01:00Z")).toBe(reply);
  });

  it("ignores unknown and invalid dates instead of substituting the current time", () => {
    const empty = emptyMessageActivity();
    for (const timestamp of [undefined, "", "not a date", new Date(Number.NaN)]) {
      expect(advanceMessageActivity(empty, "user", timestamp)).toBe(empty);
    }
  });

  it("compares equivalent time zones numerically", () => {
    const original = advanceMessageActivity(
      emptyMessageActivity(),
      "user",
      "2026-10-01T12:00:00+02:00",
    );
    expect(original.lastUserMessageAt).toBe("2026-10-01T10:00:00.000Z");
    expect(advanceMessageActivity(original, "user", "2026-10-01T09:30:00Z")).toBe(original);
  });
});

describe("historical message activity", () => {
  it("recovers the newest timestamp for each role from unordered history", () => {
    expect(
      deriveHistoricalMessageActivity([
        {
          item: { type: "assistant_message", text: "Latest reply" },
          timestamp: "2026-10-01T10:03:00Z",
        },
        { item: { type: "user_message", text: "First prompt" }, timestamp: "2026-10-01T10:00:00Z" },
        {
          item: { type: "assistant_message", text: "First reply" },
          timestamp: "2026-10-01T10:01:00Z",
        },
        { item: { type: "user_message", text: "Follow-up" }, timestamp: "2026-10-01T10:02:00Z" },
      ]),
    ).toEqual({
      lastUserMessageAt: "2026-10-01T10:02:00.000Z",
      lastAssistantMessageAt: "2026-10-01T10:03:00.000Z",
    });
  });

  it("does not turn undated history, system notifications or empty replies into activity", () => {
    expect(
      deriveHistoricalMessageActivity([
        { item: { type: "user_message", text: "Undated prompt" } },
        { item: { type: "assistant_message", text: "Undated reply" } },
        { item: { type: "assistant_message", text: "Invalid date" }, timestamp: "invalid" },
        { item: { type: "assistant_message", text: "  " }, timestamp: "2026-10-06T00:00:00Z" },
        {
          item: { type: "user_message", text: "<paseo-system>\nchild finished\n</paseo-system>" },
          timestamp: "2026-10-06T00:00:00Z",
        },
        { item: { type: "reasoning", text: "Thinking" }, timestamp: "2026-10-06T00:00:00Z" },
        {
          item: { type: "notification", level: "info", message: "Model changed" },
          timestamp: "2026-10-06T00:00:00Z",
        },
        { item: { type: "todo", items: [] }, timestamp: "2026-10-06T00:00:00Z" },
        {
          item: {
            type: "tool_call",
            callId: "tool",
            name: "shell",
            status: "completed",
            error: null,
            detail: { type: "unknown", input: {}, output: {} },
          },
          timestamp: "2026-10-06T00:00:00Z",
        },
      ]),
    ).toEqual(emptyMessageActivity());
  });

  it("accepts a dated empty user message such as an attachment-only prompt", () => {
    expect(
      deriveHistoricalMessageActivity([
        { item: { type: "user_message", text: "" }, timestamp: "2026-10-01T10:00:00Z" },
      ]),
    ).toEqual({ lastUserMessageAt: "2026-10-01T10:00:00.000Z", lastAssistantMessageAt: null });
  });
});
