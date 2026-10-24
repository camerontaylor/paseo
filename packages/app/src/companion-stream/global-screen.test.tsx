// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import type { GlobalStreamRow } from "./use-global-stream";

const state = vi.hoisted(() => ({
  supported: true,
  durableSupported: true,
  connection: "online",
  updateStreamEntry: vi.fn().mockResolvedValue(undefined),
  onUpdateStatus: undefined as
    | undefined
    | ((id: string, status: "open" | "reviewed" | "done") => void),
}));
vi.mock("react-native", () => ({
  View: ({ children, testID }: { children: React.ReactNode; testID?: string }) => (
    <div data-testid={testID}>{children}</div>
  ),
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  FlatList: () => null,
}));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => ({}) },
  withUnistyles: (component: unknown) => component,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (store: unknown) => unknown) =>
    selector({
      sessions: {
        host: {
          serverInfo: {
            features: { globalStream: state.supported, trackedAsks: state.durableSupported },
          },
        },
      },
    }),
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => [],
  useHostRuntimeClient: () => ({ updateStreamEntry: state.updateStreamEntry }),
  useHostRuntimeConnectionStatus: () => state.connection,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => (
    <button type="button" onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/headers/menu-header", () => ({ MenuHeader: () => null }));
vi.mock("@/components/ui/search-field", () => ({ SearchField: () => null }));
vi.mock("@/components/ui/segmented-control", () => ({ SegmentedControl: () => null }));
vi.mock("@/components/ui/loading-spinner", () => ({ LoadingSpinner: () => null }));
vi.mock("@/components/hosts/host-filter", () => ({ HostFilter: () => null }));
vi.mock("@/components/hosts/host-picker", () => ({ ALL_HOSTS_OPTION_ID: "all" }));
vi.mock("@/hooks/use-debounced-value", () => ({ useDebouncedValue: (value: unknown) => value }));
vi.mock("@/utils/navigate-to-agent", () => ({ navigateToAgent: vi.fn() }));
vi.mock("./use-global-stream", () => ({ useGlobalStream: vi.fn() }));
// The EntryCard internals are covered by feed-writes.test.tsx (real card,
// real status buttons). This suite exercises the global card's gating, so the
// stub mirrors EntryCard's button contract: card-level `disabled` disables all
// actions, and Done is additionally disabled for ask-bearing entries.
vi.mock("./feed", () => ({
  EntryCard: ({
    entry,
    disabled,
    onUpdateStatus,
  }: {
    entry: { id: string; ask?: unknown };
    disabled: boolean;
    onUpdateStatus: typeof state.onUpdateStatus;
  }) => {
    state.onUpdateStatus = onUpdateStatus;
    const entryId = entry.id;
    const open = React.useCallback(
      () => onUpdateStatus?.(entryId, "open"),
      [onUpdateStatus, entryId],
    );
    const reviewed = React.useCallback(
      () => onUpdateStatus?.(entryId, "reviewed"),
      [onUpdateStatus, entryId],
    );
    const done = React.useCallback(
      () => onUpdateStatus?.(entryId, "done"),
      [onUpdateStatus, entryId],
    );
    const doneDisabled = disabled || Boolean(entry.ask);
    return (
      <div>
        <button type="button" data-testid="card-open" disabled={disabled} onClick={open}>
          Open
        </button>
        <button type="button" data-testid="card-reviewed" disabled={disabled} onClick={reviewed}>
          Reviewed
        </button>
        <button type="button" data-testid="card-done" disabled={doneDisabled} onClick={done}>
          Done
        </button>
      </div>
    );
  },
}));

import { GlobalStreamCard } from "./global-screen";

beforeEach(() => {
  vi.stubGlobal("React", React);
  state.supported = true;
  state.durableSupported = true;
  state.connection = "online";
  state.updateStreamEntry = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const row: GlobalStreamRow = {
  id: "row",
  timestamp: "2026-10-05T00:00:00Z",
  serverId: "host",
  serverLabel: "Host",
  agentId: "agent",
  agentTitle: "Chat",
  cwd: "/project",
  archived: false,
  item: {
    kind: "entry",
    entry: {
      id: "question:q",
      kind: "question",
      text: "Choose name",
      status: "open",
      timestamp: "2026-10-05T00:00:00Z",
      truncated: false,
    },
  },
};

const askRow: GlobalStreamRow = {
  ...row,
  item: {
    kind: "entry",
    entry: {
      id: "ask:deploy",
      kind: "question",
      text: "Deploy",
      status: "open",
      timestamp: "2026-10-05T00:00:00Z",
      truncated: false,
      ask: {
        state: "in_progress",
        remaining: "Review",
        evidence: "Tests pass",
        revision: 5,
        provenance: "explicit",
      },
    } as CompanionEntry,
  },
};

it("blocks cached-card writes when a reconnected host loses global Stream capability", async () => {
  const onSaved = vi.fn();
  const rendered = render(<GlobalStreamCard row={row} onSaved={onSaved} />);
  expect((rendered.getByTestId("card-done") as HTMLButtonElement).disabled).toBe(false);
  state.supported = false;
  rendered.rerender(<GlobalStreamCard row={row} onSaved={onSaved} />);
  expect((rendered.getByTestId("card-done") as HTMLButtonElement).disabled).toBe(true);
  state.onUpdateStatus?.("question:q", "done");
  expect(state.updateStreamEntry).not.toHaveBeenCalled();
  state.supported = true;
  state.connection = "offline";
  rendered.rerender(<GlobalStreamCard row={row} onSaved={onSaved} />);
  expect((rendered.getByTestId("card-done") as HTMLButtonElement).disabled).toBe(true);
  state.onUpdateStatus?.("question:q", "done");
  expect(state.updateStreamEntry).not.toHaveBeenCalled();
  state.connection = "online";
  rendered.rerender(<GlobalStreamCard row={row} onSaved={onSaved} />);
  fireEvent.click(rendered.getByTestId("card-done"));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(state.updateStreamEntry).toHaveBeenCalledExactlyOnceWith({
    agentId: "agent",
    entryId: "question:q",
    action: "update_status",
    status: "done",
  });
});

it("carries the ask revision, fences on trackedAsks loss, and surfaces stale-write feedback", async () => {
  const onSaved = vi.fn();
  const rendered = render(<GlobalStreamCard row={askRow} onSaved={onSaved} />);
  // Done is disabled for an ask even while trackedAsks is supported; an enabled
  // action (Open) proves the gated dispatch carries the displayed revision.
  expect((rendered.getByTestId("card-done") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(rendered.getByTestId("card-open"));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(state.updateStreamEntry).toHaveBeenLastCalledWith({
    agentId: "agent",
    entryId: "ask:deploy",
    action: "update_status",
    status: "open",
    expectedRevision: 5,
  });

  // Removing trackedAsks with the card cached disables every action and the
  // dispatch guard refuses even a direct call.
  state.durableSupported = false;
  rendered.rerender(<GlobalStreamCard row={askRow} onSaved={onSaved} />);
  expect((rendered.getByTestId("card-open") as HTMLButtonElement).disabled).toBe(true);
  state.updateStreamEntry.mockClear();
  state.onUpdateStatus?.("ask:deploy", "open");
  expect(state.updateStreamEntry).not.toHaveBeenCalled();

  // Restoration re-enables the same card (loss and restoration tested apart).
  state.durableSupported = true;
  rendered.rerender(<GlobalStreamCard row={askRow} onSaved={onSaved} />);
  expect((rendered.getByTestId("card-open") as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(rendered.getByTestId("card-open"));
  await waitFor(() => expect(state.updateStreamEntry).toHaveBeenCalledOnce());
  expect(state.updateStreamEntry).toHaveBeenLastCalledWith(
    expect.objectContaining({ expectedRevision: 5 }),
  );

  // A rejected stale write surfaces feedback and never reports success.
  const rejection = vi.fn().mockRejectedValue(new Error("stale revision"));
  state.updateStreamEntry = rejection;
  const onSavedAfterRejection = vi.fn();
  rendered.rerender(<GlobalStreamCard row={askRow} onSaved={onSavedAfterRejection} />);
  fireEvent.click(rendered.getByTestId("card-open"));
  await waitFor(() => expect(rendered.getByText("stale revision")).toBeTruthy());
  expect(onSavedAfterRejection).not.toHaveBeenCalled();
});
