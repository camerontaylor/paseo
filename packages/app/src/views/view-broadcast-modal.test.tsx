/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ViewBroadcastModal } from "@/views/view-broadcast-modal";

const mocks = vi.hoisted(() => ({
  runBroadcast: vi.fn(),
  toast: vi.fn(),
}));

vi.stubGlobal("React", React);

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("react-native", () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => ({ body: {}, summary: {}, input: {}, actions: {} }) },
}));
vi.mock("@/contexts/toast-context", () => ({ useToast: () => ({ show: mocks.toast }) }));
vi.mock("@/views/broadcast", () => ({
  planBroadcastForCurrentState: (targets: Array<{ serverId: string; agentId: string }>) =>
    targets.map((target) => ({ ...target, delivery: "send" })),
  runBroadcast: mocks.runBroadcast,
}));
vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible ? <section>{children}</section> : null,
  AdaptiveTextInput: ({
    onChangeText,
    initialValue,
  }: {
    onChangeText: (text: string) => void;
    initialValue: string;
  }) => {
    const onChange = React.useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => onChangeText(event.target.value),
      [onChangeText],
    );
    return <input defaultValue={initialValue} onChange={onChange} />;
  },
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    disabled,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("View broadcast recovery", () => {
  it("keeps the draft and retries only recipients without an admitted intent", async () => {
    const onClose = vi.fn();
    mocks.runBroadcast
      .mockResolvedValueOnce({
        sent: 1,
        queued: 0,
        skipped: 0,
        failed: 1,
        retryTargets: [{ serverId: "host-b", agentId: "b" }],
      })
      .mockResolvedValueOnce({ sent: 1, queued: 0, skipped: 0, failed: 0, retryTargets: [] });
    render(
      <ViewBroadcastModal
        visible
        targets={[
          { serverId: "host-a", agentId: "a" },
          { serverId: "host-b", agentId: "b" },
        ]}
        onClose={onClose}
      />,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "keep this draft" } });
    fireEvent.click(screen.getByText("views.broadcast.send"));
    await waitFor(() =>
      expect(screen.getByRole("textbox")).toHaveProperty("value", "keep this draft"),
    );
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("common.actions.retry"));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(mocks.runBroadcast.mock.calls[1]?.[1]).toEqual([
      { serverId: "host-b", agentId: "b", delivery: "send" },
    ]);
  });

  it("keeps an all-skipped draft open with a neutral result", async () => {
    const onClose = vi.fn();
    mocks.runBroadcast.mockResolvedValueOnce({
      sent: 0,
      queued: 0,
      skipped: 1,
      failed: 0,
      retryTargets: [{ serverId: "host-a", agentId: "a" }],
    });
    render(
      <ViewBroadcastModal
        visible
        targets={[{ serverId: "host-a", agentId: "a" }]}
        onClose={onClose}
      />,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "wait for host" } });
    fireEvent.click(screen.getByText("views.broadcast.send"));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(mocks.toast.mock.calls[0]?.[1]).toEqual({ variant: "default" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toHaveProperty("value", "wait for host");
  });
});
