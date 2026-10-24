/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "@/stores/session-store";
import type { WorkspaceLayout } from "@/stores/workspace-layout-actions";
import type { WorkspaceTab } from "@/workspace-tabs/model";
import { useViewTimelineSync } from "@/views/use-view-timeline-sync";
import type { ViewedTimelineOwner } from "@/timeline/viewed-timeline-sync";

const prepareAgentTimeline = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({ prepareAgentTimeline }),
}));
vi.mock("@/views/view-visible-agents", () => ({
  selectViewVisibleAgentIds: () => new Map([["host-a", ["agent-a"]]]),
}));

const layout = {} as WorkspaceLayout;
const tabs: WorkspaceTab[] = [];

function setOwner(owner: ViewedTimelineOwner | null) {
  useSessionStore.setState((state) => ({
    sessions: {
      ...state.sessions,
      "host-a": {
        ...state.sessions["host-a"],
        viewedTimelineSync: owner,
      } as NonNullable<(typeof state.sessions)["host-a"]>,
    },
  }));
}

afterEach(() => {
  useSessionStore.setState({ sessions: {} });
  prepareAgentTimeline.mockClear();
});

describe("View timeline owner replacement", () => {
  it("clears the old owner and registers a new owner for the same host and View", () => {
    const first = { replaceVisibleAgentIds: vi.fn() } as unknown as ViewedTimelineOwner;
    const second = { replaceVisibleAgentIds: vi.fn() } as unknown as ViewedTimelineOwner;
    setOwner(first);
    const mounted = renderHook(() => useViewTimelineSync({ ownerKey: "view:one", layout, tabs }));
    expect(first.replaceVisibleAgentIds).toHaveBeenCalledWith("view:one", ["agent-a"]);

    act(() => setOwner(second));
    expect(first.replaceVisibleAgentIds).toHaveBeenLastCalledWith("view:one", []);
    expect(second.replaceVisibleAgentIds).toHaveBeenCalledWith("view:one", ["agent-a"]);

    mounted.unmount();
    expect(second.replaceVisibleAgentIds).toHaveBeenLastCalledWith("view:one", []);
  });
});
