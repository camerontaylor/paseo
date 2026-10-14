import { mkdtemp, mkdir, writeFile, rm, rename, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { productionStat } from "@getpaseo/protocol/diff-stat";
import {
  runGitCommand,
  type GitCommandResult,
  type RunGitCommand,
} from "../../utils/run-git-command.js";
import { parseNumstat, readComparisonBreakdown, readFileBreakdown } from "./read.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((cwd) => rm(cwd, { recursive: true, force: true })));
});
function gitResult(stdout: string, truncated = false): GitCommandResult {
  return { stdout, stderr: "", truncated, exitCode: 0, signal: null };
}
function recordingLogger() {
  const info = vi.fn();
  const warn = vi.fn();
  return { info, warn, logger: { info, warn }, infoPayload: () => info.mock.calls[0]?.[0] };
}
async function bareDirectory() {
  const cwd = await mkdtemp(join(tmpdir(), "paseo-change-stats-"));
  roots.push(cwd);
  return cwd;
}
async function repository() {
  const cwd = await mkdtemp(join(tmpdir(), "paseo-change-stats-"));
  roots.push(cwd);
  await runGitCommand(["init", "-b", "main"], { cwd });
  await runGitCommand(["config", "user.email", "test@example.com"], { cwd });
  await runGitCommand(["config", "user.name", "Test"], { cwd });
  return cwd;
}
it("partitions real tracked and untracked changes including deleted source", async () => {
  const cwd = await repository();
  await mkdir(join(cwd, "src"));
  await writeFile(join(cwd, "src/a.ts"), "const a = 1; // before\n");
  await writeFile(join(cwd, "README.md"), "before\n");
  await writeFile(join(cwd, "src/deleted.ts"), "// removed comment\nconst gone = 1;\n");
  await runGitCommand(["add", "."], { cwd });
  await runGitCommand(["commit", "-m", "initial"], { cwd });
  await writeFile(join(cwd, "src/a.ts"), "const a = 1; // after\n");
  await writeFile(join(cwd, "README.md"), "after\n");
  await rm(join(cwd, "src/deleted.ts"));
  await writeFile(join(cwd, "src/new.test.ts"), "// a test\nconst test = 1;\n");
  const breakdown = await readComparisonBreakdown({
    cwd,
    baseRef: "HEAD",
    total: { additions: 4, deletions: 4 },
  });
  expect(breakdown.comments).toEqual({ additions: 1, deletions: 2 });
  expect(breakdown.docs).toEqual({ additions: 1, deletions: 1 });
  expect(breakdown.tests).toEqual({ additions: 2, deletions: 0 });
  expect(productionStat(breakdown)).toEqual({ additions: 0, deletions: 1 });
  expect(breakdown.other).toEqual({ additions: 0, deletions: 0 });
  await writeFile(join(cwd, "src/a.ts"), "const a = 2; // after\n");
  const changed = await readComparisonBreakdown({
    cwd,
    baseRef: "HEAD",
    total: { additions: 4, deletions: 4 },
  });
  expect(productionStat(changed)).toEqual({ additions: 1, deletions: 2 });
  expect(changed.comments).toEqual({ additions: 0, deletions: 1 });
});
it("handles renamed paths containing tabs and spaces", async () => {
  const cwd = await repository();
  const oldPath = "old file\tname.ts";
  const path = "new file\tname.ts";
  await writeFile(join(cwd, oldPath), "const a = 1;\nconst b = 2;\nconst c = 3; // before\n");
  await runGitCommand(["add", "."], { cwd });
  await runGitCommand(["commit", "-m", "initial"], { cwd });
  await rename(join(cwd, oldPath), join(cwd, path));
  await writeFile(join(cwd, path), "const a = 1;\nconst b = 2;\nconst c = 3; // after\n");
  await runGitCommand(["add", "."], { cwd });
  const logger = recordingLogger();
  const result = await readComparisonBreakdown({
    cwd,
    baseRef: "HEAD",
    total: { additions: 1, deletions: 1 },
    largeDiffPathThreshold: 0,
    logger: logger.logger,
  });
  expect(result.comments).toEqual({ additions: 1, deletions: 1 });
  // The renamed record is matched by its new path even though git renders it
  // quoted with an escaped tab.
  expect(logger.infoPayload()).toMatchObject({ patchMatched: 1, patchUnmatched: 0 });
});
it("parses NUL-delimited numstat without corrupting paths", () => {
  const files = parseNumstat("1\t2\t\0old\tfile.ts\0new\nfile.ts\0-\t-\timage.png\0");
  expect(files[0]).toMatchObject({
    path: "new\nfile.ts",
    oldPath: "old\tfile.ts",
    additions: 1,
    deletions: 2,
  });
  expect(files[1]).toMatchObject({ path: "image.png", additions: 0, deletions: 0 });
});

it("keeps every categorization Git command read-only across comparison and file reads", async () => {
  const cwd = await repository();
  await writeFile(join(cwd, "a.ts"), "const a = 1;\n");
  await runGitCommand(["add", "."], { cwd });
  await runGitCommand(["commit", "-m", "initial"], { cwd });
  await writeFile(join(cwd, "a.ts"), "const a = 2;\n");
  const commands: string[][] = [];
  const readOnlyGit: RunGitCommand = async (args, options) => {
    expect(options.envOverlay).toMatchObject({ GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" });
    commands.push(args);
    return runGitCommand(args, options);
  };
  const result = await readComparisonBreakdown({
    cwd,
    baseRef: "HEAD",
    runGit: readOnlyGit,
    total: { additions: 1, deletions: 1 },
  });
  expect(productionStat(result)).toEqual({ additions: 1, deletions: 1 });
  const file = parseNumstat("1\t1\ta.ts\0")[0];
  const perFile = await readFileBreakdown({
    cwd,
    baseRef: "HEAD",
    file,
    loadPatch: true,
    runGit: readOnlyGit,
  });
  expect(productionStat(perFile)).toEqual({ additions: 1, deletions: 1 });
  await readFileBreakdown({ cwd, baseRef: "HEAD", targetRef: "HEAD", file, runGit: readOnlyGit });
  expect(commands.map((args) => args[0])).toEqual([
    "diff",
    "diff",
    "show",
    "ls-files",
    "show",
    "--literal-pathspecs",
    "show",
    "show",
  ]);
});

it("does not overcount concurrent immutable reads when evicting cached contents", async () => {
  const cwd = await repository();
  await writeFile(join(cwd, "a.ts"), `// ${"x".repeat(600_000)}\n`);
  await runGitCommand(["add", "."], { cwd });
  await runGitCommand(["commit", "-m", "initial"], { cwd });
  const baseRef = (await runGitCommand(["rev-parse", "HEAD"], { cwd })).stdout.trim();
  const barrier = Promise.withResolvers<void>();
  let completed = 0;
  const concurrentGit: RunGitCommand = async (args, options) => {
    const result = await runGitCommand(args, options);
    if (++completed === 16) barrier.resolve();
    await barrier.promise;
    return result;
  };
  const file = { ...parseNumstat("0\t1\ta.ts\0")[0], isDeleted: true };
  const results = await Promise.all(
    Array.from({ length: 16 }, () =>
      readFileBreakdown({ cwd, baseRef, file, runGit: concurrentGit }),
    ),
  );
  expect(results).toHaveLength(16);
  const cached = await readFileBreakdown({ cwd, baseRef, file, runGit: concurrentGit });
  expect(cached).toEqual(results[0]);
  expect(completed).toBe(16);
});

it("reports tracked and untracked budgets separately", async () => {
  const cwd = await repository();
  await mkdir(join(cwd, "src"));
  await writeFile(join(cwd, "src/one.ts"), "const one = 1; // before\n");
  await writeFile(join(cwd, "src/two.ts"), "const two = 2; // before\n");
  await writeFile(join(cwd, "script.sh"), "#!/bin/sh\n");
  await runGitCommand(["add", "."], { cwd });
  await runGitCommand(["commit", "-m", "initial"], { cwd });
  await writeFile(join(cwd, "src/one.ts"), "const one = 1; // after\n");
  await writeFile(join(cwd, "src/two.ts"), "const two = 2; // after\n");
  // A mode change counts as a path with zero changed lines, so its content is
  // never analysed.
  await chmod(join(cwd, "script.sh"), 0o755);
  await writeFile(join(cwd, "src/untracked-a.ts"), "// a\nconst a = 1;\n");
  await writeFile(join(cwd, "src/untracked-b.ts"), "// b\nconst b = 1;\n");
  const logger = recordingLogger();
  const breakdown = await readComparisonBreakdown({
    cwd,
    baseRef: "HEAD",
    total: { additions: 6, deletions: 2 },
    largeDiffPathThreshold: 0,
    logger: logger.logger,
  });
  expect(logger.warn).not.toHaveBeenCalled();
  expect(logger.info).toHaveBeenCalledTimes(1);
  expect(logger.infoPayload()).toMatchObject({
    pathCount: 5,
    analyzedCount: 5,
    cappedCount: 0,
    patchMatched: 3,
    patchUnmatched: 0,
    truncatedPatch: false,
    truncatedUntracked: false,
    reconciledFallback: false,
    tracked: { considered: 3, analyzed: 3, capped: 0, contentSkipped: 1 },
    untracked: { considered: 2, analyzed: 2, capped: 0, contentSkipped: 0 },
  });
  expect(breakdown.other).toEqual({ additions: 0, deletions: 0 });
});

it("caps the tracked budget without reading content past it", async () => {
  const cwd = await bareDirectory();
  const files = Array.from({ length: 520 }, (_, index) => `f${index}.ts`);
  await Promise.all(files.map((path) => writeFile(join(cwd, path), "const value = 1;\n")));
  const reads: string[] = [];
  const git: RunGitCommand = async (args) => {
    if (args.includes("--numstat"))
      return gitResult(files.map((path) => `1\t0\t${path}`).join("\0") + "\0");
    if (args[0] === "diff") return gitResult("");
    if (args[0] === "show") {
      reads.push(args[1]);
      return gitResult("const value = 1;\n");
    }
    if (args[0] === "ls-files") return gitResult("");
    throw new Error(`unexpected git call: ${args.join(" ")}`);
  };
  const logger = recordingLogger();
  const breakdown = await readComparisonBreakdown({
    cwd,
    baseRef: "HEAD",
    total: { additions: 520, deletions: 0 },
    runGit: git,
    largeDiffPathThreshold: 0,
    logger: logger.logger,
  });
  expect(reads).toHaveLength(500);
  expect(breakdown.code.additions).toBe(520);
  expect(logger.infoPayload()).toMatchObject({
    pathCount: 520,
    analyzedCount: 500,
    cappedCount: 20,
    tracked: { considered: 520, analyzed: 500, capped: 20, contentSkipped: 0 },
    untracked: { considered: 0, analyzed: 0, capped: 0, contentSkipped: 0 },
  });
});

it("caps the untracked budget and keeps capped paths in the totals", async () => {
  const cwd = await bareDirectory();
  const paths = Array.from({ length: 505 }, (_, index) => `u${index}.ts`);
  await Promise.all(paths.map((path) => writeFile(join(cwd, path), "const value = 1;\n")));
  const git: RunGitCommand = async (args) => {
    if (args[0] === "diff") return gitResult("");
    if (args[0] === "ls-files") return gitResult(paths.join("\0") + "\0");
    throw new Error(`unexpected git call: ${args.join(" ")}`);
  };
  const logger = recordingLogger();
  const breakdown = await readComparisonBreakdown({
    cwd,
    baseRef: "HEAD",
    total: { additions: 505, deletions: 0 },
    runGit: git,
    largeDiffPathThreshold: 0,
    logger: logger.logger,
  });
  expect(logger.infoPayload()).toMatchObject({
    pathCount: 505,
    analyzedCount: 500,
    cappedCount: 5,
    truncatedUntracked: false,
    untracked: { considered: 505, analyzed: 500, capped: 5, contentSkipped: 0 },
  });
  // The five capped paths are not analysed, and their lines stay in the totals.
  expect(breakdown.other.additions).toBe(5);
});

it("stays silent below the threshold and warns when the numstat stream is truncated", async () => {
  const quiet = recordingLogger();
  const git: RunGitCommand = async (args) => {
    if (args.includes("--numstat")) return gitResult("1\t1\ta.ts\0");
    if (args[0] === "diff")
      return gitResult(
        "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-// before\n+// after\n",
      );
    if (args[0] === "show") return gitResult("// before\n");
    if (args[0] === "ls-files") return gitResult("");
    throw new Error(`unexpected git call: ${args.join(" ")}`);
  };
  await readComparisonBreakdown({
    cwd: "/nonexistent",
    baseRef: "HEAD",
    total: { additions: 1, deletions: 1 },
    runGit: git,
    logger: quiet.logger,
  });
  expect(quiet.info).not.toHaveBeenCalled();
  expect(quiet.warn).not.toHaveBeenCalled();

  const truncated = recordingLogger();
  const breakdown = await readComparisonBreakdown({
    cwd: "/nonexistent",
    baseRef: "HEAD",
    total: { additions: 3, deletions: 4 },
    runGit: async () => gitResult("", true),
    largeDiffPathThreshold: 0,
    logger: truncated.logger,
  });
  // A truncated stream yields no path count, so the fallback is reported instead
  // of a count that describes work that did not happen.
  expect(truncated.info).not.toHaveBeenCalled();
  expect(truncated.warn).toHaveBeenCalledTimes(1);
  expect(truncated.warn.mock.calls[0][0]).toMatchObject({ reason: "numstat_truncated" });
  expect(breakdown.other).toEqual({ additions: 3, deletions: 4 });
});

it("drops a partial trailing path when the untracked listing is truncated", async () => {
  const cwd = await bareDirectory();
  await writeFile(join(cwd, "a.ts"), "const a = 1;\n");
  await writeFile(join(cwd, "b.ts"), "const b = 1;\n");
  // If the partial name were treated as a real path, its two lines would push the
  // sum past the total and trip the reconciliation fallback.
  await writeFile(join(cwd, "partial"), "// x\n// y\n");
  const git: RunGitCommand = async (args) => {
    if (args[0] === "diff") return gitResult("");
    if (args[0] === "ls-files") return gitResult("a.ts\0b.ts\0partial", true);
    throw new Error(`unexpected git call: ${args.join(" ")}`);
  };
  const logger = recordingLogger();
  const breakdown = await readComparisonBreakdown({
    cwd,
    baseRef: "HEAD",
    total: { additions: 2, deletions: 0 },
    runGit: git,
    largeDiffPathThreshold: 0,
    logger: logger.logger,
  });
  expect(logger.infoPayload()).toMatchObject({
    pathCount: 2,
    analyzedCount: 2,
    cappedCount: 0,
    truncatedUntracked: true,
    reconciledFallback: false,
    untracked: { considered: 2, analyzed: 2, capped: 0, contentSkipped: 0 },
  });
  expect(breakdown.other).toEqual({ additions: 0, deletions: 0 });
});

it("reports the reconciliation fallback when the worktree moved under Git's total", async () => {
  const cwd = await bareDirectory();
  await writeFile(join(cwd, "a.ts"), "const a = 1;\nconst b = 2;\n");
  const git: RunGitCommand = async (args) => {
    if (args.includes("--numstat")) return gitResult("2\t0\ta.ts\0");
    if (args[0] === "diff") return gitResult("");
    if (args[0] === "show") return gitResult("");
    if (args[0] === "ls-files") return gitResult("");
    throw new Error(`unexpected git call: ${args.join(" ")}`);
  };
  const logger = recordingLogger();
  const breakdown = await readComparisonBreakdown({
    cwd,
    baseRef: "HEAD",
    total: { additions: 1, deletions: 0 },
    runGit: git,
    largeDiffPathThreshold: 0,
    logger: logger.logger,
  });
  expect(logger.infoPayload()).toMatchObject({
    reconciledFallback: true,
    pathCount: 1,
    analyzedCount: 1,
  });
  expect(breakdown.other).toEqual({ additions: 1, deletions: 0 });
});

it("refuses a patch record with equal counts but a different path", async () => {
  const git: RunGitCommand = async (args) => {
    if (args.includes("--numstat")) return gitResult("1\t1\tsrc/alpha.ts\0");
    if (args[0] === "diff")
      return gitResult(
        "diff --git a/src/beta.ts b/src/beta.ts\n--- a/src/beta.ts\n+++ b/src/beta.ts\n@@ -1 +1 @@\n-// before\n+const beta = 1;\n",
      );
    if (args[0] === "show") return gitResult("// before\n");
    if (args[0] === "ls-files") return gitResult("");
    throw new Error(`unexpected git call: ${args.join(" ")}`);
  };
  const logger = recordingLogger();
  const breakdown = await readComparisonBreakdown({
    cwd: "/nonexistent",
    baseRef: "HEAD",
    total: { additions: 1, deletions: 1 },
    runGit: git,
    largeDiffPathThreshold: 0,
    logger: logger.logger,
  });
  // Equal counts alone used to attach beta's hunks to alpha, which would have put
  // the removed comment line in `comments`.
  expect(logger.infoPayload()).toMatchObject({ patchMatched: 0, patchUnmatched: 1 });
  expect(breakdown.comments).toEqual({ additions: 0, deletions: 0 });
  expect(breakdown.code).toEqual({ additions: 1, deletions: 1 });
});

it("keeps identity under diff.noprefix when paths are named like prefixes", async () => {
  const cwd = await repository();
  // The comparison patch forces its own `a/`/`b/` prefixes, so this config may not
  // change what the reader parses even though `b/` is a real directory here.
  await runGitCommand(["config", "diff.noprefix", "true"], { cwd });
  await mkdir(join(cwd, "b"));
  await writeFile(join(cwd, "foo.ts"), "// before\n");
  await writeFile(join(cwd, "b/foo.ts"), "const x = 1;\n");
  await runGitCommand(["add", "."], { cwd });
  await runGitCommand(["commit", "-m", "initial"], { cwd });
  await writeFile(join(cwd, "foo.ts"), "// after\n");
  await writeFile(join(cwd, "b/foo.ts"), "const x = 2;\n");
  const logger = recordingLogger();
  const breakdown = await readComparisonBreakdown({
    cwd,
    baseRef: "HEAD",
    total: { additions: 2, deletions: 2 },
    largeDiffPathThreshold: 0,
    logger: logger.logger,
  });
  expect(logger.infoPayload()).toMatchObject({
    pathCount: 2,
    patchMatched: 2,
    patchUnmatched: 0,
  });
  // Each file keeps its own hunks: only foo.ts changed a comment.
  expect(breakdown.comments).toEqual({ additions: 1, deletions: 1 });
  expect(breakdown.code).toEqual({ additions: 1, deletions: 1 });
  expect(breakdown.other).toEqual({ additions: 0, deletions: 0 });
});

it("never strips a prefix-looking directory from a stream without forced prefixes", async () => {
  const git: RunGitCommand = async (args) => {
    if (args.includes("--numstat")) return gitResult("1\t1\tfoo.ts\0");
    // A stream that did not go through the forced prefix pair, e.g. a noprefix
    // patch for the real path `b/foo.ts`.
    if (args[0] === "diff")
      return gitResult(
        "diff --git b/foo.ts b/foo.ts\n--- b/foo.ts\n+++ b/foo.ts\n@@ -1 +1 @@\n-// before\n+const beta = 1;\n",
      );
    if (args[0] === "show") return gitResult("// before\n");
    if (args[0] === "ls-files") return gitResult("");
    throw new Error(`unexpected git call: ${args.join(" ")}`);
  };
  const logger = recordingLogger();
  const breakdown = await readComparisonBreakdown({
    cwd: "/nonexistent",
    baseRef: "HEAD",
    total: { additions: 1, deletions: 1 },
    runGit: git,
    largeDiffPathThreshold: 0,
    logger: logger.logger,
  });
  // `b/foo.ts` must not be reduced to `foo.ts` and attached to a different file.
  expect(logger.infoPayload()).toMatchObject({ patchMatched: 0, patchUnmatched: 1 });
  expect(breakdown.comments).toEqual({ additions: 0, deletions: 0 });
  expect(breakdown.code).toEqual({ additions: 1, deletions: 1 });
});

it("keeps a trailing space in a filename out of another file's identity", async () => {
  const cwd = await repository();
  await writeFile(join(cwd, "foo.ts"), "// before\n");
  await writeFile(join(cwd, "foo.ts "), "const x = 1;\n");
  await runGitCommand(["add", "."], { cwd });
  await runGitCommand(["commit", "-m", "initial"], { cwd });
  await writeFile(join(cwd, "foo.ts"), "// after\n");
  await writeFile(join(cwd, "foo.ts "), "const x = 2;\n");
  const logger = recordingLogger();
  const breakdown = await readComparisonBreakdown({
    cwd,
    baseRef: "HEAD",
    total: { additions: 2, deletions: 2 },
    largeDiffPathThreshold: 0,
    logger: logger.logger,
  });
  // `foo.ts ` is a different file from `foo.ts`; trimming the path would merge
  // them at equal counts. The trailing space also keeps the path category at
  // `other` (no `.ts` extension match), which is what proves the attribution.
  expect(logger.infoPayload()).toMatchObject({
    pathCount: 2,
    patchMatched: 2,
    patchUnmatched: 0,
  });
  expect(breakdown.comments).toEqual({ additions: 1, deletions: 1 });
  expect(breakdown.other).toEqual({ additions: 1, deletions: 1 });
  expect(breakdown.code).toEqual({ additions: 0, deletions: 0 });
});

it("matches quoted non-ASCII paths against raw numstat paths", async () => {
  const cwd = await repository();
  const path = "café-☕.ts";
  await writeFile(join(cwd, path), "const value = 1; // before\n");
  await runGitCommand(["add", "."], { cwd });
  await runGitCommand(["commit", "-m", "initial"], { cwd });
  await writeFile(join(cwd, path), "const value = 1; // after\n");
  const logger = recordingLogger();
  const breakdown = await readComparisonBreakdown({
    cwd,
    baseRef: "HEAD",
    total: { additions: 1, deletions: 1 },
    largeDiffPathThreshold: 0,
    logger: logger.logger,
  });
  expect(logger.infoPayload()).toMatchObject({ patchMatched: 1, patchUnmatched: 0 });
  expect(breakdown.comments).toEqual({ additions: 1, deletions: 1 });
});
