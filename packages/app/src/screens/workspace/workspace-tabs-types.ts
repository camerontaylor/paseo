import type { WorkspaceTabScope, WorkspaceTabTarget } from "@/workspace-tabs/model";

export interface WorkspaceTabDescriptor {
  key: string;
  tabId: string;
  kind: WorkspaceTabTarget["kind"];
  target: WorkspaceTabTarget;
  scope?: WorkspaceTabScope;
  state?: import("@getpaseo/protocol/agent-types").JsonValue;
}
