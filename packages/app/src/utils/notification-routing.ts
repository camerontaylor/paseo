import type { Href } from "expo-router";
import {
  buildHostRootRoute,
  buildHostWorkspaceRoute,
  buildHostWorkspaceOpenRoute,
} from "@/utils/host-routes";

type NotificationData = Record<string, unknown> | null | undefined;
type NotificationRoute = Extract<Href, string>;

function readNonEmptyString(data: NotificationData, key: string): string | null {
  const value = data?.[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveNotificationTarget(data: NotificationData): {
  serverId: string | null;
  agentId: string | null;
  workspaceId: string | null;
  terminalId: string | null;
} {
  return {
    serverId: readNonEmptyString(data, "serverId"),
    agentId: readNonEmptyString(data, "agentId"),
    workspaceId: readNonEmptyString(data, "workspaceId"),
    terminalId: readNonEmptyString(data, "terminalId"),
  };
}

export function buildNotificationRoute(data: NotificationData): NotificationRoute {
  const { serverId, agentId, workspaceId, terminalId } = resolveNotificationTarget(data);
  if (serverId && workspaceId && agentId) {
    return buildHostWorkspaceOpenRoute(serverId, workspaceId, `agent:${agentId}`);
  }
  if (serverId && workspaceId && terminalId) {
    return buildHostWorkspaceOpenRoute(serverId, workspaceId, `terminal:${terminalId}`);
  }
  // FORK(workspace-snooze): wake links select the workspace without a chat target.
  if (serverId && workspaceId) return buildHostWorkspaceRoute(serverId, workspaceId);
  if (serverId) {
    return buildHostRootRoute(serverId);
  }
  return "/" as const;
}
