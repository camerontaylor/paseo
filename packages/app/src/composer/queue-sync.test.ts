import { describe, expect, it } from "vitest";
import type { AgentQueueSnapshot, ForgeSearchItem } from "@getpaseo/protocol/messages";

import type { AttachmentMetadata } from "@/attachments/types";
import type { PendingQueueEnqueue } from "@/stores/queue-outbox-store/model";
import {
  annotateQueueRows,
  appendPendingQueueRows,
  getPendingQueueMessageIds,
  resolveQueueStorageErrorRow,
  shouldApplyAgentQueueSnapshot,
  toQueuedComposerAttachments,
  toQueuedComposerMessages,
} from "./queue-sync";

const issueItem: ForgeSearchItem = {
  kind: "issue",
  number: 7,
  title: "Mirror the queue",
  url: "https://example.test/issues/7",
  state: "open",
  body: null,
  labels: [],
  baseRefName: null,
  headRefName: null,
};

const imageMetadata: AttachmentMetadata = {
  id: "img-1",
  mimeType: "image/png",
  storageType: "web-indexeddb",
  storageKey: "img-1",
  createdAt: 1,
};

function snapshot(overrides: Partial<AgentQueueSnapshot> = {}): AgentQueueSnapshot {
  return {
    agentId: "agent",
    revision: 1,
    items: [
      {
        id: "item-1",
        text: "first",
        intent: "queue",
        deliveryState: "pending",
        attempts: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

describe("shouldApplyAgentQueueSnapshot", () => {
  it("applies the first snapshot it sees", () => {
    expect(shouldApplyAgentQueueSnapshot({ incomingRevision: 4, appliedRevision: undefined })).toBe(
      true,
    );
  });

  it("applies a newer revision", () => {
    expect(shouldApplyAgentQueueSnapshot({ incomingRevision: 5, appliedRevision: 4 })).toBe(true);
  });

  it("drops a snapshot that raced behind one already applied", () => {
    expect(shouldApplyAgentQueueSnapshot({ incomingRevision: 3, appliedRevision: 4 })).toBe(false);
  });

  it("drops a repeat of the revision already applied", () => {
    expect(shouldApplyAgentQueueSnapshot({ incomingRevision: 4, appliedRevision: 4 })).toBe(false);
  });
});

describe("toQueuedComposerMessages", () => {
  it("keeps the composer-side attachments so any device can edit the message", () => {
    const items = toQueuedComposerMessages(
      snapshot({
        items: [
          {
            id: "item-1",
            text: "look at this",
            intent: "queue",
            deliveryState: "pending",
            attempts: 0,
            createdAt: "2026-01-01T00:00:00.000Z",
            composerAttachments: [{ kind: "forge_issue", item: issueItem }],
            images: [{ id: "srv-1", mimeType: "image/png", byteSize: 3 }],
          },
        ],
      }),
    );

    expect(items).toEqual([
      {
        id: "item-1",
        text: "look at this",
        attachments: [{ kind: "forge_issue", item: issueItem }],
        deliveryState: "pending",
        lastError: undefined,
      },
    ]);
  });

  it("carries the delivery state and last error so the queue track can show them", () => {
    const items = toQueuedComposerMessages(
      snapshot({
        items: [
          {
            id: "item-1",
            text: "first",
            intent: "queue",
            deliveryState: "uncertain",
            attempts: 3,
            lastError: "agent_request_outcome_unknown",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    );

    expect(items).toEqual([
      {
        id: "item-1",
        text: "first",
        attachments: [],
        deliveryState: "uncertain",
        lastError: "agent_request_outcome_unknown",
      },
    ]);
  });

  it("returns an empty attachment list when the item has none", () => {
    expect(toQueuedComposerMessages(snapshot())).toEqual([
      {
        id: "item-1",
        text: "first",
        attachments: [],
        deliveryState: "pending",
        lastError: undefined,
      },
    ]);
  });
});

describe("appendPendingQueueRows", () => {
  function pending(overrides: Partial<PendingQueueEnqueue> = {}): PendingQueueEnqueue {
    return {
      serverId: "server",
      agentId: "agent",
      itemId: "pending-1",
      text: "not acked yet",
      intent: "queue",
      images: [],
      attachments: [],
      composerAttachments: [],
      createdAt: 1,
      attempts: 0,
      ...overrides,
    };
  }

  it("re-appends un-acked rows a snapshot would otherwise erase", () => {
    const rows = appendPendingQueueRows(toQueuedComposerMessages(snapshot()), [pending()]);
    expect(rows.map((row) => row.id)).toEqual(["item-1", "pending-1"]);
    expect(rows[1]?.syncState).toBe("pending");
  });

  it("marks a re-appended row failed when its entry exhausted the retries", () => {
    const rows = appendPendingQueueRows(toQueuedComposerMessages(snapshot()), [
      pending({ itemId: "pending-2", failedAt: 5 }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["item-1", "pending-2"]);
    expect(rows[1]?.syncState).toBe("failed");
  });

  it("drops a pending row the snapshot already contains", () => {
    const rows = appendPendingQueueRows(toQueuedComposerMessages(snapshot()), [
      pending({ itemId: "item-1" }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["item-1"]);
    expect(rows[0]?.syncState).toBeUndefined();
  });

  it("returns the input list unchanged when nothing is pending", () => {
    const rows = toQueuedComposerMessages(snapshot());
    expect(appendPendingQueueRows(rows, [])).toBe(rows);
  });
});

describe("toQueuedComposerAttachments", () => {
  it("drops images, which travel as bytes instead", () => {
    expect(
      toQueuedComposerAttachments([
        { kind: "image", metadata: imageMetadata },
        { kind: "forge_issue", item: issueItem },
      ]),
    ).toEqual([{ kind: "forge_issue", item: issueItem }]);
  });

  it("keeps workspace file references, which resolve the same on any device", () => {
    expect(
      toQueuedComposerAttachments([
        { kind: "workspace_file", path: "src/main.ts", selection: { kind: "whole_file" } },
      ]),
    ).toEqual([{ kind: "workspace_file", path: "src/main.ts", selection: { kind: "whole_file" } }]);
  });
});

describe("getPendingQueueMessageIds", () => {
  function outboxEntry(itemId: string): PendingQueueEnqueue {
    return {
      serverId: "server-1",
      agentId: "agent-1",
      itemId,
      text: "not acked yet",
      intent: "queue",
      images: [],
      attachments: [],
      composerAttachments: [],
      createdAt: 1,
      attempts: 0,
    };
  }

  it("excludes ids the snapshot already accepted", () => {
    const ids = getPendingQueueMessageIds([outboxEntry("a"), outboxEntry("b")], new Set(["a"]));
    expect([...ids]).toEqual(["b"]);
  });

  it("includes every un-acked entry and nothing when the outbox is empty", () => {
    expect([...getPendingQueueMessageIds([outboxEntry("a")], undefined)]).toEqual(["a"]);
    expect(getPendingQueueMessageIds([], new Set(["a"])).size).toBe(0);
  });
});

describe("annotateQueueRows", () => {
  function outboxEntry(
    itemId: string,
    overrides: Partial<PendingQueueEnqueue> = {},
  ): PendingQueueEnqueue {
    return {
      serverId: "server-1",
      agentId: "agent-1",
      itemId,
      text: `text for ${itemId}`,
      intent: "queue",
      images: [],
      attachments: [],
      composerAttachments: [],
      createdAt: 1,
      attempts: 0,
      ...overrides,
    };
  }

  const snapshotRows = [{ id: "item-1", text: "first", attachments: [] }];

  it("overlays un-acked outbox rows on the stored snapshot rows", () => {
    const rows = annotateQueueRows({
      rows: snapshotRows,
      entries: [outboxEntry("pending-1", { createdAt: 1 })],
    });
    expect(rows.map((row) => [row.id, row.syncState])).toEqual([
      ["item-1", undefined],
      ["pending-1", "pending"],
    ]);
  });

  it("marks parked entries failed and visible, even when only the outbox knows them", () => {
    const rows = annotateQueueRows({
      rows: snapshotRows,
      entries: [outboxEntry("parked-1", { failedAt: 5, attempts: 8 })],
    });
    const appended = rows.find((row) => row.id === "parked-1");
    expect(appended?.syncState).toBe("failed");
  });

  it("drops a row whose entry was discarded, without needing a new snapshot", () => {
    const withOverlay = annotateQueueRows({
      rows: snapshotRows,
      entries: [outboxEntry("pending-1")],
    });
    expect(withOverlay.map((row) => row.id)).toEqual(["item-1", "pending-1"]);

    // The discard removes the outbox entry; the overlay recomputes from the
    // durable store, so the row disappears with no snapshot arriving.
    const afterDiscard = annotateQueueRows({ rows: snapshotRows, entries: [] });
    expect(afterDiscard.map((row) => row.id)).toEqual(["item-1"]);
  });
});

describe("resolveQueueStorageErrorRow", () => {
  it("carries the message key and the affected entry's text", () => {
    const row = resolveQueueStorageErrorRow({ itemId: "item-9" }, [
      {
        serverId: "server-1",
        agentId: "agent-1",
        itemId: "item-9",
        text: "the payload",
        intent: "queue",
        images: [],
        attachments: [],
        composerAttachments: [],
        createdAt: 1,
        attempts: 0,
      },
    ]);
    expect(row).toEqual({
      id: "queue-storage-error",
      messageKey: "composer.errors.queuedPersistFailed",
      entryText: "the payload",
    });
  });

  it("is null without an error and tolerates an unknown item id", () => {
    expect(resolveQueueStorageErrorRow(null, [])).toBeNull();
    const row = resolveQueueStorageErrorRow({ itemId: null }, []);
    expect(row?.entryText).toBeNull();
    expect(row?.messageKey).toBe("composer.errors.queuedPersistFailed");
  });
});

it("pending ids include tombstoned entries even when a snapshot contains them", () => {
  const tombstoned: PendingQueueEnqueue = {
    serverId: "server-1",
    agentId: "agent-1",
    itemId: "item-1",
    text: "text",
    intent: "queue",
    images: [],
    attachments: [],
    composerAttachments: [],
    createdAt: 1,
    attempts: 0,
    removalRequested: true,
  };
  const ids = getPendingQueueMessageIds([tombstoned], new Set(["item-1"]));
  expect([...ids]).toEqual(["item-1"]);
});

it("an outbox-only tombstone row carries its removal intent so discard stays rejected", () => {
  const tombstoned: PendingQueueEnqueue = {
    serverId: "server-1",
    agentId: "agent-1",
    itemId: "item-t",
    text: "cancel me",
    intent: "queue",
    images: [],
    attachments: [],
    composerAttachments: [],
    createdAt: 1,
    attempts: 3,
    removalRequested: true,
  };
  const plain: PendingQueueEnqueue = {
    ...tombstoned,
    itemId: "item-p",
    text: "plain pending",
    removalRequested: undefined,
  };
  const rows = appendPendingQueueRows([], [tombstoned, plain]);
  const tombstoneRow = rows.find((row) => row.id === "item-t");
  const plainRow = rows.find((row) => row.id === "item-p");
  expect(tombstoneRow?.removalRequested).toBe(true);
  expect(plainRow?.removalRequested).toBeUndefined();
});
