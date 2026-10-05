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
import { useQueueOutboxStore } from "@/stores/queue-outbox-store";
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
    allProjects: [{ viewKey: "view", projectName: "Paseo" }],
    workspacePlacements: [fixture.placement],
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
  return { useDraftStore: fixtureDraftStore, flushDraftPersistStorage: async () => {} };
});
let root: Root | undefined;
let container: HTMLDivElement;
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
  fixture.search.mockReset();
  fixture.enqueue.mockReset();
  fixture.open.mockReset();
  fixture.query = "Where were we working on offline?";
  fixture.search.mockResolvedValue({ results: [result], searchedCount: 1, totalCount: 1 });
  fixture.enqueue.mockResolvedValue({ agentId: "chat", revision: 1, items: [] });
  await useDraftStore.persist.rehydrate();
  await useQueueOutboxStore.persist.rehydrate();
  useDraftStore.setState({ drafts: {} });
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
async function mount() {
  await act(async () =>
    root?.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
      >
        <Fixture />
      </QueryClientProvider>,
    ),
  );
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
