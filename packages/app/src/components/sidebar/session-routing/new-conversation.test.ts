import { describe, expect, it } from "vitest";
import { defaultNewConversationWorkspace, prepareNewConversationDraft } from "./new-conversation";

const scratch = {
  serverId: "host",
  workspaceId: "scratch",
  projectViewKey: "tmp",
  projectName: "tmpworkspace",
  name: "tmpworkspace",
  workspaceDirectory: "/Users/me/code/tmpworkspace",
  projectRootPath: "/Users/me/code/tmpworkspace",
};
const project = {
  ...scratch,
  workspaceId: "project",
  projectViewKey: "project",
  projectName: "Project",
  name: "Project",
  workspaceDirectory: "/repo",
  projectRootPath: "/repo",
};
const base = {
  serverIds: ["host"],
  workspaces: [scratch, project],
  scope: null,
  active: { serverId: "host", workspaceId: "project" },
};

describe("new conversation destination", () => {
  it("defaults All projects to host tmpworkspace instead of the active chat", () => {
    expect(defaultNewConversationWorkspace(base)).toEqual(scratch);
  });
  it("honors explicitly selected project scope", () => {
    expect(defaultNewConversationWorkspace({ ...base, scope: "project" })).toEqual(project);
  });
  it("requires a choice if scratch is missing, ambiguous or belongs to another host", () => {
    expect(defaultNewConversationWorkspace({ ...base, workspaces: [project] })).toBeNull();
    expect(
      defaultNewConversationWorkspace({
        ...base,
        workspaces: [scratch, { ...scratch, workspaceId: "other" }],
      }),
    ).toBeNull();
    expect(defaultNewConversationWorkspace({ ...base, serverIds: ["other"] })).toBeNull();
  });
  it("does not guess a host when multiple hosts are selected without context", () => {
    expect(
      defaultNewConversationWorkspace({ ...base, active: null, serverIds: ["host", "other"] }),
    ).toBeNull();
  });
});

describe("new conversation draft handoff", () => {
  it("persists the exact text before opening a unique new draft", async () => {
    const calls: unknown[] = [];
    await prepareNewConversationDraft({
      workspace: scratch,
      text: "  original\ntext ",
      draftId: "unique",
      save: (...args) => calls.push(args),
      flush: async () => {
        calls.push("persisted");
      },
      isEligible: () => true,
      navigate: (target) => calls.push(target),
    });
    expect(calls).toEqual([
      ["unique", "  original\ntext "],
      "persisted",
      { serverId: "host", workspaceId: "scratch", target: { kind: "draft", draftId: "unique" } },
    ]);
  });
  it("does not navigate after persistence failure or host exclusion", async () => {
    let navigated = false;
    let eligible = true;
    const input = {
      workspace: scratch,
      text: "keep",
      draftId: "unique",
      save: () => {},
      isEligible: () => eligible,
      navigate: () => {
        navigated = true;
      },
    };
    await expect(
      prepareNewConversationDraft({
        ...input,
        flush: async () => {
          throw new Error("disk");
        },
      }),
    ).rejects.toThrow("disk");
    await expect(
      prepareNewConversationDraft({
        ...input,
        flush: async () => {
          eligible = false;
        },
      }),
    ).rejects.toThrow("available workspace");
    expect(navigated).toBe(false);
  });
});
