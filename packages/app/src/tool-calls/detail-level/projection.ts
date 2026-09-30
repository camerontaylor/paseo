import type { StreamItem } from "@/types/stream";
import type { ToolCallDetailLevel } from "@/hooks/use-settings/storage";
import { describeToolCall } from "./grouping";
import {
  groupLiveToolCalls,
  prepareGroupedHistory,
  type GroupedHistory,
  type GroupedToolCalls,
} from "./grouping";
import { buildOverviewGroup, type OverviewToolCallGroup } from "./overview/model";

export type { ToolCallDetailLevel } from "@/hooks/use-settings/storage";
export type ToolCallDetailGroup = OverviewToolCallGroup;

export interface PreparedToolCallHistory {
  mode: "overview";
  grouped: GroupedHistory<ToolCallDetailGroup>;
}

export interface ToolCallDetailProjection extends GroupedToolCalls<ToolCallDetailGroup> {}

const EMPTY_TOOL_CALL_GROUPS = new Map<string, ToolCallDetailGroup>();

const quietItemsCache = new WeakMap<StreamItem[], StreamItem[]>();
function quietToolCallItems(items: StreamItem[]): StreamItem[] {
  const cached = quietItemsCache.get(items);
  if (cached) return cached;
  const visible = visibleToolCallItems(items).filter((item) => {
    if (item.kind !== "tool_call") return true;
    const call = describeToolCall(item);
    return (
      call.status === "failed" ||
      call.error != null ||
      call.detail.type === "plan" ||
      call.name.trim().toLowerCase() === "speak"
    );
  });
  const result = visible.length === items.length ? items : visible;
  quietItemsCache.set(items, result);
  return result;
}

// Approval UI owns pending plan presentation. Retain the canonical tool in the
// stream model so resolving it can reveal a card at its original position.
const visibleItemsCache = new WeakMap<StreamItem[], StreamItem[]>();
function visibleToolCallItems(items: StreamItem[]): StreamItem[] {
  const cached = visibleItemsCache.get(items);
  if (cached) return cached;
  const visible = items.filter((item) => {
    if (item.kind !== "tool_call" || item.payload.source !== "agent") return true;
    const data = item.payload.data;
    return (
      data.name !== "ExitPlanMode" && !(data.name === "plan_approval" && data.status === "running")
    );
  });
  const result = visible.length === items.length ? items : visible;
  visibleItemsCache.set(items, result);
  return result;
}

export function prepareToolCallHistory(
  level: ToolCallDetailLevel,
  tail: StreamItem[],
): PreparedToolCallHistory | null {
  if (level === "detailed" || level === "quiet") {
    return null;
  }
  return {
    mode: "overview",
    grouped: prepareGroupedHistory({
      tail: visibleToolCallItems(tail),
      buildGroup: buildOverviewGroup,
    }),
  };
}

export function projectToolCallDetailLevel(input: {
  level: ToolCallDetailLevel;
  tail: StreamItem[];
  head: StreamItem[];
  preparedHistory: PreparedToolCallHistory | null;
  isTurnActive: boolean;
}): ToolCallDetailProjection {
  if (input.level === "detailed") {
    return {
      tail: visibleToolCallItems(input.tail),
      head: visibleToolCallItems(input.head),
      groupsByHostId: EMPTY_TOOL_CALL_GROUPS,
      historyGroupUpdatesByHostId: EMPTY_TOOL_CALL_GROUPS,
    };
  }
  if (input.level === "quiet") {
    return {
      tail: quietToolCallItems(input.tail),
      head: quietToolCallItems(input.head),
      groupsByHostId: EMPTY_TOOL_CALL_GROUPS,
      historyGroupUpdatesByHostId: EMPTY_TOOL_CALL_GROUPS,
    };
  }
  if (!input.preparedHistory || input.preparedHistory.mode !== input.level) {
    throw new Error(`Missing prepared ${input.level} tool call history`);
  }
  return groupLiveToolCalls({
    history: input.preparedHistory.grouped,
    head: visibleToolCallItems(input.head),
    isTurnActive: input.isTurnActive,
    buildGroup: buildOverviewGroup,
  });
}
