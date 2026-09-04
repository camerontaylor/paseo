import { spawnSync } from "node:child_process";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = 20_000;
const PACKAGE_MANAGERS = new Set(["npm", "pnpm"]);

// The first argument selects the package manager. Workspace installs go through
// pnpm; the global agent-CLI installs still go through npm, which has no pnpm
// equivalent that does not also need a global bin dir on PATH.
function splitCommand(args) {
  if (PACKAGE_MANAGERS.has(args[0])) {
    return { manager: args[0], rest: args.slice(1) };
  }
  return { manager: "npm", rest: args };
}

function runPackageManager(args) {
  const { manager, rest } = splitCommand(args);
  const command = process.platform === "win32" ? `${manager}.cmd` : manager;
  const result = spawnSync(command, rest, {
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`Failed to start ${manager}: ${result.error.message}`);
    return 1;
  }

  return result.status ?? 1;
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function runWithRetry(
  args,
  {
    attempts = DEFAULT_ATTEMPTS,
    backoffMs = DEFAULT_BACKOFF_MS,
    run = runPackageManager,
    sleep = wait,
  } = {},
) {
  let exitCode = 1;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    exitCode = await run(args);
    if (exitCode === 0) {
      return 0;
    }

    if (attempt < attempts) {
      const delayMs = attempt * backoffMs;
      console.warn(
        `${splitCommand(args).manager} failed with exit code ${exitCode}; retrying in ${delayMs / 1000}s (${attempt + 1}/${attempts})`,
      );
      await sleep(delayMs);
    }
  }

  return exitCode;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolvePath(process.argv[1])) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: node scripts/pm-retry.mjs [npm|pnpm] <arguments...>");
    process.exitCode = 2;
  } else {
    process.exitCode = await runWithRetry(args);
  }
}
