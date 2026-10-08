import { describe, expect, it } from "vitest";
import { selectHostFeature, type HostFeatureSessionState } from "./host-features";

function stateWith(serverId: string, features: Record<string, boolean> | undefined) {
  return {
    sessions: {
      [serverId]: { serverInfo: features === undefined ? null : { features } },
    },
  } as unknown as HostFeatureSessionState;
}

describe("selectHostFeature", () => {
  it("reports companionStreamPortV1 as supported when the daemon advertises it", () => {
    const state = stateWith("srv", { companionStreamPortV1: true });
    expect(selectHostFeature(state, "srv", "companionStreamPortV1")).toBe(true);
  });

  it("reports the feature as absent on an older daemon without it", () => {
    // Old daemons never send the flag, and unknown feature keys must not
    // read as supported: the Stream panel shows its update-host notice.
    const state = stateWith("srv", { providerUsageList: true });
    expect(selectHostFeature(state, "srv", "companionStreamPortV1")).toBe(false);
  });

  it("is absent before the session has server info", () => {
    expect(selectHostFeature(stateWith("srv", undefined), "srv", "companionStreamPortV1")).toBe(
      false,
    );
    expect(selectHostFeature(stateWith("srv", undefined), "missing", "companionStreamPortV1")).toBe(
      false,
    );
  });
});
