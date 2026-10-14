import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { ensureExplorerSidebar, openFilesPanel } from "../support/helpers/workspace-tabs";

const APP_SETTINGS_KEY = "@paseo:app-settings";

function visibleMainPane(page: Page) {
  return page.getByTestId("workspace-pane-main").filter({ visible: true });
}

function composerChangesPill(page: Page) {
  return page.getByTestId("composer-diff-stat-pill");
}

async function revealComposerChangesInExplorer(page: Page) {
  await composerChangesPill(page).click();

  const explorer = await ensureExplorerSidebar(page);
  await expect(explorer.getByTestId("changes-tree-panel")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("workspace-tab-working_diff")).toHaveCount(0);
}

async function openComposerDiff(page: Page) {
  await composerChangesPill(page).click();
}

async function seedChangedAgent(repoPrefix: string) {
  const workspace = await seedMockAgentWorkspace({
    repoPrefix,
    title: "Composer diff stat",
    repo: {
      withRemote: true,
      // Exclude the local remote before the daemon starts observing this checkout.
      files: [{ path: ".gitignore", content: "/remote.git/\n" }],
    },
  });
  try {
    await writeFile(
      path.join(workspace.cwd, "README.md"),
      "# Temp Repo\nexport const one = 1;\nexport const two = 2;\n",
    );
    await workspace.client.checkoutRefresh(workspace.cwd);
    await expect
      .poll(async () => {
        const workspaces = await workspace.client.fetchWorkspaces();
        const diffStat =
          workspaces.entries.find((entry) => entry.id === workspace.workspaceId)?.diffStat ?? null;
        if (!diffStat) return null;
        // Totals stay exact; the attached breakdown is asserted separately. The
        // e2e seed-client type only declares the totals, so the new field is
        // probed structurally instead of widening that helper.
        return {
          totals: { additions: diffStat.additions, deletions: diffStat.deletions },
          hasBreakdown: "breakdown" in diffStat,
        };
      })
      .toEqual({ totals: { additions: 2, deletions: 0 }, hasBreakdown: true });
    return workspace;
  } catch (error) {
    await workspace.cleanup();
    throw error;
  }
}

// code +2/-1 plus config +7/-3: production is +2/-1 and the total is +9/-4.
async function seedCodeAndConfigAgent(repoPrefix: string) {
  const workspace = await seedMockAgentWorkspace({
    repoPrefix,
    title: "Composer diff stat fixture",
    repo: {
      withRemote: true,
      files: [
        { path: ".gitignore", content: "/remote.git/\n" },
        { path: "app.ts", content: "export const a = 1;\nexport const b = 2;\n" },
        { path: "config.json", content: "old-1\nold-2\nold-3\n" },
      ],
    },
  });
  try {
    await writeFile(
      path.join(workspace.cwd, "app.ts"),
      "export const a = 1;\nexport const b = 3;\nexport const c = 4;\n",
    );
    await writeFile(
      path.join(workspace.cwd, "config.json"),
      "new-1\nnew-2\nnew-3\nnew-4\nnew-5\nnew-6\nnew-7\n",
    );
    await workspace.client.checkoutRefresh(workspace.cwd);
    await expect
      .poll(async () => {
        const workspaces = await workspace.client.fetchWorkspaces();
        const diffStat =
          workspaces.entries.find((entry) => entry.id === workspace.workspaceId)?.diffStat ?? null;
        return diffStat ? { additions: diffStat.additions, deletions: diffStat.deletions } : null;
      })
      .toEqual({ additions: 9, deletions: 4 });
    return workspace;
  } catch (error) {
    await workspace.cleanup();
    throw error;
  }
}

test("composer diff stat reveals Changes, then opens the diff in the configured side pane", async ({
  page,
}) => {
  await page.addInitScript((settingsKey) => {
    localStorage.setItem(settingsKey, JSON.stringify({ openInSidePane: { diffs: true } }));
  }, APP_SETTINGS_KEY);
  const workspace = await seedChangedAgent("composer-diff-stat-side-");

  try {
    await page.setViewportSize({ width: 1400, height: 900 });
    await openAgentRoute(page, {
      workspaceId: workspace.workspaceId,
      agentId: workspace.agentId,
    });

    const pill = composerChangesPill(page);
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await expect(pill).toContainText("+2");
    await expect(pill).toContainText("-0");
    await revealComposerChangesInExplorer(page);
    await openComposerDiff(page);

    const sidePane = page
      .locator('[data-testid^="workspace-pane-"]')
      .filter({ visible: true })
      .filter({ has: page.getByTestId("working-diff-panel") });
    await expect(sidePane.getByTestId("workspace-tab-working_diff")).toBeVisible({
      timeout: 30_000,
    });
    await expect(sidePane.getByTestId("working-diff-panel")).toBeVisible({ timeout: 30_000 });
    await expect(visibleMainPane(page).getByTestId("working-diff-panel")).toHaveCount(0);

    await test.step("Explorer navigation does not replace the side pane", async () => {
      await openFilesPanel(page);
      await expect(page.getByTestId("workspace-explorer-sidebar")).toContainText("Files");

      await pill.click();
      await expect(sidePane.getByTestId("working-diff-panel")).toBeVisible();
      await expect(page.getByTestId("workspace-tab-working_diff")).toHaveCount(1);
    });
  } finally {
    await workspace.cleanup();
  }
});

test("composer diff stat opens the compact explorer instead of a Changes tab", async ({ page }) => {
  const workspace = await seedChangedAgent("composer-diff-stat-compact-");

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAgentRoute(page, {
      workspaceId: workspace.workspaceId,
      agentId: workspace.agentId,
    });

    const closeExplorer = page
      .getByTestId("explorer-header")
      .getByRole("button", { name: "Close Explorer sidebar" });
    await expect(closeExplorer).not.toBeInViewport();

    await page.getByTestId("composer-diff-stat-pill").click();

    await expect(closeExplorer).toBeInViewport({ timeout: 30_000 });
    await expect(page.getByTestId("changes-header").filter({ visible: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("workspace-tab-working_diff")).toHaveCount(0);
  } finally {
    await workspace.cleanup();
  }
});

test("composer diff stat separates production from config in the pill", async ({ page }) => {
  const workspace = await seedCodeAndConfigAgent("composer-diff-stat-config-");

  try {
    await page.setViewportSize({ width: 1400, height: 900 });
    await openAgentRoute(page, {
      workspaceId: workspace.workspaceId,
      agentId: workspace.agentId,
    });

    const pill = composerChangesPill(page);
    await expect(pill).toBeVisible({ timeout: 30_000 });
    // Production excludes config: +2/-1 production next to the +9/-4 total.
    await expect(pill.getByLabel("Code")).toContainText("+2");
    await expect(pill.getByLabel("Code")).toContainText("-1");
    await expect(pill.getByLabel("Total")).toContainText("+9");
    await expect(pill.getByLabel("Total")).toContainText("-4");
    const wideBox = await pill.boundingBox();
    console.log(`[e2e] pill box wide 1400x900: ${JSON.stringify(wideBox)}`);
    await page.screenshot({ path: "/tmp/paseo-change-stats-wide.png" });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(pill.getByLabel("Total")).toContainText("+9");
    await expect(pill.getByLabel("Code")).toContainText("+2");
    const compactBox = await pill.boundingBox();
    console.log(`[e2e] pill box compact 390x844: ${JSON.stringify(compactBox)}`);
    await page.screenshot({ path: "/tmp/paseo-change-stats-compact.png" });
  } finally {
    await workspace.cleanup();
  }
});

test("composer diff stat reveals Changes, then opens the diff in the focused pane by default", async ({
  page,
}) => {
  const workspace = await seedChangedAgent("composer-diff-stat-tab-");

  try {
    await page.setViewportSize({ width: 1400, height: 900 });
    await openAgentRoute(page, {
      workspaceId: workspace.workspaceId,
      agentId: workspace.agentId,
    });

    await revealComposerChangesInExplorer(page);
    await openComposerDiff(page);

    const mainPane = visibleMainPane(page);
    await expect(mainPane.getByTestId("workspace-tab-working_diff")).toBeVisible({
      timeout: 30_000,
    });
    await expect(mainPane.getByTestId("working-diff-panel")).toBeVisible({ timeout: 30_000 });
    await expect(
      page.locator('[data-testid^="workspace-pane-"]').filter({ visible: true }),
    ).toHaveCount(1);
  } finally {
    await workspace.cleanup();
  }
});
