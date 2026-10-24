import { describe, expect, it, vi } from "vitest";
import { buildWorkspaceTabMenuEntries } from "@/screens/workspace/workspace-tab-menu";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { viewAgentActionScope } from "@/views/view-agent-action-scope";

describe("View agent tab context actions", () => {
  it("passes the clicked tab scope through Resume and Reload when two hosts share an agent id", () => {
    const hostA: WorkspaceTabDescriptor = {
      key: "host-a-agent",
      tabId: "host-a-agent",
      kind: "agent",
      target: { kind: "agent", agentId: "same-id" },
      scope: { serverId: "host-a", workspaceId: "workspace-a" },
    };
    const hostB: WorkspaceTabDescriptor = {
      ...hostA,
      key: "host-b-agent",
      tabId: "host-b-agent",
      scope: { serverId: "host-b", workspaceId: "workspace-b" },
    };
    const resumeScopes: unknown[] = [];
    const reloadScopes: unknown[] = [];
    const entries = buildWorkspaceTabMenuEntries({
      surface: "desktop",
      tab: hostB,
      index: 1,
      tabCount: 2,
      menuTestIDBase: "host-b-agent",
      onCopyResumeCommand: (agentId, tab) => {
        resumeScopes.push(viewAgentActionScope(tab, agentId));
      },
      onReloadAgent: (agentId, tab) => {
        reloadScopes.push(viewAgentActionScope(tab, agentId));
      },
      onCopyAgentId: vi.fn(),
      onCopyTerminalId: vi.fn(),
      onCopyFilePath: vi.fn(),
      onRenameTab: vi.fn(),
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
    });
    for (const key of ["copy-resume-command", "reload-agent"]) {
      const entry = entries.find((candidate) => candidate.kind === "item" && candidate.key === key);
      if (!entry || entry.kind !== "item") throw new Error("Missing agent action");
      entry.onSelect();
    }
    expect(viewAgentActionScope(hostA, "same-id")).toEqual(hostA.scope);
    expect(resumeScopes).toEqual([hostB.scope]);
    expect(reloadScopes).toEqual([hostB.scope]);
    expect(viewAgentActionScope(hostB, "another-id")).toBeNull();
  });
});
