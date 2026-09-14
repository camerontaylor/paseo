#!/usr/bin/env node
// Make a transient git worktree runnable: dependencies, generated build output, tooling.
//
// `npm ci` in this repo installs 2.7 GB and takes minutes, which is the wrong price for a
// worktree that exists for one review or one test run. The default mode instead shares the
// source checkout's third-party packages by symlink and rebuilds only the parts that must be
// worktree-local.
//
// Why not just symlink node_modules wholesale: npm records workspace packages as *relative*
// symlinks (node_modules/@getpaseo/server -> ../../packages/server). Reached through a
// symlinked node_modules, those resolve back into the source checkout, so `import` from
// "@getpaseo/protocol" loads the source checkout's code while the test believes it is
// exercising the worktree. A green run would prove nothing. Every workspace-owned link is
// therefore recreated locally, which is cheap because there are only two such places:
// node_modules/@getpaseo and node_modules/.bin.
//
// Runs through the same stable script shell as any other Paseo lifecycle command (bash on
// macOS/Linux, PowerShell on Windows), so it is Node rather than shell. See
// docs/development.md "paseo.json service scripts".
//
// Usage:
//   node fork/scripts/init-worktree.mjs [--mode=link|install] [--force]
//                                       [--no-dist] [--build] [--no-seed]
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

const isWindows = process.platform === "win32";

const options = parseArgs(process.argv.slice(2));
const { sourceRoot, targetRoot } = resolveRoots();

if (sourceRoot === targetRoot) {
  console.log("init-worktree: this is the source checkout, nothing to do.");
  process.exit(0);
}

console.log(`init-worktree: ${targetRoot}`);
console.log(`  Source:  ${sourceRoot}`);
console.log(`  Mode:    ${options.mode}`);

ensureTooling();
installDependencies();

if (options.seedDist) {
  seedBuildOutput();
}

if (options.seedState) {
  const seed = resolveScript("scripts/seed-worktree-dev-state.mjs");
  if (seed) {
    runNode([seed], { PASEO_SOURCE_CHECKOUT_PATH: sourceRoot });
  }
}

if (options.build) {
  runNpm(["run", "build:server"]);
}

verify();

console.log("init-worktree: ready.");

// ---------------------------------------------------------------------------
// Roots and arguments

function parseArgs(argv) {
  const parsed = {
    mode: process.env.PASEO_WORKTREE_INIT_MODE || "link",
    force: false,
    seedDist: true,
    seedState: true,
    build: false,
  };

  for (const arg of argv) {
    if (arg.startsWith("--mode=")) {
      parsed.mode = arg.slice("--mode=".length);
    } else if (arg === "--force") {
      parsed.force = true;
    } else if (arg === "--no-dist") {
      parsed.seedDist = false;
    } else if (arg === "--no-seed") {
      parsed.seedState = false;
    } else if (arg === "--build") {
      parsed.build = true;
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }

  if (!["link", "install"].includes(parsed.mode)) {
    fail(`Unknown --mode: ${parsed.mode}. Expected link or install.`);
  }

  // A real install produces real dist output; seeding it from the source checkout would
  // only overwrite fresher artifacts with staler ones.
  if (parsed.mode === "install") {
    parsed.seedDist = false;
  }

  return parsed;
}

// The worktree is wherever we were invoked. The source checkout is the main worktree, which
// git already knows: --git-common-dir points at the shared .git directory for every worktree.
function resolveRoots() {
  const target = realpath(process.env.PASEO_WORKTREE_PATH || process.cwd());

  const declared = process.env.PASEO_SOURCE_CHECKOUT_PATH;
  if (declared) {
    return { sourceRoot: realpath(declared), targetRoot: target };
  }

  const commonDir = git(["rev-parse", "--path-format=absolute", "--git-common-dir"], target);
  if (!commonDir) {
    fail(`Not a git worktree: ${target}`);
  }

  return { sourceRoot: realpath(dirname(commonDir)), targetRoot: target };
}

// ---------------------------------------------------------------------------
// Tooling

function ensureTooling() {
  trustMise();
  checkNodeVersion();
}

// mise records trust per absolute config path, so a fresh worktree is untrusted even though
// its .mise.toml is byte-identical to the checkout it was cut from, and every mise entry
// point in the worktree fails until it is trusted. scripts/worktree-trust-mise.sh owns the
// detail; it is bash, so on Windows we rely on mise being absent or already configured.
function trustMise() {
  const script = resolveScript("scripts/worktree-trust-mise.sh");
  if (isWindows || !script) {
    return;
  }

  const result = spawnSync("bash", [script], {
    cwd: targetRoot,
    stdio: "inherit",
    env: { ...process.env, PASEO_WORKTREE_PATH: targetRoot },
  });

  if (result.status !== 0) {
    fail("mise trust failed; run `mise trust` in the worktree and retry.");
  }

  console.log("  Tools:   mise config trusted");
}

// Node is the only pinned tool the dependency graph and the test run actually need; rust,
// java and android-sdk are for native app builds and are not this script's business.
function checkNodeVersion() {
  const pinned = readToolVersion("nodejs");
  if (!pinned) {
    return;
  }

  const running = process.versions.node;
  if (running === pinned) {
    console.log(`  Tools:   node ${running}`);
    return;
  }

  const [pinnedMajor] = pinned.split(".");
  const [runningMajor] = running.split(".");

  if (pinnedMajor !== runningMajor) {
    fail(
      `node ${running} does not match the pinned major ${pinned} (.tool-versions).\n` +
        "  Run `mise install` in the worktree, or re-run under the pinned toolchain.",
    );
  }

  console.log(`  Tools:   node ${running} (pinned ${pinned}, same major)`);
}

function readToolVersion(tool) {
  const file = join(targetRoot, ".tool-versions");
  if (!existsSync(file)) {
    return null;
  }

  for (const line of readFileSync(file, "utf8").split("\n")) {
    const [name, version] = line.trim().split(/\s+/);
    if (name === tool && version) {
      return version;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Dependencies

function installDependencies() {
  if (options.mode === "install") {
    runNpm(["ci"]);
    return;
  }

  const rootModules = join(targetRoot, "node_modules");
  if (existsSync(rootModules) && !options.force) {
    console.log("  Deps:    skipped (node_modules already present; --force to rebuild)");
    return;
  }

  const sourceModules = join(sourceRoot, "node_modules");
  if (!existsSync(sourceModules)) {
    fail(
      `${sourceModules} is missing, so there is nothing to share.\n` +
        "  Run `npm ci` in the source checkout, or re-run with --mode=install.",
    );
  }

  removeIfPresent(rootModules);
  linkRootNodeModules(sourceModules, rootModules);
  linkPackageNodeModules();
}

// Share every third-party package with the source checkout, but rebuild the two directories
// that contain workspace-owned links. Both are rebuilt by copying each symlink's *text*
// rather than its resolved path: the text is relative, so ../../packages/server and
// ../@getpaseo/cli/bin/paseo re-anchor to the worktree for free.
function linkRootNodeModules(sourceModules, targetModules) {
  mkdirSync(targetModules, { recursive: true });

  let shared = 0;
  for (const entry of readdirSync(sourceModules)) {
    const from = join(sourceModules, entry);
    const to = join(targetModules, entry);

    if (entry === ".bin" || entry === "@getpaseo") {
      mirrorLinkTree(from, to);
      continue;
    }

    // Plain file (.package-lock.json). Copy it so `npm ls` and tools that read the install
    // manifest see a worktree-local file rather than writing through to the source checkout.
    if (lstatSync(from).isFile()) {
      copyFileSync(from, to);
      continue;
    }

    link(from, to);
    shared += 1;
  }

  console.log(`  Deps:    shared ${shared} packages from the source checkout`);
}

// Per-package node_modules hold only non-hoistable third-party packages — no workspace links
// and no bins that escape their own directory — so they can be shared whole.
function linkPackageNodeModules() {
  const packagesDir = join(sourceRoot, "packages");
  if (!existsSync(packagesDir)) {
    return;
  }

  let count = 0;
  for (const pkg of readdirSync(packagesDir)) {
    const from = join(packagesDir, pkg, "node_modules");
    if (!existsSync(from)) {
      continue;
    }

    const to = join(targetRoot, "packages", pkg, "node_modules");
    if (!existsSync(dirname(to))) {
      continue;
    }

    removeIfPresent(to);
    link(from, to);
    count += 1;
  }

  console.log(`  Deps:    shared ${count} per-package node_modules`);
}

// Recreate a directory of symlinks preserving each link's target text verbatim.
function mirrorLinkTree(from, to) {
  mkdirSync(to, { recursive: true });

  for (const entry of readdirSync(from)) {
    const source = join(from, entry);
    const target = join(to, entry);
    const stat = lstatSync(source);

    if (stat.isSymbolicLink()) {
      symlinkSync(readlinkSync(source), target, isWindows ? "junction" : undefined);
      continue;
    }

    // Windows shims (.cmd/.ps1) and any real file in .bin.
    cpSync(source, target, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Build output

// dist/ is gitignored, so a fresh worktree has none and every cross-package typecheck fails
// on missing declarations. Copy rather than link: `npm run build:server` writes into these
// directories, and a link would let the worktree overwrite the source checkout's build.
//
// The copy is a snapshot of the source checkout at init time. It unblocks typecheck and
// type-only tests immediately; run `npm run build:server` (or pass --build) before trusting
// anything that executes built output.
function seedBuildOutput() {
  const packagesDir = join(sourceRoot, "packages");
  if (!existsSync(packagesDir)) {
    return;
  }

  let count = 0;
  for (const pkg of readdirSync(packagesDir)) {
    const from = join(packagesDir, pkg, "dist");
    const to = join(targetRoot, "packages", pkg, "dist");

    if (!existsSync(from) || existsSync(to) || !existsSync(dirname(to))) {
      continue;
    }

    cloneTree(from, to);
    count += 1;
  }

  console.log(`  Build:   seeded ${count} dist directories (snapshot; rebuild before running)`);
}

// APFS and Btrfs can clone a tree in constant time and near-zero space. Both fail across
// devices, and worktrees often live on a different volume than the checkout, so fall back.
function cloneTree(from, to) {
  if (!isWindows) {
    const flag = process.platform === "darwin" ? "-c" : "--reflink=auto";
    const result = spawnSync("cp", [flag, "-R", from, to], { stdio: "ignore" });
    if (result.status === 0) {
      return;
    }
    removeIfPresent(to);
  }

  cpSync(from, to, { recursive: true });
}

// ---------------------------------------------------------------------------
// Verification

// The failure this guards against is silent: if @getpaseo/* resolves into the source
// checkout, tests pass against the wrong tree. Assert resolution lands inside the worktree.
function verify() {
  const scope = join(targetRoot, "node_modules", "@getpaseo");
  if (!existsSync(scope)) {
    fail("node_modules/@getpaseo is missing after setup.");
  }

  for (const entry of readdirSync(scope)) {
    const path = join(scope, entry);

    // existsSync follows the link, so this is the dangling-link check. It has to come first:
    // realpath() below falls back to the unresolved path when resolution throws, which would
    // otherwise let a dangling worktree-local link pass the containment test vacuously.
    if (!existsSync(path)) {
      fail(`@getpaseo/${entry} is a dangling symlink. Re-run with --force.`);
    }

    const resolved = realpath(path);
    if (resolved !== targetRoot && !resolved.startsWith(targetRoot + sep)) {
      fail(
        `@getpaseo/${entry} resolves outside the worktree:\n` +
          `    ${resolved}\n` +
          "  Tests would run against the source checkout. Re-run with --force.",
      );
    }
  }

  for (const bin of ["tsgo", "zod-aot", "vitest"]) {
    const path = join(targetRoot, "node_modules", ".bin", bin);
    if (!existsSync(path)) {
      fail(`node_modules/.bin/${bin} is missing or dangling after setup.`);
    }
  }

  console.log("  Verify:  workspace packages resolve inside the worktree");
}

// ---------------------------------------------------------------------------
// Helpers

// A transient worktree is often cut from a commit that predates these helper scripts, and
// this one is routinely invoked from the source checkout against such a worktree. Prefer the
// worktree's own copy so an old checkout gets its own setup logic, then fall back.
function resolveScript(relativePath) {
  for (const root of [targetRoot, sourceRoot]) {
    const candidate = join(root, relativePath);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function link(from, to) {
  symlinkSync(from, to, isWindows ? "junction" : undefined);
}

function removeIfPresent(path) {
  // lstat, not exists: a dangling symlink reports as missing but still blocks symlinkSync.
  try {
    lstatSync(path);
  } catch {
    return;
  }
  rmSync(path, { recursive: true, force: true });
}

function realpath(path) {
  try {
    return realpathSync(resolve(path));
  } catch {
    return resolve(path);
  }
}

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function runNpm(args) {
  run(isWindows ? "npm.cmd" : "npm", args);
}

function runNode(args, env) {
  run(process.execPath, args, env);
}

function run(command, args, env) {
  console.log(`  Run:     ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: targetRoot,
    stdio: "inherit",
    env: { ...process.env, PASEO_WORKTREE_PATH: targetRoot, ...env },
  });

  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed with exit code ${result.status}.`);
  }
}

function fail(message) {
  console.error(`init-worktree: ${message}`);
  process.exit(1);
}
