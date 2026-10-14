import { emptyChangeBreakdown } from "@getpaseo/protocol/diff-stat";
import { describe, expect, it } from "vitest";
import type {
  WorkspaceDescriptorPayload,
  WorkspaceUpdatePayload,
} from "@getpaseo/protocol/messages";
import { isDuplicateWorkspaceUpdate } from "./session.js";

// The predicate only reads `kind` and deep-compares the descriptor, so a minimal
// payload keeps the test focused; the Session call site supplies full payloads.
function descriptorWith(
  diffStat: WorkspaceDescriptorPayload["diffStat"],
): WorkspaceDescriptorPayload {
  return { id: "ws-1", diffStat } as unknown as WorkspaceDescriptorPayload;
}

function upsert(workspace: WorkspaceDescriptorPayload): WorkspaceUpdatePayload {
  return { kind: "upsert", workspace } as unknown as WorkspaceUpdatePayload;
}

function breakdownWithCode(additions: number, deletions: number) {
  const breakdown = emptyChangeBreakdown();
  breakdown.code = { additions, deletions };
  return breakdown;
}

describe("workspace descriptor emission", () => {
  it("suppresses an identical descriptor", () => {
    const workspace = descriptorWith({
      additions: 2,
      deletions: 1,
      breakdown: breakdownWithCode(2, 1),
    });
    expect(isDuplicateWorkspaceUpdate(upsert(workspace), descriptorWith(workspace.diffStat))).toBe(
      true,
    );
  });

  it("emits when the totals are unchanged but the breakdown changed", () => {
    const previous = descriptorWith({
      additions: 9,
      deletions: 4,
      breakdown: breakdownWithCode(9, 4),
    });
    const next = descriptorWith({
      additions: 9,
      deletions: 4,
      breakdown: breakdownWithCode(2, 1),
    });
    expect(isDuplicateWorkspaceUpdate(upsert(previous), next)).toBe(false);
  });

  it("emits when the breakdown appears or disappears", () => {
    const withoutBreakdown = descriptorWith({ additions: 2, deletions: 1 });
    const withBreakdown = descriptorWith({
      additions: 2,
      deletions: 1,
      breakdown: breakdownWithCode(2, 1),
    });
    expect(isDuplicateWorkspaceUpdate(upsert(withoutBreakdown), withBreakdown)).toBe(false);
    expect(isDuplicateWorkspaceUpdate(upsert(withBreakdown), withoutBreakdown)).toBe(false);
  });

  it("emits when there is no previous upsert to compare against", () => {
    const workspace = descriptorWith({
      additions: 2,
      deletions: 1,
      breakdown: breakdownWithCode(2, 1),
    });
    expect(isDuplicateWorkspaceUpdate(undefined, workspace)).toBe(false);
    expect(
      isDuplicateWorkspaceUpdate(
        { kind: "remove", workspaceId: "ws-1" } as unknown as WorkspaceUpdatePayload,
        workspace,
      ),
    ).toBe(false);
  });
});
