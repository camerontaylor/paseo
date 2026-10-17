import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect, type Page } from "../support/fixtures";
import { createTempGitRepo } from "../support/helpers/workspace";
import {
  connectWorkspaceSetupClient,
  openWorkspaceScriptsMenu,
} from "../support/helpers/workspace-setup";
import { getServerId } from "../support/helpers/server-id";
import { buildHostWorkspaceRoute } from "../../src/utils/host-routes";

test("nested package scripts run, appear in the sidebar, and expose their result", async ({
  page,
}, testInfo) => {
  const client = await connectWorkspaceSetupClient();
  const manifest = JSON.stringify({
    scripts: {
      build:
        "node -e \"setInterval(() => { if(require('fs').existsSync('finish')) process.exit(0) }, 50)\"",
    },
  });
  const repo = await createTempGitRepo("package-scripts-", {
    files: [
      { path: "package.json", content: JSON.stringify({ scripts: { build: "echo root" } }) },
      { path: "packages/web/package.json", content: manifest },
    ],
  });
  try {
    const created = await client.createWorkspace({
      source: { kind: "directory", path: repo.path },
    });
    expect(created.error).toBeFalsy();
    const workspaceId = created.workspace!.id;
    await page.goto(buildHostWorkspaceRoute(getServerId(), workspaceId));
    await openWorkspaceScriptsMenu(page);
    const nestedGroup = page.getByTestId("workspace-scripts-group-packages/web/package.json");
    await expect(nestedGroup).toBeVisible();
    const scriptId = "package.json:packages%2Fweb%2Fpackage.json:build";
    const row = page.getByTestId(`workspace-scripts-item-${scriptId}`);
    await expect(row).not.toBeVisible();
    await nestedGroup.click();
    await expect(row).toContainText("build");
    await page.getByTestId(`workspace-scripts-start-${scriptId}`).click();
    await expect(
      page.getByLabel("Script packages/web/build running", { exact: true }).first(),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("running-package-script.png") });
    await page.keyboard.press("Escape");
    await writeFile(join(repo.path, "packages/web/finish"), "done");
    await expect
      .poll(async () => {
        const result = await client.listWorkspaceScripts(workspaceId);
        return result.scripts?.find((script) => script.scriptName === scriptId)?.exitCode;
      })
      .toBe(0);
    await openWorkspaceScriptsMenu(page);
    await nestedGroup.click();
    await expect(row).toContainText("exit 0");
    await expect(page.getByLabel("Script packages/web/build running", { exact: true })).toHaveCount(
      0,
    );
    await page.screenshot({ path: testInfo.outputPath("completed-package-script.png") });

    await page.keyboard.press("Escape");
    await writeFile(join(repo.path, "packages/web/package.json"), "{");
    await openWorkspaceScriptsMenu(page);
    await expect(
      page.getByTestId("workspace-scripts-item-package.json:package.json:build"),
    ).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Retry/ })).not.toBeVisible();
    await page.keyboard.press("Escape");
    await writeFile(join(repo.path, "packages/web/package.json"), manifest);
    await openWorkspaceScriptsMenu(page);
    await nestedGroup.click();
    await expect(row).toBeVisible();
  } finally {
    await client.close();
    await repo.cleanup();
  }
});

test("long script lists stay bounded, scroll, and filter by name", async ({ page }, testInfo) => {
  const client = await connectWorkspaceSetupClient();
  const scripts = Object.fromEntries(
    Array.from({ length: 80 }, (_, index) => [
      `task-${String(index).padStart(2, "0")}`,
      "echo done",
    ]),
  );
  const repo = await createTempGitRepo("script-search-", {
    files: [{ path: "package.json", content: JSON.stringify({ scripts }) }],
  });
  try {
    const created = await client.createWorkspace({
      source: { kind: "directory", path: repo.path },
    });
    expect(created.error).toBeFalsy();
    await page.goto(buildHostWorkspaceRoute(getServerId(), created.workspace!.id));
    await openWorkspaceScriptsMenu(page);
    const menu = page.getByTestId("workspace-scripts-menu");
    const lastRow = page.getByTestId("workspace-scripts-item-package.json:package.json:task-79");
    await expect(lastRow).toBeAttached();
    const bounds = await menu.boundingBox();
    expect(bounds!.height).toBeLessThanOrEqual(422);
    await lastRow.scrollIntoViewIfNeeded();
    await expect(lastRow).toBeInViewport();
    expect((await menu.boundingBox())!.height).toBeLessThanOrEqual(422);
    const search = page.getByTestId("workspace-scripts-search");
    await search.scrollIntoViewIfNeeded();
    await search.fill("TASK-79");
    await expect(menu.locator('[data-testid^="workspace-scripts-item-"]')).toHaveCount(1);
    await expect(lastRow).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath("searched-scripts.png") });
    await search.fill("no-matches");
    await expect(menu).toContainText("No matching scripts");
    await search.fill("");
    await expect(menu.locator('[data-testid^="workspace-scripts-item-"]')).toHaveCount(80);
    await page.screenshot({ path: testInfo.outputPath("scrollable-scripts.png") });
    await page.keyboard.press("Escape");
    // Compact mounts its own header, so start the app at the compact size instead of resizing a
    // mounted desktop header and racing its replacement.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(buildHostWorkspaceRoute(getServerId(), created.workspace!.id));
    await openWorkspaceScriptsMenu(page);
    const sheet = page.getByTestId("workspace-scripts-menu-content");
    await expect(sheet).toBeVisible();
    await page.getByTestId("workspace-scripts-search").fill("task-79");
    await expect(sheet.locator('[data-testid^="workspace-scripts-item-"]')).toHaveCount(1);
    await expect(lastRow).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath("compact-script-search.png") });
  } finally {
    await client.close();
    await repo.cleanup();
  }
});

test("discovers and runs a nested package script from the compact sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const client = await connectWorkspaceSetupClient();
  const repo = await createTempGitRepo("package-scripts-compact-", {
    files: [
      { path: "package.json", content: JSON.stringify({ scripts: { build: "echo root" } }) },
      {
        path: "packages/web/package.json",
        content: JSON.stringify({
          scripts: {
            dev: 'node -e "setInterval(() => {}, 100000)"',
          },
        }),
      },
    ],
  });
  try {
    const created = await client.createWorkspace({
      source: { kind: "directory", path: repo.path },
    });
    expect(created.error).toBeFalsy();
    const workspaceId = created.workspace!.id;
    await page.goto(buildHostWorkspaceRoute(getServerId(), workspaceId));

    await runDiscoveredScriptFromCompactHeader(page);
  } finally {
    await client.close();
    await repo.cleanup();
  }
});

test("keeps compact script discovery working after a desktop to compact resize", async ({ page }) => {
  const client = await connectWorkspaceSetupClient();
  const repo = await createTempGitRepo("package-scripts-resize-", {
    files: [
      { path: "package.json", content: JSON.stringify({ scripts: { build: "echo root" } }) },
      {
        path: "packages/web/package.json",
        content: JSON.stringify({
          scripts: {
            dev: 'node -e "setInterval(() => {}, 100000)"',
          },
        }),
      },
    ],
  });
  try {
    const created = await client.createWorkspace({
      source: { kind: "directory", path: repo.path },
    });
    expect(created.error).toBeFalsy();
    const workspaceId = created.workspace!.id;
    // Desktop first, then the same mounted app narrows to the compact layout.
    await page.goto(buildHostWorkspaceRoute(getServerId(), workspaceId));
    await expect(page.getByTestId("workspace-scripts-button")).toBeVisible({ timeout: 30_000 });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("workspace-header-menu-trigger")).toBeVisible({ timeout: 30_000 });

    await runDiscoveredScriptFromCompactHeader(page);
  } finally {
    await client.close();
    await repo.cleanup();
  }
});

/** Compact puts scripts on a page of the header menu; discovery still runs on demand. */
async function runDiscoveredScriptFromCompactHeader(page: Page): Promise<void> {
  await page.getByTestId("workspace-header-menu-trigger").click();
  await expect(page.getByTestId("workspace-header-menu")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("workspace-header-scripts").click();
  const scriptId = "package.json:packages%2Fweb%2Fpackage.json:dev";
  const row = page.getByTestId(`workspace-scripts-row-${scriptId}`);
  await expect(row).toContainText("dev", { timeout: 15_000 });
  await row.click();
  await expect(page.locator('[data-testid^="workspace-tab-terminal_"]').first()).toBeAttached({
    timeout: 20_000,
  });
}
