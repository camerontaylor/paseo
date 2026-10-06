import { expect, test } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";
import { writeFile } from "node:fs/promises";

test("manual routing restores its draft and delivers to an existing chat without navigating or creating a chat", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const destination = await seedMockAgentWorkspace({
    repoPrefix: "routing-destination-",
    title: "Routing destination",
  });
  const source = await seedMockAgentWorkspace({
    repoPrefix: "routing-source-",
    title: "Source chat",
  });
  const prompt = "  Preserve this routing draft\nverbatim.  ";
  const requests: Array<Record<string, unknown>> = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", ({ payload }) => {
      const envelope = JSON.parse(payload.toString());
      if (envelope.type === "session") requests.push(envelope.message);
    }),
  );
  try {
    await openAgentRoute(page, source);
    await waitForSidebarHydration(page);
    const before = (await source.client.fetchAgents()).entries.map(({ agent }) => agent.id).sort();
    const composer = page.getByTestId("session-routing-composer");
    await composer.getByTestId("routing-send-mode").click();
    await composer.getByTestId("routing-send-draft").fill(prompt);
    await page.reload();
    await waitForSidebarHydration(page);
    await composer.getByTestId("routing-send-mode").click();
    await expect(composer.getByTestId("routing-send-draft")).toHaveValue(prompt);
    await composer.getByTestId("routing-recipient").click();
    await composer.getByRole("button", { name: /Use .*Routing destination/ }).click();
    await page.screenshot({ path: testInfo.outputPath("manual-routing-ready.png") });
    const originalUrl = page.url();
    await composer.getByTestId("routing-submit").click();
    await expect(composer.getByText(/(?:Routed to|Queued for).*Routing destination/)).toBeVisible();
    expect(page.url()).toBe(originalUrl);
    await expect(composer.getByTestId("routing-send-draft")).toHaveValue("");
    expect(requests.filter((request) => request.type === "session.search.request")).toEqual([]);
    expect(requests.filter((request) => request.type === "agent.queue.enqueue.request")).toEqual([
      expect.objectContaining({
        agentId: destination.agentId,
        text: prompt,
        expectedWorkspaceId: destination.workspaceId,
      }),
    ]);
    expect((await source.client.fetchAgents()).entries.map(({ agent }) => agent.id).sort()).toEqual(
      before,
    );
    await page.screenshot({ path: testInfo.outputPath("manual-routing-acknowledged.png") });
    await openAgentRoute(page, destination);
    await expect(
      page.getByText("Preserve this routing draft", { exact: false }).last(),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("destination-received.png") });
    await writeFile(
      testInfo.outputPath("routing-delivery.json"),
      JSON.stringify(
        {
          originalPrompt: prompt,
          enqueue: requests.filter((request) => request.type === "agent.queue.enqueue.request"),
          matchingRequests: requests.filter((request) => request.type === "session.search.request"),
          chatsBefore: before,
          chatsAfter: (await source.client.fetchAgents()).entries
            .map(({ agent }) => agent.id)
            .sort(),
          destinationVisible: await page
            .getByText("Preserve this routing draft", { exact: false })
            .last()
            .innerText(),
        },
        null,
        2,
      ),
    );
  } finally {
    await source.cleanup();
    await destination.cleanup();
  }
});

test("new conversation handoff keeps the prompt and chosen workspace without sending", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const source = await seedMockAgentWorkspace({
    repoPrefix: "routing-new-",
    title: "Original conversation",
  });
  try {
    await openAgentRoute(page, source);
    await waitForSidebarHydration(page);
    const before = (await source.client.fetchAgents()).entries.map(({ agent }) => agent.id).sort();
    const composer = page.getByTestId("session-routing-composer");
    const text = "  A completely new task\nwith its own context.  ";
    await composer.getByTestId("routing-send-mode").click();
    await composer.getByTestId("routing-send-draft").fill(text);
    await expect(composer.getByTestId("routing-delivery-mode")).toHaveText("Queue");
    for (const mode of ["Steer", "Interrupt", "Queue"]) {
      await composer.getByTestId("routing-delivery-mode").click();
      await page.getByRole("menuitem", { name: mode, exact: true }).click();
      await expect(composer.getByTestId("routing-delivery-mode")).toHaveText(mode);
      await expect(composer.getByTestId("routing-send-draft")).toHaveValue(text);
    }

    await composer.getByTestId("routing-recipient").click();
    await composer.getByTestId("routing-new-conversation").click();
    await expect(composer.getByTestId("routing-new-workspace")).toHaveText("Choose workspace");
    await expect(composer.getByTestId("routing-submit")).toBeDisabled();
    await composer.getByTestId("routing-new-workspace").click();
    await page
      .getByRole("menuitem")
      .filter({ hasText: /routing-new-/ })
      .first()
      .click();
    await expect(composer.getByTestId("routing-send-draft")).toHaveValue(text);
    await composer.getByRole("button", { name: "Continue in new conversation" }).click();
    await expect(page.locator("[data-composer-input]:visible").last()).toHaveValue(text);
    expect(page.url()).toContain(encodeURIComponent(source.workspaceId));
    expect((await source.client.fetchAgents()).entries.map(({ agent }) => agent.id).sort()).toEqual(
      before,
    );
  } finally {
    await source.cleanup();
  }
});
