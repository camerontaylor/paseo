import { beforeEach, describe, expect, it, vi } from "vitest";
import { execCommand } from "../utils/spawn.js";
import { LinearService } from "./linear-service.js";

vi.mock("../utils/spawn.js", () => ({ execCommand: vi.fn() }));
const command = vi.mocked(execCommand);
const target = { cwd: process.cwd(), prUrl: "https://github.com/ventrata/web-builder/pull/1095" };
const states = [
  { id: "release", name: "Ready for Release", type: "started", color: "#5e6ad2", position: 3144 },
  { id: "qa", name: "Ready for QA", type: "started", color: "#eb5757", position: 2079 },
  { id: "review", name: "Ready for review", type: "started", color: "#f2994a", position: 1022 },
  { id: "progress", name: "In Progress", type: "started", color: "#f2c94c", position: 2 },
  { id: "todo", name: "TO DO", type: "unstarted", color: "#e2e2e2", position: 1 },
];
const issue = {
  id: "issue-id",
  identifier: "CMS-664",
  title: "Search page",
  url: "https://linear.app/ventrata/issue/CMS-664",
  state: states[1],
  team: { states: { nodes: states } },
};
function reply(data: unknown) {
  return { stdout: JSON.stringify({ data }), stderr: "" };
}
function linked(nodes = [{ issue }]) {
  return reply({ attachmentsForURL: { nodes } });
}

beforeEach(() => vi.resetAllMocks());

describe("LinearService", () => {
  it("looks up PR attachments and preserves workflow color and ordered progress", async () => {
    command.mockResolvedValue(linked([{ issue }, { issue }]));
    const service = new LinearService();
    const issues = await service.getIssues(target);
    expect(issues).toEqual([
      {
        id: "issue-id",
        identifier: "CMS-664",
        title: "Search page",
        url: issue.url,
        state: { name: "Ready for QA", type: "started", color: "#eb5757", progress: 0.6 },
      },
    ]);
    expect(command).toHaveBeenCalledWith(
      "linear",
      [
        "api",
        expect.stringContaining("attachmentsForURL"),
        "--variables-json",
        JSON.stringify({ url: target.prUrl }),
      ],
      expect.objectContaining({ cwd: target.cwd, timeout: 15_000, maxBuffer: 2 * 1024 * 1024 }),
    );
  });

  it("shares pending lookups across clients and caches their result", async () => {
    command.mockResolvedValue(linked());
    const service = new LinearService();
    await Promise.all([service.getIssues(target), service.getIssues(target)]);
    await service.getIssues(target);
    expect(command).toHaveBeenCalledTimes(1);
    await service.getIssues({
      ...target,
      prUrl: "https://github.com/ventrata/web-builder/pull/1096",
    });
    expect(command).toHaveBeenCalledTimes(2);
  });

  it("returns no issues when a PR has no attachments", async () => {
    command.mockResolvedValue(linked([]));
    expect(await new LinearService().getIssues(target)).toEqual([]);
  });

  it("reports failures and allows a subsequent retry", async () => {
    command.mockRejectedValueOnce(new Error("process failed with private arguments"));
    command.mockResolvedValueOnce(linked());
    const service = new LinearService();
    await expect(service.getIssues(target)).rejects.toThrow("Linear request failed");
    expect(await service.getIssues(target)).toHaveLength(1);
  });

  it("rejects GraphQL errors instead of treating them as an unlinked PR", async () => {
    command.mockResolvedValue({
      stdout: JSON.stringify({ errors: [{ message: "Issue unavailable" }] }),
      stderr: "",
    });
    await expect(new LinearService().getIssues(target)).rejects.toThrow("Issue unavailable");
  });

  it("links the requested issue and invalidates the empty lookup", async () => {
    command.mockResolvedValueOnce(linked([]));
    command.mockResolvedValueOnce(reply({ issue: { id: "issue-id" } }));
    command.mockResolvedValueOnce(reply({ attachmentCreate: { success: true } }));
    command.mockResolvedValueOnce(linked());
    const service = new LinearService();
    await service.getIssues(target);
    await service.linkIssue({ ...target, identifier: " cms-664 " });
    expect(await service.getIssues(target)).toHaveLength(1);
    expect(command.mock.calls[1][1].at(-1)).toBe(JSON.stringify({ id: "CMS-664" }));
    expect(command.mock.calls[2][1].at(-1)).toBe(
      JSON.stringify({ issueId: "issue-id", url: target.prUrl }),
    );
  });

  it("does not report success when Linear refuses the link", async () => {
    command.mockResolvedValueOnce(reply({ issue: { id: "issue-id" } }));
    command.mockResolvedValueOnce(reply({ attachmentCreate: { success: false } }));
    await expect(
      new LinearService().linkIssue({ ...target, identifier: "CMS-664" }),
    ).rejects.toThrow("Linear did not link the issue");
  });

  it("validates issue identifiers before invoking the CLI", async () => {
    await expect(
      new LinearService().linkIssue({ ...target, identifier: "CMS-664; echo bad" }),
    ).rejects.toThrow("Enter a Linear issue identifier");
    expect(command).not.toHaveBeenCalled();
  });
});
