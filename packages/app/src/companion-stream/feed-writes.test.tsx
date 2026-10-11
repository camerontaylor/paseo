// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";

const state = vi.hoisted(() => ({
  supported: true,
  durableSupported: true,
  connection: "online" as string,
  updateStreamEntry: vi.fn<(input: Record<string, unknown>) => Promise<void>>(),
  queryRows: [] as Array<Record<string, unknown>>,
  textInputProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("react-native", () => ({
  View: ({ children, testID }: { children?: React.ReactNode; testID?: string }) => (
    <div data-testid={testID}>{children}</div>
  ),
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  FlatList: ({
    data,
    renderItem,
    ListHeaderComponent: Header,
    ListEmptyComponent: Empty,
    ListFooterComponent: Footer,
  }: {
    data?: unknown[];
    renderItem?: (options: { item: unknown; index: number }) => React.ReactNode;
    ListHeaderComponent?: React.ReactNode;
    ListEmptyComponent?: React.ReactNode;
    ListFooterComponent?: React.ReactNode;
  }) => {
    const renderNode = (node: React.ReactNode) =>
      typeof node === "function" ? React.createElement(node) : node;
    const items = data ?? [];
    return (
      <div>
        {renderNode(Header)}
        {items.map((item, index) => {
          const key =
            (item as { id?: string })?.id ??
            (item as { artifact?: { path?: string } })?.artifact?.path ??
            `index-${index}`;
          return <div key={key}>{renderItem?.({ item, index })}</div>;
        })}
        {items.length === 0 ? renderNode(Empty) : null}
        {renderNode(Footer)}
      </div>
    );
  },
  ActivityIndicator: () => null,
  Pressable: ({
    onLongPress,
    disabled,
    testID,
  }: {
    onLongPress?: () => void;
    disabled?: boolean;
    testID?: string;
  }) => (
    <button type="button" data-testid={testID} onClick={disabled ? undefined : onLongPress}>
      pin
    </button>
  ),
}));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => ({}) },
  withUnistyles: (component: unknown) => component,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    disabled,
    testID,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    disabled?: boolean;
    testID?: string;
  }) => (
    <button type="button" onClick={onPress} disabled={disabled} data-testid={testID}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/ui/segmented-control", () => ({
  SegmentedControl: ({
    value,
    onValueChange,
    options,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
  }) => (
    <div>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={segmentPick(onValueChange, option.value)}
          data-active={option.value === value}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
}));
function segmentPick(onValueChange: (value: string) => void, value: string): () => void {
  return () => onValueChange(value);
}
vi.mock("@/components/ui/text-input", () => ({
  EditingTextInput: React.forwardRef(function EditingTextInput(
    props: Record<string, unknown>,
    _ref: unknown,
  ) {
    state.textInputProps.push(props);
    return <input data-testid="note-input" />;
  }),
}));
vi.mock("@/components/markdown/renderer", () => ({ MarkdownRenderer: () => null }));
vi.mock("@/artifacts/feed", () => ({
  ArtifactFeed: () => null,
  ArtifactCard: (props: Record<string, unknown>) => {
    const onPin = props.onPin as (() => void) | undefined;
    return (
      <button
        type="button"
        data-testid={`artifact-pin-${String((props.artifact as { path: string })?.path ?? "")}`}
        onClick={props.pinDisabled ? undefined : onPin}
      >
        pin-artifact
      </button>
    );
  },
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeConnectionStatus: () => state.connection,
  useHostRuntimeClient: () => ({ updateStreamEntry: state.updateStreamEntry }),
}));
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
vi.mock("@/utils/time", () => ({ formatMessageTimestamp: () => "now" }));
vi.mock("@/utils/navigate-to-agent", () => ({ navigateToAgent: () => "/stream" }));
const refetch = vi.fn(async () => undefined);
const fetchNextPage = vi.fn();
vi.mock("./use-global-stream", () => ({
  useGlobalStream: () => ({
    rows: state.queryRows,
    notices: [],
    refetch,
    fetchNextPage,
    isLoading: false,
    isFetching: false,
    isFetchingNextPage: false,
    hasNextPage: false,
  }),
}));

import { CompanionFeed } from "./feed";

function artifactRow(path: string) {
  return {
    id: JSON.stringify(["agent", "artifact", path]),
    agentId: "agent",
    agentTitle: "Chat",
    cwd: "/project",
    archived: false,
    timestamp: "2026-10-11T00:00:00.000Z",
    item: {
      kind: "artifact",
      artifact: {
        path,
        name: path,
        kind: "markdown",
        mimeType: "text/markdown",
        size: 1,
        createdAt: "2026-10-11T00:00:00.000Z",
        updatedAt: "2026-10-11T00:00:00.000Z",
      },
    },
  };
}

function askRow(entry: CompanionEntry) {
  return {
    id: JSON.stringify(["agent", "entry", entry.id]),
    agentId: "agent",
    agentTitle: "Chat",
    cwd: "/project",
    archived: false,
    timestamp: entry.timestamp,
    item: { kind: "entry", entry },
  };
}

const askEntry = (revision: number): CompanionEntry =>
  ({
    id: "ask:deploy",
    kind: "question",
    status: "open",
    timestamp: "2026-10-11T00:00:00.000Z",
    text: "Deploy",
    truncated: false,
    ask: {
      state: "in_progress",
      remaining: "Review",
      evidence: "Tests pass",
      revision,
      provenance: "explicit",
    },
  }) as CompanionEntry;

beforeEach(() => {
  vi.stubGlobal("React", React);
  state.supported = true;
  state.durableSupported = true;
  state.connection = "online";
  state.textInputProps.length = 0;
  state.queryRows = [];
  state.updateStreamEntry = vi.fn().mockResolvedValue(undefined);
  refetch.mockClear();
  fetchNextPage.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const baseProps = {
  serverId: "host",
  agentId: "agent",
  cwd: "/project",
  artifacts: [],
  isSupported: true,
  artifactsSupported: true,
  onReturnToChat: () => undefined,
  onReplyInChat: () => undefined,
};

it("renders the degraded-capture warning from the carried flag and clears it on recovery", () => {
  const rendered = render(<CompanionFeed {...baseProps} captureDegraded />);
  expect(rendered.getByTestId("companion-stream-degraded")).toBeTruthy();
  rendered.rerender(<CompanionFeed {...baseProps} />);
  expect(rendered.queryByTestId("companion-stream-degraded")).toBeNull();
});

it("keeps controls fenced while concurrent artifact saves are in flight", async () => {
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const gates = [
    new Promise<void>((resolve) => {
      releaseFirst = resolve;
    }),
    new Promise<void>((resolve) => {
      releaseSecond = resolve;
    }),
  ];
  state.updateStreamEntry = vi.fn().mockImplementation(() => gates.shift());
  state.queryRows = [artifactRow("a.md"), artifactRow("b.md")];
  const rendered = render(<CompanionFeed {...baseProps} />);
  // Artifacts render in the stream tab only when the open-only filter is off.
  fireEvent.click(rendered.getByText("agentPanel.stream.queueTab"));
  fireEvent.click(rendered.getByTestId("companion-stream-pending"));
  fireEvent.click(rendered.getByTestId("artifact-pin-a.md"));
  fireEvent.click(rendered.getByTestId("artifact-pin-b.md"));
  await Promise.resolve();
  expect(state.updateStreamEntry).toHaveBeenCalledTimes(2);
  const savingNotice = () => rendered.queryByText("globalStream.saving");
  await vi.waitFor(() => {
    expect(savingNotice()).toBeTruthy();
  });
  // The first completion must not re-enable controls while the second pends.
  releaseFirst();
  await vi.waitFor(() => {
    expect(savingNotice()).toBeTruthy();
  });
  releaseSecond();
  await vi.waitFor(() => {
    expect(savingNotice()).toBeNull();
  });
});

it("sends the displayed revision from a cached ask card and fences when trackedAsks disappears", async () => {
  state.queryRows = [askRow(askEntry(3))];
  const rendered = render(<CompanionFeed {...baseProps} />);
  // Open (an enabled action) proves gated dispatch carries the displayed revision.
  fireEvent.click(rendered.getByText("agentPanel.stream.statusOpen"));
  await Promise.resolve();
  expect(state.updateStreamEntry).toHaveBeenCalledTimes(1);
  expect(state.updateStreamEntry.mock.calls[0]?.[0]).toMatchObject({
    agentId: "agent",
    entryId: "ask:deploy",
    action: "update_status",
    status: "open",
    expectedRevision: 3,
  });
  // Removing trackedAsks while the card stays cached fences the next write.
  state.durableSupported = false;
  rendered.rerender(<CompanionFeed {...baseProps} />);
  // Ask cards relabel Reviewed as "In progress"; the fenced card stays cached.
  fireEvent.click(rendered.getAllByText("globalStream.askStateInProgress")[1]);
  await Promise.resolve();
  expect(state.updateStreamEntry).toHaveBeenCalledTimes(1);
  // Restoration re-enables dispatch (tested separately from the loss).
  state.durableSupported = true;
  rendered.rerender(<CompanionFeed {...baseProps} />);
  fireEvent.click(rendered.getAllByText("globalStream.askStateInProgress")[1]);
  await Promise.resolve();
  expect(state.updateStreamEntry).toHaveBeenCalledTimes(2);
  expect(state.updateStreamEntry.mock.calls[1]?.[0]).toMatchObject({ expectedRevision: 3 });
  // Done stays disabled for ask-bearing entries across both flag states: the
  // old status path can never bypass the completion-evidence contract.
  expect((rendered.getByText("agentPanel.stream.statusDone") as HTMLButtonElement).disabled).toBe(
    true,
  );
});

it("creates checklist asks with expectedRevision 0 and scopes retry identity per action", async () => {
  let failFirst = true;
  state.updateStreamEntry = vi.fn().mockImplementation(async (input) => {
    if (failFirst) {
      failFirst = false;
      throw new Error("lost ack");
    }
    void input;
  });
  const rendered = render(<CompanionFeed {...baseProps} />);
  typeNote("Ship the requested feature");
  pressSubmit();
  await Promise.resolve();
  await Promise.resolve();
  expect(state.updateStreamEntry).toHaveBeenCalledTimes(1);
  expect(state.updateStreamEntry.mock.calls[0]?.[0]).toMatchObject({
    action: "set_ask",
    entryId: expect.any(String),
    expectedRevision: 0,
    ask: { state: "open", remaining: "", evidence: "" },
  });
  const askIdentity = state.updateStreamEntry.mock.calls[0]?.[0]?.entryId;
  // A lost ack replays the same ask identity.
  typeNote("Ship the requested feature");
  pressSubmit();
  await Promise.resolve();
  expect(state.updateStreamEntry.mock.calls[1]?.[0]?.entryId).toBe(askIdentity);
  await vi.waitFor(() => {
    expect(rendered.queryByText("globalStream.saving")).toBeNull();
  });
  // Switching tabs starts a fresh identity under the other action prefix.
  fireEvent.click(rendered.getByText("agentPanel.stream.pinnedTab"));
  typeNote("Keep this");
  pressSubmit();
  await vi.waitFor(() => {
    expect(state.updateStreamEntry.mock.calls[2]?.[0]).toMatchObject({
      action: "add_pin",
    });
  });
  expect(state.updateStreamEntry.mock.calls[2]?.[0]?.entryId).not.toBe(askIdentity);
});

it("keeps a new checklist ask fenced when trackedAsks is absent at mount, retaining the draft", async () => {
  state.durableSupported = false;
  const rendered = render(<CompanionFeed {...baseProps} />);
  // The view tab still defaults to Checklist, but its submit control is fenced.
  expect((rendered.getByTestId("note-submit") as HTMLButtonElement).disabled).toBe(true);
  typeNote("Ship the requested feature");
  pressSubmit();
  await Promise.resolve();
  expect(state.updateStreamEntry).not.toHaveBeenCalled();
  // The draft survives; restoring the capability submits the same text as a set_ask.
  state.durableSupported = true;
  rendered.rerender(<CompanionFeed {...baseProps} />);
  pressSubmit();
  await vi.waitFor(() => expect(state.updateStreamEntry).toHaveBeenCalledTimes(1));
  expect(state.updateStreamEntry.mock.calls[0]?.[0]).toMatchObject({
    action: "set_ask",
    text: "Ship the requested feature",
  });
});

it("fences a lost checklist ask with typed text, retaining the draft and sending zero calls", async () => {
  const rendered = render(<CompanionFeed {...baseProps} />);
  typeNote("Ship the requested feature");
  // Losing trackedAsks while the typed draft is present fences the submit.
  state.durableSupported = false;
  rendered.rerender(<CompanionFeed {...baseProps} />);
  expect((rendered.getByTestId("note-submit") as HTMLButtonElement).disabled).toBe(true);
  pressSubmit();
  await Promise.resolve();
  expect(state.updateStreamEntry).not.toHaveBeenCalled();
  // Restoration submits the retained draft, not a cleared one.
  state.durableSupported = true;
  rendered.rerender(<CompanionFeed {...baseProps} />);
  pressSubmit();
  await vi.waitFor(() => expect(state.updateStreamEntry).toHaveBeenCalledTimes(1));
  expect(state.updateStreamEntry.mock.calls[0]?.[0]).toMatchObject({
    action: "set_ask",
    text: "Ship the requested feature",
  });
});

function typeNote(text: string) {
  const input = state.textInputProps[state.textInputProps.length - 1];
  act(() => {
    (input.onChangeText as (value: string) => void)(text);
  });
}

function pressSubmit() {
  const input = state.textInputProps[state.textInputProps.length - 1];
  act(() => {
    (input.onSubmitEditing as () => void)();
  });
}
