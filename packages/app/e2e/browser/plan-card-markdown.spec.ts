import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { attachFileFromMenu } from "../support/helpers/composer";
import { waitForPermissionPrompt } from "../support/helpers/permissions";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { createAgentTabFromMenu } from "../support/helpers/workspace-tabs";

const TEST_JSON = {
  name: "handoff-draft.json",
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify({ draft: "keep" })),
};

// Literal shell commands and copyright markers must survive Markdown rendering.
test.describe("Plan card markdown", () => {
  test("renders plan text verbatim, copies it, and opens one editable handoff draft", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const session = await seedMockAgentWorkspace({
      repoPrefix: "plan-card-markdown-",
      title: "Plan card markdown e2e",
      initialPrompt: "Emit synthetic plan approval.",
      // A model with thinking levels, so the handoff's effort has something to carry.
      model: "ten-second-stream",
      thinkingOptionId: "high",
    });

    try {
      await openAgentRoute(page, session);
      await waitForPermissionPrompt(page, 120_000);

      const planCard = page.getByTestId("permission-plan-card");
      await expect(planCard.locator(".enrm-text")).toBeVisible();
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

      // A draft that already holds text and an attachment. Handing off must open its own draft and
      // leave this one alone.
      await createAgentTabFromMenu(page);
      const existingDraftTab = page
        .locator('[data-testid^="workspace-tab-draft_"][aria-selected="true"]')
        .filter({ visible: true });
      await expect(existingDraftTab).toHaveCount(1);
      const existingDraftTabId = await existingDraftTab.getAttribute("data-testid");
      expect(existingDraftTabId).not.toBeNull();
      const existingDraftComposer = page
        .getByRole("textbox", { name: "Message agent..." })
        .filter({ visible: true });
      await existingDraftComposer.fill("keep this draft");
      await attachFileFromMenu(page, TEST_JSON);
      await expect(page.getByTestId("composer-file-attachment-pill")).toContainText(
        TEST_JSON.name,
        {
          timeout: 30_000,
        },
      );

      // The plan card lives in the source agent's tab, so hand off from there.
      await page
        .getByTestId(`workspace-tab-agent_${session.agentId}`)
        .filter({ visible: true })
        .click();
      await planCard.getByTestId("permission-plan-handoff").click();
      const handoffDraftTab = page
        .locator('[data-testid^="workspace-tab-draft_"][aria-selected="true"]')
        .filter({ visible: true });
      await expect(handoffDraftTab).toHaveCount(1);
      const handoffDraftTabId = await handoffDraftTab.getAttribute("data-testid");
      expect(handoffDraftTabId).not.toBeNull();
      expect(handoffDraftTabId).not.toBe(existingDraftTabId);
      const composer = page
        .getByRole("textbox", { name: "Message agent..." })
        .filter({ visible: true });
      await expect(composer).toBeEditable();
      await expect(composer).toHaveValue(/Implement the following proposed plan\./);
      await expect(composer).toHaveValue(/Add the \(c\) README note/);
      await expect(composer).toHaveValue(new RegExp(session.agentId));
      const sourceAgent = (await session.client.fetchAgents({ scope: "active" })).entries.find(
        ({ agent }) => agent.id === session.agentId,
      )?.agent;
      expect(sourceAgent).toBeDefined();
      expect(sourceAgent!.thinkingOptionId).toBe("high");
      const agents = await session.client.fetchAgents({ scope: "active" });
      expect(
        agents.entries.filter(({ agent }) => agent.workspaceId === session.workspaceId),
      ).toHaveLength(1);

      // The draft that was already open still has its own text and attachment.
      await page.getByTestId(existingDraftTabId!).click();
      const restoredDraftComposer = page
        .getByRole("textbox", { name: "Message agent..." })
        .filter({ visible: true });
      await expect(restoredDraftComposer).toHaveValue("keep this draft");
      await expect(page.getByTestId("composer-file-attachment-pill")).toContainText(TEST_JSON.name);

      // Submit the handoff draft, not the one that was already open.
      await page.getByTestId(handoffDraftTabId!).click();
      await expect(composer).toHaveValue(/Implement the following proposed plan\./);
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
      // The created agent runs on the provider the source agent used, account included.
      expect(destination!.provider).toBe(sourceAgent!.provider);
      expect(destination!.model).toBe(sourceAgent!.model);
      expect(destination!.thinkingOptionId).toBe(sourceAgent!.thinkingOptionId);
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

test("chat and file preview share the library renderer and resolve file links", async ({
  page,
}, testInfo) => {
  await withSharedMarkdownFiles(page, async () => {
    const message = page.getByTestId("assistant-message");
    await expect(message).toHaveCount(1);
    await expect(message.locator(".enrm-text > p").first()).toContainText("First paragraph.");
    await expect(message.locator(".enrm-text > p").nth(1)).toContainText("Second paragraph.");
    await expect(message.locator("blockquote")).toContainText("A quote");
    await expect(message.getByRole("table")).toContainText("42");
    await expect(message.getByRole("cell").nth(0)).toHaveText("Answer");
    await expect(message.getByRole("cell").nth(1)).toHaveText("");
    await expect(message.getByRole("cell").nth(2)).toHaveText("42");
    await expect(message.locator("p div")).toHaveCount(0);
    await openSharedMarkdownFile(page, "README.md");
    const preview = page.getByTestId("markdown-preview-frame");
    await expect(preview.locator(".enrm-text")).toContainText("Second paragraph.");
    await expect(preview.getByRole("table")).toContainText("42");
    await returnToSharedMarkdownChat(page);
    await expectFileLinkTooltip(
      page,
      message.getByRole("link", { name: "src/说明.md:2-3", exact: true }),
      "packages/app/src/说明.md:2-3",
    );
    await openSharedMarkdownFile(page, "src/说明.md:2-3");
    await expect(page.getByText("Unicode suffix lookup succeeded.", { exact: true })).toBeVisible();
    await openSharedMarkdownFile(page, "packages/app/src/说明.md:2-3");
    await expect(page.getByText("Unicode suffix lookup succeeded.", { exact: true })).toBeVisible();
    await openSharedMarkdownFile(page, "Space file");
    await expect(
      page.getByText("Explicit link opened the space filename.", { exact: true }),
    ).toBeVisible();
    await openSharedMarkdownFile(page, "my%20file.ts");
    await expect(
      page.getByText("Inline code opened the literal percent filename.", { exact: true }),
    ).toBeVisible();
    await testInfo.attach("shared-renderer", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });
});
async function expectFileLinkTooltip(page: Page, link: Locator, path: string) {
  await link.hover();
  await expect(page.getByRole("tooltip")).toHaveText(path);
}

async function withSharedMarkdownFiles(page: Page, run: () => Promise<void>) {
  const { writeFile, mkdir } = await import("node:fs/promises");
  const source =
    "First paragraph.\n\nSecond paragraph.\n\n```ts\nconst answer = 42;\n```\n\n> A quote\n\n| Key || Value |\n| --- | --- | --- |\n| Answer || 42 |\n\nOpen `README.md` or `src/说明.md:2-3`, or packages/app/src/说明.md:2-3.\n\n[Space file](my%20file.ts) and `my%20file.ts`.";
  const session = await seedMockAgentWorkspace({
    repoPrefix: "shared-markdown-",
    title: "Shared Markdown",
    featureValues: { mockAssistantResponse: source },
    initialPrompt: "Show Markdown",
  });
  try {
    await writeFile(`${session.cwd}/README.md`, source);
    await writeFile(`${session.cwd}/my file.ts`, "Explicit link opened the space filename.");
    await writeFile(
      `${session.cwd}/my%20file.ts`,
      "Inline code opened the literal percent filename.",
    );
    await mkdir(`${session.cwd}/packages/app/src`, { recursive: true });
    await writeFile(
      `${session.cwd}/packages/app/src/说明.md`,
      "# Nested file\n\nUnicode suffix lookup succeeded.",
    );
    await session.client.waitForFinish(session.agentId, 30_000);
    // A cold render must work even when a separate parser chunk cannot be fetched.
    await page.route("**/wasm/md4c.bundle?**", (route) => route.abort("failed"));
    await openAgentRoute(page, session);
    await run();
  } finally {
    await session.cleanup();
  }
}

async function returnToSharedMarkdownChat(page: Page) {
  await page.getByRole("button", { name: "Shared Markdown", exact: true }).click();
}

async function openSharedMarkdownFile(page: Page, name: string) {
  await returnToSharedMarkdownChat(page);
  await page.getByTestId("assistant-message").getByRole("link", { name, exact: true }).click();
}

test("linked inline code keeps code typography and wraps long paths", async ({
  page,
}, testInfo) => {
  const longPath =
    "packages/app/src/components/markdown/renderer/very-long-directory-name/another-long-directory-name/file.ts:12";
  const session = await seedMockAgentWorkspace({
    repoPrefix: "inline-code-style-",
    title: "Inline code style",
    featureValues: {
      mockAssistantResponse:
        "Compare `ordinary_token`, `file.ts:12`, `https://example.com`. At the end of this line open `" +
        longPath +
        "`.",
    },
    initialPrompt: "Show inline code",
  });
  try {
    await session.client.waitForFinish(session.agentId, 30_000);
    await openAgentRoute(page, session);
    const message = page.getByTestId("assistant-message");
    await expect(message.getByRole("link", { name: longPath, exact: true })).toBeVisible();
    const measurements = await measureInlineCode(message);
    await testInfo.attach("inline-code-measurements", {
      body: JSON.stringify(measurements, null, 2),
      contentType: "application/json",
    });
    expect(measurements.codes).toHaveLength(4);
    const [plain, file, url, long] = measurements.codes;
    for (const linked of [file, url, long]) {
      expect(linked.fontSize).toBe(plain.fontSize);
      expect(linked.fontFamily).toBe(plain.fontFamily);
      expect(linked.backgroundColor).toBe(plain.backgroundColor);
      expect(linked.color).toBe(linked.anchorColor);
      expect(linked.color).not.toBe(plain.color);
    }
    expect(long.lines).toBeGreaterThan(1);
    expect(long.right).toBeLessThanOrEqual(measurements.right + 1);
  } finally {
    await session.cleanup();
  }
});

async function measureInlineCode(message: Locator) {
  return message.evaluate((element) => {
    // Constrain the paragraph to exercise an inline path at a line boundary.
    const paragraph = element.querySelector("p")!;
    paragraph.style.width = "300px";
    const codes = Array.from(paragraph.querySelectorAll("code"), (code) => {
      const style = getComputedStyle(code);
      const range = document.createRange();
      range.selectNodeContents(code);
      const rects = Array.from(range.getClientRects());
      return {
        text: code.textContent,
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
        backgroundColor: style.backgroundColor,
        color: style.color,
        anchorColor: code.closest("a") ? getComputedStyle(code.closest("a")!).color : null,
        whiteSpace: style.whiteSpace,
        overflowWrap: style.overflowWrap,
        rects: rects.map((rect) => ({ left: rect.left, right: rect.right, top: rect.top })),
        lines: new Set(rects.map((rect) => rect.top)).size,
        right: Math.max(...rects.map((rect) => rect.right)),
      };
    });
    return { codes, right: paragraph.getBoundingClientRect().right };
  });
}

test("inline-code paths preserve stable recognition and file navigation", async ({
  page,
  context,
}, testInfo) => {
  const { writeFile, mkdir } = await import("node:fs/promises");
  const paths = ["src/app/[id].tsx", "src/app/(tabs)/index.tsx", "src/a$b.ts"];
  const source =
    paths.map((path) => `Open \`${path}\`.`).join("\n\n") +
    "\n\nOpen `.gitignore` and `src/index.ts#L10-L20`. Compare before/after and `before/after`. Keep `word.word` plain.";
  const session = await seedMockAgentWorkspace({
    repoPrefix: "inline-path-regression-",
    title: "Inline path regression",
    initialPrompt: "Show file paths",
    featureValues: { mockAssistantResponse: source },
  });
  try {
    await mkdir(`${session.cwd}/src/app/(tabs)`, { recursive: true });
    for (const path of paths) await writeFile(`${session.cwd}/${path}`, `Opened ${path}`);
    await writeFile(
      `${session.cwd}/src/index.ts`,
      Array.from({ length: 30 }, (_, i) => `export const line${i + 1} = ${i + 1};`).join("\n"),
    );
    await session.client.waitForFinish(session.agentId, 30_000);
    await openAgentRoute(page, session);
    const message = page.getByTestId("assistant-message");
    await expect(message.getByRole("link", { name: ".gitignore", exact: true })).toBeVisible();
    await expect(message.getByRole("link", { name: "before/after", exact: true })).toHaveCount(0);
    await expect(message.getByRole("link", { name: "word.word", exact: true })).toHaveCount(0);
    for (const path of paths) {
      await openInlineRegressionFile(page, path);
      await expect(page.getByTestId("file-source-editor").filter({ visible: true })).toContainText(
        `Opened ${path}`,
      );
    }
    await openInlineRegressionFile(page, "src/index.ts#L10-L20");
    await expect(page.getByLabel("Line 20, column 26")).toBeVisible();
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page
      .getByTestId("file-source-editor")
      .filter({ visible: true })
      .locator(".cm-content")
      .focus();
    await page.keyboard.press("ControlOrMeta+c");
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(
        Array.from({ length: 11 }, (_, i) => `export const line${i + 10} = ${i + 10};`).join("\n"),
      );
    await expect(
      page
        .getByTestId("file-source-editor")
        .filter({ visible: true })
        .locator(".cm-selectionBackground"),
    ).not.toHaveCount(0);
    await testInfo.attach("inline-path-line-selection", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  } finally {
    await session.cleanup();
  }
});

async function openInlineRegressionFile(page: Page, path: string) {
  await page.getByRole("button", { name: "Inline path regression", exact: true }).click();
  await page
    .getByTestId("assistant-message")
    .getByRole("link", { name: path, exact: true })
    .click();
}

// Web links are styled inline by the library, so hover state has to restyle the anchor.
test("markdown links underline on hover", async ({ page }) => {
  const session = await seedMockAgentWorkspace({
    repoPrefix: "markdown-link-hover-",
    title: "Markdown link hover",
    featureValues: {
      mockAssistantResponse: "See [the docs](https://example.com/docs) and [README](README.md).",
    },
    initialPrompt: "Show links",
  });
  try {
    await session.client.waitForFinish(session.agentId, 30_000);
    await openAgentRoute(page, session);
    const message = page.getByTestId("assistant-message");
    for (const name of ["the docs", "README"]) {
      const link = message.getByRole("link", { name, exact: true });
      await expect(link).toHaveCSS("text-decoration-line", "none");
      await link.hover();
      await expect(link).toHaveCSS("text-decoration-line", "underline");
      await page.mouse.move(0, 0);
      await expect(link).toHaveCSS("text-decoration-line", "none");
    }
  } finally {
    await session.cleanup();
  }
});

const PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test("Markdown images show a zoom-in cursor", async ({ page }) => {
  const session = await seedMockAgentWorkspace({
    repoPrefix: "markdown-image-cursor-",
    title: "Markdown image cursor",
    featureValues: { mockAssistantResponse: `Before.\n\n![pixel](${PIXEL_PNG})\n\nAfter.` },
    initialPrompt: "Show image",
  });
  try {
    await session.client.waitForFinish(session.agentId, 30_000);
    await openAgentRoute(page, session);
    const image = page.getByTestId("assistant-message").getByRole("button", { name: "pixel" });
    await expect(image).toHaveCSS("cursor", "zoom-in");
  } finally {
    await session.cleanup();
  }
});
