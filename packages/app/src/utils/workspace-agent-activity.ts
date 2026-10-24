import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";
import { isWorkspaceRootAgent } from "@/subagents/policies";
import { deriveSidebarStateBucket } from "./sidebar-agent-state";

export interface WorkspaceAgentActivity {
  agentId: string;
  status: WorkspaceDescriptor["status"];
  enteredAt: Date | null;
  lastActivityAt: Date;
  lastMessageAt?: Date;
  lastUserMessageAt?: Date;
}

function workspaceAgentStatus(agent: Agent): Agent["status"] {
  if (agent.turn.phase === "open") return "running";
  return agent.status === "running" ? "idle" : agent.status;
}

export function buildWorkspaceAgentActivityIndex(
  agents: ReadonlyMap<string, Agent>,
  previous?: ReadonlyMap<string, WorkspaceAgentActivity>,
): Map<string, WorkspaceAgentActivity> {
  const activityByWorkspaceId = new Map<string, WorkspaceAgentActivity>();
  const latestActivityAtByWorkspaceId = new Map<string, Date>();
  const lastActivityAtByWorkspaceId = new Map<string, Date>();
  const lastMessageAtByWorkspaceId = new Map<string, Date>();
  const lastUserMessageAtByWorkspaceId = new Map<string, Date>();

  for (const agent of agents.values()) {
    const parentAgent = agent.parentAgentId ? agents.get(agent.parentAgentId) : undefined;
    if (agent.archivedAt || !agent.workspaceId || !isWorkspaceRootAgent(agent, parentAgent)) {
      continue;
    }

    recordLatest(lastActivityAtByWorkspaceId, agent.workspaceId, agent.lastActivityAt);
    recordMessageClocks(agent, lastMessageAtByWorkspaceId, lastUserMessageAtByWorkspaceId);

    const enteredAt = agent.attentionTimestamp ?? agent.updatedAt;
    const latestActivityAt = latestActivityAtByWorkspaceId.get(agent.workspaceId);
    if (latestActivityAt && enteredAt <= latestActivityAt) {
      continue;
    }
    latestActivityAtByWorkspaceId.set(agent.workspaceId, enteredAt);

    const status = deriveSidebarStateBucket({
      status: workspaceAgentStatus(agent),
      pendingPermissionCount: agent.pendingPermissions.length,
      requiresAttention: agent.requiresAttention,
      attentionReason: agent.attentionReason,
    });
    activityByWorkspaceId.set(agent.workspaceId, {
      agentId: agent.id,
      status,
      enteredAt,
      lastActivityAt: agent.lastActivityAt,
    });
  }

  for (const [workspaceId, activity] of activityByWorkspaceId) {
    activity.lastActivityAt =
      lastActivityAtByWorkspaceId.get(workspaceId) ?? activity.lastActivityAt;
    activity.lastMessageAt = lastMessageAtByWorkspaceId.get(workspaceId);
    activity.lastUserMessageAt = lastUserMessageAtByWorkspaceId.get(workspaceId);
    const previousActivity = previous?.get(workspaceId);
    activityByWorkspaceId.set(workspaceId, preservePreviousActivity(activity, previousActivity));
  }

  if (previous && areWorkspaceAgentActivityIndexesIdentical(previous, activityByWorkspaceId)) {
    return previous instanceof Map ? previous : new Map(previous);
  }
  return activityByWorkspaceId;
}

function recordMessageClocks(
  agent: Agent,
  lastMessageAtByWorkspaceId: Map<string, Date>,
  lastUserMessageAtByWorkspaceId: Map<string, Date>,
): void {
  if (!agent.workspaceId) return;
  const user = messageDate(agent.messageActivity?.lastUserMessageAt) ?? agent.createdAt;
  const assistant = messageDate(agent.messageActivity?.lastAssistantMessageAt);
  recordLatest(lastUserMessageAtByWorkspaceId, agent.workspaceId, user);
  recordLatest(
    lastMessageAtByWorkspaceId,
    agent.workspaceId,
    assistant && assistant > user ? assistant : user,
  );
}

function preservePreviousActivity(
  activity: WorkspaceAgentActivity,
  previous: WorkspaceAgentActivity | undefined,
): WorkspaceAgentActivity {
  if (previous?.agentId !== activity.agentId || previous.status !== activity.status)
    return activity;
  if (sameClocks(previous, activity)) return previous;
  return { ...activity, enteredAt: previous.enteredAt };
}

function areWorkspaceAgentActivityIndexesIdentical(
  previous: ReadonlyMap<string, WorkspaceAgentActivity>,
  next: ReadonlyMap<string, WorkspaceAgentActivity>,
): boolean {
  if (previous.size !== next.size) {
    return false;
  }
  for (const [workspaceId, activity] of next) {
    if (previous.get(workspaceId) !== activity) {
      return false;
    }
  }
  return true;
}

function messageDate(value: string | null | undefined): Date | undefined {
  const time = Date.parse(value ?? "");
  return Number.isFinite(time) ? new Date(time) : undefined;
}

function recordLatest(target: Map<string, Date>, key: string, date: Date): void {
  const previous = target.get(key);
  if (!previous || date > previous) target.set(key, date);
}

function sameClocks(left: WorkspaceAgentActivity, right: WorkspaceAgentActivity): boolean {
  return (
    left.lastActivityAt.getTime() === right.lastActivityAt.getTime() &&
    left.lastMessageAt?.getTime() === right.lastMessageAt?.getTime() &&
    left.lastUserMessageAt?.getTime() === right.lastUserMessageAt?.getTime()
  );
}
