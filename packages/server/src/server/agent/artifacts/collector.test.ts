import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentArtifactCollector } from "./collector.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("AgentArtifactCollector", () => {
  it("collects supported files created by shell-style writes during a turn", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "paseo-artifacts-"));
    temporaryDirectories.push(cwd);
    await mkdir(path.join(cwd, "reports"));
    const collector = new AgentArtifactCollector();

    collector.beginTurn("agent-1", cwd);
    await writeFile(path.join(cwd, "reports", "summary.html"), "<h1>Summary</h1>");
    await writeFile(path.join(cwd, "chart.png"), Buffer.from([137, 80, 78, 71]));
    await writeFile(path.join(cwd, "notes.txt"), "not an artifact");

    const collection = await collector.finishTurn("agent-1", []);

    expect(collection?.addedOrUpdated).toBe(2);
    expect(collection?.artifacts.map((artifact) => artifact.path).sort()).toEqual([
      "chart.png",
      "reports/summary.html",
    ]);
    expect(collection?.artifacts.find((artifact) => artifact.path === "chart.png")?.kind).toBe(
      "image",
    );
  });

  it("caps the retained artifact list at the per-agent ceiling during a turn", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "paseo-artifacts-"));
    temporaryDirectories.push(cwd);
    await mkdir(path.join(cwd, "out"));
    const collector = new AgentArtifactCollector();
    collector.beginTurn("agent-3", cwd);
    const total = 210;
    for (let index = 0; index < total; index += 1) {
      await writeFile(path.join(cwd, "out", `page-${String(index).padStart(3, "0")}.html`), "<p>");
    }

    const collection = await collector.finishTurn("agent-3", []);

    expect(collection?.artifacts).toHaveLength(200);
    // The kept set is the most recently modified, so the oldest pages drop.
    expect(collection?.artifacts.every((artifact) => artifact.path > "out/page-009.html")).toBe(
      true,
    );
  });

  it("uses completed write tool calls when the recursive watcher is unavailable", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "paseo-artifacts-"));
    temporaryDirectories.push(cwd);
    const collector = new AgentArtifactCollector();
    collector.beginTurn("agent-2", cwd);
    await writeFile(path.join(cwd, "report.md"), "# Report");
    collector.observeToolCall("agent-2", {
      type: "tool_call",
      callId: "write-1",
      name: "Write",
      status: "completed",
      error: null,
      detail: { type: "write", filePath: "report.md" },
    });

    const collection = await collector.finishTurn("agent-2", []);

    expect(collection?.artifacts).toEqual([
      expect.objectContaining({ path: "report.md", kind: "markdown" }),
    ]);
  });
});
