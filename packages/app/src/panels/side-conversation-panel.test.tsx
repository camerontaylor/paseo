// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SideConversationRecord } from "@/side-conversations/store";

const { client, sessionState, pane } = vi.hoisted(() => {
  const panelClient = { askSideConversation: vi.fn(), fetchSideConversationTimeline: vi.fn() };
  return {
    client: panelClient,
    sessionState: {
      sessions: {
        host: { client: panelClient, serverInfo: { features: { sideConversations: true } } },
      },
    },
    pane: {
      serverId: "host",
      target: { kind: "side_conversation", parentAgentId: "parent", threadId: "thread" },
    },
  };
});
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => ({}) },
  withUnistyles: <T,>(component: T) => component,
}));
vi.mock("@/panels/pane-context", () => ({ usePaneContext: () => pane }));
vi.mock("@/panels/panel-registry", () => ({
  definePanel: (_kind: string, implementation: unknown) => implementation,
}));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (state: typeof sessionState) => unknown) => selector(sessionState),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    onPress,
    disabled,
    children,
  }: {
    onPress: () => void;
    disabled?: boolean;
    children: React.ReactNode;
  }) => (
    <button type="button" disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/ui/text-input", () => ({
  EditingTextInput: React.forwardRef(
    (
      { onChangeText, editable }: { onChangeText: (text: string) => void; editable?: boolean },
      ref,
    ) => {
      const [text, setText] = React.useState("");
      React.useImperativeHandle(ref, () => ({ replaceText: setText }));
      const handleChange = React.useCallback(
        (event: React.ChangeEvent<HTMLInputElement>) => {
          setText(event.target.value);
          onChangeText(event.target.value);
        },
        [onChangeText],
      );
      return (
        <input
          aria-label="question"
          value={text}
          disabled={editable === false}
          onChange={handleChange}
        />
      );
    },
  ),
}));
import { useSideConversationStore } from "@/side-conversations/store";
import { sideConversationPanelRegistration } from "./side-conversation-panel";
const Panel = sideConversationPanelRegistration.component;
const snapshot: SideConversationRecord = {
  parentAgentId: "parent",
  threadId: "thread",
  items: [],
  pendingQuestion: null,
  lastAnswer: null,
};

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.resetAllMocks();
  pane.target = { kind: "side_conversation", parentAgentId: "parent", threadId: "thread" };
  useSideConversationStore.setState({ records: new Map() });
  client.fetchSideConversationTimeline.mockResolvedValue(snapshot);
  client.askSideConversation.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function submitQuestion() {
  render(<Panel />);
  await waitFor(() => expect(screen.queryByTestId("side-conversation-panel-loading")).toBeNull());
  const input = screen.getByRole("textbox", { name: "question" }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "What changed?" } });
  fireEvent.click(screen.getByRole("button", { name: "sideConversations.composer.send" }));
  return input;
}

describe("side conversation submission failures", () => {
  it("keeps an accepted question cleared when refreshing its answer fails", async () => {
    client.fetchSideConversationTimeline
      .mockResolvedValueOnce(snapshot)
      .mockRejectedValue(new Error("refresh failed"));
    const input = await submitQuestion();
    await waitFor(() =>
      expect(screen.queryByTestId("side-conversation-panel-failed")).not.toBeNull(),
    );
    expect(input.value).toBe("");
    expect(screen.queryByText("sideConversations.errors.failed")).toBeNull();
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
    expect(client.askSideConversation).toHaveBeenCalledExactlyOnceWith(
      "parent",
      "thread",
      "What changed?",
    );
  });

  it("restores a rejected question and leaves it ready to retry", async () => {
    client.askSideConversation.mockRejectedValue(new Error("ask failed"));
    const input = await submitQuestion();
    await waitFor(() =>
      expect(screen.queryByText("sideConversations.errors.failed")).not.toBeNull(),
    );
    expect(input.value).toBe("What changed?");
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false);
    expect(client.fetchSideConversationTimeline).toHaveBeenCalledTimes(1);
  });
});

it("ignores a failed answer refresh after the pane switches threads", async () => {
  let rejectRefresh!: (error: Error) => void;
  client.fetchSideConversationTimeline
    .mockResolvedValueOnce(snapshot)
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectRefresh = reject;
        }),
    )
    .mockResolvedValue({ ...snapshot, threadId: "next-thread" });
  const view = render(<Panel />);
  await waitFor(() => expect(screen.queryByTestId("side-conversation-panel-loading")).toBeNull());
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Question" } });
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(client.fetchSideConversationTimeline).toHaveBeenCalledTimes(2));
  pane.target = { ...pane.target, threadId: "next-thread" };
  view.rerender(<Panel />);
  await waitFor(() => expect(client.fetchSideConversationTimeline).toHaveBeenCalledTimes(3));
  await act(async () => {
    rejectRefresh(new Error("old refresh failed"));
  });
  expect(screen.queryByTestId("side-conversation-panel-failed")).toBeNull();
  expect(screen.queryByTestId("side-conversation-panel-loading")).toBeNull();
});
