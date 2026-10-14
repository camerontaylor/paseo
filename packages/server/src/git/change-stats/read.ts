import { readFile, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import type { Logger } from "pino";
import {
  emptyChangeBreakdown,
  sumDiffStats,
  type ChangeBreakdown,
  type DiffStat,
} from "@getpaseo/protocol/diff-stat";
import { parseDiff, type ParsedDiffFile } from "../../server/utils/diff-highlighter.js";
import { runGitCommand, type RunGitCommand } from "../../utils/run-git-command.js";
import { classifyDiff } from "./classify.js";
import { classifyPath } from "./path.js";

const READ_ONLY_GIT_ENV = { GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" };
const MAX_BYTES = 1024 * 1024;
const immutableContentCache = new Map<string, string>();
let cachedContentCharacters = 0;
const MAX_ANALYZED_FILES = 500;
const MAX_ANALYZED_UNTRACKED_FILES = 500;
const LARGE_DIFF_PATH_THRESHOLD = 200;
interface SideAccounting {
  considered: number;
  analyzed: number;
  capped: number;
  contentSkipped: number;
}
interface Comparison {
  cwd: string;
  baseRef: string;
  targetRef?: string;
  runGit?: RunGitCommand;
  logger?: Pick<Logger, "info" | "warn">;
  largeDiffPathThreshold?: number;
}

async function readContent(input: Comparison, path: string, ref?: string): Promise<string | null> {
  if (ref) {
    const key = `${input.cwd}:${ref}:${path}`;
    const cached = immutableContentCache.get(key);
    if (cached !== undefined) return cached;
    const result = await (input.runGit ?? runGitCommand)(["show", `${ref}:${path}`], {
      cwd: input.cwd,
      envOverlay: READ_ONLY_GIT_ENV,
      maxOutputBytes: MAX_BYTES,
      acceptExitCodes: [0, 128],
    });
    if (result.exitCode !== 0 || result.truncated) return null;
    if (/^[a-f0-9]{40,64}$/.test(ref)) {
      cachedContentCharacters -= immutableContentCache.get(key)?.length ?? 0;
      immutableContentCache.set(key, result.stdout);
      cachedContentCharacters += result.stdout.length;
      while (immutableContentCache.size > 256 || cachedContentCharacters > 8 * 1024 * 1024) {
        const oldest = immutableContentCache.keys().next().value!;
        cachedContentCharacters -= immutableContentCache.get(oldest)!.length;
        immutableContentCache.delete(oldest);
      }
    }
    return result.stdout;
  }
  try {
    const filePath = resolve(input.cwd, path);
    const metadata = await lstat(filePath);
    if (!metadata.isFile() || metadata.size > MAX_BYTES) return null;
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      ["ENOENT", "EACCES", "EPERM"].includes(String(error.code))
    )
      return null;
    throw error;
  }
}

export async function readFileBreakdown(
  input: Comparison & { file: ParsedDiffFile; loadPatch?: boolean },
): Promise<ChangeBreakdown> {
  return (await readFileBreakdownStats(input)).breakdown;
}

const CONTENT_EXCLUDED_CATEGORIES = new Set(["docs", "generated", "other"]);

// Content analysis is ineligible for oversized/binary metadata, for paths with no
// changed lines, and when both sides already classify as documentation, generated
// or other.
function needsContentAnalysis(file: ParsedDiffFile): boolean {
  if (file.status === "too_large") return false;
  if (file.additions + file.deletions === 0) return false;
  const oldCategory = classifyPath(file.oldPath ?? file.path);
  const newCategory = classifyPath(file.path);
  return !(
    CONTENT_EXCLUDED_CATEGORIES.has(oldCategory) && CONTENT_EXCLUDED_CATEGORIES.has(newCategory)
  );
}

async function loadFileHunks(input: Comparison, file: ParsedDiffFile, oldPath: string) {
  const refs = input.targetRef ? [input.baseRef, input.targetRef] : [input.baseRef];
  const patch = await (input.runGit ?? runGitCommand)(
    [
      "--literal-pathspecs",
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--unified=0",
      ...refs,
      "--",
      oldPath,
      file.path,
    ],
    { cwd: input.cwd, envOverlay: READ_ONLY_GIT_ENV, maxOutputBytes: MAX_BYTES },
  );
  return patch.truncated ? file.hunks : (parseDiff(patch.stdout)[0]?.hunks ?? []);
}

async function readFileBreakdownStats(
  input: Comparison & { file: ParsedDiffFile; loadPatch?: boolean },
): Promise<{ breakdown: ChangeBreakdown; content: "analyzed" | "skipped" }> {
  const { file } = input;
  const oldPath = file.oldPath ?? file.path;
  if (!needsContentAnalysis(file)) {
    return {
      breakdown: classifyDiff({ file, oldContent: null, newContent: null }),
      content: "skipped",
    };
  }
  const [oldContent, newContent] = await Promise.all([
    file.isNew ? Promise.resolve("") : readContent(input, oldPath, input.baseRef),
    file.isDeleted ? Promise.resolve("") : readContent(input, file.path, input.targetRef),
  ]);
  const wantsPatch = Boolean(
    input.loadPatch && !file.hunks.length && (file.additions || file.deletions),
  );
  const hunks = wantsPatch ? await loadFileHunks(input, file, oldPath) : file.hunks;
  // A read that was attempted and returned null counts as unavailable content.
  const contentUnavailable =
    (!file.isNew && oldContent === null) || (!file.isDeleted && newContent === null);
  return {
    breakdown: classifyDiff({ file: { ...file, hunks }, oldContent, newContent }),
    content: contentUnavailable ? "skipped" : "analyzed",
  };
}

export async function addFileBreakdowns(
  input: Comparison & { files: ParsedDiffFile[]; loadPatch?: boolean },
): Promise<{ analyzed: number; contentSkipped: number }> {
  const analyzed = Math.min(input.files.length, MAX_ANALYZED_FILES);
  let contentSkipped = 0;
  for (let offset = 0; offset < analyzed; offset += 4) {
    await Promise.all(
      input.files.slice(offset, offset + 4).map(async (file) => {
        if (file.breakdown) return;
        const result = await readFileBreakdownStats({ ...input, file });
        file.breakdown = result.breakdown;
        if (result.content === "skipped") contentSkipped++;
      }),
    );
  }
  for (const file of input.files.slice(MAX_ANALYZED_FILES)) {
    file.breakdown = classifyDiff({
      file: { ...file, hunks: [] },
      oldContent: null,
      newContent: null,
    });
  }
  return { analyzed, contentSkipped };
}

function splitNulDelimited(text: string): string[] {
  const fields = text.split("\0");
  // A truncated stream can end mid-entry; that trailing field is a partial path,
  // not a real one.
  if (fields.length > 0 && fields[fields.length - 1] !== "") fields.pop();
  return fields.filter(Boolean);
}

// The comparison patch is requested with a forced `a/`/`b/` prefix pair, so a
// section header identifies its two paths without guessing. The prefix letters
// cannot be confused with directories named `a/` or `b/` in the repository, and
// the user's diff.noprefix / diff.mnemonicPrefix cannot change what is parsed.
const PATCH_OLD_PREFIX = "a/";
const PATCH_NEW_PREFIX = "b/";
const PATCH_PREFIX_ARGS = [`--src-prefix=${PATCH_OLD_PREFIX}`, `--dst-prefix=${PATCH_NEW_PREFIX}`];

const GIT_SIMPLE_ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  v: "\v",
  f: "\f",
  b: "\b",
  a: "\u0007",
};

// Git C-quotes paths containing tabs, quotes or non-ASCII bytes. Octal escapes
// are bytes, so they are collected and decoded together with the rest as UTF-8.
function unquoteGitPath(path: string): string {
  if (path.length < 2 || !path.startsWith('"') || !path.endsWith('"')) return path;
  const body = path.slice(1, -1);
  const bytes: number[] = [];
  const pushText = (text: string) => {
    for (const byte of Buffer.from(text, "utf8")) bytes.push(byte);
  };
  for (let index = 0; index < body.length; index++) {
    const char = body[index]!;
    if (char !== "\\") {
      pushText(char);
      continue;
    }
    const escaped = body[++index];
    if (escaped === undefined) break;
    const replacement = GIT_SIMPLE_ESCAPES[escaped];
    if (replacement !== undefined) {
      pushText(replacement);
      continue;
    }
    if (/[0-7]/.test(escaped)) {
      let octal = escaped;
      while (octal.length < 3 && index + 1 < body.length && /[0-7]/.test(body[index + 1]!)) {
        octal += body[++index]!;
      }
      bytes.push(Number.parseInt(octal, 8));
      continue;
    }
    pushText(escaped);
  }
  return Buffer.from(bytes).toString("utf8");
}

function stripPatchPrefix(path: string, prefix: string): string {
  return path.startsWith(prefix) && path.length > prefix.length ? path.slice(prefix.length) : path;
}

// Our own patch stream is requested with the forced `a/`/`b/` pair; a stream that
// does not carry both halves keeps its raw paths, which is what `--numstat -z`
// reports. This is a check on the delimiter pair, not a guess from filenames.
function hasForcedPrefixPair(sectionHeader: string): boolean {
  return (
    sectionHeader.startsWith(PATCH_OLD_PREFIX) && sectionHeader.includes(` ${PATCH_NEW_PREFIX}`)
  );
}

// Git appends a tab to `---`/`+++` when the path contains a space, and writes
// `/dev/null` for the side that does not exist, so the metadata line -- not the
// `diff --git` line -- is the exact source for a path containing spaces.
function sectionMetadataPath(
  section: string,
  marker: "--- " | "+++ ",
  stripPrefix: boolean,
): string | null {
  const line = section.split("\n").find((candidate) => candidate.startsWith(marker));
  if (!line) return null;
  const raw = line.slice(marker.length).replace(/\t.*$/, "").trimEnd();
  if (!raw || raw === "/dev/null") return null;
  const path = unquoteGitPath(raw);
  if (!stripPrefix) return path;
  return stripPatchPrefix(path, marker === "+++ " ? PATCH_NEW_PREFIX : PATCH_OLD_PREFIX);
}

function patchSectionPaths(
  section: string,
  parsedPath: string,
): { oldPath: string | null; path: string } {
  const sectionHeader = section.split("\n")[0] ?? "";
  const quoted = sectionHeader.match(/"(?:[^"\\]|\\.)*"/g);
  if (quoted && quoted.length >= 2) {
    const quotedOld = unquoteGitPath(quoted[0]!);
    const quotedNew = unquoteGitPath(quoted[1]!);
    const stripPrefix =
      quotedOld.startsWith(PATCH_OLD_PREFIX) && quotedNew.startsWith(PATCH_NEW_PREFIX);
    const oldPath = stripPrefix ? stripPatchPrefix(quotedOld, PATCH_OLD_PREFIX) : quotedOld;
    const path = stripPrefix ? stripPatchPrefix(quotedNew, PATCH_NEW_PREFIX) : quotedNew;
    return { oldPath: oldPath === path ? null : oldPath, path };
  }
  const stripPrefix = hasForcedPrefixPair(sectionHeader);
  const newSide = sectionMetadataPath(section, "+++ ", stripPrefix);
  const oldSide = sectionMetadataPath(section, "--- ", stripPrefix);
  // A metadata-only section (a pure rename) has neither line; parseDiff consumed
  // the new-side prefix when it resolved the header, so its path is used as-is.
  const path = newSide ?? oldSide ?? unquoteGitPath(parsedPath);
  return { oldPath: oldSide === null || oldSide === path ? null : oldSide, path };
}

export function parseNumstat(text: string): ParsedDiffFile[] {
  const fields = text.split("\0");
  const files: ParsedDiffFile[] = [];
  for (let i = 0; i < fields.length; i++) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(fields[i]);
    if (!match) continue;
    let path = match[3];
    let oldPath: string | undefined;
    if (!path) {
      oldPath = fields[++i];
      path = fields[++i];
    }
    if (!path) continue;
    files.push({
      path,
      oldPath,
      additions: match[1] === "-" ? 0 : Number(match[1]),
      deletions: match[2] === "-" ? 0 : Number(match[2]),
      isNew: false,
      isDeleted: false,
      hunks: [],
    });
  }
  return files;
}

function emptyAccounting(): SideAccounting {
  return { considered: 0, analyzed: 0, capped: 0, contentSkipped: 0 };
}

export async function readComparisonBreakdown(
  input: Comparison & { total: DiffStat },
): Promise<ChangeBreakdown> {
  const startedAt = performance.now();
  const git = input.runGit ?? runGitCommand;
  const refs = input.targetRef ? [input.baseRef, input.targetRef] : [input.baseRef];
  const result = await git(["diff", "--no-ext-diff", "--no-textconv", "--numstat", "-z", ...refs], {
    cwd: input.cwd,
    envOverlay: READ_ONLY_GIT_ENV,
  });
  if (result.truncated) {
    // A truncated stream yields no path count, so report the fallback instead of a
    // count that describes work that did not happen.
    input.logger?.warn(
      { reason: "numstat_truncated", durationMs: performance.now() - startedAt },
      "change-stats fallback",
    );
    return exhaustiveBreakdown(input.total);
  }
  const files = parseNumstat(result.stdout);
  const trackedConsidered = files.length;
  const patch = await git(
    ["diff", "--no-ext-diff", "--no-textconv", "--unified=0", ...PATCH_PREFIX_ARGS, ...refs],
    {
      cwd: input.cwd,
      envOverlay: READ_ONLY_GIT_ENV,
    },
  );
  const attachment = patch.truncated
    ? { matched: 0, unmatched: 0, truncated: true }
    : { ...attachPatchHunks(files, patch.stdout), truncated: false };
  const trackedAnalysis = await addFileBreakdowns({ ...input, files });
  const tracked: SideAccounting = {
    considered: trackedConsidered,
    analyzed: trackedAnalysis.analyzed,
    capped: Math.max(0, trackedConsidered - trackedAnalysis.analyzed),
    contentSkipped: trackedAnalysis.contentSkipped,
  };
  const untracked = input.targetRef
    ? { accounting: emptyAccounting(), truncated: false }
    : await appendUntrackedFiles(input, git, files);
  const sum = sumDiffStats(files);
  const reconciliation = reconcileBreakdown(sum, input.total);
  logClassification(input.logger, input.largeDiffPathThreshold ?? LARGE_DIFF_PATH_THRESHOLD, {
    durationMs: performance.now() - startedAt,
    tracked,
    untracked: untracked.accounting,
    patchMatched: attachment.matched,
    patchUnmatched: attachment.unmatched,
    truncatedPatch: attachment.truncated,
    truncatedUntracked: untracked.truncated,
    reconciledFallback: reconciliation.reconciledFallback,
  });
  return reconciliation.breakdown;
}

// Both streams describe the same paths, but only path identity shows that a patch
// record belongs to a metadata record: equal counts do not. Sections and parsed
// records come from the same split, so they line up by index; when they do not,
// nothing is attached.
function attachPatchHunks(
  files: ParsedDiffFile[],
  patchText: string,
): { matched: number; unmatched: number } {
  const records = parseDiff(patchText);
  const sections = patchText.split(/^diff --git /m).filter(Boolean);
  if (records.length !== sections.length) return { matched: 0, unmatched: records.length };
  let matched = 0;
  let unmatched = 0;
  const byPath = new Map<string, Array<{ record: ParsedDiffFile; oldPath: string | null }>>();
  for (let index = 0; index < records.length; index++) {
    const sides = patchSectionPaths(sections[index]!, records[index]!.path);
    const entry = { record: records[index], oldPath: sides.oldPath };
    const bucket = byPath.get(sides.path);
    if (bucket) bucket.push(entry);
    else byPath.set(sides.path, [entry]);
  }
  for (const file of files) {
    const entry = byPath.get(file.path)?.shift();
    if (!entry) continue;
    // A rename is identified by its new path on both streams; the old path is only
    // a check when both sides declare it.
    const oldPathDisagrees =
      file.oldPath !== undefined && entry.oldPath !== null && file.oldPath !== entry.oldPath;
    if (
      oldPathDisagrees ||
      file.additions !== entry.record.additions ||
      file.deletions !== entry.record.deletions
    ) {
      unmatched++;
      continue;
    }
    file.hunks = entry.record.hunks;
    matched++;
  }
  for (const bucket of byPath.values()) unmatched += bucket.length;
  return { matched, unmatched };
}

async function readUntrackedFile(input: Comparison, path: string): Promise<ParsedDiffFile | null> {
  const content = await readContent(input, path);
  if (!content || content.includes("\0")) return null;
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const file: ParsedDiffFile = {
    path,
    isNew: true,
    isDeleted: false,
    additions: lines.length,
    deletions: 0,
    hunks: [
      {
        oldStart: 0,
        oldCount: 0,
        newStart: 1,
        newCount: lines.length,
        lines: lines.map((line) => ({ type: "add", content: line })),
      },
    ],
  };
  file.breakdown = classifyDiff({ file, oldContent: "", newContent: content });
  return file;
}

async function appendUntrackedFiles(
  input: Comparison,
  git: RunGitCommand,
  files: ParsedDiffFile[],
): Promise<{ accounting: SideAccounting; truncated: boolean }> {
  const listing = await git(["ls-files", "--others", "--exclude-standard", "-z"], {
    cwd: input.cwd,
    envOverlay: READ_ONLY_GIT_ENV,
  });
  const paths = splitNulDelimited(listing.stdout);
  const accounting: SideAccounting = {
    considered: paths.length,
    analyzed: Math.min(paths.length, MAX_ANALYZED_UNTRACKED_FILES),
    capped: 0,
    contentSkipped: 0,
  };
  accounting.capped = paths.length - accounting.analyzed;
  for (const path of paths.slice(0, accounting.analyzed)) {
    const file = await readUntrackedFile(input, path);
    if (!file) accounting.contentSkipped++;
    else files.push(file);
  }
  // This flag means Git output truncation only; the 500-path budget is reported by
  // `capped` alone.
  return { accounting, truncated: listing.truncated };
}

function exhaustiveBreakdown(total: DiffStat): ChangeBreakdown {
  const breakdown = emptyChangeBreakdown();
  breakdown.other = { additions: total.additions, deletions: total.deletions };
  return breakdown;
}

// A working tree can change between Git's total and the content reads. A partition
// from a different snapshot is returned as an all-`other` fallback instead of as if
// it reconciled.
function reconcileBreakdown(
  sum: DiffStat,
  total: DiffStat,
): { breakdown: ChangeBreakdown; reconciledFallback: boolean } {
  if (sum.additions > total.additions || sum.deletions > total.deletions) {
    return { breakdown: exhaustiveBreakdown(total), reconciledFallback: true };
  }
  const breakdown = sum.breakdown ?? emptyChangeBreakdown();
  breakdown.other.additions += total.additions - sum.additions;
  breakdown.other.deletions += total.deletions - sum.deletions;
  return { breakdown, reconciledFallback: false };
}

interface ClassificationEvent {
  durationMs: number;
  tracked: SideAccounting;
  untracked: SideAccounting;
  patchMatched: number;
  patchUnmatched: number;
  truncatedPatch: boolean;
  truncatedUntracked: boolean;
  reconciledFallback: boolean;
}

function logClassification(
  logger: Comparison["logger"],
  threshold: number,
  event: ClassificationEvent,
): void {
  if (!logger) return;
  const pathCount = event.tracked.considered + event.untracked.considered;
  const interesting =
    pathCount >= threshold ||
    event.truncatedPatch ||
    event.truncatedUntracked ||
    event.reconciledFallback;
  if (!interesting) return;
  logger.info(
    {
      durationMs: event.durationMs,
      pathCount,
      analyzedCount: event.tracked.analyzed + event.untracked.analyzed,
      cappedCount: event.tracked.capped + event.untracked.capped,
      tracked: event.tracked,
      untracked: event.untracked,
      patchMatched: event.patchMatched,
      patchUnmatched: event.patchUnmatched,
      truncatedPatch: event.truncatedPatch,
      truncatedUntracked: event.truncatedUntracked,
      reconciledFallback: event.reconciledFallback,
    },
    "change-stats classification",
  );
}
