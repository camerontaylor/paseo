import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { createDefaultDaemonEnv, getTerminalHookSmokeCommand, hasTerminalHookMarker } =
  createRequire(import.meta.url)("../../e2e/packaged-app-smoke.js") as {
    createDefaultDaemonEnv(extraEnv: Record<string, string>): NodeJS.ProcessEnv;
    getTerminalHookSmokeCommand(marker: string, platform?: NodeJS.Platform): string;
    hasTerminalHookMarker(lines: string[], marker: string): boolean;
  };

function writeExecutable(filePath: string, contents: string): void {
  writeFileSync(filePath, contents, "utf8");
  chmodSync(filePath, 0o755);
}

function createFakeMacBundle(options: { includeHelper: boolean }): {
  root: string;
  shimPath: string;
} {
  const root = mkdtempSync(join(tmpdir(), "paseo-cli-shim-test-"));
  const appPath = join(root, "Paseo.app");
  const contentsPath = join(appPath, "Contents");
  const resourcesPath = join(contentsPath, "Resources");
  const shimPath = join(resourcesPath, "bin", "paseo");
  const mainPath = join(contentsPath, "MacOS", "Paseo");
  const helperPath = join(
    contentsPath,
    "Frameworks",
    "Paseo Helper.app",
    "Contents",
    "MacOS",
    "Paseo Helper",
  );

  mkdirSync(dirname(shimPath), { recursive: true });
  mkdirSync(dirname(mainPath), { recursive: true });
  copyFileSync(join(packageRoot, "bin", "paseo"), shimPath);
  chmodSync(shimPath, 0o755);

  writeExecutable(mainPath, "#!/bin/sh\necho main-executable\n");

  if (options.includeHelper) {
    mkdirSync(dirname(helperPath), { recursive: true });
    writeExecutable(
      helperPath,
      [
        "#!/bin/sh",
        'printf "helper env=%s/%s cli=%s\\n" "$ELECTRON_RUN_AS_NODE" "$PASEO_NODE_ENV" "$PASEO_CLI"',
        'printf "args=%s\\n" "$*"',
        "",
      ].join("\n"),
    );
  }

  return { root, shimPath };
}

describe("desktop packaging", () => {
  it("uses an Electron runtime whose Squirrel handoff explicitly wakes ShipIt", () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      devDependencies?: Record<string, string>;
    };
    const electronVersion = pkg.devDependencies?.electron ?? "0.0.0";
    const electronMajor = Number(electronVersion.split(".")[0]);

    expect(electronMajor).toBeGreaterThanOrEqual(44);
  });

  it("requires macOS 13 or newer in the packaged application", () => {
    const config = readFileSync(join(packageRoot, "electron-builder.yml"), "utf8");

    expect(config).toContain('minimumSystemVersion: "13.0.0"');
  });

  it("unpacks server zsh shell integration files for external shells", () => {
    const config = readFileSync(join(packageRoot, "electron-builder.yml"), "utf8");

    expect(config).toContain(
      "node_modules/@getpaseo/server/dist/server/terminal/shell-integration/**/*",
    );
    expect(config).not.toContain(
      "node_modules/@getpaseo/server/dist/src/terminal/shell-integration/**/*",
    );
  });

  it("excludes package debug/source files from the packaged app", () => {
    const config = readFileSync(join(packageRoot, "electron-builder.yml"), "utf8");

    expect(config).toContain("!**/*.map");
    expect(config).toContain("!node_modules/@getpaseo/*/src/**");
    expect(config).toContain("!node_modules/@getpaseo/**/*.test.*");
    expect(config).toContain("!node_modules/@getpaseo/**/*.spec.*");
  });

  it("excludes the bundled daemon web UI from the packaged app", () => {
    const config = readFileSync(join(packageRoot, "electron-builder.yml"), "utf8");

    expect(config).toContain("!node_modules/@getpaseo/server/dist/server/web-ui/**");
  });

  it("uses the server skill catalog without a duplicate desktop resource", () => {
    const config = readFileSync(join(packageRoot, "electron-builder.yml"), "utf8");
    const serverPackage = readFileSync(join(packageRoot, "..", "server", "package.json"), "utf8");
    const runtimeTrace = readFileSync(
      join(packageRoot, "..", "..", "scripts", "trace-daemon.mjs"),
      "utf8",
    );

    expect(config).not.toContain("from: ../../skills");
    expect(serverPackage).toContain("fs.rmSync('dist/server/skills',{recursive:true,force:true})");
    expect(serverPackage).toContain("fs.cpSync('../../skills','dist/server/skills'");
    expect(runtimeTrace).toContain('"packages/server/dist/server/skills/**"');
  });

  it("registers Paseo agent links with the operating system", () => {
    const config = readFileSync(join(packageRoot, "electron-builder.yml"), "utf8");

    expect(config).toContain("name: Paseo agent link");
    expect(config).toContain("- paseo");
  });

  // electron-builder packs production dependencies declared in package.json into
  // app.asar. Runtime code in runtime-paths.ts and bin/paseo dynamically resolves
  // these workspace packages by string, so static analysis (TypeScript, Knip) cannot
  // see the link. If a runtime-required workspace dep is dropped from
  // dependencies, the build still succeeds but ships a broken bundle. This
  // assertion is the safety net.
  it("declares all workspace packages required at runtime", () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const deps = pkg.dependencies ?? {};

    for (const required of ["@getpaseo/cli", "@getpaseo/server"]) {
      expect(deps[required], `${required} must be declared in dependencies`).toBe("*");
    }
  });

  it("launches the packaged macOS CLI through Helper instead of the main app executable", () => {
    if (process.platform === "win32") return;

    const bundle = createFakeMacBundle({ includeHelper: true });
    try {
      const result = spawnSync(bundle.shimPath, ["--version"], { encoding: "utf8" });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`helper env=1/production cli=${bundle.shimPath}`);
      expect(result.stdout).toContain("node-entrypoint-runner.js");
      expect(result.stdout).toContain("node-script");
      expect(result.stdout).toContain("@getpaseo/cli/dist/index.js");
      expect(result.stdout).toContain("--version");
      expect(result.stdout).not.toContain("main-executable");
    } finally {
      rmSync(bundle.root, { recursive: true, force: true });
    }
  });

  it("fails packaged macOS CLI startup when Helper is missing", () => {
    if (process.platform === "win32") return;

    const bundle = createFakeMacBundle({ includeHelper: false });
    try {
      const result = spawnSync(bundle.shimPath, ["--version"], { encoding: "utf8" });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Bundled Paseo Helper executable not found");
      expect(result.stdout).not.toContain("main-executable");
    } finally {
      rmSync(bundle.root, { recursive: true, force: true });
    }
  });
});

describe("packaged terminal smoke", () => {
  const marker = "paseo-packaged-terminal-smoke-1234567890";

  it("isolates inherited zsh configuration while preserving explicit environment overrides", () => {
    vi.stubEnv("ZDOTDIR", "/host/zsh-config");
    vi.stubEnv("HOME", "/host/home");
    vi.stubEnv("SHELL", "/bin/zsh");
    vi.stubEnv("PASEO_HOME", "/host/paseo");
    try {
      const env = createDefaultDaemonEnv({ HOME: "/isolated/home", USERPROFILE: "/isolated/home" });
      expect(env.ZDOTDIR).toBeUndefined();
      expect(env.HOME).toBe("/isolated/home");
      expect(env.USERPROFILE).toBe("/isolated/home");
      expect(env.SHELL).toBe("/bin/zsh");
      expect(env.PASEO_HOME).toBeUndefined();
      expect(createDefaultDaemonEnv({ ZDOTDIR: "/explicit/zsh-config" }).ZDOTDIR).toBe(
        "/explicit/zsh-config",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each(["darwin", "win32"] as const)(
    "rejects echoed and wrapped %s command input",
    (platform) => {
      const command = getTerminalHookSmokeCommand(marker, platform);
      const wrapped = command.match(/.{1,40}/g) ?? [];
      expect(command).not.toContain(marker);
      expect(hasTerminalHookMarker([command, ...wrapped], marker)).toBe(false);
      expect(hasTerminalHookMarker([`prompt> ${marker}`, `${marker}-extra`], marker)).toBe(false);
      expect(hasTerminalHookMarker([marker, "prompt>"], marker)).toBe(true);
      expect(hasTerminalHookMarker([`${marker}   `], marker)).toBe(true);
    },
  );

  it("keeps PowerShell hook failure ahead of split-generated output", () => {
    const command = getTerminalHookSmokeCommand(marker, "win32");
    const encoded = command.split(" ").at(-1)!;
    const script = Buffer.from(encoded, "base64").toString("utf16le");
    expect(command).toMatch(/^powershell.exe -NoProfile -NonInteractive -EncodedCommand /);
    expect(script).toMatch(
      /^& \$env:PASEO_HOOK_CLI hooks codex Stop; if \(\$LASTEXITCODE -ne 0\) \{ exit \$LASTEXITCODE \}; Write-Output \('[^']+' \+ '[^']+'\)$/,
    );
    expect(script).not.toContain(marker);
  });

  it.each([0, 7])("requires real hook success before capturing output (exit %i)", (exitCode) => {
    const root = mkdtempSync(join(tmpdir(), "paseo-smoke-hook-test-"));
    const windows = process.platform === "win32";
    const hook = join(root, windows ? "hook.cmd" : "hook");
    writeExecutable(
      hook,
      windows
        ? `@echo off\r\nif not "%*"=="hooks codex Stop" exit /b 99\r\nexit /b ${exitCode}\r\n`
        : `#!/bin/sh\n[ "$*" = "hooks codex Stop" ] || exit 99\nexit ${exitCode}\n`,
    );
    try {
      const command = getTerminalHookSmokeCommand(marker);
      const result = spawnSync(
        windows ? "cmd.exe" : "/bin/sh",
        windows ? ["/d", "/c", command] : ["-c", command],
        { encoding: "utf8", timeout: 5_000, env: { ...process.env, PASEO_HOOK_CLI: hook } },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(exitCode);
      expect(result.stderr).toBe("");
      expect(result.stdout.replace(/\r\n/g, "\n")).toBe(exitCode === 0 ? `${marker}\n` : "");
      const capturedLines = [
        command,
        ...(command.match(/.{1,40}/g) ?? []),
        ...result.stdout.split(/\r?\n/),
      ];
      expect(hasTerminalHookMarker(capturedLines, marker)).toBe(exitCode === 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

it("installs the Linux helper as root-owned 4755 regardless of root's namespace access", () => {
  const config = readFileSync(join(packageRoot, "electron-builder.yml"), "utf8");
  expect(config).toContain("afterInstall: scripts/linux-sandbox/after-install.tpl");
  const installer = readFileSync(
    join(packageRoot, "scripts/linux-sandbox/after-install.tpl"),
    "utf8",
  );
  expect(installer).not.toContain("unshare");
  expect(installer).toContain("chown root:root '/opt/${sanitizedProductName}/chrome-sandbox'");
  expect(installer).toContain("chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox'");
  expect(installer).not.toContain("chmod 0755");
});
