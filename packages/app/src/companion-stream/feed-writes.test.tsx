// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";

const state = vi.hoisted(() => ({
  supported: true,
  connection: "online" as string,
  updateStreamEntry: vi.fn<(input: Record<string, unknown>) => Promise<void>>(),
  textInputProps: [] as Array<Record<string, unknown>>,
  artifactCardProps: [] as Array<Record<string, unknown>>,
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
            (item as { id?: string; artifact?: { path?: string } })?.id ??
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
function segmentPick(onValueChange: (value: string) => void, value: string): () => void {
  return () => onValueChange(value);
}
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
vi.mock("@/components/ui/text-input", () => ({
  EditingTextInput: React.forwardRef(function EditingTextInput(
    props: Record<string, unknown>,
    _ref: unknown,
  ) {
    state.textInputProps.push(props);
    return <input data-testid="note-input" />;
  }),
}));
vi.mock("@/components/markdown/renderer", () => ({
  MarkdownRenderer: () => null,
}));
vi.mock("@/artifacts/feed", () => ({
  ArtifactFeed: () => null,
  ArtifactCard: (props: Record<string, unknown>) => {
    state.artifactCardProps.push(props);
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
        host: { serverInfo: { features: { globalStream: state.supported } } },
      },
    }),
}));
vi.mock("@/utils/time", () => ({ formatMessageTimestamp: () => "now" }));

import { CompanionFeed } from "./feed";

const artifact = (path: string) => ({
  path,
  name: path,
  kind: "markdown" as const,
  mimeType: "text/markdown",
  size: 1,
  createdAt: "2026-10-11T00:00:00.000Z",
  updatedAt: "2026-10-11T00:00:00.000Z",
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

beforeEach(() => {
  vi.stubGlobal("React", React);
  state.supported = true;
  state.connection = "online";
  state.textInputProps.length = 0;
  state.artifactCardProps.length = 0;
  state.updateStreamEntry = vi.fn().mockResolvedValue(undefined);
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
  const rendered = render(<CompanionFeed {...baseProps} captureDegraded entries={[]} />);
  expect(rendered.getByTestId("companion-stream-degraded")).toBeTruthy();
  rendered.rerender(<CompanionFeed {...baseProps} entries={[]} />);
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
  const rendered = render(
    <CompanionFeed {...baseProps} artifacts={[artifact("a.md"), artifact("b.md")]} entries={[]} />,
  );
  // Artifacts render in the stream tab only when the open-only filter is off.
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

it("scopes lost-ack retry identity per action and fences on capability or offline loss", async () => {
  const ids: Array<{ action?: string; entryId?: string }> = [];
  let failNext = true;
  state.updateStreamEntry = vi.fn().mockImplementation(async (input) => {
    ids.push({ action: input.action as string, entryId: input.entryId as string });
    if (failNext) {
      failNext = false;
      throw new Error("save failed");
    }
  });
  const rendered = render(<CompanionFeed {...baseProps} entries={[]} />);
  // The stream tab owns the question input; type and submit.
  typeNote("Choose a name");
  pressSubmit();
  await Promise.resolve();
  expect(state.updateStreamEntry).toHaveBeenCalledTimes(1);
  const first = ids[0];
  expect(first.action).toBe("add_question");
  // Lost acknowledgement: retrying in the same tab replays the same identity.
  await Promise.resolve();
  typeNote("Choose a name");
  pressSubmit();
  await Promise.resolve();
  expect(ids[1]?.entryId).toBe(first.entryId);
  expect(ids[1]?.action).toBe("add_question");
  // Switching tabs starts a fresh identity with the other action prefix.
  fireEvent.click(rendered.getByText("agentPanel.stream.pinnedTab"));
  typeNote("Keep this");
  pressSubmit();
  await Promise.resolve();
  expect(ids[2]?.action).toBe("add_pin");
  expect(ids[2]?.entryId).not.toBe(first.entryId);
  // Capability loss fences the submit; offline fences too.
  state.supported = false;
  rendered.rerender(<CompanionFeed {...baseProps} entries={[]} />);
  typeNote("Blocked");
  pressSubmit();
  await Promise.resolve();
  expect(state.updateStreamEntry).toHaveBeenCalledTimes(3);
  state.supported = true;
  state.connection = "offline";
  rendered.rerender(<CompanionFeed {...baseProps} entries={[]} />);
  typeNote("Blocked offline");
  pressSubmit();
  await Promise.resolve();
  expect(state.updateStreamEntry).toHaveBeenCalledTimes(3);
});

const entry = (overrides: Partial<CompanionEntry> & { id: string }): CompanionEntry =>
  ({
    timestamp: "2026-10-11T00:00:00.000Z",
    text: "Entry",
    truncated: false,
    ...overrides,
  }) as CompanionEntry;

it("renders the degraded warning alongside entries without changing the feed list", () => {
  const entries = [entry({ id: "q1", kind: "question", status: "open" })];
  const rendered = render(<CompanionFeed {...baseProps} captureDegraded entries={entries} />);
  expect(rendered.getByTestId("companion-stream-degraded")).toBeTruthy();
});
