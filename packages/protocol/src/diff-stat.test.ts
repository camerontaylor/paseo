import { expect, it } from "vitest";
import { z } from "zod";
import {
  ChangeBreakdownSchema,
  DiffStatSchema,
  emptyChangeBreakdown,
  productionStat,
  sumDiffStats,
} from "./diff-stat.js";
import {
  CheckoutCommitFileDiffResponseSchema,
  WorkspaceDescriptorPayloadSchema,
} from "./messages.js";

it("accepts old totals and permits old clients to read enriched totals", () => {
  const total = { additions: 3, deletions: 1 };
  expect(DiffStatSchema.parse(total)).toEqual(total);
  const oldSchema = z.object({ additions: z.number(), deletions: z.number() });
  const breakdown = emptyChangeBreakdown();
  breakdown.code = total;
  expect(oldSchema.parse({ ...total, breakdown })).toEqual(total);
  expect(DiffStatSchema.parse({ ...total, breakdown }).breakdown).toEqual(breakdown);
});

it("sums production categories without counting estimate annotations twice", () => {
  const first = emptyChangeBreakdown();
  first.code.additions = 2;
  first.comments.additions = 1;
  const second = emptyChangeBreakdown();
  second.ci.deletions = 3;
  second.tests.additions = 4;
  second.commentsIncluded.deletions = 3;
  const sum = sumDiffStats([
    { additions: 3, deletions: 0, breakdown: first },
    { additions: 4, deletions: 3, breakdown: second },
  ]);
  expect(sum).toMatchObject({ additions: 7, deletions: 3 });
  expect(productionStat(sum.breakdown!)).toEqual({ additions: 2, deletions: 3 });
  expect(sum.breakdown!.commentsIncluded.deletions).toBe(3);
});

it("does not present a partial folder breakdown as complete", () => {
  const sum = sumDiffStats([
    { additions: 1, deletions: 0 },
    { additions: 0, deletions: 0, breakdown: emptyChangeBreakdown() },
  ]);
  expect(sum).toEqual({ additions: 1, deletions: 0 });
});

it("counts config separately from production while retaining it in totals", () => {
  const breakdown = emptyChangeBreakdown();
  breakdown.code = { additions: 2, deletions: 1 };
  breakdown.config = { additions: 7, deletions: 3 };
  const sum = sumDiffStats([{ additions: 9, deletions: 4, breakdown }]);
  expect(sum).toMatchObject({
    additions: 9,
    deletions: 4,
    breakdown: { config: { additions: 7, deletions: 3 } },
  });
  expect(sum.breakdown!.code).toEqual({ additions: 2, deletions: 1 });
  expect(productionStat(sum.breakdown!)).toEqual({ additions: 2, deletions: 1 });
});

it("retains the code breakdown when a binary file has no changed lines", () => {
  const breakdown = emptyChangeBreakdown();
  breakdown.code.additions = 1;
  const sum = sumDiffStats([
    { additions: 1, deletions: 0, breakdown },
    { additions: 0, deletions: 0 },
  ]);
  expect(sum.breakdown?.code.additions).toBe(1);
});

// Frozen transcribes of the released v0.11.1 wire shapes (messages.ts at the
// frozen base: the inline `diffStat` object and `ParsedDiffFileSchema`). They are
// literals on purpose: deriving them with `.omit()`/`.extend()` from the enriched
// schemas would change them whenever the enriched schemas change, which is exactly
// the property that has to be proven about old clients.
const RELEASED_V0111_DIFF_STAT = z.object({ additions: z.number(), deletions: z.number() });
const RELEASED_V0111_PARSED_DIFF_FILE = z.object({
  path: z.string(),
  oldPath: z.string().optional(),
  isNew: z.boolean(),
  isDeleted: z.boolean(),
  additions: z.number(),
  deletions: z.number(),
  hunks: z.array(
    z.object({
      oldStart: z.number(),
      oldCount: z.number(),
      newStart: z.number(),
      newCount: z.number(),
      lines: z.array(
        z.object({
          type: z.enum(["add", "remove", "context", "header"]),
          content: z.string(),
          tokens: z.array(z.object({ text: z.string(), style: z.string().nullable() })).optional(),
        }),
      ),
    }),
  ),
  status: z.enum(["ok", "too_large", "binary"]).optional(),
});

const ENRICHED_BREAKDOWN = {
  code: { additions: 1, deletions: 0 },
  components: { additions: 0, deletions: 0 },
  styles: { additions: 0, deletions: 0 },
  ci: { additions: 0, deletions: 0 },
  config: { additions: 0, deletions: 0 },
  tooling: { additions: 0, deletions: 0 },
  otherCode: { additions: 0, deletions: 0 },
  comments: { additions: 1, deletions: 0 },
  docs: { additions: 1, deletions: 1 },
  tests: { additions: 0, deletions: 0 },
  generated: { additions: 0, deletions: 0 },
  formatting: { additions: 0, deletions: 0 },
  blank: { additions: 0, deletions: 0 },
  other: { additions: 0, deletions: 0 },
  commentsIncluded: { additions: 0, deletions: 0 },
};

const ENRICHED_TOTAL = { additions: 3, deletions: 1, breakdown: ENRICHED_BREAKDOWN };
const RELEASED_FILE = {
  path: "src/a.ts",
  oldPath: "src/old.ts",
  isNew: false,
  isDeleted: false,
  additions: 3,
  deletions: 1,
  hunks: [
    {
      oldStart: 1,
      oldCount: 1,
      newStart: 1,
      newCount: 3,
      lines: [
        { type: "header", content: "@@ -1 +1,3 @@" },
        { type: "remove", content: "// old" },
        { type: "add", content: "const a = 1;" },
        { type: "add", content: "const b = 2;" },
      ],
    },
  ],
  status: "ok",
};
const ENRICHED_FILE = { ...RELEASED_FILE, breakdown: ENRICHED_BREAKDOWN };
const RELEASED_WORKSPACE = {
  id: "ws-1",
  projectId: "proj-1",
  projectDisplayName: "repo",
  projectRootPath: "/repo",
  workspaceDirectory: "/repo",
  projectKind: "git",
  workspaceKind: "worktree",
  name: "feature",
  status: "running",
  activityAt: null,
  scripts: [],
};
const ENRICHED_FILE_DIFF_PAYLOAD = {
  type: "checkout.commits.file_diff.response",
  payload: {
    cwd: "/repo",
    sha: "0".repeat(40),
    path: "src/a.ts",
    file: ENRICHED_FILE,
    error: null,
    requestId: "req-1",
  },
};
const ENRICHED_WORKSPACE_PAYLOAD = {
  ...RELEASED_WORKSPACE,
  diffStat: { additions: 3, deletions: 1, breakdown: ENRICHED_BREAKDOWN },
};

it("keeps released v0.11.1 clients parsing the enriched payloads", () => {
  expect(RELEASED_V0111_DIFF_STAT.parse(ENRICHED_TOTAL)).toEqual({ additions: 3, deletions: 1 });
  expect(RELEASED_V0111_PARSED_DIFF_FILE.parse(ENRICHED_FILE)).toEqual(RELEASED_FILE);
  expect(DiffStatSchema.parse(ENRICHED_TOTAL).breakdown).toEqual(ENRICHED_BREAKDOWN);

  // The released client drops the new field and keeps the rest of the record.
  expect(RELEASED_V0111_PARSED_DIFF_FILE.parse(ENRICHED_FILE_DIFF_PAYLOAD.payload.file)).toEqual(
    RELEASED_FILE,
  );
  expect(
    CheckoutCommitFileDiffResponseSchema.parse(ENRICHED_FILE_DIFF_PAYLOAD).payload.file?.breakdown,
  ).toEqual(ENRICHED_BREAKDOWN);

  expect(
    RELEASED_V0111_DIFF_STAT.nullable().optional().parse(ENRICHED_WORKSPACE_PAYLOAD.diffStat),
  ).toEqual({ additions: 3, deletions: 1 });
  expect(
    WorkspaceDescriptorPayloadSchema.parse(ENRICHED_WORKSPACE_PAYLOAD).diffStat?.breakdown,
  ).toEqual(ENRICHED_BREAKDOWN);
});

// The walk below is what a review of the schema source cannot guarantee: every
// node of the two schemas stays a plain object/number, so no transform, default,
// catch, preprocess or nullable sneaks in. zod reports transform and preprocess
// both as "pipe".
function collectZodTypes(node: unknown, types = new Set<string>()): Set<string> {
  const def = (node as { _zod?: { def?: Record<string, unknown> } })?._zod?.def;
  const type = def?.["type"];
  if (typeof type !== "string") return types;
  types.add(type);
  for (const child of Object.values((def?.["shape"] as Record<string, unknown>) ?? {})) {
    collectZodTypes(child, types);
  }
  if (def?.["innerType"]) collectZodTypes(def["innerType"], types);
  return types;
}

it("parses structurally: unknown keys are stripped, nothing is transformed", () => {
  const input = { additions: 3, deletions: 1, breakdown: ENRICHED_BREAKDOWN, unexpected: true };
  const parsed = DiffStatSchema.parse(input);
  expect(parsed).toEqual(ENRICHED_TOTAL);
  expect(parsed).not.toBe(input);
  expect(input).toHaveProperty("unexpected", true);
  expect(Object.keys(parsed.breakdown!)).toEqual(Object.keys(ENRICHED_BREAKDOWN));
});

it("requires every breakdown category and both totals", () => {
  const totalOnly = DiffStatSchema.safeParse({});
  expect(totalOnly.success).toBe(false);
  const missing = ChangeBreakdownSchema.safeParse({});
  expect(missing.success).toBe(false);
  if (missing.success) throw new Error("unreachable");
  expect(new Set(missing.error.issues.map((issue) => issue.path.join(".")))).toEqual(
    new Set(Object.keys(ENRICHED_BREAKDOWN)),
  );
});

it("uses only plain object, number and optional nodes", () => {
  expect([...collectZodTypes(DiffStatSchema)].sort()).toEqual(["number", "object", "optional"]);
  expect([...collectZodTypes(ChangeBreakdownSchema)].sort()).toEqual(["number", "object"]);
});

it("returns a fresh zero breakdown per call", () => {
  const first = emptyChangeBreakdown();
  const second = emptyChangeBreakdown();
  expect(Object.keys(first)).toHaveLength(15);
  first.code.additions = 5;
  expect(second.code.additions).toBe(0);
  expect(first.code).not.toBe(second.code);
});
