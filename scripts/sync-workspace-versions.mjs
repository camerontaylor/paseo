import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const rootPackagePath = path.join(rootDir, "package.json");

const rootPackage = JSON.parse(readFileSync(rootPackagePath, "utf8"));
const rootVersion = rootPackage.version;
// The workspace package list lives in pnpm-workspace.yaml, not in
// package.json's "workspaces" field (pnpm ignores that field entirely).
const pnpmWorkspace = load(readFileSync(path.join(rootDir, "pnpm-workspace.yaml"), "utf8"));
const workspacePaths = Array.isArray(pnpmWorkspace?.packages) ? pnpmWorkspace.packages : [];
if (workspacePaths.length === 0) {
  throw new Error('pnpm-workspace.yaml must list at least one entry under "packages"');
}
const sharedMetadata = {
  homepage: rootPackage.homepage,
  repository: rootPackage.repository,
  author: rootPackage.author,
  license: rootPackage.license,
};

if (typeof rootVersion !== "string" || rootVersion.length === 0) {
  throw new Error('Root package.json must contain a valid "version"');
}

const dependencySections = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

const touched = [];

for (const workspacePath of workspacePaths) {
  const packagePath = path.join(rootDir, workspacePath, "package.json");
  if (!existsSync(packagePath)) {
    continue;
  }

  const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  let changed = false;

  if (pkg.version !== rootVersion) {
    pkg.version = rootVersion;
    changed = true;
  }

  if (pkg.name === "@getpaseo/desktop") {
    for (const [field, value] of Object.entries(sharedMetadata)) {
      const currentValue = JSON.stringify(pkg[field]);
      const nextValue = JSON.stringify(value);
      if (currentValue !== nextValue) {
        pkg[field] = value;
        changed = true;
      }
    }
  }

  // Private workspaces (app, desktop) keep "*" for internal deps so pnpm always
  // resolves the local sibling, never a registry artifact. Publishable workspaces
  // get the root version so their published tarballs reference real npm versions.
  const internalDepRange = pkg.private === true ? "*" : rootVersion;

  for (const section of dependencySections) {
    const deps = pkg[section];
    if (!deps || typeof deps !== "object") {
      continue;
    }

    for (const name of Object.keys(deps)) {
      if (!name.startsWith("@getpaseo/")) {
        continue;
      }
      if (name === pkg.name) {
        continue;
      }
      if (deps[name] !== internalDepRange) {
        deps[name] = internalDepRange;
        changed = true;
      }
    }
  }

  if (changed) {
    writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
    touched.push(path.relative(rootDir, packagePath));
  }
}

if (touched.length === 0) {
  console.log(`Workspace versions and internal deps already synced to ${rootVersion}`);
} else {
  console.log(`Synced to ${rootVersion}:`);
  for (const file of touched) {
    console.log(`- ${file}`);
  }
}
