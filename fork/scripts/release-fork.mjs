#!/usr/bin/env node
// Fork release tooling — fork/plans/ralplan-fork-release-channel.md, Sitting 1 step 2.
//
// Stages a clean copy of the release commit (git archive HEAD), renames the 7
// publishable workspace packages to @<scope>/paseo-* @ <base>.fork.N, rebuilds
// inside the staged tree (release:check subset), reproduces the stock prepack
// artifacts (the daemon web UI export into the server dist), rewrites
// compiled dist specifiers and shipped docs/bin that name the upstream scope,
// then runs the pack-list gate (zero `"@getpaseo/` occurrences across the
// files npm pack would ship, plus a web-ui presence assertion for the server
// package) and npm pack --dry-run for all 7. Every pack/publish invocation
// runs with --ignore-scripts so no prepack can rebuild dist from unrewritten
// source after the gate passed.
//
// Dry-run is the default and never publishes. Real publishing requires BOTH
// --publish and --yes-i-am-publishing; without the second flag the script only
// prints the exact commands and refuses.

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Single source of truth for the publish scope (approval-gate confirmation):
// resolved once at startup via resolveForkScope() and never hardcoded elsewhere.
const DEFAULT_FORK_SCOPE = "@paseo-fork";
const UPSTREAM_SCOPE = "@getpaseo/";
const RELEASE_PACKAGES = ["highlight", "relay", "protocol", "client", "plugin", "server", "cli"];
const QUOTED_SPECIFIER_NEEDLE = `"${UPSTREAM_SCOPE}`;
const BACKTICK_SPECIFIER_NEEDLE = `\`${UPSTREAM_SCOPE}`;
const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
// Lifecycle scripts are disabled on EVERY pack/publish invocation (flag
// parity): stock packages define prepack (a clean rebuild; the server one also
// exports the daemon web UI) which would rebuild dist from the unrewritten
// staged source and resurrect "@getpaseo/" specifiers AFTER the gate passed.
// The staged flow reproduces those prepack artifacts itself instead.
export const SCRIPTS_DISABLED = ["--ignore-scripts"];

export function gatePackArgs(forkName) {
  return ["pack", "--dry-run", "--json", ...SCRIPTS_DISABLED, `--workspace=${forkName}`];
}

export function tarballPackArgs(forkName, destination) {
  return [
    "pack",
    ...SCRIPTS_DISABLED,
    `--workspace=${forkName}`,
    "--pack-destination",
    destination,
  ];
}

export function publishArgs(forkName) {
  return ["publish", ...SCRIPTS_DISABLED, `--workspace=${forkName}`, "--tag", "fork"];
}

export function resolveForkScope(env = process.env) {
  const scope = env.FORK_SCOPE ?? DEFAULT_FORK_SCOPE;
  if (!/^@[a-z0-9][a-z0-9._-]*$/i.test(scope)) {
    throw new Error(`Invalid fork scope: ${scope}`);
  }
  return scope;
}

export function forkPackageName(name, forkScope) {
  if (typeof name !== "string" || !name.startsWith(UPSTREAM_SCOPE)) return name;
  return `${forkScope}/paseo-${name.slice(UPSTREAM_SCOPE.length)}`;
}

export function computeForkVersion(baseVersion, forkNumber) {
  return `${baseVersion}.fork.${forkNumber}`;
}

export function rewritePackageJsonDoc(doc, { forkScope, baseVersion, forkVersion }) {
  const out = structuredClone(doc);
  out.name = forkPackageName(out.name, forkScope);
  if (out.version === baseVersion) {
    out.version = forkVersion;
  }
  rewriteWorkspaceScripts(out, { forkScope });
  for (const field of DEP_FIELDS) {
    const deps = out[field];
    if (!deps) continue;
    const next = {};
    for (const [name, spec] of Object.entries(deps)) {
      next[forkPackageName(name, forkScope)] = spec === baseVersion ? forkVersion : spec;
    }
    out[field] = next;
  }
  return out;
}

// Package and root scripts reference sibling workspaces by name (e.g. the
// client build runs `npm run build --workspace=@getpaseo/protocol`); npm
// resolves --workspace against the renamed staged manifests, so rewrite the
// tokens of the renamed packages only — non-release workspaces (app, desktop,
// website, expo-two-way-audio) keep their names and must stay resolvable (the
// daemon web UI export runs `build:app-deps`, which needs expo-two-way-audio).
function rewriteWorkspaceTokens(text, { forkScope }) {
  let out = text;
  for (const name of RELEASE_PACKAGES) {
    out = out.replaceAll(`${UPSTREAM_SCOPE}${name}`, `${forkScope}/paseo-${name}`);
  }
  return out;
}

function rewriteWorkspaceScripts(doc, { forkScope }) {
  if (doc.scripts) {
    for (const [key, value] of Object.entries(doc.scripts)) {
      if (typeof value === "string") {
        doc.scripts[key] = rewriteWorkspaceTokens(value, { forkScope });
      }
    }
  }
  return doc;
}

// The root manifest is private and never published; only its scripts reference
// the workspace packages (by name, unquoted), so only the scripts are rewritten.
export function rewriteRootPackageJsonDoc(doc, { forkScope }) {
  return rewriteWorkspaceScripts(structuredClone(doc), { forkScope });
}

// Compiled output quotes module specifiers with double quotes (error-message
// prose is unquoted and harmless); the backtick form only appears in copied
// markdown (skills docs) and is rewritten so shipped docs name the fork scope.
export function rewriteSpecifiersInText(text, { forkScope }) {
  return text
    .replaceAll(QUOTED_SPECIFIER_NEEDLE, `"${forkScope}/paseo-`)
    .replaceAll(BACKTICK_SPECIFIER_NEEDLE, `\`${forkScope}/paseo-`);
}

function countOccurrences(buffer, needle) {
  let count = 0;
  let index = buffer.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = buffer.indexOf(needle, index + needle.length);
  }
  return count;
}

function rewriteTextFileSpecifiers(filePath, { forkScope }) {
  const buffer = readFileSync(filePath);
  const hits =
    countOccurrences(buffer, QUOTED_SPECIFIER_NEEDLE) +
    countOccurrences(buffer, BACKTICK_SPECIFIER_NEEDLE);
  if (hits === 0) return 0;
  const text = buffer.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(buffer)) {
    throw new Error(`Non-text file contains a quoted "${UPSTREAM_SCOPE}" specifier: ${filePath}`);
  }
  writeFileSync(filePath, rewriteSpecifiersInText(text, { forkScope }));
  return hits;
}

export function rewriteShippedFileSpecifiers(filePath, context) {
  return existsSync(filePath) ? rewriteTextFileSpecifiers(filePath, context) : 0;
}

// Walks any shipped directory (dist/, bin/): rewrites quoted module specifiers
// in text files, refuses binary files that contain the pattern.
export function rewriteDistSpecifiers(distDir, context) {
  let filesScanned = 0;
  let filesRewritten = 0;
  let occurrences = 0;
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(filePath);
        continue;
      }
      filesScanned += 1;
      const hits = rewriteTextFileSpecifiers(filePath, context);
      if (hits === 0) continue;
      filesRewritten += 1;
      occurrences += hits;
    }
  };
  if (existsSync(distDir)) visit(distDir);
  return { filesScanned, filesRewritten, occurrences };
}

export function parsePackFilePaths(stdout) {
  // lifecycle scripts (e.g. a prepack generate step) can print to stdout before
  // the --json payload; parse from the first JSON value instead of trusting
  // stdout to be pure JSON.
  const start = stdout.search(/[[{]/);
  if (start === -1) {
    throw new Error("npm pack produced no JSON output");
  }
  const parsed = JSON.parse(stdout.slice(start));
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  return entries.flatMap((entry) => (entry.files ?? []).map((file) => file.path));
}

// The gate scans the CONTENT of every file npm pack would ship — pack-list
// scoping, not merely dist/, because the server package also ships skills/,
// shell-integration, README.md and .env.example.
export function scanPackListFiles({ packageDir, paths, needle = QUOTED_SPECIFIER_NEEDLE }) {
  const violations = [];
  for (const relPath of paths) {
    const count = countOccurrences(readFileSync(path.join(packageDir, relPath)), needle);
    if (count > 0) violations.push({ path: relPath, count });
  }
  return violations;
}
// The stock server tarball ships the daemon web UI (its prepack exports the
// browser app into dist/server/web-ui, included via files: ["dist/server"]);
// its absence in the pack list means the fork artifact silently drops the
// PASEO_WEB_UI feature.
export const SERVER_WEB_UI_PACK_PREFIX = "dist/server/web-ui/";

export function assertWebUiAssetsInPackList(paths, prefix = SERVER_WEB_UI_PACK_PREFIX) {
  if (!paths.some((packPath) => packPath.startsWith(prefix))) {
    throw new Error(
      `server pack list is missing ${prefix}* — the daemon web UI would be silently dropped`,
    );
  }
}

export function assertPublishAccess(doc, label) {
  if (doc.publishConfig?.access !== "public") {
    throw new Error(
      `${label}: publishConfig.access must be "public" (scoped packages default to restricted)`,
    );
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function capture(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
  return result.stdout;
}

function repoRootFromScript() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, doc) {
  writeFileSync(filePath, `${JSON.stringify(doc, null, 2)}\n`);
}

function parseArgs(argv) {
  const args = {
    dryRun: true,
    publish: false,
    yesIAmPublishing: false,
    keepStaging: false,
    forkNumber: Number(process.env.FORK_NUMBER ?? 1),
    stagingDir: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--publish") {
      args.publish = true;
    } else if (arg === "--yes-i-am-publishing") {
      args.yesIAmPublishing = true;
    } else if (arg === "--keep-staging") {
      args.keepStaging = true;
    } else if (arg === "--fork-number") {
      i += 1;
      args.forkNumber = Number(argv[i]);
    } else if (arg === "--staging-dir") {
      i += 1;
      args.stagingDir = argv[i];
    } else if (arg !== "--dry-run") {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isInteger(args.forkNumber) || args.forkNumber < 1) {
    throw new Error(`--fork-number must be a positive integer, got ${args.forkNumber}`);
  }
  return args;
}

function publishCommands({ forkScope, forkVersion, branch, notesPath, tarballDir }) {
  return [
    ...RELEASE_PACKAGES.map((name) => `npm ${publishArgs(`${forkScope}/paseo-${name}`).join(" ")}`),
    `git tag fork/v${forkVersion}`,
    `git push origin ${branch} fork/v${forkVersion}`,
    `gh release create fork/v${forkVersion} --title "${forkScope} ${forkVersion}" --notes-file ${notesPath} ${tarballDir}/*.tgz`,
  ];
}

function printRefusal(forkScope, forkVersion, branch) {
  console.log("\nRefusing to publish: --publish requires --yes-i-am-publishing.");
  console.log("Commands that publish mode would run after a green dry-run:");
  for (const line of publishCommands({
    forkScope,
    forkVersion,
    branch,
    notesPath: "<staging-dir>/release-notes.md",
    tarballDir: "<staging-dir>",
  })) {
    console.log(`  ${line}`);
  }
}

// npm links workspace packages with symlinks into the real checkout (here:
// absolute paths). A staged copy must resolve them within the staged tree —
// otherwise builds and Metro silently read the REAL worktree, mixing both and
// resurrecting upstream specifiers past the gate.
export function relinkCopiedSymlinks(rootDir, repoRoot, stage) {
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        const resolved = path.resolve(path.dirname(entryPath), readlinkSync(entryPath));
        if (resolved === repoRoot || resolved.startsWith(repoRoot + path.sep)) {
          const stagedTarget = stage + resolved.slice(repoRoot.length);
          rmSync(entryPath);
          symlinkSync(path.relative(path.dirname(entryPath), stagedTarget), entryPath);
        }
        continue;
      }
      if (entry.isDirectory()) visit(entryPath);
    }
  };
  visit(rootDir);
}

function stageReleaseCopy(repoRoot, stage) {
  capture("bash", ["-c", `git archive HEAD | tar -x -C '${stage}'`], repoRoot);
  console.log("copying node_modules into the staged tree...");
  cpSync(path.join(repoRoot, "node_modules"), path.join(stage, "node_modules"), {
    recursive: true,
  });
  // npm also installs per-workspace node_modules when hoisting is impossible
  // (e.g. packages/server/node_modules carries the typed lru-cache and
  // @opencode-ai/sdk); the staged build resolves modules through them.
  const copiedNodeModules = [path.join(stage, "node_modules")];
  for (const entry of readdirSync(path.join(stage, "packages"), { withFileTypes: true })) {
    const realNodeModules = path.join(repoRoot, "packages", entry.name, "node_modules");
    if (entry.isDirectory() && existsSync(realNodeModules)) {
      const stagedNodeModules = path.join(stage, "packages", entry.name, "node_modules");
      cpSync(realNodeModules, stagedNodeModules, { recursive: true });
      copiedNodeModules.push(stagedNodeModules);
    }
  }
  for (const nodeModules of copiedNodeModules) {
    relinkCopiedSymlinks(nodeModules, repoRoot, stage);
  }
}

function rewriteStagedManifests(stage, rootDoc, rewriteContext) {
  for (const name of RELEASE_PACKAGES) {
    const packageJsonPath = path.join(stage, "packages", name, "package.json");
    const rewritten = rewritePackageJsonDoc(readJson(packageJsonPath), rewriteContext);
    assertPublishAccess(rewritten, `packages/${name}`);
    writeJson(packageJsonPath, rewritten);
  }
  writeJson(path.join(stage, "package.json"), rewriteRootPackageJsonDoc(rootDoc, rewriteContext));
}

function buildAndTypecheckStagedTree(stage) {
  console.log("building staged tree (build:server:clean)...");
  run("npm", ["run", "build:server:clean"], { cwd: stage });
  console.log("typechecking staged tree (typecheck:server)...");
  run("npm", ["run", "typecheck:server"], { cwd: stage });
}
// Reproduces the server package's prepack artifacts inside the staged tree so
// the packed tarball is exactly what ships: the prepack `build:clean` half
// already ran via build:server:clean (clean rebuild of all 7 packages); this
// adds the daemon web UI export that stock ships via dist/server/web-ui.
function buildDaemonWebUiAssets(stage) {
  console.log("exporting daemon web UI (build:daemon-web-ui)...");
  run("npm", ["run", "build:daemon-web-ui"], { cwd: stage });
}

function rewriteStagedOutput(stage, forkScope) {
  const context = { forkScope };
  for (const name of RELEASE_PACKAGES) {
    const packageDir = path.join(stage, "packages", name);
    const stats = rewriteDistSpecifiers(path.join(packageDir, "dist"), context);
    let extraHits = rewriteDistSpecifiers(path.join(packageDir, "bin"), context).occurrences;
    for (const shipped of ["README.md", ".env.example"]) {
      extraHits += rewriteShippedFileSpecifiers(path.join(packageDir, shipped), context);
    }
    console.log(
      `dist rewrite ${forkScope}/paseo-${name}: ${stats.filesScanned} files scanned, ` +
        `${stats.filesRewritten} rewritten, ${stats.occurrences} specifiers` +
        (extraHits > 0 ? `, ${extraHits} in shipped docs/bin` : ""),
    );
  }
}

function runPackListGate(stage, forkScope) {
  console.log("pack-list gate: npm pack --dry-run --json per staged package...");
  let gateFailures = 0;
  for (const name of RELEASE_PACKAGES) {
    const forkName = `${forkScope}/paseo-${name}`;
    const packageDir = path.join(stage, "packages", name);
    const packOutput = capture("npm", gatePackArgs(forkName), stage);
    const packPaths = parsePackFilePaths(packOutput);
    if (name === "server") {
      const webUiFiles = packPaths.filter((packPath) =>
        packPath.startsWith(SERVER_WEB_UI_PACK_PREFIX),
      ).length;
      assertWebUiAssetsInPackList(packPaths);
      console.log(`GATE INFO ${forkName}: daemon web-ui assets present (${webUiFiles} files)`);
    }
    const violations = scanPackListFiles({ packageDir, paths: packPaths });
    if (violations.length > 0) {
      gateFailures += 1;
      console.error(`GATE FAIL ${forkName}: leftover "${UPSTREAM_SCOPE}" in the pack list:`);
      for (const violation of violations) {
        console.error(`  ${violation.path}: ${violation.count} occurrence(s)`);
      }
    } else {
      console.log(`GATE PASS ${forkName}: ${packPaths.length} packed files, 0 occurrences`);
    }
  }
  if (gateFailures > 0) {
    throw new Error(`pack-list gate failed for ${gateFailures} package(s)`);
  }
}

function logStagedVersionSurfaces(stage) {
  const stagedCli = readJson(path.join(stage, "packages", "cli", "package.json"));
  const stagedServer = readJson(path.join(stage, "packages", "server", "package.json"));
  console.log(`staged cli version    (paseo --version): ${stagedCli.name}@${stagedCli.version}`);
  console.log(
    `staged server version (server_info):      ${stagedServer.name}@${stagedServer.version}`,
  );
  console.log(`staged tree: ${stage}`);
}

function writeReleaseNotes(stage, repoRoot, forkScope, forkVersion) {
  const notesPath = path.join(stage, "release-notes.md");
  const changelogPath = path.join(repoRoot, "fork", "CHANGELOG.md");
  if (existsSync(changelogPath)) {
    copyFileSync(changelogPath, notesPath);
  } else {
    writeFileSync(notesPath, `${forkScope} ${forkVersion}\n`);
  }
}

function publishStagedRelease(stage, repoRoot, { forkScope, forkVersion, branch }) {
  const tarballs = [];
  for (const name of RELEASE_PACKAGES) {
    run("npm", publishArgs(`${forkScope}/paseo-${name}`), {
      cwd: stage,
    });
    const out = capture("npm", tarballPackArgs(`${forkScope}/paseo-${name}`, stage), stage);
    tarballs.push(path.join(stage, out.trim().split("\n").at(-1)));
  }
  run("git", ["tag", `fork/v${forkVersion}`], { cwd: repoRoot });
  run("git", ["push", "origin", branch, `fork/v${forkVersion}`], { cwd: repoRoot });
  run(
    "gh",
    [
      "release",
      "create",
      `fork/v${forkVersion}`,
      "--title",
      `${forkScope} ${forkVersion}`,
      "--notes-file",
      path.join(stage, "release-notes.md"),
      ...tarballs,
    ],
    { cwd: repoRoot },
  );
}

function main() {
  const forkScope = resolveForkScope();
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = repoRootFromScript();
  const rootDoc = readJson(path.join(repoRoot, "package.json"));
  const baseVersion = rootDoc.version;
  const forkVersion = computeForkVersion(baseVersion, args.forkNumber);
  const branch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"], repoRoot).trim();

  console.log(`fork release: scope=${forkScope} base=${baseVersion} version=${forkVersion}`);

  if (args.publish && !args.yesIAmPublishing) {
    printRefusal(forkScope, forkVersion, branch);
    process.exitCode = 1;
    return;
  }

  console.log(`staging a clean copy of ${branch} @ HEAD via git archive...`);
  const stage = args.stagingDir ?? mkdtempSync(path.join(tmpdir(), "paseo-fork-release-"));
  mkdirSync(stage, { recursive: true });
  let completed = false;
  try {
    stageReleaseCopy(repoRoot, stage);
    rewriteStagedManifests(stage, rootDoc, { forkScope, baseVersion, forkVersion });
    buildAndTypecheckStagedTree(stage);
    buildDaemonWebUiAssets(stage);
    rewriteStagedOutput(stage, forkScope);
    runPackListGate(stage, forkScope);
    logStagedVersionSurfaces(stage);
    writeReleaseNotes(stage, repoRoot, forkScope, forkVersion);

    if (args.publish && args.yesIAmPublishing) {
      publishStagedRelease(stage, repoRoot, { forkScope, forkVersion, branch });
    } else {
      console.log("\ndry-run complete: no publish, no tag, no push (default mode).");
      console.log("Publish mode requires: --publish --yes-i-am-publishing");
    }
    completed = true;
  } finally {
    if (completed && !args.keepStaging && !args.publish) {
      rmSync(stage, { recursive: true, force: true });
    }
  }
}

const isEntrypoint =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  try {
    main();
  } catch (error) {
    console.error(`release-fork failed: ${error.message}`);
    process.exitCode = 1;
  }
}
