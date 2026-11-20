#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "../../scripts/is-main-module.mjs";

const basePattern = /^\d+\.\d+\.\d+(?:-beta\.[1-9]\d*)?$/;
const forkPattern =
  /^(\d+\.\d+\.\d+(?:-beta\.[1-9]\d*)?)(?:-|\.)(?:fork|mine)\.(?:[1-9]\d*|\d{6}-\d{4}(?:\.g[0-9a-f]{12})?)$/;

export function validateBuildVersion(baseVersion, version) {
  const match = forkPattern.exec(version);
  if (!match || match[1] !== baseVersion) {
    throw new Error(`Expected a fork build version of ${baseVersion}, got ${version}`);
  }
  const separator = baseVersion.includes("-") ? "." : "-";
  if (!version.startsWith(`${baseVersion}${separator}`)) {
    throw new Error(`Invalid fork version separator: ${version}`);
  }
  return version;
}

export function computeBuildVersion(baseVersion, revision, commitTime) {
  if (!basePattern.test(baseVersion) || !/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error("A build version requires an upstream version and full source commit SHA");
  }
  const date = new Date(Number(commitTime) * 1000);
  const iso = date.toISOString();
  const stamp = `${iso.slice(2, 10).replaceAll("-", "")}-${iso.slice(11, 16).replace(":", "")}`;
  const separator = baseVersion.includes("-") ? "." : "-";
  return `${baseVersion}${separator}fork.${stamp}.g${revision.slice(0, 12)}`;
}

export function resolveBuildVersion(repoRoot, override = process.env.PASEO_PACKAGE_VERSION) {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const stamped = forkPattern.exec(pkg.version);
  const baseVersion = stamped ? stamped[1] : pkg.version;
  if (override) return validateBuildVersion(baseVersion, override);
  if (stamped) return validateBuildVersion(baseVersion, pkg.version);
  const source = execFileSync("git", ["show", "-s", "--format=%H:%ct", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  const [revision, commitTime] = source.split(":");
  return computeBuildVersion(baseVersion, revision, commitTime);
}

function stampManifest(doc, { baseVersion, previousVersion, version }) {
  doc.version = version;
  for (const field of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    for (const [name, spec] of Object.entries(doc[field] ?? {})) {
      if (name.startsWith("@getpaseo/") && (spec === baseVersion || spec === previousVersion)) {
        doc[field][name] = version;
      }
    }
  }
}

// Used on a disposable build tree or npm staging tree before Metro inlines the
// app manifest. Stamping only Electron's extraMetadata leaves the CLI and UI stale.
export function stampBuildVersion(repoRoot, version) {
  const rootPath = path.join(repoRoot, "package.json");
  const root = JSON.parse(readFileSync(rootPath, "utf8"));
  const stamped = forkPattern.exec(root.version);
  const baseVersion = stamped ? stamped[1] : root.version;
  validateBuildVersion(baseVersion, version);
  const originals = new Map();
  const files = [
    rootPath,
    ...root.workspaces.map((workspace) => path.join(repoRoot, workspace, "package.json")),
  ];
  const restore = () => {
    for (const [file, original] of originals) writeFileSync(file, original);
  };
  try {
    for (const file of files) {
      if (!existsSync(file)) continue;
      const original = readFileSync(file);
      const doc = JSON.parse(original);
      if (doc.version !== baseVersion && doc.version !== root.version) continue;
      stampManifest(doc, { baseVersion, previousVersion: root.version, version });
      originals.set(file, original);
      writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    }
  } catch (error) {
    restore();
    throw error;
  }
  return restore;
}

if (isMainModule(import.meta.url)) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const args = process.argv.slice(2);
  const version = resolveBuildVersion(repoRoot);
  if (args.length === 1 && args[0] === "--print") {
    console.log(version);
  } else {
    if (args[0] !== "--" || args.length < 2) {
      throw new Error(
        "Usage: node fork/scripts/build-version.mjs --print | -- <command> [args...]",
      );
    }
    const restore = stampBuildVersion(repoRoot, version);
    console.log(`Fork build version: ${version}`);
    const child = spawn(args[1], args.slice(2), {
      cwd: repoRoot,
      stdio: "inherit",
      detached: process.platform !== "win32",
      env: { ...process.env, PASEO_PACKAGE_VERSION: version, PASEO_BUILD_VERSION_STAMPED: "1" },
    });
    // npm and shell build commands launch grandchildren; stop the whole build
    // before restoring manifests that those processes may still be reading.
    const forwardSignal = (signal) => {
      if (process.platform === "win32") child.kill(signal);
      else process.kill(-child.pid, signal);
    };
    const interrupt = () => forwardSignal("SIGINT");
    const terminate = () => forwardSignal("SIGTERM");
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    try {
      process.exitCode = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code) => resolve(code ?? 1));
      });
    } finally {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
      restore();
    }
  }
}
