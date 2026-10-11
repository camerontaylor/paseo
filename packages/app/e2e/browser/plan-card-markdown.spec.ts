import { expect, test } from "../support/fixtures";
import { waitForPermissionPrompt } from "../support/helpers/permissions";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

// The plan card has to pass its own markdown parser. Drop that prop and
// react-native-markdown-display silently supplies one with `typographer: true`
// (node_modules/react-native-markdown-display/src/index.js:139-141), which
// turns (c) into ©, curls straight quotes, and rewrites --- as an em dash.
// No unit test can catch that, because the defect lives in the JSX.
//
// Nothing here is provider-specific: the mock provider drives it, and the
// behavior is the same for every agent.
test.describe("Plan card markdown", () => {
  test("renders plan text verbatim, copies it, and opens one editable handoff draft", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const session = await seedMockAgentWorkspace({
      repoPrefix: "plan-card-markdown-",
      title: "Plan card markdown e2e",
      initialPrompt: "Emit synthetic plan approval.",
    });

    try {
      await openAgentRoute(page, session);
      await waitForPermissionPrompt(page, 120_000);

      const planCard = page.getByTestId("permission-plan-card");
      await expect(planCard).toContainText("(c)");
      await expect(planCard).toContainText('--name="my repo"');
      await expect(planCard).toContainText("---buzz");
      await expect(planCard).not.toContainText("©");
      await expect(planCard).not.toContainText("—buzz");
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      const readClipboard = () => page.evaluate("navigator.clipboard.readText()");
      await planCard.getByTestId("plan-copy-content").click();
      await expect.poll(readClipboard).toContain("(c)");
      await planCard.getByTestId("plan-copy-link").click();
      await expect.poll(readClipboard).toContain(`/agent/${session.agentId}`);

      await planCard.getByTestId("permission-plan-handoff").click();
      const composer = page
        .getByRole("textbox", { name: "Message agent..." })
        .filter({ visible: true });
      await expect(composer).toBeEditable();
      await expect(composer).toHaveValue(/Implement the following proposed plan\./);
      await expect(composer).toHaveValue(/Add the \(c\) README note/);
      await expect(composer).toHaveValue(new RegExp(session.agentId));
      const agents = await session.client.fetchAgents({ scope: "active" });
      expect(
        agents.entries.filter(({ agent }) => agent.workspaceId === session.workspaceId),
      ).toHaveLength(1);

      const handoffPrompt = await composer.inputValue();
      await page.getByRole("button", { name: "Send message" }).filter({ visible: true }).click();
      await expect
        .poll(async () => {
          let count = 0;
          for (const { agent } of (await session.client.fetchAgents({ scope: "active" })).entries) {
            if (agent.workspaceId === session.workspaceId) count += 1;
          }
          return count;
        })
        .toBe(2);
      const destination = (await session.client.fetchAgents({ scope: "active" })).entries.find(
        ({ agent }) => agent.workspaceId === session.workspaceId && agent.id !== session.agentId,
      )?.agent;
      expect(destination).toBeDefined();
      const timelineClient = session.client as typeof session.client & {
        fetchAgentTimeline(agentId: string): Promise<{
          entries: Array<{ item: { type: string; text?: string } }>;
        }>;
      };
      await expect
        .poll(async () => {
          let count = 0;
          for (const { item } of (await timelineClient.fetchAgentTimeline(destination!.id))
            .entries) {
            if (item.type === "user_message" && item.text === handoffPrompt) count += 1;
          }
          return count;
        })
        .toBe(1);
    } finally {
      await session.cleanup();
    }
  });
});
