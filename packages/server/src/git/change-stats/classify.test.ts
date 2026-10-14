import { describe, expect, it } from "vitest";
import {
  CHANGE_CATEGORIES,
  PRODUCTION_CATEGORIES,
  productionStat,
} from "@getpaseo/protocol/diff-stat";
import { classifyDiff } from "./classify.js";
import { classifyPath } from "./path.js";
import type { ParsedDiffFile } from "../../server/utils/diff-highlighter.js";

function compare(path: string, before: string, after: string) {
  const oldLines = before ? before.split("\n") : [];
  const newLines = after ? after.split("\n") : [];
  const file: ParsedDiffFile = {
    path,
    isNew: !before,
    isDeleted: !after,
    additions: newLines.length,
    deletions: oldLines.length,
    hunks: [
      {
        oldStart: 1,
        oldCount: oldLines.length,
        newStart: 1,
        newCount: newLines.length,
        lines: [
          ...oldLines.map((content) => ({ type: "remove" as const, content })),
          ...newLines.map((content) => ({ type: "add" as const, content })),
        ],
      },
    ],
  };
  const result = classifyDiff({ file, oldContent: before, newContent: after });
  expect(CHANGE_CATEGORIES.reduce((sum, category) => sum + result[category].additions, 0)).toBe(
    file.additions,
  );
  expect(CHANGE_CATEGORIES.reduce((sum, category) => sum + result[category].deletions, 0)).toBe(
    file.deletions,
  );
  return result;
}

describe("change classification", () => {
  it("separates trailing comment edits from production", () => {
    const result = compare("src/a.ts", "const a = 1; // before", "const a = 1; // after");
    expect(result.comments).toEqual({ additions: 1, deletions: 1 });
    expect(productionStat(result)).toEqual({ additions: 0, deletions: 0 });
  });
  it("counts mixed code/comment changes as production", () => {
    expect(compare("src/a.ts", "const a = 1; // before", "const a = 2; // after").code).toEqual({
      additions: 1,
      deletions: 1,
    });
  });
  it("does not mistake strings, templates or regular expressions for comments", () => {
    const result = compare(
      "src/a.ts",
      "",
      'const a = "// string";\nconst b = /[/*]/;\nconst c = `/* ${a} */`;',
    );
    expect(result.code.additions).toBe(3);
  });
  it("uses full-file context for multiline comments", () => {
    const file: ParsedDiffFile = {
      path: "a.ts",
      isNew: false,
      isDeleted: false,
      additions: 1,
      deletions: 1,
      hunks: [
        {
          oldStart: 2,
          oldCount: 1,
          newStart: 2,
          newCount: 1,
          lines: [
            { type: "remove", content: "old" },
            { type: "add", content: "new" },
          ],
        },
      ],
    };
    const result = classifyDiff({
      file,
      oldContent: "/*\nold\n*/\nconst a=1;",
      newContent: "/*\nnew\n*/\nconst a=1;",
    });
    expect(result.comments).toEqual({ additions: 1, deletions: 1 });
  });
  it("recognizes JSX comments while retaining JSX text", () => {
    expect(
      compare("a.tsx", "", "const a = <div>\n{/* explanation */}\nHello world\n</div>;").comments
        .additions,
    ).toBe(1);
    expect(
      compare("a.jsx", "const a = <div>Hello</div>;", "const a = <div>Goodbye</div>;").components
        .additions,
    ).toBe(1);
  });
  it("separates formatting and blanks", () => {
    expect(compare("a.ts", "const a=1;", "const a = 1;").formatting).toEqual({
      additions: 1,
      deletions: 1,
    });
    expect(compare("a.ts", "", "\nconst a=1;").blank.additions).toBe(1);
  });
  it("does not treat string whitespace edits as formatting", () => {
    expect(
      compare("a.ts", 'const a="hello world";', 'const a="hello  world";').code.additions,
    ).toBe(1);
  });
  it("classifies CSS comments and formatting", () => {
    expect(
      compare("a.css", "a { color: red; } /* old */", "a { color: red; } /* new */").comments
        .additions,
    ).toBe(1);
    expect(compare("a.css", "a{color:red}", "a { color: red }").formatting.additions).toBe(1);
  });
  it("file purpose owns comments in tests, docs and generated files", () => {
    expect(compare("a.test.ts", "", "// test\nconst x=1;").tests.additions).toBe(2);
    expect(compare("docs/a.ts", "", "// doc").docs.additions).toBe(1);
    expect(compare("a.ts", "", "// @generated\nconst a=1;").generated.additions).toBe(2);
    expect(classifyPath(".github/workflows/test.yml")).toBe("ci");
    expect(classifyPath("vite.config.ts")).toBe("config");
    expect(classifyPath("scripts/build.ts")).toBe("tooling");
  });
  it("reports comment-inclusive estimates for unsupported and malformed sources", () => {
    const python = compare("a.py", "", "# hello\nprint(1)");
    expect(python.otherCode.additions).toBe(2);
    expect(python.commentsIncluded.additions).toBe(2);
    const invalid = compare("a.ts", "", "const a = ;");
    expect(invalid.commentsIncluded.additions).toBe(1);
  });
  it("uses the old path and purpose for deletions after a rename", () => {
    const file: ParsedDiffFile = {
      path: "a.ts",
      oldPath: "a.test.ts",
      isNew: false,
      isDeleted: false,
      additions: 1,
      deletions: 1,
      hunks: [
        {
          oldStart: 1,
          oldCount: 1,
          newStart: 1,
          newCount: 1,
          lines: [
            { type: "remove", content: "const a=1;" },
            { type: "add", content: "const a=2;" },
          ],
        },
      ],
    };
    const result = classifyDiff({ file, oldContent: "const a=1;", newContent: "const a=2;" });
    expect(result.tests.deletions).toBe(1);
    expect(result.code.additions).toBe(1);
  });
});

it("keeps adjacent formatting and comment edits in separate categories", () => {
  const result = compare(
    "a.ts",
    "const a=1; // before\nconst b=2;",
    "const a=1; // after\nconst b = 2;",
  );
  expect(result.comments).toEqual({ additions: 1, deletions: 1 });
  expect(result.formatting).toEqual({ additions: 1, deletions: 1 });
});
it("counts JSDoc as comments", () => {
  expect(
    compare("a.ts", "", "/** Explanation. */\nexport function f() {}").comments.additions,
  ).toBe(1);
});
it("does not classify automatic-semicolon changes as formatting", () => {
  const result = compare("a.ts", "function f() { return\n1; }", "function f() { return 1; }");
  expect(result.formatting.additions).toBe(0);
});
it("preserves significant selector whitespace in CSS", () => {
  const result = compare("a.css", "a :hover { color: red; }", "a:hover { color: red; }");
  expect(result.styles.additions).toBe(1);
});

it("counts reordered statements as production changes", () => {
  const result = compare("a.ts", "first();\nsecond();", "second();\nfirst();");
  expect(result.code).toEqual({ additions: 2, deletions: 2 });
  expect(result.formatting).toEqual({ additions: 0, deletions: 0 });
});

// Fixed table: no randomness, no clocks, same cases every run. Each entry is
// checked against the partition, production-sum and commentsIncluded invariants.
const PARTITION_CASES: Array<{ name: string; path: string; before: string; after: string }> = [
  { name: "code line edit", path: "src/a.ts", before: "const a = 1;", after: "const a = 2;" },
  {
    name: "trailing comment edit",
    path: "src/a.ts",
    before: "const a = 1; // before",
    after: "const a = 1; // after",
  },
  {
    name: "comment removed",
    path: "src/a.ts",
    before: "// gone\nconst a = 1;",
    after: "const a = 1;",
  },
  { name: "blank line added", path: "src/a.ts", before: "const a = 1;", after: "const a = 1;\n" },
  {
    name: "whitespace only",
    path: "src/a.ts",
    before: "const a = 1;",
    after: "const  a  =  1;",
  },
  {
    name: "new file",
    path: "src/new.ts",
    before: "",
    after: "export const a = 1;\nexport const b = 2;",
  },
  { name: "deleted file", path: "src/old.ts", before: "const a = 1;", after: "" },
  { name: "docs", path: "README.md", before: "before", after: "after" },
  { name: "config", path: "paseo.json", before: '{"a":1}', after: '{"a":2}' },
  { name: "lockfile", path: "package-lock.json", before: '{"a":1}', after: '{"a":2}' },
  { name: "test file", path: "src/a.test.ts", before: "// before", after: "// after" },
  {
    name: "styles",
    path: "src/a.css",
    before: "a :hover { color: red; }",
    after: "a:hover { color: red; }",
  },
  {
    name: "ci workflow",
    path: ".github/workflows/ci.yml",
    before: "on: push",
    after: "on: pull_request",
  },
  { name: "script", path: "scripts/build.sh", before: "make all", after: "make clean all" },
  { name: "other code", path: "src/main.go", before: "package main", after: "package main // x" },
  {
    name: "component",
    path: "src/button.tsx",
    before: "export const B = 1;",
    after: "export const B = 2;",
  },
  { name: "markdown docs folder", path: "docs/guide.md", before: "a", after: "b" },
  { name: "unknown extension", path: "assets/blob.bin", before: "a", after: "b" },
  {
    name: "multiline comment",
    path: "src/a.ts",
    before: "/* one */\nconst a = 1;",
    after: "const a = 1;",
  },
  {
    name: "reordered statements",
    path: "src/a.ts",
    before: "first();\nsecond();",
    after: "second();\nfirst();",
  },
];

describe("classification invariants", () => {
  it("is deterministic for identical input", () => {
    const before = "const a = 1; // note\nconst b = 2;\n";
    const after = "const a = 1;\nconst b = 2; // note\nconst c = 3;\n";
    expect(compare("src/deterministic.ts", before, after)).toEqual(
      compare("src/deterministic.ts", before, after),
    );
  });

  it("partitions every changed line exactly once across the fixed case table", () => {
    for (const entry of PARTITION_CASES) {
      const result = compare(entry.path, entry.before, entry.after);
      const productions = productionStat(result);
      const changedLines = {
        additions: entry.after ? entry.after.split("\n").length : 0,
        deletions: entry.before ? entry.before.split("\n").length : 0,
      };
      for (const side of ["additions", "deletions"] as const) {
        const production = PRODUCTION_CATEGORIES.reduce(
          (sum, category) => sum + result[category][side],
          0,
        );
        expect(production, `${entry.name} production ${side}`).toBe(productions[side]);
        expect(
          productions[side],
          `${entry.name} production ${side} within file total`,
        ).toBeLessThanOrEqual(changedLines[side]);
        expect(
          result.commentsIncluded[side],
          `${entry.name} commentsIncluded ${side}`,
        ).toBeLessThanOrEqual(productions[side]);
      }
    }
  });
});
