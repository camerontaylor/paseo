#!/usr/bin/env node
// Fleet acceleration is owned by agents; other clones use a normal npm install.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const helper = join(
  process.env.AGENTS_DIR || join(homedir(), ".local", "agents"),
  "scripts",
  "paseo-fork",
  "init-worktree.mjs",
);
const external = existsSync(helper);
if (!external) console.log("init-worktree: fleet helper unavailable; running npm ci");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(
  external ? process.execPath : npmCommand,
  external ? [helper, ...process.argv.slice(2)] : ["ci"],
  {
    cwd: process.env.PASEO_WORKTREE_PATH || process.cwd(),
    stdio: "inherit",
    env: process.env,
    shell: !external && process.platform === "win32",
  },
);
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
