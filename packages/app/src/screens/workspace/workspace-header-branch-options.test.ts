import { describe, expect, it } from "vitest";
import { baseBranchOptions } from "./workspace-header-branch-options";

describe("base branch options", () => {
  it("keeps colliding local and remote refs distinct and excludes only HEAD", () => {
    expect(
      baseBranchOptions({
        currentBranchName: "foo",
        branches: ["foo"],
        branchDetails: [
          {
            name: "foo",
            localRefs: ["refs/heads/foo", "refs/heads/origin/foo"],
            remoteRefs: ["refs/remotes/origin/foo"],
          },
        ],
      }),
    ).toEqual([
      { id: "refs/heads/origin/foo", label: "origin/foo (local)" },
      { id: "refs/remotes/origin/foo", label: "foo (origin)" },
    ]);
  });

  it("uses legacy names when qualified refs are unavailable", () => {
    expect(
      baseBranchOptions({ currentBranchName: "feature", branches: ["feature", "main"] }),
    ).toEqual([{ id: "main", label: "main" }]);
  });

  it("has no base choice when the checkout has no other branch or remote", () => {
    expect(
      baseBranchOptions({ currentBranchName: "main", branches: ["main"], branchDetails: [] }),
    ).toEqual([]);
  });
});
