import type { WorkspaceTabScope, WorkspaceTabTarget } from "@/workspace-tabs/model";

export interface WorkspaceTabDescriptor {
  key: string;
  tabId: string;
  kind: WorkspaceTabTarget["kind"];
  target: WorkspaceTabTarget;
  state?: import("@getpaseo/protocol/agent-types").JsonValue;
  /** Owning host/workspace when the tab is shown in a cross-workspace View. */
  scope?: WorkspaceTabScope;
}
