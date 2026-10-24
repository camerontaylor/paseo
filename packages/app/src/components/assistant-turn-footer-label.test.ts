import { describe, expect, it } from "vitest";

import { i18n } from "@/i18n/i18next";
import { formatMessageTimestamp } from "@/utils/time";
import { getAssistantTurnFooterLabel, getTurnDurationLabel } from "./assistant-turn-footer-label";

describe("getTurnDurationLabel", () => {
  it("says how long the turn worked", () => {
    expect(getTurnDurationLabel(14_000, i18n.t)).toBe("Worked for 14s");
  });

  it("reads in the active app language", async () => {
    await i18n.changeLanguage("fr");
    try {
      expect(getTurnDurationLabel(14_000, i18n.t)).toBe("A travaillé pendant 14s");
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});

describe("getAssistantTurnFooterLabel", () => {
  it("shows the completion clock and duration together", () => {
    const completedAt = new Date(2026, 9, 6, 16, 32);
    const label = getAssistantTurnFooterLabel(completedAt, 14_000, i18n.t);
    expect(label).toContain(formatMessageTimestamp(completedAt));
    expect(label).toContain("Worked for 14s");
  });

  it("does not invent missing timing", () => {
    expect(getAssistantTurnFooterLabel(undefined, null, i18n.t)).toBe("");
    expect(getAssistantTurnFooterLabel(undefined, 0, i18n.t)).toBe("Worked for 0s");
  });
});
