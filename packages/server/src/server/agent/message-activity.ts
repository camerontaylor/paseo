import type { AgentTimelineItem } from "./agent-sdk-types.js";
import { isSystemInjectedEnvelope } from "./agent-prompt.js";

export interface MessageActivity {
  lastUserMessageAt: string | null;
  lastAssistantMessageAt: string | null;
}

export function emptyMessageActivity(): MessageActivity {
  return { lastUserMessageAt: null, lastAssistantMessageAt: null };
}

/** Caller supplies acceptance/completion time for live messages, never a token timestamp. */
export function advanceMessageActivity(
  activity: MessageActivity,
  role: "user" | "assistant",
  timestamp: string | Date | undefined,
): MessageActivity {
  const time = timestamp instanceof Date ? timestamp.getTime() : Date.parse(timestamp ?? "");
  if (!Number.isFinite(time)) return activity;
  const key = role === "user" ? "lastUserMessageAt" : "lastAssistantMessageAt";
  const previous = Date.parse(activity[key] ?? "");
  if (Number.isFinite(previous) && previous >= time) return activity;
  return { ...activity, [key]: new Date(time).toISOString() };
}

/**
 * Only original provider dates qualify: undated history must not become new activity
 * on import. System notifications are not user-authored activity.
 */
export function deriveHistoricalMessageActivity(
  events: Iterable<{ item: AgentTimelineItem; timestamp?: string }>,
): MessageActivity {
  let activity = emptyMessageActivity();
  for (const { item, timestamp } of events) {
    if (item.type === "user_message" && !isSystemInjectedEnvelope(item.text)) {
      activity = advanceMessageActivity(activity, "user", timestamp);
    } else if (item.type === "assistant_message" && item.text.trim()) {
      activity = advanceMessageActivity(activity, "assistant", timestamp);
    }
  }
  return activity;
}
