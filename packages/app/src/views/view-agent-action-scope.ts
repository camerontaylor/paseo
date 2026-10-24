import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import type { WorkspaceTabScope } from "@/workspace-tabs/model";

/** Context actions use the clicked tab, since agent ids can repeat on different hosts. */
export function viewAgentActionScope(
  tab: WorkspaceTabDescriptor | undefined,
  agentId: string,
): WorkspaceTabScope | null {
  return tab?.target.kind === "agent" && tab.target.agentId === agentId
    ? (tab.scope ?? null)
    : null;
}
