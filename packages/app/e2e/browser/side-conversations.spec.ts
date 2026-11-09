import { expect, test } from "../support/fixtures";
import { openAgentRoute } from "../support/helpers/mock-agent";
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
