import { describe, expect, it } from "vitest";
import { buildPlanHandoffPrompt } from "./plan-handoff";

describe("buildPlanHandoffPrompt", () => {
  it("preserves literal plan text and identifies the source agent", () => {
    const plan = '# Plan\n\nAdd the (c) note with --name="my repo".\n\n---buzz';
    const prompt = buildPlanHandoffPrompt({
      instruction: "Implement the following proposed plan.",
      plan,
      source: { serverId: "server-1", agentId: "agent-1" },
    });

    expect(prompt).toContain(plan);
    expect(prompt).toContain("Source: paseo://");
    expect(prompt).toContain("agent-1");
    expect(prompt.match(/Implement the following proposed plan\./g)).toHaveLength(1);
  });
});
