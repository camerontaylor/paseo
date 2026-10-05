import { page } from "vitest/browser";
import type { DraftRecord, DraftInput } from "@/stores/draft-store/state";
import type { Theme } from "@/styles/theme";
import React, { act, useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { within, waitFor } from "@testing-library/dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { EditingTextInput } from "@/components/ui/text-input";
import { i18n } from "@/i18n/i18next";
import { useDraftStore } from "@/stores/draft-store";
import { AgentQueueDestinationChangedError } from "@getpaseo/client/internal/daemon-client";
import { flushQueueOutboxForServer, useQueueOutboxStore } from "@/stores/queue-outbox-store";
import { SESSION_ROUTING_DRAFT_KEY } from "@/stores/draft-keys";
import { SessionRoutingComposer } from "./composer";
void i18n;
vi.mock("expo-router", () => ({
  router: {},
  useRouter: () => ({}),
  useLocalSearchParams: () => ({}),
  usePathname: () => "/fixture",
}));
vi.mock("react-native-unistyles", async () => {
  const { darkTheme } = await import("@/styles/theme");
  return {
    StyleSheet: {
      create: <T,>(styles: T | ((theme: Theme) => T)): T =>
        typeof styles === "function" ? Reflect.apply(styles, undefined, [darkTheme]) : styles,
    },
    withUnistyles: <T,>(component: T) => component,
    useUnistyles: () => ({ theme: darkTheme, rt: {}, breakpoint: undefined }),
    UnistylesRuntime: { themeName: "dark", setTheme: () => {} },
  };
});
const fixture = vi.hoisted(() => ({
  serverIds: ["host"],
  directory: true,
  query: "Where were we working on offline?",
  search: vi.fn(),
  enqueue: vi.fn(),
  open: vi.fn(),
  placement: {
    serverId: "host",
    workspaceId: "workspace",
    projectViewKey: "view",
    projectName: "Paseo",
    name: "paseo",
  },
}));
vi.mock("@/components/sidebar/sidebar-model", () => ({
  useSidebarModel: () => ({
    searchQuery: fixture.query,
    serverIds: fixture.serverIds,
    hostRegistryLoaded: true,
    allProjects: [{ viewKey: "view", projectName: "Paseo" }],
    workspacePlacements: fixture.directory ? [fixture.placement] : [],
  }),
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => [{ serverId: "host", label: "M5" }],
  getHostRuntimeStore: () => ({
    getClient: () => ({
      getConnectionState: () => ({ status: "connected" }),
      searchSessions: fixture.search,
      enqueueAgentMessage: fixture.enqueue,
    }),
  }),
}));
vi.mock("@/stores/navigation-active-workspace-store", () => ({
  useActiveWorkspaceSelection: () => ({ serverId: "host", workspaceId: "workspace" }),
}));
vi.mock("@/utils/navigate-to-agent", () => ({ navigateToAgent: fixture.open }));
vi.mock("@/stores/session-store", async () => {
  const { create } = await import("zustand");
  return {
    useSessionStore: create(() => ({
      sessions: {
        host: {
          hasHydratedWorkspaces: true,
          agents: new Map([
            [
              "chat",
              {
                id: "chat",
                serverId: "host",
                workspaceId: "workspace",
                title: "Offline indicator",
              },
            ],
          ]),
          workspaces: new Map([["workspace", { projectId: "project" }]]),
          serverInfo: { features: { sessionSearch: true, agentMessageQueue: true } },
        },
      },
      applyAgentQueueSnapshot: vi.fn(),
    })),
  };
});
vi.mock("@/stores/draft-store", async () => {
  const { create } = await import("zustand");
  const { persist } = await import("zustand/middleware");
  const { editDraftRecordText } = await import("@/stores/draft-store/state");
  const storage = (await import("@react-native-async-storage/async-storage")).default;
  const { createJSONStorage } = await import("zustand/middleware");
  interface FixtureDraftState {
    drafts: Record<string, DraftRecord>;
    editDraftText: (input: { draftKey: string; text: string }) => void;
    getDraftInput: (key: string) => DraftInput | undefined;
    hydrateDraftInput: (input: { draftKey: string }) => Promise<DraftInput | undefined>;
  }
  const fixtureDraftStore = create<FixtureDraftState>()(
    persist(
      (set, get) => ({
        drafts: {},
        editDraftText: ({ draftKey, text }) =>
          set((state) => ({
            drafts: {
              ...state.drafts,
              [draftKey]: editDraftRecordText(state.drafts[draftKey], text, Date.now()),
            },
          })),
        getDraftInput: (key) =>
          get().drafts[key]?.lifecycle === "active" ? get().drafts[key].input : undefined,
        hydrateDraftInput: async ({ draftKey }) => get().getDraftInput(draftKey),
      }),
      { name: "routing-fixture-drafts", storage: createJSONStorage(() => storage) },
    ),
  );
  return {
    useDraftStore: fixtureDraftStore,
    flushDraftPersistStorage: async () => {},
    flushDraftPersistStorageDurably: async () => {},
    awaitDraftHydration: async () => {
      if (!fixtureDraftStore.persist.hasHydrated()) await fixtureDraftStore.persist.rehydrate();
      if (!fixtureDraftStore.persist.hasHydrated()) throw new Error("Draft hydration failed");
    },
  };
});
let root: Root | undefined;
let container: HTMLDivElement;
let queryClient: QueryClient;
const result = {
  agentId: "chat",
  workspaceId: "workspace",
  projectId: "project",
  projectName: "Paseo",
  title: "Offline indicator",
  excerpt: "Relay reconnect investigation",
  confidence: 0.98,
};
beforeEach(async () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.search.mockReset();
  fixture.enqueue.mockReset();
  fixture.open.mockReset();
  fixture.serverIds = ["host"];
  fixture.directory = true;
  queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  fixture.query = "Where were we working on offline?";
  fixture.search.mockResolvedValue({ results: [result], searchedCount: 1, totalCount: 1 });
  fixture.enqueue.mockResolvedValue({ agentId: "chat", revision: 1, items: [] });
  await useDraftStore.persist.rehydrate();
  await useQueueOutboxStore.persist.rehydrate();
  useDraftStore.setState({
    drafts: {},
    hydrateDraftInput: async ({ draftKey }) => useDraftStore.getState().getDraftInput(draftKey),
  });
  useQueueOutboxStore.setState({ entries: {}, acknowledgements: {}, rejections: {} });
  document.body.style.background = "#141716";
  container = document.createElement("div");
  container.style.width = "320px";
  container.style.padding = "12px";
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});
const fixtureFindStyle = { color: "#f2f3f2", fontSize: 14 };
function Fixture() {
  const [query, setQuery] = useState(fixture.query);
  fixture.query = query;
  const renderInput = useCallback(
    (submit: () => void) => (
      <EditingTextInput
        style={fixtureFindStyle}
        accessibilityLabel="Find query"
        initialValue={query}
        onChangeText={setQuery}
        onSubmitEditing={submit}
      />
    ),
    [query],
  );
  return <SessionRoutingComposer>{renderInput}</SessionRoutingComposer>;
}
async function render() {
  await act(async () =>
    root?.render(
      <QueryClientProvider client={queryClient}>
        <Fixture />
      </QueryClientProvider>,
    ),
  );
  return within(container);
}
async function mount() {
  await render();
  await waitFor(() =>
    expect(within(container).getByTestId("routing-submit").getAttribute("aria-disabled")).not.toBe(
      "true",
    ),
  );
  return within(container);
}
function type(input: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) throw new Error("No input setter");
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
  });
}
test("Find and Open never deliver; Use restores independent draft and explicit send waits for acknowledgement", async () => {
  useDraftStore
    .getState()
    .editDraftText({ draftKey: SESSION_ROUTING_DRAFT_KEY, text: "  fix the relay\n" });
  const view = await mount();
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(view.getByText("Relay reconnect investigation")).toBeTruthy());
  expect(fixture.enqueue).not.toHaveBeenCalled();
  act(() => view.getByRole("button", { name: "Open chat" }).click());
  expect(fixture.open).toHaveBeenCalled();
  expect(fixture.enqueue).not.toHaveBeenCalled();
  act(() => view.getByRole("button", { name: "Use this chat" }).click());
  expect(view.getByTestId<HTMLInputElement>("routing-send-draft").value).toBe("  fix the relay\n");
  expect(fixture.enqueue).not.toHaveBeenCalled();
  let acknowledge!: (value: { agentId: string; revision: number; items: [] }) => void;
  fixture.enqueue.mockImplementation(
    () =>
      new Promise((resolve) => {
        acknowledge = resolve;
      }),
  );
  act(() => {
    view.getByTestId("routing-submit").click();
    view.getByTestId("routing-submit").click();
  });
  await waitFor(() => expect(fixture.enqueue).toHaveBeenCalledTimes(1));
  expect(fixture.search).toHaveBeenCalledTimes(1);
  expect(fixture.enqueue.mock.calls[0]?.[0]).toMatchObject({
    agentId: "chat",
    text: "  fix the relay\n",
    expectedWorkspaceId: "workspace",
  });
  expect(view.queryByText("Routed to Paseo · Offline indicator")).toBeNull();
  await act(async () => acknowledge({ agentId: "chat", revision: 1, items: [] }));
  await waitFor(() => expect(view.getByText("Routed to Paseo · Offline indicator")).toBeTruthy());
});
test("ambiguous send asks first and query edits clear stale Find results", async () => {
  const view = await mount();
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(view.getByText("Relay reconnect investigation")).toBeTruthy());
  type(view.getByRole<HTMLInputElement>("textbox", { name: "Find query" }), "different query");
  await waitFor(() => expect(view.queryByText("Relay reconnect investigation")).toBeNull());
  fixture.search.mockResolvedValue({
    results: [
      result,
      { ...result, agentId: "other", title: "Relay diagnostics", confidence: 0.93 },
    ],
    searchedCount: 2,
    totalCount: 2,
  });
  act(() => view.getByTestId("routing-send-mode").click());
  type(view.getByTestId<HTMLTextAreaElement>("routing-send-draft"), "continue");
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(view.getAllByRole("button", { name: "Send here" })).toHaveLength(2));
  expect(fixture.enqueue).not.toHaveBeenCalled();
  act(() => view.getAllByRole("button", { name: "Send here" })[0]?.click());
  await waitFor(() => expect(fixture.enqueue).toHaveBeenCalledTimes(1));
});

test("rendered desktop and compact fixture evidence", async () => {
  const view = await mount();
  await page.viewport(900, 640);
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(view.getByText("Relay reconnect investigation")).toBeTruthy());
  await page.screenshot({
    element: container,
    path: "../../../../.vitest-screenshots/routing-find-desktop.png",
  });
  act(() => view.getByRole("button", { name: "Use this chat" }).click());
  type(
    view.getByTestId<HTMLTextAreaElement>("routing-send-draft"),
    "Fix the offline indicator when the relay reconnects.",
  );
  await page.viewport(390, 700);
  await page.screenshot({
    element: container,
    path: "../../../../.vitest-screenshots/routing-send-compact.png",
  });
});

test("no match and incomplete coverage preserve the prompt and require manual choice", async () => {
  fixture.search.mockResolvedValue({ results: [], searchedCount: 1, totalCount: 1 });
  const view = await mount();
  act(() => view.getByTestId("routing-send-mode").click());
  type(view.getByTestId<HTMLTextAreaElement>("routing-send-draft"), "do the task");
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() =>
    expect(view.getByRole("button", { name: "Choose an existing chat" })).toBeTruthy(),
  );
  expect(fixture.enqueue).not.toHaveBeenCalled();
  expect(view.getByTestId<HTMLTextAreaElement>("routing-send-draft").value).toBe("do the task");
  fixture.search.mockResolvedValue({ results: [result], searchedCount: 100, totalCount: 150 });
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(view.getByRole("button", { name: "Send here" })).toBeTruthy());
  expect(fixture.enqueue).not.toHaveBeenCalled();
});
test("an old failed Find cannot override a newer lookup", async () => {
  let fail!: (error: Error) => void;
  fixture.search.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
  );
  const view = await mount();
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(fixture.search).toHaveBeenCalledTimes(1));
  type(view.getByRole<HTMLInputElement>("textbox", { name: "Find query" }), "new lookup");
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(view.getByText("Relay reconnect investigation")).toBeTruthy());
  await act(async () => fail(new Error("stale failure")));
  expect(view.queryByText("stale failure")).toBeNull();
  expect(fixture.enqueue).not.toHaveBeenCalled();
});

test("complete Find displays searched and total chat counts", async () => {
  fixture.search.mockResolvedValue({ results: [result], searchedCount: 12, totalCount: 12 });
  const view = await mount();
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() =>
    expect(view.getByText("Searched 12 of 12 chats.").textContent).toBe("Searched 12 of 12 chats."),
  );
  expect(fixture.enqueue).not.toHaveBeenCalled();
});

test("a selected host without a directory prevents automatic delivery", async () => {
  fixture.serverIds = ["host", "cold-host"];
  const view = await mount();
  act(() => view.getByTestId("routing-send-mode").click());
  type(view.getByTestId<HTMLTextAreaElement>("routing-send-draft"), "continue");
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(view.getAllByRole("button", { name: "Send here" })).toHaveLength(1));
  expect(view.getByText(/Host directories are still loading/).textContent).toContain(
    "Choose a chat manually.",
  );
  expect(fixture.search).toHaveBeenCalledTimes(1);
  expect(fixture.enqueue).not.toHaveBeenCalled();
  expect(view.getByTestId<HTMLTextAreaElement>("routing-send-draft").value).toBe("continue");
});

test("a pushed acknowledgement survives a lost enqueue response", async () => {
  fixture.enqueue.mockImplementation(async (entry) => {
    const outbox = useQueueOutboxStore.getState();
    await outbox.acknowledge(entry.itemId, {
      agentId: "chat",
      revision: 1,
      items: [{ id: entry.itemId, text: entry.text, createdAt: "2026-01-01T00:00:00.000Z" }],
    });
    await outbox.removeDurably(entry.itemId, true);
    throw new Error("response lost");
  });
  const view = await mount();
  act(() => view.getByTestId("routing-send-mode").click());
  type(view.getByTestId<HTMLTextAreaElement>("routing-send-draft"), "continue");
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() =>
    expect(view.getByText("Queued for Paseo · Offline indicator").textContent).toBe(
      "Queued for Paseo · Offline indicator",
    ),
  );
  expect(view.queryByText("response lost")).toBeNull();
  await waitFor(() =>
    expect(view.getByTestId<HTMLTextAreaElement>("routing-send-draft").value).toBe(""),
  );
  act(() => view.getByTestId("routing-submit").click());
  expect(fixture.enqueue).toHaveBeenCalledTimes(1);
});

test("changing selected hosts ignores an in-flight automatic send and clears editable recipients", async () => {
  let resolve!: (value: {
    results: (typeof result)[];
    searchedCount: number;
    totalCount: number;
  }) => void;
  fixture.search.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = await mount();
  act(() => view.getByTestId("routing-send-mode").click());
  type(view.getByTestId<HTMLTextAreaElement>("routing-send-draft"), "continue");
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(fixture.search).toHaveBeenCalledTimes(1));
  fixture.serverIds = ["cold-host"];
  await render();
  await act(async () => resolve({ results: [result], searchedCount: 1, totalCount: 1 }));
  expect(fixture.enqueue).not.toHaveBeenCalled();
  expect(view.queryByText("Relay reconnect investigation")).toBeNull();
  expect(view.getByTestId<HTMLTextAreaElement>("routing-send-draft").value).toBe("continue");
  fixture.serverIds = ["host"];
  await render();
  act(() => view.getByTestId("routing-find-mode").click());
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(view.getByRole("button", { name: "Use this chat" })).toBeTruthy());
  act(() => view.getByRole("button", { name: "Use this chat" }).click());
  fixture.serverIds = ["cold-host"];
  await render();
  expect(view.getByTestId("routing-recipient").textContent).toContain("Automatic");
});

test("host changes ignore stale Find failure and success", async () => {
  let reject!: (error: Error) => void;
  fixture.search.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  const view = await mount();
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(fixture.search).toHaveBeenCalledTimes(1));
  fixture.serverIds = ["cold-host"];
  await render();
  await act(async () => reject(new Error("old host failure")));
  expect(view.queryByText(/old host failure/)).toBeNull();
  expect(fixture.enqueue).not.toHaveBeenCalled();
});

test("filtering out an uncertain destination preserves its lock and original retry ID", async () => {
  fixture.enqueue.mockRejectedValueOnce(new Error("response lost"));
  const view = await mount();
  act(() => view.getByTestId("routing-send-mode").click());
  type(view.getByTestId<HTMLTextAreaElement>("routing-send-draft"), "continue");
  act(() => view.getByTestId("routing-submit").click());
  await waitFor(() => expect(view.getByRole("button", { name: "Retry delivery" })).toBeTruthy());
  const itemId = fixture.enqueue.mock.calls[0]?.[0].itemId;
  fixture.serverIds = ["cold-host"];
  await render();
  expect(view.getByTestId("routing-submit").getAttribute("aria-disabled")).toBe("true");
  act(() => view.getByRole("button", { name: "Retry delivery" }).click());
  expect(fixture.enqueue).toHaveBeenCalledTimes(1);
  fixture.serverIds = ["host"];
  await render();
  act(() => view.getByRole("button", { name: "Retry delivery" }).click());
  await waitFor(() => expect(fixture.enqueue).toHaveBeenCalledTimes(2));
  expect(fixture.enqueue.mock.calls[1]?.[0].itemId).toBe(itemId);
});

test("both persisted reads gate sending and restore an owned pending item with no loaded directory", async () => {
  useDraftStore.getState().editDraftText({ draftKey: SESSION_ROUTING_DRAFT_KEY, text: "continue" });
  const record = useDraftStore.getState().drafts[SESSION_ROUTING_DRAFT_KEY];
  await useQueueOutboxStore.getState().add({
    serverId: "host",
    agentId: "chat",
    itemId: "recovered-original",
    text: "continue",
    expectedWorkspaceId: "workspace",
    expectedProjectId: "project",
    routingOrigin: true,
    routingDraftVersion: record?.version,
    routingDraftUpdatedAt: record?.updatedAt,
    images: [],
    attachments: [],
    composerAttachments: [],
  });
  const draftStorage = useDraftStore.persist.getOptions().storage!;
  const outboxStorage = useQueueOutboxStore.persist.getOptions().storage!;
  let releaseDraft!: () => void;
  let releaseOutbox!: () => void;
  const draftRead = new Promise<void>((done) => {
    releaseDraft = done;
  });
  const outboxRead = new Promise<void>((done) => {
    releaseOutbox = done;
  });
  useDraftStore.persist.setOptions({
    storage: {
      ...draftStorage,
      getItem: async (key) => {
        await draftRead;
        return draftStorage.getItem(key);
      },
    },
  });
  useQueueOutboxStore.persist.setOptions({
    storage: {
      ...outboxStorage,
      getItem: async (key) => {
        await outboxRead;
        return outboxStorage.getItem(key);
      },
    },
  });
  const loadingDraft = useDraftStore.persist.rehydrate();
  const loadingOutbox = useQueueOutboxStore.persist.rehydrate();
  fixture.directory = false;
  try {
    const view = await render();
    expect(view.getByTestId("routing-submit").getAttribute("aria-disabled")).toBe("true");
    await act(async () => releaseDraft());
    await loadingDraft;
    expect(view.getByTestId("routing-submit").getAttribute("aria-disabled")).toBe("true");
    await act(async () => releaseOutbox());
    await loadingOutbox;
    await waitFor(() => expect(view.getByRole("button", { name: "Retry delivery" })).toBeTruthy());
    expect(view.getByTestId("routing-submit").getAttribute("aria-disabled")).toBe("true");
    expect(view.getByTestId<HTMLTextAreaElement>("routing-send-draft").value).toBe("continue");
    expect(fixture.search).not.toHaveBeenCalled();
    act(() => view.getByRole("button", { name: "Retry delivery" }).click());
    await waitFor(() => expect(fixture.enqueue).toHaveBeenCalledTimes(1));
    expect(fixture.enqueue.mock.calls[0]?.[0].itemId).toBe("recovered-original");
  } finally {
    releaseDraft();
    releaseOutbox();
    useDraftStore.persist.setOptions({ storage: draftStorage });
    useQueueOutboxStore.persist.setOptions({ storage: outboxStorage });
  }
});

test("an acknowledgement during draft loading cannot pair stale text with new ownership", async () => {
  useDraftStore.getState().editDraftText({ draftKey: SESSION_ROUTING_DRAFT_KEY, text: "continue" });
  const record = useDraftStore.getState().drafts[SESSION_ROUTING_DRAFT_KEY];
  await useQueueOutboxStore.getState().add({
    serverId: "host",
    agentId: "chat",
    itemId: "accepted-on-load",
    text: "continue",
    routingOrigin: true,
    routingDraftVersion: record?.version,
    routingDraftUpdatedAt: record?.updatedAt,
    images: [],
    attachments: [],
    composerAttachments: [],
  });
  let finishMigration!: () => void;
  const migration = new Promise<void>((done) => {
    finishMigration = done;
  });
  const staleInput = useDraftStore.getState().getDraftInput(SESSION_ROUTING_DRAFT_KEY);
  useDraftStore.setState({
    hydrateDraftInput: async () => {
      await migration;
      return staleInput;
    },
  });
  const view = await render();
  await act(async () => {
    await useQueueOutboxStore
      .getState()
      .acknowledge("accepted-on-load", { agentId: "chat", revision: 1, items: [] });
    await useQueueOutboxStore.getState().removeDurably("accepted-on-load");
    finishMigration();
  });
  await waitFor(() =>
    expect(view.getByTestId("routing-send-mode").getAttribute("aria-disabled")).not.toBe("true"),
  );
  act(() => view.getByTestId("routing-send-mode").click());
  expect(view.getByTestId<HTMLTextAreaElement>("routing-send-draft").value).toBe("");
  act(() => view.getByTestId("routing-submit").click());
  expect(fixture.enqueue).not.toHaveBeenCalled();
});

test("visible Find and Send actions have matching voice-accessible names", async () => {
  const view = await mount();
  expect(
    view.getByRole("button", { name: "Find existing chats", exact: true }).textContent,
  ).toContain("Find");
  act(() => view.getByRole("button", { name: "Send prompt mode", exact: true }).click());
  expect(
    view.getByRole("button", { name: "Send message to an existing chat", exact: true }).textContent,
  ).toContain("Send");
});

for (const outcome of ["acknowledged", "rejected"] as const) {
  test(`host exclusion clears the editable pin after pending delivery is ${outcome}`, async () => {
    const view = await mount();
    act(() => view.getByTestId("routing-submit").click());
    await waitFor(() => expect(view.getByRole("button", { name: "Use this chat" })).toBeTruthy());
    act(() => view.getByRole("button", { name: "Use this chat" }).click());
    type(view.getByTestId<HTMLTextAreaElement>("routing-send-draft"), "continue");
    fixture.enqueue.mockRejectedValueOnce(new Error("lost response"));
    act(() => view.getByTestId("routing-submit").click());
    await waitFor(() => expect(view.getByRole("button", { name: "Retry delivery" })).toBeTruthy());
    const itemId = fixture.enqueue.mock.calls[0]?.[0].itemId;
    fixture.serverIds = ["cold-host"];
    await render();
    expect(view.getByTestId("routing-recipient").textContent).toContain("Automatic");
    expect(view.getByRole("button", { name: "Retry delivery" })).toBeTruthy();
    await act(async () => {
      if (outcome === "acknowledged") {
        await useQueueOutboxStore
          .getState()
          .acknowledge(itemId, { agentId: "chat", revision: 2, items: [] });
        await useQueueOutboxStore.getState().removeDurably(itemId);
      } else {
        await flushQueueOutboxForServer({
          serverId: "host",
          client: {
            enqueueAgentMessage: async () => {
              throw new AgentQueueDestinationChangedError();
            },
          },
          applySnapshot: () => {},
        });
      }
    });
    await waitFor(() => expect(view.queryByRole("button", { name: "Retry delivery" })).toBeNull());
    expect(view.getByTestId("routing-recipient").textContent).toContain("Automatic");
    fixture.serverIds = ["host"];
    await render();
    act(() => view.getByTestId("routing-recipient").click());
    act(() => view.getByRole("button", { name: /Paseo.*Offline indicator/ }).click());
    type(view.getByTestId<HTMLTextAreaElement>("routing-send-draft"), "next prompt");
    act(() => view.getByTestId("routing-submit").click());
    await waitFor(() => expect(fixture.enqueue).toHaveBeenCalledTimes(2));
    expect(fixture.enqueue.mock.calls[1]?.[0].text).toBe("next prompt");
  });
}

test("cold recovery never adopts a moved chat's new project for retry", async () => {
  useDraftStore.getState().editDraftText({ draftKey: SESSION_ROUTING_DRAFT_KEY, text: "continue" });
  const record = useDraftStore.getState().drafts[SESSION_ROUTING_DRAFT_KEY];
  await useQueueOutboxStore.getState().add({
    serverId: "host",
    agentId: "chat",
    itemId: "moved-original",
    text: "continue",
    expectedWorkspaceId: "original-workspace",
    expectedProjectId: "original-project",
    routingOrigin: true,
    routingDraftVersion: record?.version,
    routingDraftUpdatedAt: record?.updatedAt,
    images: [],
    attachments: [],
    composerAttachments: [],
  });
  await useDraftStore.persist.rehydrate();
  await useQueueOutboxStore.persist.rehydrate();
  fixture.enqueue.mockImplementation(async (entry) => {
    if (entry.expectedWorkspaceId !== "workspace" || entry.expectedProjectId !== "project")
      throw new AgentQueueDestinationChangedError();
    return { agentId: "chat", revision: 1, items: [] };
  });
  const view = await render();
  await waitFor(() => expect(view.getByRole("button", { name: "Retry delivery" })).toBeTruthy());
  expect(view.getByTestId("routing-recipient").textContent).toContain("original-project");
  act(() => view.getByRole("button", { name: "Retry delivery" }).click());
  await waitFor(() => expect(fixture.enqueue).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(useQueueOutboxStore.getState().entries["moved-original"]).toBeUndefined(),
  );
  expect(fixture.enqueue.mock.calls[0]?.[0]).toMatchObject({
    itemId: "moved-original",
    expectedWorkspaceId: "original-workspace",
    expectedProjectId: "original-project",
  });
  expect(useQueueOutboxStore.getState().entries["moved-original"]).toBeUndefined();
  expect(view.getByTestId<HTMLTextAreaElement>("routing-send-draft").value).toBe("continue");
});
