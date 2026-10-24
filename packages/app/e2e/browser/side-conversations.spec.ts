import { expect, test } from "../support/fixtures";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { awaitAssistantMessage } from "../support/helpers/agent-stream";
import {
  askSideQuestion,
  expectNoSideConversationInTabMenu,
  expectSideConversationText,
  hideSideConversationsCapability,
  mockSideAnswer,
  seedSideConversationParent,
  sideConversationPanel,
  sideConversationTabs,
  sideConversationTrackRow,
  startSideConversationFromTabMenu,
} from "../support/helpers/side-conversations";
import { openSubagentsTrack } from "../support/helpers/subagents";

const UNAVAILABLE = "Side conversations aren't available for this agent.";
const REMOVED = "This side conversation is no longer on the host.";

test.describe("Side conversations", () => {
  test("asks on a thread, threads the follow-up, and lists it in the subagents track", async ({
    page,
  }) => {
    const agent = await seedSideConversationParent({
      repoPrefix: "side-conversation-ask-",
      title: "Side conversation parent",
      answersSideQuestions: true,
    });
    try {
      await openAgentRoute(page, { workspaceId: agent.workspaceId, agentId: agent.agentId });
      await startSideConversationFromTabMenu(page, agent.agentId);
      await expect(sideConversationTabs(page)).toHaveCount(1);

      const first = "What did you change?";
      await askSideQuestion(page, first);
      await expectSideConversationText(page, mockSideAnswer(0, first));

      // The thread only earns a track row once it has been asked something — a thread is named by
      // its first question, and the daemon answers an unasked one with an empty snapshot.
      await page.getByTestId(`workspace-tab-agent_${agent.agentId}`).first().click();
      await openSubagentsTrack(page);
      const row = sideConversationTrackRow(page, first);
      await expect(row).toBeVisible({ timeout: 30_000 });

      await row.click();
      await expect(sideConversationPanel(page)).toBeVisible({ timeout: 30_000 });
      await expectSideConversationText(page, first);

      // "1" can only appear if the daemon handed the completed first exchange back to the provider,
      // so this is the assertion that a follow-up stays on the same thread instead of asking cold.
      const followUp = "And why?";
      await askSideQuestion(page, followUp);
      await expectSideConversationText(page, mockSideAnswer(1, followUp));

      // Reopening the row must not mint a second thread.
      await expect(sideConversationTabs(page)).toHaveCount(1);
    } finally {
      await agent.cleanup();
    }
  });

  test("reopens a reply thread from its retained source and queues its answer once", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1400, height: 900 });
    const agent = await seedSideConversationParent({
      repoPrefix: "side-conversation-reply-thread-",
      title: "Threaded reply parent",
      answersSideQuestions: true,
    });
    try {
      const sourcePrompt = "Create a source reply for threaded follow-up.";
      await agent.client.sendAgentMessage(agent.agentId, sourcePrompt);
      await agent.client.waitForFinish(agent.agentId, 30_000);
      await openAgentRoute(page, { workspaceId: agent.workspaceId, agentId: agent.agentId });
      await awaitAssistantMessage(page);

      const sourceUrl = page.url();
      const mainComposer = page.locator("textarea[data-composer-input]:visible").first();
      await expect(mainComposer).toBeEditable({ timeout: 30_000 });
      await mainComposer.fill("Keep this main draft intact");
      await page.getByTestId("reply-in-thread").last().click();
      await expect(sideConversationPanel(page)).toBeVisible({ timeout: 30_000 });
      await expect(mainComposer).toHaveValue("Keep this main draft intact");
      expect(page.url()).toBe(sourceUrl);

      const question = "Explain the source reply.";
      await askSideQuestion(page, question);
      await expectSideConversationText(page, mockSideAnswer(0, question));
      const sendBack = sideConversationPanel(page).getByTestId("thread-send-back");
      await sendBack.click();
      await expect(sendBack).toHaveText("Answer added to main queue", { timeout: 30_000 });

      const threadTab = sideConversationTabs(page).first();
      const tabTestId = await threadTab.getAttribute("data-testid");
      expect(tabTestId).toMatch(/^workspace-tab-/);
      const menuTabId = tabTestId!.slice("workspace-tab-".length);
      await threadTab.click({ button: "right" });
      await page.getByTestId("workspace-tab-context-" + menuTabId + "-close").click();
      await expect(sideConversationTabs(page)).toHaveCount(0);
      await expect(mainComposer).toHaveValue("Keep this main draft intact");

      await page.getByTestId("reply-in-thread").last().click();
      await expect(sideConversationPanel(page)).toBeVisible({ timeout: 30_000 });
      await expect(sideConversationTabs(page)).toHaveCount(1);
      await expectSideConversationText(page, question);
      await expectSideConversationText(page, mockSideAnswer(0, question));
      await expect(sideConversationPanel(page).getByTestId("thread-send-back")).toHaveText(
        "Answer added to main queue",
      );
      await expect(mainComposer).toHaveValue("Keep this main draft intact");

      await sideConversationPanel(page).getByTestId("thread-open-source").click();
      await expect(page.getByTestId("assistant-message").first()).toBeVisible();
      await expect(page).toHaveURL(sourceUrl);
      await expect(page.getByTestId("reply-in-thread").last()).toBeVisible();
    } finally {
      await agent.cleanup();
    }
  });

  test("tells the user the thread is gone when the parent is archived", async ({ page }) => {
    const agent = await seedSideConversationParent({
      repoPrefix: "side-conversation-archive-",
      title: "Archived side conversation parent",
      answersSideQuestions: true,
    });
    try {
      await openAgentRoute(page, { workspaceId: agent.workspaceId, agentId: agent.agentId });
      await startSideConversationFromTabMenu(page, agent.agentId);
      const question = "Still here?";
      await askSideQuestion(page, question);
      await expectSideConversationText(page, mockSideAnswer(0, question));

      await agent.client.archiveAgent(agent.agentId);

      // The daemon drops every thread the parent owned and broadcasts the removal, so the open tab
      // has to say so rather than keep showing an answer the host no longer has.
      await expect(
        sideConversationPanel(page).getByTestId("side-conversation-panel-removed"),
      ).toBeVisible({ timeout: 30_000 });
      await expectSideConversationText(page, REMOVED);
    } finally {
      await agent.cleanup();
    }
  });

  test("records the question and says so when the provider has no side-question seam", async ({
    page,
  }) => {
    const agent = await seedSideConversationParent({
      repoPrefix: "side-conversation-no-seam-",
      title: "Seam-less side conversation parent",
      answersSideQuestions: false,
    });
    try {
      await openAgentRoute(page, { workspaceId: agent.workspaceId, agentId: agent.agentId });
      // The control is offered: it is gated on the host capability, not on the parent's provider.
      await startSideConversationFromTabMenu(page, agent.agentId);

      const question = "Anyone home?";
      await askSideQuestion(page, question);
      await expectSideConversationText(page, UNAVAILABLE);

      // The question survives the failed answer, so the thread is still findable from the track.
      await page.getByTestId(`workspace-tab-agent_${agent.agentId}`).first().click();
      await openSubagentsTrack(page);
      await expect(sideConversationTrackRow(page, question)).toBeVisible({ timeout: 30_000 });
    } finally {
      await agent.cleanup();
    }
  });

  test("offers no side conversation on a host that does not advertise the feature", async ({
    page,
  }) => {
    const agent = await seedSideConversationParent({
      repoPrefix: "side-conversation-old-host-",
      title: "Old host parent",
      answersSideQuestions: true,
    });
    try {
      await hideSideConversationsCapability(page);
      await openAgentRoute(page, { workspaceId: agent.workspaceId, agentId: agent.agentId });

      await expectNoSideConversationInTabMenu(page, agent.agentId);

      // The entry point disappears rather than greying out, and nothing opens a thread tab behind
      // the user's back on a host that could not serve one.
      await expect(sideConversationTabs(page)).toHaveCount(0);
    } finally {
      await agent.cleanup();
    }
  });
});
