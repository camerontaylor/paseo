/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "@testing-library/react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPlanHandoffPrompt } from "./plan-handoff";

const harness = vi.hoisted(() => ({
  session: null as unknown,
  sendMessage: vi.fn(),
  saveDraftInput: vi.fn(),
  navigateToWorkspace: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("lucide-react-native", () => ({ ArrowRight: () => null }));
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
    <button type="button" data-testid={testID} disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("@/contexts/toast-context", () => ({
  useToast: () => ({ error: harness.toastError }),
}));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: { getState: () => harness.session },
}));
vi.mock("@/stores/navigation-active-workspace-store", () => ({
  navigateToWorkspace: harness.navigateToWorkspace,
}));
vi.mock("@/stores/draft-store", () => ({
  useDraftStore: { getState: () => ({ saveDraftInput: harness.saveDraftInput }) },
}));

import { PlanHandoffButton } from "./plan-handoff-button";

const SOURCE = { serverId: "server-1", agentId: "agent-1" };

describe("buildPlanHandoffPrompt", () => {
  it("preserves literal plan text and identifies the source agent", () => {
    const plan = '# Plan\n\nAdd the (c) note with --name="my repo".\n\n---buzz';
    const prompt = buildPlanHandoffPrompt({
      instruction: "Implement the following proposed plan.",
      plan,
      source: { serverId: "server-1", agentId: "agent-1" },
    });

    expect(prompt).toContain(plan);
    expect(prompt).toContain("Source: paseo://");
    expect(prompt).toContain("agent-1");
    expect(prompt.match(/Implement the following proposed plan\./g)).toHaveLength(1);
  });
});

describe("PlanHandoffButton", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  const agent = {
    id: "agent-1",
    workspaceId: "ws-1",
    provider: "claude",
    cwd: "/code/project",
    model: "opus",
    thinkingOptionId: "high",
    features: [{ id: "web-search", value: true }],
  };

  const handoffButton = () =>
    container?.querySelector<HTMLButtonElement>('[data-testid="permission-plan-handoff"]') ?? null;

  const press = () => {
    act(() => {
      handoffButton()?.click();
    });
  };

  beforeEach(() => {
    // The app's JSX compiles to the classic runtime here, and the button does not import React.
    vi.stubGlobal("React", React);
    harness.sendMessage.mockClear();
    harness.saveDraftInput.mockClear();
    harness.navigateToWorkspace.mockClear();
    harness.toastError.mockClear();
    harness.session = {
      client: { sendMessage: harness.sendMessage },
      agents: new Map([["agent-1", agent]]),
      workspaces: new Map([["ws-1", { workspaceId: "ws-1" }]]),
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(<PlanHandoffButton source={SOURCE} text="# Plan" />);
    });
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    container?.remove();
    container = null;
    vi.unstubAllGlobals();
  });

  // The source agent's workspace can be gone by the time the plan is read. The button has to say so
  // and leave no trace: no draft, no navigation, and still usable afterwards.
  it("reports an unavailable source without saving a draft or navigating", () => {
    harness.session = {
      client: { sendMessage: harness.sendMessage },
      agents: new Map(),
      workspaces: new Map(),
    };

    press();

    expect(harness.saveDraftInput).not.toHaveBeenCalled();
    expect(harness.navigateToWorkspace).not.toHaveBeenCalled();
    expect(harness.toastError).toHaveBeenCalledWith("agentStream.permission.handoffFailed");
    expect(handoffButton()?.disabled).toBe(false);
    expect(handoffButton()?.textContent).toBe("agentStream.permission.handOff");
  });

  it("opens one editable draft under a fresh key and sends nothing", () => {
    press();

    expect(harness.saveDraftInput).toHaveBeenCalledTimes(1);
    const saved = harness.saveDraftInput.mock.calls[0]?.[0] as {
      draftKey: string;
      draft: { text: string; attachments: unknown[] };
    };
    // A fresh draft id, so an existing draft for the source agent is never overwritten.
    expect(saved.draftKey).toMatch(/^draft:server-1:draft_/);
    expect(saved.draftKey).not.toBe("agent:server-1:agent-1");
    expect(saved.draft.text).toContain("# Plan");
    expect(saved.draft.text).toContain("agent-1");
    expect(saved.draft.attachments).toEqual([]);

    const [navigation] = harness.navigateToWorkspace.mock.calls[0] as [
      {
        serverId: string;
        workspaceId: string;
        target: { kind: string; draftId: string; setup: Record<string, unknown> };
      },
    ];
    expect(navigation.serverId).toBe("server-1");
    expect(navigation.workspaceId).toBe("ws-1");
    expect(navigation.target.kind).toBe("draft");
    expect(saved.draftKey).toBe(`draft:server-1:${navigation.target.draftId}`);
    expect(navigation.target.setup).toEqual({
      provider: "claude",
      cwd: "/code/project",
      model: "opus",
      thinkingOptionId: "high",
      modeId: null,
      featureValues: { "web-search": true },
    });

    // Handing off drafts; it never sends.
    expect(harness.sendMessage).not.toHaveBeenCalled();
    expect(handoffButton()?.disabled).toBe(true);
    press();
    expect(harness.saveDraftInput).toHaveBeenCalledTimes(1);
  });
});
