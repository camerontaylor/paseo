import type { Agent } from "@/stores/session-store";

export type CloseAgentTabPolicy = { kind: "archive-on-close" } | { kind: "layout-only" };

export function resolveCloseAgentTabPolicy(
  agent: (Pick<Agent, "parentAgentId"> & Partial<Pick<Agent, "workspaceId">>) | null | undefined,
  layoutWorkspaceId?: string,
): CloseAgentTabPolicy {
  if (agent?.parentAgentId) {
    return { kind: "layout-only" };
  }

  if (layoutWorkspaceId && agent?.workspaceId && agent.workspaceId !== layoutWorkspaceId) {
    return { kind: "layout-only" };
  }
  return { kind: "archive-on-close" };
}
