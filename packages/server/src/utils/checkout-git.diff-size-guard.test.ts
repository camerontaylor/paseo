import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { CHECKOUT_DIFF_MAX_STRUCTURED_BYTES, getCheckoutDiff } from "./checkout-git.js";

// Classification adds wire data after the initial diff-size accounting, so the cap
// has to be re-checked afterwards. Reaching 24 MB of classified structured diff
// with a real repository would need a fixture far larger than a unit test can
// build, so this file scopes a mock of the classifier: the payload fits before
// classification and exceeds the cap only because of what classification adds.
// The mock lives in its own file so the real classifier stays in force for
// checkout-git.test.ts.
const { inflateFiles } = vi.hoisted(() => ({
  inflateFiles: { enabled: false, bytesPerFile: 0 },
}));

vi.mock("../git/change-stats/read.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../git/change-stats/read.js")>();
  return {
    ...actual,
    addFileBreakdowns: async (input: { files: { path: string }[] }) => {
      if (!inflateFiles.enabled) return { analyzed: input.files.length, contentSkipped: 0 };
      // Simulate the wire growth classification causes: the real classifier adds a
      // breakdown to every file on top of the payload that was already accounted for.
      const padding = "x".repeat(inflateFiles.bytesPerFile);
      for (const file of input.files) {
        (file as { breakdown?: unknown }).breakdown = {
          other: { additions: 1, deletions: 0 },
          padding,
        };
      }
      return { analyzed: input.files.length, contentSkipped: 0 };
    },
  };
});

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  inflateFiles.enabled = false;
  inflateFiles.bytesPerFile = 0;
});

function initRepo(): string {
  const tempDir = realpathSync.native(mkdtempSync(join(tmpdir(), "diff-size-guard-")));
  tempDirs.push(tempDir);
  const repoDir = join(tempDir, "repo");
  mkdirSync(repoDir, { recursive: true });
  git(repoDir, ["init", "-b", "main"]);
  git(repoDir, ["config", "user.email", "test@test.com"]);
  git(repoDir, ["config", "user.name", "Test User"]);
  return repoDir;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd }).toString();
}

it("rejects a structured diff that only exceeds the cap because of classification", async () => {
  const repoDir = initRepo();
  writeFileSync(join(repoDir, "one.txt"), "hello\n");
  git(repoDir, ["add", "."]);
  git(repoDir, ["-c", "commit.gpgsign=false", "commit", "-m", "initial"]);
  writeFileSync(join(repoDir, "one.txt"), "hello again\n");

  const withinCap = await getCheckoutDiff(repoDir, {
    mode: "uncommitted",
    includeStructured: true,
  });
  const unclassifiedBytes = Buffer.byteLength(JSON.stringify(withinCap.structured), "utf8");
  expect(unclassifiedBytes).toBeLessThan(CHECKOUT_DIFF_MAX_STRUCTURED_BYTES);

  inflateFiles.enabled = true;
  inflateFiles.bytesPerFile = CHECKOUT_DIFF_MAX_STRUCTURED_BYTES;
  const rejected = await getCheckoutDiff(repoDir, { mode: "uncommitted", includeStructured: true });

  expect(rejected).toEqual({ diff: "", structured: [], diffTooLarge: true });
});

it("keeps the declared cap for the unclassified payload", () => {
  expect(CHECKOUT_DIFF_MAX_STRUCTURED_BYTES).toBe(24_117_208);
});
