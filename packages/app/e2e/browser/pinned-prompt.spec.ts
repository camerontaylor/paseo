import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import {
  expectTimelinePromptLandedBelowTop,
  expectTimelinePromptVisible,
  openAgentTimeline,
  scrollTimelinePromptIntoView,
  seedLongMockAgentTimeline,
  type LongTimelineAgent,
} from "../support/helpers/timeline-pagination";

// Wide enough that the transcript is well clear of the compact form factor, which has no pin.
const WIDE_VIEWPORT = { width: 1440, height: 900 };
const COMPACT_VIEWPORT = { width: 420, height: 860 };
// Enough turns below `prompts[8]` to fill a viewport: a prompt can only scroll clear of the
// transcript top when the content beneath it is taller than the viewport, and the mock's turns are
// short. Keep this above 13 so `prompts[8]` stays reachable.
const LOADED_TURNS = 14;

function timeline(page: Page) {
  return page.locator('[data-testid="agent-chat-scroll"]:visible').first();
}

function pinnedPrompt(page: Page) {
  return page.getByTestId("pinned-prompt");
}

/** The outgoing pin remains mounted during its exit animation. */
async function expectSettledPin(page: Page, prompt: string): Promise<void> {
  await expect(pinnedPrompt(page).filter({ hasText: prompt })).toHaveCount(1);
  await expect(pinnedPrompt(page)).toHaveCount(1);
  await expect(pinnedPrompt(page)).toContainText(prompt);
}

/** Scrolls down until the prompt's own row has left the top of the transcript. */
async function scrollPromptAboveFold(page: Page, prompt: string): Promise<void> {
  await scrollTimelinePromptIntoView(page, prompt);
  const promptRow = timeline(page)
    .locator("[data-history-row-id]")
    .filter({ hasText: prompt })
    .first();
  const [timelineBox, promptBox] = await Promise.all([
    timeline(page).boundingBox(),
    promptRow.boundingBox(),
  ]);
  if (!timelineBox || !promptBox) throw new Error(`Expected a rendered prompt for ${prompt}`);
  // The reading line is 8px below the viewport top, and a row's box includes its trailing gap.
  // Scroll until the row, not just the bubble inside it, clears that line.
  const distance = promptBox.y + promptBox.height - timelineBox.y + 2;
  await timeline(page).evaluate((element, delta) => {
    if (element instanceof HTMLElement) element.scrollTop += delta;
  }, distance);
  await expect
    .poll(async () => {
      const box = await promptRow.boundingBox();
      return box === null || box.y + box.height < timelineBox.y;
    })
    .toBe(true);
}

/** Aligns the prompt row with the transcript's reading line at its top edge. */
async function scrollPromptToReadingLine(page: Page, prompt: string): Promise<void> {
  const activeTimeline = timeline(page);
  const promptRow = activeTimeline.locator("[data-history-row-id]").filter({ hasText: prompt });
  const [timelineBox, rowBox] = await Promise.all([
    activeTimeline.boundingBox(),
    promptRow.boundingBox(),
  ]);
  if (!timelineBox || !rowBox) {
    throw new Error(`Expected a rendered timeline prompt for ${prompt}`);
  }
  await activeTimeline.hover();
  await page.mouse.wheel(0, rowBox.y - timelineBox.y - 8);
  await expectTimelinePromptLandedBelowTop(page, prompt);
}

test.describe("pinned current prompt", () => {
  let agent: LongTimelineAgent;

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    agent = await seedLongMockAgentTimeline({ turns: LOADED_TURNS });
  });

  test.afterAll(async () => {
    if (agent) {
      await agent.cleanup();
    }
  });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(WIDE_VIEWPORT);
    await openAgentTimeline(page, agent);
    await expectTimelinePromptVisible(page, agent.newestPrompt);
  });

  test("pins nothing while the prompt's own bubble is on screen", async ({ page }) => {
    // A prompt can be visible lower in the viewport while the reader is still in an earlier
    // turn. Put its row at the reading line to verify the prompt does not pin itself.
    await scrollPromptToReadingLine(page, agent.prompts[8]!);

    await expect(pinnedPrompt(page)).toHaveCount(0);
  });

  test("pins the prompt of the turn being read once its bubble scrolls past the top", async ({
    page,
  }) => {
    await scrollPromptAboveFold(page, agent.prompts[8]!);

    await expectSettledPin(page, agent.prompts[8]!);
  });

  test("swaps the pin when the reader crosses into the next turn", async ({ page }) => {
    await scrollPromptAboveFold(page, agent.prompts[6]!);
    await expectSettledPin(page, agent.prompts[6]!);

    await scrollPromptAboveFold(page, agent.prompts[7]!);

    await expectSettledPin(page, agent.prompts[7]!);
  });

  test("scrolls the real message back under the pin when clicked", async ({ page }) => {
    await scrollPromptAboveFold(page, agent.prompts[8]!);
    await expectSettledPin(page, agent.prompts[8]!);
    await pinnedPrompt(page).click();

    await expectTimelinePromptLandedBelowTop(page, agent.prompts[8]!);
    // The prompt is the reading row again, so its own bubble carries the turn.
    await expect(pinnedPrompt(page)).toHaveCount(0);
  });

  test("hides the pin on a compact viewport", async ({ page }) => {
    await scrollPromptAboveFold(page, agent.prompts[8]!);
    await expectSettledPin(page, agent.prompts[8]!);

    await page.setViewportSize(COMPACT_VIEWPORT);

    await expect(pinnedPrompt(page)).toHaveCount(0);
  });

  test("fades a prompt longer than the pinned cap", async ({ page }) => {
    const longPrompt = Array.from({ length: 80 }, (_unused, line) => `pinned cap line ${line}`)
      .join(" ")
      .concat(" end");
    await agent.client.sendAgentMessage(agent.agentId, longPrompt);
    await agent.client.waitForFinish(agent.agentId, 15_000);
    await scrollPromptAboveFold(page, longPrompt);

    await expect(pinnedPrompt(page)).toBeVisible();
    await expect(page.getByTestId("pinned-prompt-fade")).toBeVisible();
  });
});
