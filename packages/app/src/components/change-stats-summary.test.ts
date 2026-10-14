import { emptyChangeBreakdown, type ChangeBreakdown } from "@getpaseo/protocol/diff-stat";
import { describe, expect, it } from "vitest";
import { summarizeChangeStats } from "./change-stats-summary";

function mixedBreakdown(): ChangeBreakdown {
  const breakdown = emptyChangeBreakdown();
  breakdown.code = { additions: 2, deletions: 1 };
  breakdown.config = { additions: 7, deletions: 3 };
  return breakdown;
}

describe("summarizeChangeStats", () => {
  it("shows production next to the total for an advertised breakdown", () => {
    expect(
      summarizeChangeStats({
        additions: 9,
        deletions: 4,
        breakdown: mixedBreakdown(),
        supported: true,
      }),
    ).toEqual({
      production: { additions: 2, deletions: 1 },
      showProduction: true,
      estimated: false,
    });
  });

  it("keeps config out of production and shows the total alone for a config-only change", () => {
    const breakdown = emptyChangeBreakdown();
    breakdown.config = { additions: 7, deletions: 3 };
    expect(
      summarizeChangeStats({ additions: 7, deletions: 3, breakdown, supported: true }),
    ).toEqual({
      production: { additions: 0, deletions: 0 },
      showProduction: false,
      estimated: false,
    });
  });

  it("ignores a breakdown the host did not advertise", () => {
    expect(
      summarizeChangeStats({
        additions: 9,
        deletions: 4,
        breakdown: mixedBreakdown(),
        supported: false,
      }),
    ).toEqual({ production: null, showProduction: false, estimated: false });
  });

  it("renders nothing when there are no changes", () => {
    expect(
      summarizeChangeStats({
        additions: 0,
        deletions: 0,
        breakdown: emptyChangeBreakdown(),
        supported: true,
      }),
    ).toBeNull();
  });

  it("marks a production portion that includes estimated lines", () => {
    const breakdown = emptyChangeBreakdown();
    breakdown.code = { additions: 2, deletions: 1 };
    breakdown.commentsIncluded = { additions: 1, deletions: 0 };
    const summary = summarizeChangeStats({
      additions: 3,
      deletions: 1,
      breakdown,
      supported: true,
    });
    expect(summary?.estimated).toBe(true);
  });
});
