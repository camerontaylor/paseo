import { beforeEach, describe, expect, it } from "vitest";
import { threadOriginAgentKey, useThreadOriginNavigationStore } from "./origin-navigation-store";

describe("thread origin navigation requests", () => {
  beforeEach(() => {
    useThreadOriginNavigationStore.setState({ requestsByAgent: {}, statusByThread: {} });
  });

  it("tracks pending navigation per parent and ignores stale acknowledgements", () => {
    const store = useThreadOriginNavigationStore.getState();
    const firstId = store.request({
      serverId: "host",
      parentAgentId: "parent",
      threadId: "thread-a",
      anchor: "message-a",
    });
    const secondId = useThreadOriginNavigationStore.getState().request({
      serverId: "host",
      parentAgentId: "parent",
      threadId: "thread-b",
      anchor: "message-b",
    });

    useThreadOriginNavigationStore.getState().resolve({
      serverId: "host",
      parentAgentId: "parent",
      threadId: "thread-a",
      requestId: firstId,
      status: "opened",
    });

    const state = useThreadOriginNavigationStore.getState();
    expect(state.requestsByAgent[threadOriginAgentKey("host", "parent")]?.requestId).toBe(secondId);
    expect(state.statusByThread["host\0parent\0thread-a"]?.status).toBe("opened");
    expect(state.statusByThread["host\0parent\0thread-b"]?.status).toBe("pending");
  });

  it("reports unavailable without changing the persisted origin owner", () => {
    const requestId = useThreadOriginNavigationStore.getState().request({
      serverId: "host",
      parentAgentId: "parent",
      threadId: "thread",
      anchor: "cursor:epoch:9",
    });
    useThreadOriginNavigationStore.getState().resolve({
      serverId: "host",
      parentAgentId: "parent",
      threadId: "thread",
      requestId,
      status: "unavailable",
    });

    expect(
      useThreadOriginNavigationStore.getState().statusByThread["host\0parent\0thread"],
    ).toMatchObject({
      status: "unavailable",
    });
    expect(useThreadOriginNavigationStore.getState().requestsByAgent).toEqual({});
  });
});
