import { describe, expect, it } from "vitest";
import type { StateStorage } from "zustand/middleware";
import type { ComposerAttachment, UserComposerAttachment } from "@/attachments/types";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import {
  migratePersistedState,
  type MigrateLegacyImages,
  PersistedDraftStoreSchema,
} from "./migration";
import { isAttachmentMetadata, type DraftRecord } from "./state";

const passThroughMigrateLegacyImages: MigrateLegacyImages = async (images) =>
  images.filter(isAttachmentMetadata);

function createMemoryStorage(): StateStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
  };
}

function activeDraft(
  text: string,
  updatedAt: number,
  attachments: UserComposerAttachment[] = [],
): DraftRecord {
  return {
    input: { text, attachments },
    lifecycle: "active",
    updatedAt,
    version: 1,
  };
}

function githubIssueAttachment(
  number: number,
): Extract<UserComposerAttachment, { kind: "github_issue" }> {
  return {
    kind: "github_issue",
    item: {
      kind: "issue",
      number,
      title: `Review item ${number}`,
      url: `https://example.com/issues/${number}`,
      state: "open",
      body: null,
      labels: [],
    },
  };
}

function githubPrAttachment(
  number: number,
): Extract<UserComposerAttachment, { kind: "github_pr" }> {
  return {
    kind: "github_pr",
    item: {
      kind: "change_request",
      number,
      title: `Review item ${number}`,
      url: `https://example.com/pulls/${number}`,
      state: "open",
      body: null,
      labels: [],
      baseRefName: "main",
      headRefName: "feature/legacy",
    },
  };
}

function workspaceReviewAttachment(): Extract<ComposerAttachment, { kind: "review" }> {
  return {
    kind: "review",
    reviewDraftKey: "review:key",
    commentCount: 1,
    attachment: {
      type: "review",
      mimeType: "application/paseo-review",
      cwd: "/repo",
      mode: "uncommitted",
      baseRef: null,
      comments: [
        {
          filePath: "src/example.ts",
          side: "new",
          lineNumber: 41,
          body: "Please simplify this.",
          context: {
            hunkHeader: "@@ -40,1 +40,1 @@",
            targetLine: {
              oldLineNumber: null,
              newLineNumber: 41,
              type: "add",
              content: "const value = newValue;",
            },
            lines: [
              {
                oldLineNumber: null,
                newLineNumber: 41,
                type: "add",
                content: "const value = newValue;",
              },
            ],
          },
        },
      ],
    },
  };
}

describe("draft-store migration", () => {
  it("keeps a supported legacy draft for migration", async () => {
    const backing = createMemoryStorage();
    const legacyState = {
      drafts: {
        "draft:unsent": {
          text: "do not lose this",
          attachments: [],
        },
      },
      createModalDraft: null,
    };
    backing.values.set("paseo-drafts", JSON.stringify({ state: legacyState, version: 4 }));
    const storage = createValidatedPersistStorage(backing, PersistedDraftStoreSchema);

    const stored = await storage.getItem("paseo-drafts");
    const migrated = await migratePersistedState(stored?.state, {
      migrateLegacyImages: passThroughMigrateLegacyImages,
      nowMs: 1,
    });

    expect(migrated.drafts["draft:unsent"]?.input.text).toBe("do not lose this");
    expect(backing.values.has("paseo-drafts")).toBe(true);
  });

  it("promotes the newest legacy New Workspace draft into the singleton surface", async () => {
    const forkDraft = activeDraft("fork context", 1700000000003);
    const agentDraft = activeDraft("agent prompt", 1700000000004);

    const migrated = await migratePersistedState(
      {
        drafts: {
          "new-workspace:server-a:/project/older": activeDraft(
            "older new workspace prompt",
            1700000000001,
          ),
          "new-workspace:server-b:/project/newer": activeDraft(
            "newer new workspace prompt",
            1700000000002,
          ),
          "new-workspace:draft:fork-1": forkDraft,
          "agent:server-a:agent-1": agentDraft,
        },
        createModalDraft: null,
      },
      { migrateLegacyImages: passThroughMigrateLegacyImages, nowMs: 1700000000005 },
    );

    expect(migrated.drafts).toEqual({
      "new-workspace": activeDraft("newer new workspace prompt", 1700000000002),
      "new-workspace:draft:fork-1": forkDraft,
      "agent:server-a:agent-1": agentDraft,
    });
  });

  it("drops unowned checkout PR context when promoting a scoped New Workspace draft", async () => {
    const issue = githubIssueAttachment(101);
    const migrated = await migratePersistedState(
      {
        drafts: {
          "new-workspace:server-a:/project/a": activeDraft("keep the prompt", 2, [
            issue,
            githubPrAttachment(202),
          ]),
        },
        createModalDraft: null,
      },
      { migrateLegacyImages: passThroughMigrateLegacyImages, nowMs: 3 },
    );

    expect(migrated.drafts["new-workspace"]?.input).toEqual({
      text: "keep the prompt",
      attachments: [issue],
    });
  });

  it("normalizes legacy image metadata into image attachments and strips persisted preview URLs", async () => {
    const migrated = await migratePersistedState(
      {
        drafts: {
          "agent:server:agent": {
            input: {
              text: "hello",
              images: [
                {
                  id: "att-1",
                  mimeType: "image/png",
                  storageType: "desktop-file",
                  storageKey: "/tmp/att-1.png",
                  createdAt: 1700000000000,
                  previewUri: "asset://should-not-persist",
                },
              ],
            },
            lifecycle: "active",
            updatedAt: 1700000000001,
            version: 1,
          },
        },
        createModalDraft: null,
      },
      { migrateLegacyImages: passThroughMigrateLegacyImages, nowMs: 1700000000002 },
    );

    expect(migrated.drafts["agent:server:agent"]?.input).toEqual({
      text: "hello",
      attachments: [
        {
          kind: "image",
          metadata: {
            id: "att-1",
            mimeType: "image/png",
            storageType: "desktop-file",
            storageKey: "/tmp/att-1.png",
            createdAt: 1700000000000,
          },
        },
      ],
    });
  });

  it("hydrates old persisted drafts that still include cwd", async () => {
    const original = {
      drafts: {
        "agent:server:agent": {
          input: {
            text: "hello",
            attachments: [
              {
                kind: "image",
                metadata: {
                  id: "att-1",
                  mimeType: "image/jpeg",
                  storageType: "web-indexeddb",
                  storageKey: "att-1",
                  createdAt: 1700000000000,
                },
              },
            ],
            cwd: "/repo",
          },
          lifecycle: "active",
          updatedAt: 1700000000001,
          version: 2,
        },
      },
      createModalDraft: null,
    };

    const ports = { migrateLegacyImages: passThroughMigrateLegacyImages, nowMs: 1700000000002 };
    const once = await migratePersistedState(original, ports);
    const twice = await migratePersistedState(once, ports);

    expect(twice).toEqual(once);
    expect(twice.drafts["agent:server:agent"]?.input).toEqual({
      text: "hello",
      attachments: [
        {
          kind: "image",
          metadata: {
            id: "att-1",
            mimeType: "image/jpeg",
            storageType: "web-indexeddb",
            storageKey: "att-1",
            createdAt: 1700000000000,
          },
        },
      ],
    });
  });

  it("drops a legacy workspace review attachment without deleting its draft", async () => {
    const backing = createMemoryStorage();
    const persistedState = {
      drafts: {
        "agent:server:agent": {
          input: {
            text: "hello",
            attachments: [workspaceReviewAttachment()],
          },
          lifecycle: "active",
          updatedAt: 1700000000001,
          version: 2,
        },
      },
      createModalDraft: null,
    };
    backing.values.set("paseo-drafts", JSON.stringify({ state: persistedState, version: 4 }));
    const storage = createValidatedPersistStorage(backing, PersistedDraftStoreSchema);

    const stored = await storage.getItem("paseo-drafts");
    const migrated = await migratePersistedState(stored?.state, {
      migrateLegacyImages: passThroughMigrateLegacyImages,
      nowMs: 1700000000002,
    });

    expect(migrated.drafts["agent:server:agent"]?.input).toEqual({
      text: "hello",
      attachments: [],
    });
    expect(backing.values.has("paseo-drafts")).toBe(true);
  });
});

describe("draft-store queueEdit metadata", () => {
  it("survives a round trip through the validated storage and a fresh rehydrate", async () => {
    const backing = createMemoryStorage();
    const storage = createValidatedPersistStorage(backing, PersistedDraftStoreSchema);
    const queuedEditState = {
      drafts: {
        "queued-edit:srv:agent-1:item-1:baseline": {
          input: {
            text: "row text at edit start",
            attachments: [],
            queueEdit: { itemId: "item-1", baselineRevision: 4 },
          },
          lifecycle: "active",
          updatedAt: 1,
          version: 1,
        },
        "queued-edit:srv:agent-1:item-1": {
          input: {
            text: "work in progress",
            attachments: [],
            queueEdit: { itemId: "item-1", baselineRevision: 4, conflicted: true },
          },
          lifecycle: "active",
          updatedAt: 2,
          version: 3,
        },
      },
      createModalDraft: null,
    };
    // The validated storage expects the zustand-persist envelope.
    await storage.setItem("paseo-drafts", { state: queuedEditState, version: 5 } as never);

    const reloaded = await createValidatedPersistStorage(
      backing,
      PersistedDraftStoreSchema,
    ).getItem("paseo-drafts");
    const migrated = await migratePersistedState(reloaded?.state, {
      migrateLegacyImages: passThroughMigrateLegacyImages,
      nowMs: 3,
    });

    expect(migrated.drafts["queued-edit:srv:agent-1:item-1:baseline"]?.input.queueEdit).toEqual({
      itemId: "item-1",
      baselineRevision: 4,
    });
    expect(migrated.drafts["queued-edit:srv:agent-1:item-1"]?.input.queueEdit).toEqual({
      itemId: "item-1",
      baselineRevision: 4,
      conflicted: true,
    });
  });

  it("a legacy payload without queueEdit migrates unchanged", async () => {
    const backing = createMemoryStorage();
    const legacyState = {
      drafts: {
        "draft:plain": { text: "plain draft", attachments: [] },
      },
      createModalDraft: null,
    };
    backing.values.set("paseo-drafts", JSON.stringify({ state: legacyState, version: 4 }));
    const storage = createValidatedPersistStorage(backing, PersistedDraftStoreSchema);

    const stored = await storage.getItem("paseo-drafts");
    const migrated = await migratePersistedState(stored?.state, {
      migrateLegacyImages: passThroughMigrateLegacyImages,
      nowMs: 1,
    });

    expect(migrated.drafts["draft:plain"]?.input.text).toBe("plain draft");
    expect(migrated.drafts["draft:plain"]?.input.queueEdit).toBeUndefined();
  });
});
