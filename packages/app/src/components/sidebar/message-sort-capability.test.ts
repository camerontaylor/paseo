import { expect, it } from "vitest";
import { messageSortAvailability, effectiveSidebarSortMode } from "./message-sort-capability";
it("waits for server info, detects old hosts, and restores the selected activity sort when supported", () => {
  expect(messageSortAvailability([])).toBe("loading");
  expect(messageSortAvailability([true, undefined])).toBe("loading");
  expect(messageSortAvailability([true, false])).toBe("unsupported");
  expect(messageSortAvailability([true, true])).toBe("ready");
  for (const mode of ["recent", "user"] as const) {
    expect(effectiveSidebarSortMode(mode, "loading")).toBe("manual");
    expect(effectiveSidebarSortMode(mode, "unsupported")).toBe("manual");
    expect(effectiveSidebarSortMode(mode, "ready")).toBe(mode);
  }
  expect(effectiveSidebarSortMode("title", "unsupported")).toBe("title");
  expect(effectiveSidebarSortMode("manual", "unsupported")).toBe("manual");
});
