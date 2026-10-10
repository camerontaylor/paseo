import { expect, type Locator, type Page } from "@playwright/test";
import { daemonWsRoutePattern } from "./daemon-port";
import { seedMockAgentWorkspace, type MockAgentWorkspace } from "./mock-agent";

/**
 * The mock provider only exposes `askSideQuestion` when the agent asks for it, so one helper seeds
 * a parent that can answer and the same helper seeds the seam-less shape Codex, Copilot, Pi and
 * every ACP provider really have. See `mock-load-test-agent.ts`'s `mockSideQuestions` feature value.
 */
export function seedSideConversationParent(options: {
  repoPrefix: string;
  title: string;
  /** False reproduces a provider with no side-question seam. */
  answersSideQuestions: boolean;
}): Promise<MockAgentWorkspace> {
  return seedMockAgentWorkspace({
    repoPrefix: options.repoPrefix,
    title: options.title,
    featureValues: options.answersSideQuestions ? { mockSideQuestions: true } : {},
  });
}

/** What the mock answers with, so a follow-up can be shown to carry the earlier exchange. */
export function mockSideAnswer(priorExchanges: number, question: string): string {
  return `mock-side-answer ${priorExchanges}: ${question}`;
}

function agentTabMenuItem(page: Page, agentId: string, suffix: string): Locator {
  return page.getByTestId(`workspace-tab-context-agent_${agentId}-${suffix}`);
}

async function openAgentTabContextMenu(page: Page, agentId: string): Promise<void> {
  const tab = page.getByTestId(`workspace-tab-agent_${agentId}`).filter({ visible: true }).first();
  await expect(tab).toBeVisible({ timeout: 30_000 });
  await tab.click({ button: "right" });
  // Anchor on an entry every agent tab has, so a missing side-conversation item is a real absence
  // rather than a menu that never opened.
  await expect(agentTabMenuItem(page, agentId, "copy-agent-id")).toBeVisible({ timeout: 30_000 });
}

/** Opens a fresh thread the way a user does: the agent tab's own context menu. */
export async function startSideConversationFromTabMenu(page: Page, agentId: string): Promise<void> {
  await openAgentTabContextMenu(page, agentId);
  await agentTabMenuItem(page, agentId, "new-side-conversation").click();
  await expect(sideConversationPanel(page)).toBeVisible({ timeout: 30_000 });
}

export async function expectNoSideConversationInTabMenu(
  page: Page,
  agentId: string,
): Promise<void> {
  await openAgentTabContextMenu(page, agentId);
  await expect(agentTabMenuItem(page, agentId, "new-side-conversation")).toHaveCount(0);
  await page.keyboard.press("Escape");
}

export function sideConversationPanel(page: Page): Locator {
  return page.getByTestId("side-conversation-panel").filter({ visible: true }).first();
}

export async function askSideQuestion(page: Page, question: string): Promise<void> {
  const panel = sideConversationPanel(page);
  await panel.getByTestId("side-conversation-input").fill(question);
  await panel.getByTestId("side-conversation-send").click();
  await expect(panel.getByText(question, { exact: true })).toBeVisible({ timeout: 30_000 });
}

export async function expectSideConversationText(page: Page, text: string): Promise<void> {
  await expect(sideConversationPanel(page).getByText(text, { exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Thread ids are minted in the browser, so a spec cannot predict the row's testID. A thread is
 * named by its first question, which is the only stable handle on it from the outside.
 */
export function sideConversationTrackRow(page: Page, firstQuestion: string): Locator {
  return page
    .locator('[data-testid^="subagents-track-row-"]')
    .filter({ hasText: firstQuestion })
    .first();
}

export function sideConversationTabs(page: Page): Locator {
  return page
    .locator('[data-testid^="workspace-tab-side_conversation_"]')
    .filter({ visible: true });
}

/**
 * Serves a daemon that never advertises `features.sideConversations`, which is what an app talking
 * to a pre-v0.5 host sees. Only the advertisement is rewritten: the daemon, the socket and every
 * other message stay real.
 */
export async function hideSideConversationsCapability(page: Page): Promise<void> {
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => ws.send(withoutSideConversationsFeature(message)));
  });
}

function withoutSideConversationsFeature(message: string | Buffer): string | Buffer {
  const raw = typeof message === "string" ? message : message.toString("utf8");
  try {
    const envelope = JSON.parse(raw) as {
      type?: unknown;
      message?: {
        type?: unknown;
        payload?: { status?: unknown; features?: Record<string, unknown> };
      };
    };
    const payload = envelope.message?.payload;
    if (
      envelope.type !== "session" ||
      envelope.message?.type !== "status" ||
      payload?.status !== "server_info" ||
      !payload.features
    ) {
      return message;
    }
    delete payload.features.sideConversations;
    return JSON.stringify(envelope);
  } catch {
    return message;
  }
}
