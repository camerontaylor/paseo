import { describe, expect, it } from "vitest";
import { formatMessageTimestamp } from "@/utils/time";
import { getAssistantTurnFooterLabels } from "./assistant-turn-footer-label";

describe("assistant turn footer labels", () => {
  const now = new Date(2026, 9, 6, 17);
  const completedAt = new Date(2026, 9, 6, 16, 32);
  const startedAt = new Date(2026, 9, 6, 16, 26);

  it("keeps completion and duration visible and reveals the real start separately", () => {
    expect(
      getAssistantTurnFooterLabels({ startedAt, completedAt, durationMs: 360_000, now }),
    ).toEqual({
      label: `Finished ${formatMessageTimestamp(completedAt, now)} · 6m`,
      hoverLabel: `Started ${formatMessageTimestamp(startedAt, now)}`,
    });
  });

  it("shows completion without inventing an unknown duration or start", () => {
    expect(getAssistantTurnFooterLabels({ completedAt, durationMs: null, now })).toEqual({
      label: `Finished ${formatMessageTimestamp(completedAt, now)}`,
      hoverLabel: "",
    });
  });

  it("retains duration-only wording when completion is missing or invalid", () => {
    for (const completion of [undefined, new Date(NaN)]) {
      expect(
        getAssistantTurnFooterLabels({ completedAt: completion, durationMs: 7000, now }),
      ).toEqual({
        label: "Worked for 7s",
        hoverLabel: "",
      });
    }
  });

  it("does not render invalid times or invalid durations", () => {
    for (const durationMs of [undefined, null, -1, NaN, Infinity]) {
      expect(
        getAssistantTurnFooterLabels({
          completedAt: new Date(NaN),
          startedAt: new Date(NaN),
          durationMs,
          now,
        }),
      ).toEqual({ label: "", hoverLabel: "" });
    }
  });

  it("retains a known zero duration", () => {
    expect(getAssistantTurnFooterLabels({ completedAt, durationMs: 0, now }).label).toBe(
      `Finished ${formatMessageTimestamp(completedAt, now)} · 0s`,
    );
  });
});
