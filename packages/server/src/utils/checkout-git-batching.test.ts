import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { startGitCommandMetrics, stopGitCommandMetrics } from "@server/utils/run-git-command.js";

import { getCheckoutDiff, getCheckoutPlacement, getCheckoutStatus } from "./checkout-git.js";
import { writePaseoWorktreeMetadata } from "./worktree-metadata.js";

function initRepoWithTrackedChanges(fileCount: number): { tempDir: string; repoDir: string } {
  const tempDir = realpathSync(mkdtempSync(join(tmpdir(), "checkout-git-batch-test-")));
  const repoDir = join(tempDir, "repo");

  mkdirSync(repoDir, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir });

  for (let i = 0; i < fileCount; i += 1) {
    writeFileSync(join(repoDir, `file-${i}.txt`), `before-${i}\n`);
  }
  execFileSync("git", ["add", "."], { cwd: repoDir });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "initial"], {
    cwd: repoDir,
  });

  for (let i = 0; i < fileCount; i += 1) {
    writeFileSync(join(repoDir, `file-${i}.txt`), `after-${i}\n`);
  }

  return { tempDir, repoDir };
}

describe("checkout git diff batching", () => {
  let tempDir: string;
  let repoDir: string;

  beforeEach(() => {
    const setup = initRepoWithTrackedChanges(20);
    tempDir = setup.tempDir;
    repoDir = setup.repoDir;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("reads placement without diff, upstream or comparison commands", async () => {
    const status = await getCheckoutStatus(repoDir);
    startGitCommandMetrics();
    const placement = await getCheckoutPlacement(repoDir);
    const metrics = stopGitCommandMetrics();
    expect(placement).toEqual({
      isGit: true,
      repoRoot: repoDir,
      mainRepoRoot: null,
      currentBranch: "main",
      remoteUrl: null,
      isPaseoOwnedWorktree: false,
    });
    expect(status).toMatchObject(placement);
    const argumentsUsed = metrics.commands.flatMap(({ args }) => args);
    expect(argumentsUsed).not.toEqual(expect.arrayContaining(["status"]));
    expect(argumentsUsed).not.toEqual(expect.arrayContaining(["diff"]));
    expect(argumentsUsed).not.toEqual(expect.arrayContaining(["rev-list"]));
    expect(argumentsUsed).not.toEqual(expect.arrayContaining(["for-each-ref"]));
    expect(argumentsUsed).not.toEqual(expect.arrayContaining(["show-ref"]));
  });

  it.each([false, true])("preserves placement for a worktree (Paseo-owned: %s)", async (owned) => {
    const paseoHome = join(tempDir, "home");
    const worktree = owned
      ? join(paseoHome, "worktrees", "repo", "feature")
      : join(tempDir, "linked");
    execFileSync("git", ["worktree", "add", "-b", "feature", worktree], { cwd: repoDir });
    if (owned) await writePaseoWorktreeMetadata(worktree, { baseRefName: "main" });
    const context = { paseoHome };
    const status = await getCheckoutStatus(worktree, context);
    const placement = await getCheckoutPlacement(worktree, context);
    expect(placement).toMatchObject({
      isGit: true,
      repoRoot: worktree,
      mainRepoRoot: repoDir,
      currentBranch: "feature",
      isPaseoOwnedWorktree: owned,
    });
    expect(status).toMatchObject(placement);
    execFileSync("git", ["checkout", "--detach"], { cwd: worktree });
    expect(await getCheckoutStatus(worktree, context)).toMatchObject(
      await getCheckoutPlacement(worktree, context),
    );
  });

  it("keeps non-repository directories classified as non-Git", async () => {
    expect(await getCheckoutPlacement(tempDir)).toEqual({ isGit: false });
  });

  it("collects ordinary tracked patches with one bounded Git command", async () => {
    startGitCommandMetrics();
    const result = await getCheckoutDiff(repoDir, {
      mode: "uncommitted",
      includeStructured: false,
    });

    expect(result.diff).toContain("file-0.txt");
    expect(result.diff).toContain("file-19.txt");
    const metrics = stopGitCommandMetrics();
    expect(
      metrics.commands.filter(({ args }) => args[0] === "diff" && args.includes("--")),
    ).toHaveLength(1);
  });

  it("batches committed file contents and preserves the highlighted diff", async () => {
    execFileSync("git", ["checkout", "-b", "feature"], { cwd: repoDir });
    execFileSync("git", ["add", "."], { cwd: repoDir });
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "change"], { cwd: repoDir });
    startGitCommandMetrics();
    const result = await getCheckoutDiff(repoDir, {
      mode: "base",
      baseRef: "main",
      includeStructured: true,
    });
    const metrics = stopGitCommandMetrics();
    expect(result.structured).toHaveLength(20);
    expect(result.structured?.every((file) => file.additions === 1 && file.deletions === 1)).toBe(
      true,
    );
    expect(metrics.commands.filter(({ args }) => args[0] === "show")).toHaveLength(0);
    expect(metrics.commands.filter(({ args }) => args[0] === "cat-file")).toHaveLength(1);
  });

  it("keeps small neighbors when a patch exceeds the entire batch budget", async () => {
    writeFileSync(join(repoDir, "file-0.txt"), "x".repeat(9 * 1024 * 1024) + "\n");
    const result = await getCheckoutDiff(repoDir, {
      mode: "uncommitted",
      includeStructured: true,
    });
    expect(result.structured).toHaveLength(20);
    expect(result.structured?.find((file) => file.path === "file-0.txt")).toMatchObject({
      status: "too_large",
      hunks: [],
    });
    expect(result.structured?.filter((file) => file.status === "ok")).toHaveLength(19);
    expect(result.diff).toContain("+after-19");
    expect(result.diff).not.toContain("x".repeat(1_000));
  });
});
