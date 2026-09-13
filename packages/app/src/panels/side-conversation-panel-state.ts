/**
 * What the side conversation transcript says when it has no messages to draw.
 *
 * The daemon drops a thread on archive, reload, and history clear, and it answers a fetch for a
 * thread it has never seen with an empty snapshot rather than an error. So "no record" covers
 * three different situations, and the panel has to tell them apart or it sits on a loading line
 * forever for two of them.
 */
export type SideConversationLoadState = "loading" | "loaded" | "failed";

export type SideConversationPlaceholder = "loading" | "failed" | "removed" | "empty";

export const SIDE_CONVERSATION_PLACEHOLDER_KEYS: Record<SideConversationPlaceholder, string> = {
  loading: "sideConversations.states.loading",
  failed: "sideConversations.errors.unavailable",
  removed: "sideConversations.states.removed",
  empty: "sideConversations.states.empty",
};

export function resolveSideConversationPlaceholder(input: {
  loadState: SideConversationLoadState;
  hasRecord: boolean;
  /** True once this thread has been in the store, which is what makes its absence a removal. */
  hadRecord: boolean;
  isEmpty: boolean;
}): SideConversationPlaceholder | null {
  if (input.loadState === "failed") return "failed";
  if (!input.hasRecord) {
    if (input.hadRecord) return "removed";
    return input.loadState === "loading" ? "loading" : "empty";
  }
  return input.isEmpty ? "empty" : null;
}
