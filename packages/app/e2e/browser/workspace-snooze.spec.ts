import { test, expect, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { openWorkspaceContextMenu, selectSidebarStatusGrouping } from "../support/helpers/sidebar";

test.use({
  e2eDaemonConfig: {
    version: 1,
    agents: {
      providers: {
        codex: { enabled: false },
        claude: { enabled: false },
        copilot: { enabled: false },
        opencode: { enabled: false },
        pi: { enabled: false },
        omp: { enabled: false },
      },
    },
  },
});

function row(page: Page, workspaceId: string) {
  return page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspaceId}`);
}
async function openSnooze(page: Page, workspaceId: string) {
  await openWorkspaceContextMenu(page, workspaceId);
  await page.getByTestId(`sidebar-workspace-snooze-${getServerId()}:${workspaceId}`).click();
  await expect(page.getByTestId("workspace-snooze-dialog")).toBeVisible();
}

test("timed snoozes hide a workspace, survive reload, and can be revealed and unsnoozed", async ({
  page,
}, testInfo) => {
  const workspace = await seedWorkspace({ repoPrefix: "snooze-time-" });
  try {
    await gotoAppShell(page);
    await openSnooze(page, workspace.workspaceId);
    await page.screenshot({ path: testInfo.outputPath("snooze-time.png") });
    await page.getByTestId("workspace-snooze-submit").click();
    await expect(page.getByTestId("workspace-snooze-dialog")).toBeHidden();
    await expect(row(page, workspace.workspaceId)).toHaveCount(0);
    await page.reload();
    await expect(page.getByText("Show all", { exact: true })).toBeVisible();
    await page.getByText("Show all", { exact: true }).click();
    await expect(row(page, workspace.workspaceId)).toContainText("Snoozed");
    await openWorkspaceContextMenu(page, workspace.workspaceId);
    await page
      .getByTestId(`sidebar-workspace-unsnooze-${getServerId()}:${workspace.workspaceId}`)
      .click();
    await expect(row(page, workspace.workspaceId)).not.toContainText("Snoozed");
    await expect(page.getByText("Show less", { exact: true })).toHaveCount(0);
  } finally {
    await workspace.cleanup();
  }
});

test("AI snooze keeps unavailable checks visible in the editor and pinned/status groups respect hiding", async ({
  page,
}, testInfo) => {
  const workspace = await seedWorkspace({ repoPrefix: "snooze-ai-" });
  try {
    await workspace.client.setWorkspacePinned(workspace.workspaceId, true);
    await gotoAppShell(page);
    await openSnooze(page, workspace.workspaceId);
    await page.getByTestId("snooze-mode-ai").click();
    await page.getByTestId("snooze-condition").fill("The deployment is healthy");
    await page.getByTestId("workspace-snooze-submit").click();
    await expect(row(page, workspace.workspaceId)).toHaveCount(0);
    await page.getByText("Show all", { exact: true }).click();
    await openSnooze(page, workspace.workspaceId);
    await expect(page.getByTestId("snooze-condition")).toHaveValue("The deployment is healthy");
    await expect(page.getByTestId("workspace-snooze-dialog")).toContainText("Couldn’t determine");
    await page.screenshot({ path: testInfo.outputPath("snooze-ai.png") });
    await page.getByTestId("workspace-snooze-dialog").getByText("Cancel", { exact: true }).click();
    await workspace.client.setWorkspacePinned(workspace.workspaceId, false);
    await selectSidebarStatusGrouping(page);
    await expect(row(page, workspace.workspaceId)).toHaveCount(0);
    await page.getByText("Show all", { exact: true }).click();
    await expect(row(page, workspace.workspaceId)).toContainText("Snoozed");
  } finally {
    await workspace.cleanup();
  }
});

test("a rejected save keeps the dialog and exposes the daemon error", async ({ page }) => {
  const workspace = await seedWorkspace({ repoPrefix: "snooze-rejected-" });
  try {
    await gotoAppShell(page);
    await openSnooze(page, workspace.workspaceId);
    await workspace.client.archiveWorkspace(workspace.workspaceId);
    await page.getByTestId("workspace-snooze-submit").click();
    await expect(page.getByTestId("snooze-error")).toHaveText(
      "Archived workspaces cannot be snoozed",
    );
    await expect(page.getByTestId("workspace-snooze-submit")).toBeEnabled();
  } finally {
    await workspace.cleanup();
  }
});

test("custom date validates time and stays usable at compact width", async ({ page }, testInfo) => {
  const workspace = await seedWorkspace({ repoPrefix: "snooze-custom-" });
  try {
    await gotoAppShell(page);
    await openSnooze(page, workspace.workspaceId);
    await page.getByTestId("snooze-preset-custom").click();
    await page.getByTestId("snooze-custom-time").fill("25:00");
    await page.getByTestId("workspace-snooze-submit").click();
    await expect(page.getByTestId("snooze-error")).toHaveText(
      "Choose a valid future date and time",
    );
    await page.getByTestId("snooze-custom-time").fill("10:30");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("snooze-custom-time")).toHaveValue("10:30");
    await page.getByTestId("snooze-custom-time").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("workspace-snooze-submit")).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath("snooze-custom-compact.png") });
    await page.getByTestId("workspace-snooze-submit").click();
    await expect(page.getByTestId("workspace-snooze-dialog")).toBeHidden();
  } finally {
    await workspace.cleanup();
  }
});
