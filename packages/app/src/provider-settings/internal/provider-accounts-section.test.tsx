/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import type { MutableDaemonConfig } from "@getpaseo/protocol/messages";

const { snapshotState, configState, featureState, sheetState } = vi.hoisted(() => ({
  sheetState: {
    onSave: null as
      | ((input: {
          providerId: string;
          originalProviderId?: string;
          patch: unknown;
        }) => Promise<boolean>)
      | null,
  },
  snapshotState: { entries: undefined as ProviderSnapshotEntry[] | undefined },
  configState: { config: null as MutableDaemonConfig | null },
  featureState: {} as Record<string, boolean>,
}));

vi.mock("react-native", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-native")>()),
  View: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("div", { "data-testid": testID }, children),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/settings", () => ({
  SettingsCard: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  SettingsDetailRow: ({
    label,
    onPress,
    testID,
  }: {
    label: string;
    onPress?: () => void;
    testID?: string;
  }) =>
    React.createElement("div", { role: "button", "data-testid": testID, onClick: onPress }, label),
}));

// The real sheet pulls in react-native-reanimated, which is untransformed here.
vi.mock("@/components/provider-account-sheet", () => ({
  ProviderAccountSheet: ({
    visible,
    baseProviderId,
    account,
    onSave,
  }: {
    visible?: boolean;
    baseProviderId?: string;
    account?: { providerId: string };
    onSave?: typeof sheetState.onSave;
  }) => {
    sheetState.onSave = onSave ?? null;
    return visible
      ? React.createElement("div", {
          "data-testid": `provider-account-sheet-${account?.providerId ?? baseProviderId}`,
          "data-base": baseProviderId,
        })
      : null;
  },
}));

vi.mock("@/hooks/use-providers-snapshot", () => ({
  useProvidersSnapshot: () => ({ entries: snapshotState.entries, refresh: vi.fn() }),
}));

vi.mock("@/hooks/use-daemon-config", () => ({
  useDaemonConfig: () => ({ config: configState.config, patchConfig: vi.fn() }),
}));

vi.mock("@/runtime/host-features", () => ({
  useHostFeature: (_serverId: string, feature: string) => featureState[feature] ?? false,
}));

vi.mock("@/styles/settings", () => ({ settingsStyles: { section: {} } }));

import { ProviderAccountsSection } from "./provider-accounts-section";

function entry(overrides: Partial<ProviderSnapshotEntry>): ProviderSnapshotEntry {
  return {
    provider: "claude",
    source: "builtin",
    status: "ready",
    enabled: true,
    label: "Claude",
    defaultModeId: null,
    modes: [],
    models: [],
    ...overrides,
  } as ProviderSnapshotEntry;
}

const claudeEntry = entry({});
const claudeWorkEntry = entry({
  provider: "claude-work",
  source: "custom",
  label: "Claude · Work",
});

function makeConfig(providers: Record<string, unknown> = {}): MutableDaemonConfig {
  return { providers } as unknown as MutableDaemonConfig;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function render(shown: ProviderSnapshotEntry, label: string, onRenamed?: () => void) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      React.createElement(ProviderAccountsSection, {
        serverId: "host",
        entry: shown,
        label,
        onRenamed,
      }),
    );
  });
}

function click(testId: string) {
  const element = container?.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  expect(element).not.toBeNull();
  act(() => {
    element?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
}

describe("ProviderAccountsSection", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    snapshotState.entries = [claudeEntry, claudeWorkEntry];
    configState.config = makeConfig({
      "claude-work": { extends: "claude", label: "Claude · Work" },
    });
    for (const feature of Object.keys(featureState)) delete featureState[feature];
    sheetState.onSave = null;
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  it("opens the account sheet from a builtin provider's detail", () => {
    render(claudeEntry, "Claude");
    expect(container?.querySelector('[data-testid="provider-account-sheet-claude"]')).toBeNull();
    expect(container?.querySelector('[data-testid="provider-edit-account-claude"]')).toBeNull();

    click("provider-add-account-claude");

    expect(
      container?.querySelector('[data-testid="provider-account-sheet-claude"]'),
    ).not.toBeNull();
  });

  it("edits an account against its base provider when the daemon supports exact replacement", () => {
    featureState.providerConfigReplace = true;
    render(claudeWorkEntry, "Claude · Work");
    expect(container?.querySelector('[data-testid="provider-add-account-claude-work"]')).toBeNull();

    click("provider-edit-account-claude-work");

    const sheet = container?.querySelector('[data-testid="provider-account-sheet-claude-work"]');
    expect(sheet?.getAttribute("data-base")).toBe("claude");
  });

  it("shows nothing for an account when the daemon cannot replace it exactly", () => {
    render(claudeWorkEntry, "Claude · Work");
    expect(container?.textContent).toBe("");
  });

  it("leaves the detail after a save renames the account", async () => {
    featureState.providerConfigReplace = true;
    const onRenamed = vi.fn();
    render(claudeWorkEntry, "Claude · Work", onRenamed);
    click("provider-edit-account-claude-work");

    await act(async () => {
      await sheetState.onSave?.({
        providerId: "claude-team",
        originalProviderId: "claude-work",
        patch: {},
      });
    });

    expect(onRenamed).toHaveBeenCalledTimes(1);
    expect(
      container?.querySelector('[data-testid="provider-account-sheet-claude-work"]'),
    ).toBeNull();
  });

  it("stays on the detail after a save that keeps the account's ID", async () => {
    featureState.providerConfigReplace = true;
    const onRenamed = vi.fn();
    render(claudeWorkEntry, "Claude · Work", onRenamed);
    click("provider-edit-account-claude-work");

    await act(async () => {
      await sheetState.onSave?.({
        providerId: "claude-work",
        originalProviderId: "claude-work",
        patch: {},
      });
    });

    expect(onRenamed).not.toHaveBeenCalled();
  });
});
