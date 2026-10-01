/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LinearIssue } from "@getpaseo/protocol/linear";
import { i18n } from "@/i18n/i18next";
import { WorkspaceLinearButton } from "./workspace-button";

const mocks = vi.hoisted(() => ({
  getLinearIssues: vi.fn(),
  linkLinearIssue: vi.fn(),
  open: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => mocks,
  useHostRuntimeIsConnected: () => true,
}));
vi.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: (select: (state: unknown) => unknown) =>
    select({
      sessions: { host: { serverInfo: { features: { linearIssues: true } } } },
    }),
}));
vi.mock("@/utils/open-external-url", () => ({ openExternalUrl: mocks.open }));
vi.mock("@/contexts/toast-context", () => ({ useToast: () => ({ show: mocks.toast }) }));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 0 }),
}));
vi.mock("react-native-svg", () => ({ default: "svg", Circle: "circle", Path: "path" }));

const target = { serverId: "host", cwd: "/repo", prUrl: "https://github.com/acme/repo/pull/1095" };
const issue: LinearIssue = {
  id: "issue-1",
  identifier: "CMS-664",
  title: "Search page",
  url: "https://linear.app/acme/issue/CMS-664",
  state: { name: "Ready for QA", type: "started", color: "#eb5757", progress: 0.6 },
};
const clients: QueryClient[] = [];
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <WorkspaceLinearButton {...target} />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  vi.stubGlobal("React", React);
  vi.resetAllMocks();
  mocks.open.mockResolvedValue(undefined);
  await i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
});

describe("Linear toolbar", () => {
  it("shows the issue identifier and exact workflow color, and opens the issue", async () => {
    mocks.getLinearIssues.mockResolvedValue({ issues: [issue], error: null });
    mount();
    const button = await screen.findByRole("button", {
      name: "CMS-664: Search page · Ready for QA",
    });
    expect(button.textContent).toBe("CMS-664");
    expect(button.querySelector("circle")?.getAttribute("stroke")).toBe("#eb5757");
    expect(screen.getByText("CMS-664").style.color).toBe("rgb(235, 87, 87)");
    fireEvent.click(button);
    expect(mocks.open).toHaveBeenCalledWith(issue.url);
  });

  it("shows a lookup error and lets the user retry", async () => {
    mocks.getLinearIssues.mockResolvedValueOnce({ issues: [], error: "Linear is unavailable" });
    mocks.getLinearIssues.mockResolvedValueOnce({ issues: [issue], error: null });
    mount();
    await waitFor(() => expect(mocks.getLinearIssues).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId("workspace-linear-button"));
    expect(await screen.findByTestId("linear-lookup-error")).toHaveProperty(
      "textContent",
      "Linear is unavailable",
    );
    fireEvent.click(screen.getByTestId("linear-retry"));
    expect(await screen.findByText("CMS-664")).not.toBeNull();
  });

  it("lists multiple linked issues so the user can choose one", async () => {
    mocks.getLinearIssues.mockResolvedValue({
      issues: [
        issue,
        {
          ...issue,
          id: "issue-2",
          identifier: "CMS-665",
          url: "https://linear.app/acme/issue/CMS-665",
        },
      ],
      error: null,
    });
    mount();
    await screen.findByText("2");
    fireEvent.click(screen.getByTestId("workspace-linear-button"));
    fireEvent.click(await screen.findByText("CMS-665: Search page · Ready for QA"));
    expect(mocks.open).toHaveBeenCalledWith("https://linear.app/acme/issue/CMS-665");
  });

  it("keeps a failed link editable and closes after a successful retry", async () => {
    mocks.getLinearIssues.mockResolvedValue({ issues: [], error: null });
    mocks.linkLinearIssue.mockResolvedValueOnce({ success: false, error: "Link failed" });
    mocks.linkLinearIssue.mockResolvedValueOnce({ success: true, error: null });
    mount();
    await waitFor(() => expect(mocks.getLinearIssues).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId("workspace-linear-button"));
    fireEvent.click(await screen.findByText("Link issue"));
    const input = await screen.findByTestId("linear-issue-identifier");
    fireEvent.change(input, { target: { value: "CMS-664" } });
    fireEvent.click(screen.getByTestId("linear-link-submit"));
    expect(await screen.findByTestId("linear-link-error")).toHaveProperty(
      "textContent",
      "Link failed",
    );
    mocks.getLinearIssues.mockResolvedValue({ issues: [issue], error: null });
    fireEvent.click(screen.getByTestId("linear-link-submit"));
    expect(await screen.findByText("CMS-664")).not.toBeNull();
    expect(mocks.linkLinearIssue).toHaveBeenLastCalledWith({
      cwd: "/repo",
      prUrl: target.prUrl,
      identifier: "CMS-664",
    });
  });
});
