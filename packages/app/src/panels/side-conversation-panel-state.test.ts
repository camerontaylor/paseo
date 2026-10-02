import { describe, expect, it } from "vitest";
import { en } from "@/i18n/resources/en";
import {
  resolveSideConversationPlaceholder,
  SIDE_CONVERSATION_PLACEHOLDER_KEYS,
  type SideConversationPlaceholder,
} from "./side-conversation-panel-state";

function resolve(
  input: Partial<Parameters<typeof resolveSideConversationPlaceholder>[0]>,
): SideConversationPlaceholder | null {
  return resolveSideConversationPlaceholder({
    loadState: "loaded",
    hasRecord: true,
    hadRecord: true,
    isEmpty: false,
    ...input,
  });
}

describe("resolveSideConversationPlaceholder", () => {
  it("waits only while the first fetch is in flight", () => {
    expect(resolve({ loadState: "loading", hasRecord: false, hadRecord: false })).toBe("loading");
    expect(resolve({ loadState: "loaded", hasRecord: false, hadRecord: false })).toBe("empty");
  });

  it("reports a thread that vanished under an open tab as removed", () => {
    expect(resolve({ loadState: "loaded", hasRecord: false, hadRecord: true })).toBe("removed");
    expect(resolve({ loadState: "loading", hasRecord: false, hadRecord: true })).toBe("removed");
  });

  it("prefers the fetch failure over every other state", () => {
    expect(resolve({ loadState: "failed", hasRecord: false, hadRecord: true })).toBe("failed");
    expect(resolve({ loadState: "failed", hasRecord: true, isEmpty: false })).toBe("failed");
  });

  it("draws nothing once the thread has messages", () => {
    expect(resolve({ hasRecord: true, isEmpty: false })).toBeNull();
    expect(resolve({ hasRecord: true, isEmpty: true })).toBe("empty");
  });

  it("names a translation that exists for every placeholder", () => {
    const strings: Record<string, unknown> = {
      "sideConversations.states.loading": en.sideConversations.states.loading,
      "sideConversations.states.empty": en.sideConversations.states.empty,
      "sideConversations.states.removed": en.sideConversations.states.removed,
      "sideConversations.errors.unavailable": en.sideConversations.errors.unavailable,
    };
    for (const key of Object.values(SIDE_CONVERSATION_PLACEHOLDER_KEYS)) {
      expect(strings[key]).toBeTypeOf("string");
    }
  });
});
