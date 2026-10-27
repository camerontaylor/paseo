// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentArtifact } from "@getpaseo/protocol/agent-types";

const { updateCompanionEntry, connection } = vi.hoisted(() => ({
  updateCompanionEntry: vi.fn(),
  connection: { hasClient: true },
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => ({}) },
  withUnistyles: <T,>(component: T) => component,
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeConnectionStatus: () => "online",
  useHostRuntimeClient: () => (connection.hasClient ? { updateCompanionEntry } : null),
}));
vi.mock("expo-image", () => ({ Image: () => null }));
vi.mock("@/attachments/service", () => ({ persistAttachmentFromBytes: vi.fn() }));
vi.mock("@/attachments/use-attachment-preview-url", () => ({ useAttachmentPreviewUrl: vi.fn() }));
vi.mock("@/data/query", () => ({ useFetchQuery: vi.fn() }));
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
          aria-label="note"
          disabled={editable === false}
          value={text}
          onChange={handleChange}
        />
      );
    },
  ),
}));
vi.mock("@/components/ui/segmented-control", () => ({
  SegmentedControl: ({
    options,
    onValueChange,
  }: {
    options: { value: string; label: string }[];
    onValueChange: (value: string) => void;
  }) => {
    const handleClick = React.useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onValueChange(event.currentTarget.value);
      },
      [onValueChange],
    );
    return (
      <>
        {options.map((option) => (
          <button type="button" key={option.value} value={option.value} onClick={handleClick}>
            {option.label}
          </button>
        ))}
      </>
    );
  },
}));
vi.mock("@/components/markdown/renderer", () => ({ MarkdownRenderer: () => null }));
vi.mock("lucide-react-native", () => ({
  FileCode2: () => null,
  FileDiff: () => null,
  FileText: () => null,
  Image: () => null,
}));

import { CompanionFeed } from "./feed";

const artifact: AgentArtifact = {
  path: "report.html",
  name: "report.html",
  kind: "html",
  mimeType: "text/html",
  size: 120,
  createdAt: "2026-09-21T12:01:00Z",
  updatedAt: "2026-09-21T12:01:00Z",
};

function mountUnsupported(artifacts: readonly AgentArtifact[]) {
  const openFile = vi.fn();
  const returnToChat = vi.fn();
  render(
    <CompanionFeed
      serverId="server-1"
      agentId="agent-1"
      cwd="/workspace"
      entries={[]}
      artifacts={artifacts}
      isSupported={false}
      onOpenWorkspaceFile={openFile}
      onReturnToChat={returnToChat}
      onReplyInChat={vi.fn()}
    />,
  );
  return { openFile, returnToChat };
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  updateCompanionEntry.mockClear();
  connection.hasClient = true;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("unsupported companion stream", () => {
  it("retains supplied file cards and opens them without companion mutations", () => {
    const { openFile, returnToChat } = mountUnsupported([artifact]);
    expect(screen.getByTestId("companion-stream-unsupported")).toBeTruthy();
    const card = screen.getByTestId("artifact-card-report.html");
    fireEvent.click(card);
    expect(openFile).toHaveBeenCalledExactlyOnceWith({
      location: { path: "report.html" },
      disposition: "side",
    });
    expect(returnToChat).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("companion-stream")).toBeNull();
    expect(screen.queryByTestId("companion-stream-pending")).toBeNull();
    expect(updateCompanionEntry).not.toHaveBeenCalled();
  });

  it("shows the upgrade notice and ordinary empty state without supplied files", () => {
    const { openFile } = mountUnsupported([]);
    expect(screen.getByTestId("companion-stream-unsupported")).toBeTruthy();
    expect(screen.getByTestId("artifact-feed-empty")).toBeTruthy();
    expect(screen.queryByTestId("artifact-feed")).toBeNull();
    expect(screen.queryByTestId("companion-stream")).toBeNull();
    expect(openFile).not.toHaveBeenCalled();
    expect(updateCompanionEntry).not.toHaveBeenCalled();
  });
});

function createToast(error: (message: string) => void) {
  return { error, copied: vi.fn(), show: vi.fn(() => vi.fn()) };
}

describe("companion notes", () => {
  it.each(["offline", "rejected", "success"])(
    "preserves note contents until saved: %s",
    async (outcome) => {
      connection.hasClient = outcome !== "offline";
      updateCompanionEntry.mockImplementation(async () => {
        if (outcome === "rejected") throw new Error("offline");
      });
      const error = vi.fn();
      const toast = createToast(error);
      render(
        <CompanionFeed
          serverId="server-1"
          agentId="agent-1"
          cwd="/workspace"
          entries={[]}
          artifacts={[]}
          isSupported
          onReturnToChat={vi.fn()}
          onReplyInChat={vi.fn()}
          toast={toast}
        />,
      );
      fireEvent.click(screen.getByText("agentPanel.stream.pinnedTab"));
      const input = screen.getByRole("textbox", { name: "note" }) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "keep this note" } });
      fireEvent.click(screen.getByText("agentPanel.stream.addNote"));
      if (outcome === "success") {
        await waitFor(() => expect(input.value).toBe(""));
        expect(error).not.toHaveBeenCalled();
      } else {
        await waitFor(() => expect(error).toHaveBeenCalledWith("agentPanel.stream.mutationFailed"));
        expect(input.value).toBe("keep this note");
      }
      expect(updateCompanionEntry).toHaveBeenCalledTimes(outcome === "offline" ? 0 : 1);
    },
  );
});
