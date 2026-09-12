import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import {
  assertPublishAccess,
  assertWebUiAssetsInPackList,
  computeForkVersion,
  forkPackageName,
  gatePackArgs,
  parsePackFilePaths,
  publishArgs,
  relinkCopiedSymlinks,
  resolveForkScope,
  rewriteDistSpecifiers,
  rewritePackageJsonDoc,
  rewriteRootPackageJsonDoc,
  rewriteShippedFileSpecifiers,
  scanPackListFiles,
  tarballPackArgs,
} from "./release-fork.mjs";

const CTX = {
  forkScope: "@paseo-fork",
  baseVersion: "0.7.0-beta.2",
  forkVersion: "0.7.0-beta.2.fork.1",
};

test("rewrites package names and stamps the fork version across dependency pins", () => {
  const doc = {
    name: "@getpaseo/server",
    version: "0.7.0-beta.2",
    publishConfig: { access: "public" },
    dependencies: {
      "@getpaseo/client": "0.7.0-beta.2",
      "@getpaseo/protocol": "0.7.0-beta.2",
      zod: "^3.0.0",
    },
  };
  const out = rewritePackageJsonDoc(doc, CTX);

  assert.equal(out.name, "@paseo-fork/paseo-server");
  assert.equal(out.version, "0.7.0-beta.2.fork.1");
  assert.deepEqual(out.dependencies, {
    "@paseo-fork/paseo-client": "0.7.0-beta.2.fork.1",
    "@paseo-fork/paseo-protocol": "0.7.0-beta.2.fork.1",
    zod: "^3.0.0",
  });
  assert.deepEqual(out.publishConfig, { access: "public" });
  // the input document is not mutated
  assert.equal(doc.name, "@getpaseo/server");
});

test("rewrites internal pins in devDependencies and peerDependencies and leaves other specs alone", () => {
  const doc = {
    name: "@getpaseo/plugin",
    version: "0.7.0-beta.2",
    devDependencies: { "@getpaseo/protocol": "0.7.0-beta.2" },
    peerDependencies: { "@getpaseo/client": "0.7.0-beta.2", react: "^19.0.0" },
    optionalDependencies: { fsevents: "^2.3.3" },
  };
  const out = rewritePackageJsonDoc(doc, CTX);

  assert.deepEqual(out.devDependencies, { "@paseo-fork/paseo-protocol": "0.7.0-beta.2.fork.1" });
  assert.deepEqual(out.peerDependencies, {
    "@paseo-fork/paseo-client": "0.7.0-beta.2.fork.1",
    react: "^19.0.0",
  });
  assert.deepEqual(out.optionalDependencies, { fsevents: "^2.3.3" });
});

test("rewrites sibling workspace references in staged package scripts", () => {
  const out = rewritePackageJsonDoc(
    {
      name: "@getpaseo/client",
      version: "0.7.0-beta.2",
      scripts: {
        build:
          "npm run build --workspace=@getpaseo/protocol && tsc -p tsconfig.json --incremental false",
      },
    },
    CTX,
  );

  assert.equal(
    out.scripts.build,
    "npm run build --workspace=@paseo-fork/paseo-protocol && tsc -p tsconfig.json --incremental false",
  );
});

test("rewrites the compiled quoted runtime sites: packageJson.name gate, require.resolve, SERVER_PACKAGE_NAME", () => {
  // Fixtures mirror the compiled output of the three known quoted runtime sites:
  // packages/cli/src/commands/daemon/local-daemon.ts:187 (packageJson.name check),
  // packages/cli/src/commands/daemon/local-daemon.ts:199 (require.resolve), and
  // packages/server/src/server/daemon-version.ts:3 (SERVER_PACKAGE_NAME).
  const dist = mkdtempSync(path.join(tmpdir(), "paseo-release-fork-dist-"));
  try {
    const daemonDir = path.join(dist, "commands", "daemon");
    const versionDir = path.join(dist, "server");
    mkdirSync(daemonDir, { recursive: true });
    mkdirSync(versionDir, { recursive: true });
    const localDaemon = path.join(daemonDir, "local-daemon.js");
    writeFileSync(
      localDaemon,
      [
        `if (packageJson.name !== "@getpaseo/server") return null;`,
        `const serverExportPath = require.resolve("@getpaseo/server");`,
      ].join("\n"),
    );
    const daemonVersion = path.join(versionDir, "daemon-version.js");
    writeFileSync(daemonVersion, `const SERVER_PACKAGE_NAME = "@getpaseo/server";\n`);

    const stats = rewriteDistSpecifiers(dist, CTX);

    assert.equal(stats.filesScanned, 2);
    assert.equal(stats.filesRewritten, 2);
    assert.equal(stats.occurrences, 3);
    const rewrittenDaemon = readFileSync(localDaemon, "utf8");
    assert.match(rewrittenDaemon, /packageJson\.name !== "@paseo-fork\/paseo-server"/);
    assert.match(rewrittenDaemon, /require\.resolve\("@paseo-fork\/paseo-server"\)/);
    assert.equal(
      readFileSync(daemonVersion, "utf8"),
      `const SERVER_PACKAGE_NAME = "@paseo-fork/paseo-server";\n`,
    );
    assert.ok(!rewrittenDaemon.includes('"@getpaseo/'));
  } finally {
    rmSync(dist, { force: true, recursive: true });
  }
});

test("dist rewrite leaves files without quoted specifiers untouched and reports them as scanned", () => {
  const dist = mkdtempSync(path.join(tmpdir(), "paseo-release-fork-clean-"));
  try {
    const clean = path.join(dist, "index.js");
    writeFileSync(
      clean,
      'console.log("Unable to resolve @getpaseo/cli version from package.json.");\n',
    );
    const stats = rewriteDistSpecifiers(dist, CTX);

    assert.deepEqual(stats, { filesScanned: 1, filesRewritten: 0, occurrences: 0 });
    // unquoted prose (error message) is not a module specifier and stays untouched
    assert.equal(
      readFileSync(clean, "utf8"),
      'console.log("Unable to resolve @getpaseo/cli version from package.json.");\n',
    );
  } finally {
    rmSync(dist, { force: true, recursive: true });
  }
});

test("dist rewrite refuses binary files that contain the quoted specifier", () => {
  const dist = mkdtempSync(path.join(tmpdir(), "paseo-release-fork-binary-"));
  try {
    const binary = path.join(dist, "asset.bin");
    writeFileSync(binary, Buffer.from([0xff, 0xfe, 0x22, 0x40, 0x67, 0x65]));
    // append a full quoted specifier so the needle matches
    writeFileSync(binary, Buffer.concat([readFileSync(binary), Buffer.from('"@getpaseo/server"')]));
    assert.throws(() => rewriteDistSpecifiers(dist, CTX), /Non-text file/);
  } finally {
    rmSync(dist, { force: true, recursive: true });
  }
});

test("rewrites quoted specifiers in shipped docs that the pack list includes", () => {
  const packageDir = mkdtempSync(path.join(tmpdir(), "paseo-release-fork-docs-"));
  try {
    const readme = path.join(packageDir, "README.md");
    writeFileSync(readme, 'import { createPaseoClient } from "@getpaseo/client";\n');
    const missing = rewriteShippedFileSpecifiers(path.join(packageDir, ".env.example"), CTX);

    assert.equal(rewriteShippedFileSpecifiers(readme, CTX), 1);
    assert.equal(missing, 0);
    assert.equal(
      readFileSync(readme, "utf8"),
      'import { createPaseoClient } from "@paseo-fork/paseo-client";\n',
    );
  } finally {
    rmSync(packageDir, { force: true, recursive: true });
  }
});

test("every pack and publish invocation disables lifecycle scripts (prepack parity)", () => {
  const forkName = "@paseo-fork/paseo-cli";
  const argvs = [
    gatePackArgs(forkName),
    tarballPackArgs(forkName, "/tmp/fork-out"),
    publishArgs(forkName),
  ];
  for (const argv of argvs) {
    assert.ok(argv.includes("--ignore-scripts"), `missing --ignore-scripts: ${argv.join(" ")}`);
  }
  // the gate stays a dry-run json pack; the tarball pack targets a destination;
  // the publish keeps the fork dist-tag
  assert.deepEqual(gatePackArgs(forkName).slice(1, 3), ["--dry-run", "--json"]);
  assert.ok(tarballPackArgs(forkName, "dest-dir").includes("--pack-destination"));
  assert.deepEqual(publishArgs(forkName).slice(-2), ["--tag", "fork"]);
});

test("server pack list must include the daemon web-ui assets or the gate fails", () => {
  assertWebUiAssetsInPackList([
    "package.json",
    "dist/server/server/index.js",
    "dist/server/web-ui/index.html",
    "dist/server/web-ui/index.html.br",
  ]);
  assert.throws(
    () => assertWebUiAssetsInPackList(["package.json", "dist/server/server/index.js"]),
    /daemon web UI would be silently dropped/,
  );
});

test("leaves non-release workspace tokens in scripts untouched", () => {
  const rootOut = rewriteRootPackageJsonDoc(
    {
      scripts: {
        "build:app-deps":
          "npm run build:highlight && npm run build:client && npm run build --workspace=@getpaseo/expo-two-way-audio",
      },
    },
    { forkScope: "@paseo-fork" },
  );

  // expo-two-way-audio is not one of the 7 renamed packages: its token stays,
  // while nested root-script refs (build:highlight etc.) are separate scripts
  assert.equal(
    rootOut.scripts["build:app-deps"],
    "npm run build:highlight && npm run build:client && npm run build --workspace=@getpaseo/expo-two-way-audio",
  );
});

test("rewrites workspace symlinks copied from the real checkout to resolve inside the staged tree", () => {
  const base = mkdtempSync(path.join(tmpdir(), "paseo-release-fork-links-"));
  try {
    const repoRoot = path.join(base, "repo");
    const stage = path.join(base, "stage");
    mkdirSync(path.join(repoRoot, "packages/highlight/dist"), { recursive: true });
    mkdirSync(path.join(stage, "packages/highlight/dist"), { recursive: true });
    writeFileSync(path.join(repoRoot, "packages/highlight/dist/index.js"), "real\n");
    writeFileSync(path.join(stage, "packages/highlight/dist/index.js"), "staged\n");
    const linkPath = path.join(stage, "node_modules/@getpaseo/highlight");
    mkdirSync(path.join(stage, "node_modules/@getpaseo"), { recursive: true });
    symlinkSync(path.join(repoRoot, "packages/highlight"), linkPath);
    mkdirSync(path.join(stage, "node_modules/.bin"), { recursive: true });
    // a relative link that stays inside the stage must be left alone
    const insideRelativeLink = path.join(stage, "node_modules/.bin/tool");
    symlinkSync("../packages/highlight/dist/index.js", insideRelativeLink);

    relinkCopiedSymlinks(path.join(stage, "node_modules"), repoRoot, stage);

    const relinked = readlinkSync(linkPath);
    assert.equal(
      path.resolve(path.dirname(linkPath), relinked),
      path.join(stage, "packages/highlight"),
    );
    assert.equal(readFileSync(path.join(linkPath, "dist/index.js"), "utf8"), "staged\n");
    assert.equal(readlinkSync(insideRelativeLink), "../packages/highlight/dist/index.js");
  } finally {
    rmSync(base, { force: true, recursive: true });
  }
});

test("appends the fork build number to the upstream base version", () => {
  assert.equal(computeForkVersion("0.7.0-beta.2", 1), "0.7.0-beta.2.fork.1");
  assert.equal(computeForkVersion("0.7.0-beta.2", 2), "0.7.0-beta.2.fork.2");
});

test("resolves the fork scope from the environment with a default", () => {
  assert.equal(resolveForkScope({}), "@paseo-fork");
  assert.equal(resolveForkScope({ FORK_SCOPE: "@my-fork" }), "@my-fork");
  assert.throws(() => resolveForkScope({ FORK_SCOPE: "no-at-sign" }), /Invalid fork scope/);
});

test("forkPackageName renames only upstream-scoped names", () => {
  assert.equal(forkPackageName("@getpaseo/cli", "@paseo-fork"), "@paseo-fork/paseo-cli");
  assert.equal(forkPackageName("react", "@paseo-fork"), "react");
});

test("publishConfig.access=public must survive the rewrite in every staged package", () => {
  const good = rewritePackageJsonDoc(
    { name: "@getpaseo/cli", version: "0.7.0-beta.2", publishConfig: { access: "public" } },
    CTX,
  );
  assertPublishAccess(good, "packages/cli");
  assert.throws(
    () => assertPublishAccess({ name: "@paseo-fork/paseo-cli" }, "packages/cli"),
    /publishConfig\.access/,
  );
  assert.throws(
    () => assertPublishAccess({ publishConfig: { access: "restricted" } }, "packages/cli"),
    /publishConfig\.access/,
  );
});

test("parses npm pack --dry-run --json output in array and single-object shapes", () => {
  const asArray = JSON.stringify([
    { files: [{ path: "dist/index.js" }, { path: "package.json" }] },
  ]);
  assert.deepEqual(parsePackFilePaths(asArray), ["dist/index.js", "package.json"]);
  const asObject = JSON.stringify({ files: [{ path: "README.md" }] });
  assert.deepEqual(parsePackFilePaths(asObject), ["README.md"]);
  // a prepack lifecycle script can print to stdout before the JSON payload
  const withPrepackNoise = `generated src/generated/validation/ws-outbound.aot.ts\n${asArray}`;
  assert.deepEqual(parsePackFilePaths(withPrepackNoise), ["dist/index.js", "package.json"]);
});

test("gate scans pack file list contents and flags only quoted upstream specifiers", () => {
  const packageDir = mkdtempSync(path.join(tmpdir(), "paseo-release-fork-pack-"));
  try {
    mkdirSync(path.join(packageDir, "dist"), { recursive: true });
    writeFileSync(path.join(packageDir, "dist", "clean.js"), 'console.log("ok");\n');
    writeFileSync(
      path.join(packageDir, "dist", "stale.js"),
      'const SERVER_PACKAGE_NAME = "@getpaseo/server";\n',
    );
    // bare error-message prose without a leading quote is not a specifier
    writeFileSync(
      path.join(packageDir, "README.md"),
      "# fork\nUnable to resolve @getpaseo/cli version from package.json.\n",
    );

    const violations = scanPackListFiles({
      packageDir,
      paths: ["dist/clean.js", "dist/stale.js", "README.md"],
    });

    assert.deepEqual(violations, [{ path: "dist/stale.js", count: 1 }]);
  } finally {
    rmSync(packageDir, { force: true, recursive: true });
  }
});

test("rewrites workspace references in the staged root manifest scripts", () => {
  const out = rewriteRootPackageJsonDoc(
    {
      name: "paseo",
      private: true,
      scripts: {
        "build:server": "npm run build --workspace=@getpaseo/server",
        "typecheck:server": "npm run typecheck --workspace=@getpaseo/cli",
      },
    },
    { forkScope: "@paseo-fork" },
  );

  assert.equal(out.scripts["build:server"], "npm run build --workspace=@paseo-fork/paseo-server");
  assert.equal(
    out.scripts["typecheck:server"],
    "npm run typecheck --workspace=@paseo-fork/paseo-cli",
  );
  assert.equal(out.name, "paseo");
});
