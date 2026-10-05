import { expect, test, vi } from "vitest";
import { AgentQueueDestinationChangedError } from "@getpaseo/client/internal/daemon-client";
import { deliverRoutedPrompt, type RouteDeliveryInput } from "./delivery";
import type { AgentQueueSnapshot } from "@getpaseo/protocol/messages";
const snapshot: AgentQueueSnapshot = {
  agentId: "chat",
  revision: 1,
  items: [{ id: "item", text: "hello", createdAt: "2026-10-01" }],
};
function fixture() {
  const events: string[] = [];
  const input: RouteDeliveryInput = {
    recipient: {
      serverId: "host",
      agentId: "chat",
      workspaceId: "workspace",
      projectId: "project",
      projectViewKey: "view",
      hostLabel: "M5",
      projectName: "Paseo",
      title: "CI",
      excerpt: "",
      confidence: 1,
    },
    itemId: "item",
    text: "  original\nverbatim  ",
    draftVersion: 7,
    isHostEligible: () => true,
    client: {
      enqueueAgentMessage: vi.fn(async () => {
        events.push("wire");
        return snapshot;
      }),
    },
    outbox: {
      getEntry: vi.fn(async () => undefined),
      markRoutingDispatched: vi.fn(async () => {}),
      add: vi.fn(async () => {
        events.push("persist");
      }),
      acknowledge: vi.fn(async () => {
        events.push("ack");
      }),
      removeDurably: vi.fn(async () => {
        events.push("remove");
      }),
    },
    applySnapshot: vi.fn(),
  };
  return { input, events };
}
test("persists original prompt and destination before sending, then reports actual queue acknowledgement", async () => {
  const { input, events } = fixture();
  expect(await deliverRoutedPrompt(input)).toEqual({ queued: true });
  expect(events).toEqual(["persist", "wire", "ack", "remove"]);
  expect(input.client.enqueueAgentMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      text: input.text,
      itemId: "item",
      expectedWorkspaceId: "workspace",
      expectedProjectId: "project",
      routingDraftVersion: 7,
    }),
  );
  expect(input.client.enqueueAgentMessage).not.toHaveBeenCalledWith(
    expect.objectContaining({ interrupt: true }),
  );
});
test("storage failure never sends and uncertain delivery retains the durable item for same-ID retry", async () => {
  const { input } = fixture();
  input.outbox.add = vi.fn(async () => {
    throw new Error("disk full");
  });
  await expect(deliverRoutedPrompt(input)).rejects.toThrow("disk full");
  expect(input.client.enqueueAgentMessage).not.toHaveBeenCalled();
  input.outbox.add = vi.fn(async () => {});
  input.client.enqueueAgentMessage = vi.fn(async () => {
    throw new Error("ack lost");
  });
  await expect(deliverRoutedPrompt(input)).rejects.toThrow("ack lost");
  expect(input.outbox.removeDurably).not.toHaveBeenCalled();
  expect(input.outbox.acknowledge).not.toHaveBeenCalled();
  input.client.enqueueAgentMessage = vi.fn(async () => ({ ...snapshot, items: [] }));
  expect(await deliverRoutedPrompt(input)).toEqual({ queued: false });
  expect(input.client.enqueueAgentMessage).toHaveBeenCalledWith(
    expect.objectContaining({ itemId: "item", text: input.text }),
  );
});
test("definitive destination rejection releases pending submission without claiming acknowledgement", async () => {
  const { input } = fixture();
  input.client.enqueueAgentMessage = vi.fn(async () => {
    throw new AgentQueueDestinationChangedError();
  });
  await expect(deliverRoutedPrompt(input)).rejects.toBeInstanceOf(
    AgentQueueDestinationChangedError,
  );
  expect(input.outbox.removeDurably).toHaveBeenCalledWith("item");
  expect(input.outbox.acknowledge).not.toHaveBeenCalled();
});
