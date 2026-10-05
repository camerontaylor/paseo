import { describe, expect, test } from "vitest";
import { automaticRecipient, initialRoutingState, routingReducer, type Recipient } from "./model";

const recipient: Recipient = {
  serverId: "host-a",
  agentId: "chat",
  workspaceId: "workspace",
  projectId: "project",
  projectViewKey: "host-a:project",
  hostLabel: "M5",
  projectName: "Paseo",
  title: "Offline indicator",
  excerpt: "Investigating relay disconnect",
  confidence: 0.96,
};

describe("session routing decisions", () => {
  test("finding and using a chat preserve the independent send draft without submitting", () => {
    let state = routingReducer(initialRoutingState, {
      type: "restoreDraft",
      text: "  fix it\n",
      version: 4,
    });
    state = routingReducer(state, {
      type: "phase",
      phase: { status: "matching", mode: "find", requestId: "find", text: "find the CI chat" },
    });
    state = routingReducer(state, {
      type: "matched",
      requestId: "find",
      recipients: [recipient],
      notice: "",
    });
    expect(state.phase.status).toBe("results");
    state = routingReducer(state, { type: "recipient", recipient });
    expect(state).toMatchObject({
      mode: "send",
      sendDraft: "  fix it\n",
      recipient,
      phase: { status: "idle" },
    });
    state = routingReducer(state, { type: "mode", mode: "find" });
    expect(state.sendDraft).toBe("  fix it\n");
  });
  test("scope includes host identity and clears incompatible explicit recipients", () => {
    const pinned = routingReducer(initialRoutingState, { type: "recipient", recipient });
    const scoped = routingReducer(pinned, { type: "scope", scope: "host-b:project" });
    expect(scoped.recipient).toBeNull();
    const matching = routingReducer(scoped, {
      type: "phase",
      phase: { status: "matching", requestId: "a", mode: "send", text: "continue" },
    });
    expect(
      routingReducer(matching, {
        type: "matched",
        requestId: "a",
        recipients: [recipient],
        notice: "",
      }).phase,
    ).toMatchObject({ recipients: [] });
  });
  test("superseded matching results and invalidated Find results cannot survive", () => {
    let state = routingReducer(initialRoutingState, {
      type: "phase",
      phase: { status: "matching", mode: "find", requestId: "new", text: "offline" },
    });
    expect(
      routingReducer(state, {
        type: "matched",
        requestId: "old",
        recipients: [recipient],
        notice: "",
      }),
    ).toBe(state);
    state = routingReducer(state, { type: "invalidateFind" });
    expect(
      routingReducer(state, {
        type: "matched",
        requestId: "new",
        recipients: [recipient],
        notice: "",
      }).phase.status,
    ).toBe("idle");
  });
  test("ambiguous, weak, and missing destinations require a choice", () => {
    expect(automaticRecipient([])).toBeNull();
    expect(automaticRecipient([{ ...recipient, confidence: 0.89 }])).toBeNull();
    expect(
      automaticRecipient([recipient, { ...recipient, agentId: "other", confidence: 0.8 }]),
    ).toBeNull();
    expect(automaticRecipient([recipient])).toEqual(recipient);
  });
  test("only the matching item acknowledgement clears its owned draft; equal new text survives", () => {
    let state = routingReducer(initialRoutingState, {
      type: "restoreDraft",
      text: "continue",
      version: 8,
    });
    state = routingReducer(state, {
      type: "restorePending",
      recipient,
      text: "continue",
      itemId: "item",
      draftVersion: 8,
    });
    expect(routingReducer(state, { type: "acknowledged", itemId: "wrong", queued: true })).toBe(
      state,
    );
    expect(
      routingReducer(state, { type: "acknowledged", itemId: "item", queued: true }),
    ).toMatchObject({ sendDraft: "", phase: { status: "acknowledged", queued: true } });
    state = routingReducer(state, { type: "syncDraft", text: "continue", version: 10 });
    expect(
      routingReducer(state, { type: "acknowledged", itemId: "item", queued: false }),
    ).toMatchObject({ sendDraft: "continue", phase: { status: "acknowledged", queued: false } });
  });
  test("a recycled draft version after record collection still belongs to a different draft", () => {
    let state = routingReducer(initialRoutingState, {
      type: "restoreDraft",
      text: "continue",
      version: 1,
      updatedAt: 100,
    });
    state = routingReducer(state, {
      type: "restorePending",
      recipient,
      text: "continue",
      itemId: "old",
      draftVersion: 1,
      draftUpdatedAt: 100,
    });
    state = routingReducer(state, {
      type: "syncDraft",
      text: "continue",
      version: 1,
      updatedAt: 500000,
    });
    expect(
      routingReducer(state, { type: "acknowledged", itemId: "old", queued: false }).sendDraft,
    ).toBe("continue");
  });
});
