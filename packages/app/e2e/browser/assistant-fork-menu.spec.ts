import { expect, test as base } from "../support/fixtures";
import { awaitAssistantMessage } from "../support/helpers/agent-stream";
import {
  expectChatHistoryAttachment,
  expectInFlightForkAvailable,
  expectLiveAssistantText,
  forkInFlightTurnToNewTab,
  forkMostRecentAssistantTurnToNewTab,
  forkMostRecentAssistantTurnToNewWorkspace,
  observeForkAttachment,
} from "../support/helpers/assistant-fork";
import { expectComposerVisible, submitMessage } from "../support/helpers/composer";
import { createAgentTabFromMenu } from "../support/helpers/workspace-tabs";
import { getE2EDaemonPort } from "../support/helpers/daemon-port";
import {
  openAgentRoute,
  seedMockAgentWorkspace,
  type MockAgentOptions,
  type MockAgentWorkspace,
} from "../support/helpers/mock-agent";
import { getServerId } from "../support/helpers/server-id";
import { seedSavedSettingsHosts } from "../support/helpers/settings";
import { submitNewWorkspaceEmpty } from "../support/helpers/new-workspace";

const test = base.extend<{
  seedForkWorkspace: (options: MockAgentOptions) => Promise<MockAgentWorkspace>;
}>({
  seedForkWorkspace: async ({ browserName: _browserName }, provide) => {
    const sessions: MockAgentWorkspace[] = [];
    await provide(async (options) => {
      const session = await seedMockAgentWorkspace(options);
      sessions.push(session);
      return session;
    });
    await Promise.allSettled(sessions.map((session) => session.cleanup()));
  },
});

test.describe("Assistant fork menu", () => {
  test.describe.configure({ timeout: 180_000 });

  test("combines transcripts from open workspace chats and keeps toggles draft-local", async ({
    page,
    seedForkWorkspace,
  }) => {
    const session = await seedForkWorkspace({
      repoPrefix: "multiple-transcripts-",
      title: "Chat Alpha",
      initialPrompt: "Alpha context is included.",
      featureValues: { mockAssistantResponse: "Alpha transcript response." },
    });
    const beta = await session.client.createAgent({
      provider: "mock",
      cwd: session.cwd,
      workspaceId: session.workspaceId,
      modeId: "load-test",
      model: "e2e-fast-stream",
      title: "Chat Beta",
      initialPrompt: "Beta context is included.",
      featureValues: { mockAssistantResponse: "Beta transcript response." },
    });
    const unopened = await session.client.createAgent({
      provider: "mock",
      cwd: session.cwd,
      workspaceId: session.workspaceId,
      modeId: "load-test",
      model: "e2e-fast-stream",
      title: "Unopened chat",
      initialPrompt: "Excluded unopened context.",
    });
    await Promise.all([
      session.client.waitForFinish(session.agentId, 30_000),
      session.client.waitForFinish(beta.id, 30_000),
      session.client.waitForFinish(unopened.id, 30_000),
    ]);
    // Active root agents are opened automatically; archive this chat to close its tab.
    await session.client.archiveAgent(unopened.id);
    await openAgentRoute(page, session);
    await expectComposerVisible(page);
    await openAgentRoute(page, { ...session, agentId: beta.id });
    await expectComposerVisible(page);
    await page.getByTestId(`workspace-tab-agent_${session.agentId}`).click();
    await forkMostRecentAssistantTurnToNewTab(page);
    const picker = page.getByTestId("draft-transcript-picker").filter({ visible: true });
    const alphaToggle = picker.getByRole("checkbox", { name: "Chat Alpha", exact: true });
    const betaToggle = picker.getByRole("checkbox", { name: "Chat Beta", exact: true });
    await expect(alphaToggle).toBeChecked();
    await expect(betaToggle).not.toBeChecked();
    await expect(picker.getByRole("checkbox")).toHaveCount(2);
    await expect(picker.getByText("Unopened chat")).toHaveCount(0);
    await alphaToggle.click();
    await expect(alphaToggle).not.toBeChecked();
    await expect(
      page.getByTestId("composer-chat-history-attachment-pill").filter({ visible: true }),
    ).toHaveCount(0);
    await betaToggle.click();
    await expect(betaToggle).toBeChecked();
    await expect(betaToggle).toBeEnabled();
    await alphaToggle.click();
    await expect(alphaToggle).toBeChecked();
    await expect(alphaToggle).toBeEnabled();
    const pills = page
      .getByTestId("composer-chat-history-attachment-pill")
      .filter({ visible: true });
    await expect(pills).toHaveCount(2);
    const betaPill = pills.filter({ hasText: "Chat Beta" });
    await betaPill.hover();
    await betaPill
      .locator("..")
      .getByRole("button", { name: "Remove chat history attachment", exact: true })
      .click();
    await expect(betaToggle).not.toBeChecked();
    await expect(pills).toHaveCount(1);
    await betaToggle.click();
    await expect(betaToggle).toBeEnabled();
    await expect(pills).toHaveCount(2);
    const input = page.getByRole("textbox", { name: "Message agent..." });
    await input.fill("Use both chat transcripts.");
    const firstDraft = await page
      .locator('[data-testid^="workspace-tab-draft_"][aria-selected="true"]')
      .getAttribute("data-testid");
    expect(firstDraft).not.toBeNull();
    await createAgentTabFromMenu(page);
    await expect(
      picker.getByRole("checkbox", { name: "Chat Alpha", exact: true }),
    ).not.toBeChecked();
    await expect(
      picker.getByRole("checkbox", { name: "Chat Beta", exact: true }),
    ).not.toBeChecked();
    await expect(pills).toHaveCount(0);
    await page.getByTestId(firstDraft!).click();
    await expect(alphaToggle).toBeChecked();
    await expect(betaToggle).toBeChecked();
    await expect(pills).toHaveCount(2);
    await expect(input).toHaveValue("Use both chat transcripts.");
    await page.screenshot({ path: "/tmp/paseo-multiple-transcripts.png" });
    await input.press("Enter");
    const userMessage = page
      .getByTestId("user-message")
      .filter({ hasText: "Use both chat transcripts." })
      .last();
    await expect(userMessage).toBeVisible({ timeout: 30_000 });
    await expect(userMessage).toContainText("Chat history · Chat Alpha");
    await expect(userMessage).toContainText("Chat history · Chat Beta");
  });

  test("forks a failed assistant turn that has no provider message id", async ({
    page,
    seedForkWorkspace,
  }) => {
    const session = await seedForkWorkspace({
      repoPrefix: "assistant-fork-failed-turn-",
      title: "Assistant fork failed turn",
      model: "ten-second-stream",
    });

    await openAgentRoute(page, session);
    await expectComposerVisible(page);
    await submitMessage(page, "Emit a synthetic turn failure.");
    await expect(page.getByText("[System Error] Requested mock provider failure")).toBeVisible({
      timeout: 30_000,
    });

    await forkMostRecentAssistantTurnToNewTab(page);
    await expectChatHistoryAttachment(page);
  });

  test("forks a streaming assistant turn without interrupting it", async ({
    page,
    seedForkWorkspace,
  }) => {
    const visibleBeforeFork = "where the auto-scroll logic actually lives";
    const visibleAfterFork = "the first useful step is to read the relevant files";
    const sourceAgentTitle = "Assistant fork in flight";
    const forkAttachment = observeForkAttachment(page);

    const session = await seedForkWorkspace({
      repoPrefix: "assistant-fork-in-flight-",
      title: sourceAgentTitle,
      model: "thirty-minute-stream",
    });

    await openAgentRoute(page, session);
    await expectComposerVisible(page);
    await submitMessage(page, "Walk me through the scroll anchor behavior.");

    await expectInFlightForkAvailable(page);
    await expectLiveAssistantText(page, visibleBeforeFork);

    await forkInFlightTurnToNewTab(page);
    await expectChatHistoryAttachment(page);
    expect(await forkAttachment.waitForText()).toContain(visibleBeforeFork);
    await expect(page.getByRole("button", { name: "Menu backdrop", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: sourceAgentTitle }).click();
    await expectLiveAssistantText(page, visibleAfterFork);
  });

  test("focuses a forked assistant turn in a new workspace draft tab", async ({
    page,
    seedForkWorkspace,
  }) => {
    const session = await seedForkWorkspace({
      repoPrefix: "assistant-fork-focused-tab-",
      title: "Assistant fork focused tab",
      initialPrompt: "emit 1 coalesced agent stream updates for initial assistant fork turn.",
      model: "ten-second-stream",
    });

    await openAgentRoute(page, session);
    await expectComposerVisible(page);
    await awaitAssistantMessage(page);
    await session.client.waitForFinish(session.agentId, 45_000);

    await submitMessage(page, "emit 1 coalesced agent stream updates while this tab is visible.");
    await session.client.waitForFinish(session.agentId, 45_000);
    await awaitAssistantMessage(page);

    const agentTab = page.getByTestId(`workspace-tab-agent_${session.agentId}`);
    await expect(agentTab).toHaveAttribute("aria-selected", "true");

    await forkMostRecentAssistantTurnToNewTab(page);

    const selectedTab = page
      .getByTestId("workspace-tabs-row")
      .getByRole("button")
      .and(page.locator('[aria-selected="true"]'));
    await expect(selectedTab).toHaveAttribute("data-testid", /^workspace-tab-draft_/, {
      timeout: 30_000,
    });
    await expect(agentTab).toHaveAttribute("aria-selected", "false");
    await expectChatHistoryAttachment(page);
  });

  test("keeps the fork attachment after submitting an existing-workspace draft tab", async ({
    page,
    seedForkWorkspace,
  }) => {
    const session = await seedForkWorkspace({
      repoPrefix: "assistant-fork-tab-submit-",
      title: "Assistant fork tab submit",
      initialPrompt: "emit 1 coalesced agent stream updates for assistant fork tab submit.",
      model: "ten-second-stream",
    });

    await openAgentRoute(page, session);
    await expectComposerVisible(page);
    await awaitAssistantMessage(page);
    await session.client.waitForFinish(session.agentId, 45_000);

    await forkMostRecentAssistantTurnToNewTab(page);
    await expectChatHistoryAttachment(page);

    await submitMessage(page, "");

    const userMessage = page.getByTestId("user-message").filter({ hasText: "Chat history" }).last();
    await expect(userMessage).toBeVisible({ timeout: 30_000 });
    await expect(userMessage).not.toContainText("Source agent:");
  });

  test("forks an assistant turn into New Workspace and keeps the attachment across host changes", async ({
    page,
    seedForkWorkspace,
  }) => {
    await seedSavedSettingsHosts(page, [
      {
        serverId: getServerId(),
        label: "localhost",
        endpoint: `127.0.0.1:${getE2EDaemonPort()}`,
      },
      {
        serverId: "secondary-assistant-fork-host",
        label: "Secondary host",
        // The host does not need to be reachable; this pins that the draft-scoped
        // attachment survives changing the selected target host.
        endpoint: "127.0.0.1:9",
      },
    ]);

    const session = await seedForkWorkspace({
      repoPrefix: "assistant-fork-workspace-",
      title: "Assistant fork workspace",
      initialPrompt: "emit 1 coalesced agent stream updates for assistant fork new workspace.",
      model: "ten-second-stream",
    });

    await openAgentRoute(page, session);
    await expectComposerVisible(page);
    await awaitAssistantMessage(page);
    await session.client.waitForFinish(session.agentId, 45_000);

    await forkMostRecentAssistantTurnToNewWorkspace(page);

    await expect(page).toHaveURL(/\/new\?.*draftId=/, { timeout: 30_000 });
    await expectChatHistoryAttachment(page);

    await page.getByTestId("host-picker-trigger").click();
    await page
      .getByTestId("new-workspace-host-picker-option-secondary-assistant-fork-host")
      .click();
    await expectChatHistoryAttachment(page);
  });

  test("keeps the fork attachment after the new agent receives its user message", async ({
    page,
    seedForkWorkspace,
  }) => {
    const session = await seedForkWorkspace({
      repoPrefix: "assistant-fork-submit-",
      title: "Assistant fork submit",
      initialPrompt: "emit 1 coalesced agent stream updates for assistant fork submit.",
      model: "ten-second-stream",
    });

    await openAgentRoute(page, session);
    await expectComposerVisible(page);
    await awaitAssistantMessage(page);
    await session.client.waitForFinish(session.agentId, 45_000);

    await forkMostRecentAssistantTurnToNewWorkspace(page);
    await expectChatHistoryAttachment(page);

    await submitNewWorkspaceEmpty(page);

    const userMessage = page.getByTestId("user-message").filter({ hasText: "Chat history" }).last();
    await expect(userMessage).toBeVisible({ timeout: 30_000 });
    await expect(userMessage).not.toContainText("Source agent:");
  });
});
