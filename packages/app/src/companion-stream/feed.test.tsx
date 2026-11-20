// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentArtifact } from "@getpaseo/protocol/agent-types";

const { updateCompanionEntry } = vi.hoisted(() => ({ updateCompanionEntry: vi.fn() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => ({}) },
  withUnistyles: <T,>(component: T) => component,
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeConnectionStatus: () => "online",
  useHostRuntimeClient: () => ({ updateCompanionEntry }),
}));
vi.mock("expo-image", () => ({ Image: () => null }));
vi.mock("@/attachments/service", () => ({ persistAttachmentFromBytes: vi.fn() }));
vi.mock("@/attachments/use-attachment-preview-url", () => ({ useAttachmentPreviewUrl: vi.fn() }));
vi.mock("@/data/query", () => ({ useFetchQuery: vi.fn() }));
vi.mock("@/components/ui/button", () => ({ Button: () => null }));
vi.mock("@/components/ui/text-input", () => ({ EditingTextInput: () => null }));
vi.mock("@/components/ui/segmented-control", () => ({ SegmentedControl: () => null }));
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
