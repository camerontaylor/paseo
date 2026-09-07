import { useEffect, useMemo } from "react";
import { usePendingArchiveAgentIds } from "@/hooks/use-archive-agent";
import equal from "fast-deep-equal";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { refreshProviderSubagents, useProviderSubagentStore } from "./provider-store";
import type { ProviderSubagentDescriptorPayload } from "@getpaseo/protocol/messages";
import {
  refreshSideConversations,
  sideConversationParentPrefix,
  sideConversationTitle,
  type SideConversationRecord,
  useSideConversationStore,
} from "@/side-conversations/store";

export interface PaseoSubagentRow {
  kind: "paseo";
  id: Agent["id"];
  provider: Agent["provider"];
  title: Agent["title"];
  /** Managed agents have a real title, so the union's task line is always absent for them. */
  description: null;
  subtitle: null;
  status: Agent["status"];
  requiresAttention: Agent["requiresAttention"];
  createdAt: Agent["createdAt"];
}

export interface ProviderSubagentRow {
  kind: "provider";
  id: string;
  parentAgentId: string;
  provider: ProviderSubagentDescriptorPayload["provider"];
  // `title` is the subagent type ("Explore", "general-purpose") and repeats across a fan-out;
  // `description` is the task it was given. Both are carried so presentation can choose which
  // one names the row — collapsing them here is what makes every row read alike.
  title: string | null;
  description: string | null;
  /** Compact provider-owned context. The app displays it without interpreting its contents. */
  subtitle: string | null;
  status: ProviderSubagentDescriptorPayload["status"];
  requiresAttention: boolean;
  createdAt: Date;
}

export interface SideConversationRow {
  kind: "side_conversation";
  id: string;
  parentAgentId: string;
  provider: Agent["provider"];
  title: string | null;
  description: null;
  subtitle: null;
  status: "running" | "idle" | "error";
  requiresAttention: boolean;
  createdAt: Date;
}

export type SubagentRow = PaseoSubagentRow | ProviderSubagentRow | SideConversationRow;

type SessionStoreSnapshot = ReturnType<typeof useSessionStore.getState>;
type ProviderSubagentStoreSnapshot = ReturnType<typeof useProviderSubagentStore.getState>;
type SideConversationStoreSnapshot = ReturnType<typeof useSideConversationStore.getState>;

interface SelectSubagentsParams {
  serverId: string;
  parentAgentId: string;
}

const EMPTY_SUBAGENT_ROWS: SubagentRow[] = [];
const EMPTY_PROVIDER_SUBAGENT_ROWS: ProviderSubagentRow[] = [];
const EMPTY_SIDE_CONVERSATION_ROWS: SideConversationRow[] = [];

function sideConversationStatus(record: SideConversationRecord): SideConversationRow["status"] {
  if (record.pendingQuestion !== null) return "running";
  if (record.lastAnswer === null || record.lastAnswer.status === "answered") return "idle";
  return "error";
}

function toSubagentRow(agent: Agent): SubagentRow {
  return {
    kind: "paseo",
    id: agent.id,
    provider: agent.provider,
    title: agent.title,
    description: null,
    subtitle: null,
    status: agent.status,
    requiresAttention: agent.requiresAttention,
    createdAt: agent.createdAt,
  };
}

export function selectSubagentsForParent(
  state: SessionStoreSnapshot,
  params: SelectSubagentsParams,
  pendingArchiveIds: ReadonlySet<string>,
): SubagentRow[] {
  const agents = state.sessions[params.serverId]?.agents;
  if (!agents || agents.size === 0) {
    return EMPTY_SUBAGENT_ROWS;
  }

  const rows: SubagentRow[] = [];
  for (const agent of agents.values()) {
    if (
      agent.archivedAt ||
      pendingArchiveIds.has(agent.id) ||
      agent.parentAgentId !== params.parentAgentId
    ) {
      continue;
    }
    rows.push(toSubagentRow(agent));
  }

  if (rows.length === 0) {
    return EMPTY_SUBAGENT_ROWS;
  }

  rows.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  return rows;
}

export function selectProviderSubagentsForParent(
  state: ProviderSubagentStoreSnapshot,
  params: SelectSubagentsParams,
  supported: boolean,
): ProviderSubagentRow[] {
  if (!supported) return EMPTY_PROVIDER_SUBAGENT_ROWS;
  const rows: ProviderSubagentRow[] = [];
  const prefix = `${params.serverId}\0${params.parentAgentId}\0`;
  for (const [key, subagent] of state.descriptors) {
    if (!key.startsWith(prefix) || state.hiddenFromTrack.has(key)) continue;
    rows.push({
      kind: "provider",
      id: subagent.id,
      parentAgentId: subagent.parentAgentId,
      provider: subagent.provider,
      title: subagent.title,
      description: subagent.description,
      subtitle: subagent.subtitle ?? null,
      status: subagent.status,
      requiresAttention: subagent.status === "failed",
      createdAt: new Date(subagent.createdAt),
    });
  }
  rows.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  return rows;
}

export function selectSideConversationsForParent(
  state: SideConversationStoreSnapshot,
  params: SelectSubagentsParams,
  provider: Agent["provider"] | undefined,
  supported: boolean,
): SideConversationRow[] {
  if (!supported || !provider) return EMPTY_SIDE_CONVERSATION_ROWS;
  const rows: SideConversationRow[] = [];
  const prefix = sideConversationParentPrefix(params.serverId, params.parentAgentId);
  for (const [key, record] of state.records) {
    if (!key.startsWith(prefix)) continue;
    // A thread is named by its first question. Opening the panel mints the thread before there is
    // one, and the daemon answers that fetch with an empty snapshot, so listing it here would put
    // a nameless row in the track for a conversation that has not started.
    if (record.items.length === 0) continue;
    const lastAnswer = record.lastAnswer;
    rows.push({
      kind: "side_conversation",
      id: record.threadId,
      parentAgentId: record.parentAgentId,
      provider,
      title: sideConversationTitle(record) || null,
      description: null,
      subtitle: null,
      status: sideConversationStatus(record),
      requiresAttention:
        (lastAnswer?.status === "answered" && lastAnswer.synthetic) ||
        (lastAnswer !== null && lastAnswer.status !== "answered"),
      // Side-conversation snapshots carry ordered content but no wall-clock timestamp. Preserve
      // the store's insertion order and append these rows after agent-owned children below.
      createdAt: new Date(rows.length),
    });
  }
  return rows.length > 0 ? rows : EMPTY_SIDE_CONVERSATION_ROWS;
}

export function useSubagentsForParent(params: SelectSubagentsParams): SubagentRow[] {
  const pendingArchiveIds = usePendingArchiveAgentIds(params.serverId);
  const paseoRows = useStoreWithEqualityFn(
    useSessionStore,
    (state) => selectSubagentsForParent(state, params, pendingArchiveIds),
    equal,
  );
  const supported = useSessionStore(
    (state) => state.sessions[params.serverId]?.serverInfo?.features?.providerSubagents === true,
  );
  const sideConversationsSupported = useSessionStore(
    (state) => state.sessions[params.serverId]?.serverInfo?.features?.sideConversations === true,
  );
  const parentProvider = useSessionStore(
    (state) => state.sessions[params.serverId]?.agents.get(params.parentAgentId)?.provider,
  );
  const providerRows = useStoreWithEqualityFn(
    useProviderSubagentStore,
    (state) => selectProviderSubagentsForParent(state, params, supported),
    equal,
  );
  const client = useSessionStore((state) => state.sessions[params.serverId]?.client ?? null);
  const sideConversationRows = useStoreWithEqualityFn(
    useSideConversationStore,
    (state) =>
      selectSideConversationsForParent(state, params, parentProvider, sideConversationsSupported),
    equal,
  );

  useEffect(() => {
    if (!client || !supported) return;
    void refreshProviderSubagents(client, params.serverId, params.parentAgentId).catch(
      () => undefined,
    );
  }, [client, params.parentAgentId, params.serverId, supported]);

  // COMPAT(sideConversations): added in 0.7.0-beta.2.fork.1, fork-only — stock peers never gain it, so the gate lasts as long as stock peers are supported.
  useEffect(() => {
    if (!client || !sideConversationsSupported) return;
    void refreshSideConversations(client, params.serverId, params.parentAgentId).catch(
      () => undefined,
    );
  }, [client, params.parentAgentId, params.serverId, sideConversationsSupported]);

  return useMemo(() => {
    if (providerRows.length === 0 && sideConversationRows.length === 0) return paseoRows;
    const rows = [...paseoRows, ...providerRows];
    rows.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    return [...rows, ...sideConversationRows];
  }, [paseoRows, providerRows, sideConversationRows]);
}
