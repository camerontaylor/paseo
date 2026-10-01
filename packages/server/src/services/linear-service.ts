import { isAbsolute } from "node:path";
import { z } from "zod";
import type { LinearIssue } from "@getpaseo/protocol/linear";
import { execCommand } from "../utils/spawn.js";

const StateSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  position: z.number(),
});
const IssueSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  url: z.string().url(),
  state: StateSchema,
  team: z.object({ states: z.object({ nodes: z.array(StateSchema) }) }),
});
const LinkedIssuesSchema = z.object({
  attachmentsForURL: z.object({
    nodes: z.array(z.object({ issue: IssueSchema })),
  }),
});
const IssueIdSchema = z.object({ issue: z.object({ id: z.string() }) });
const LinkedSchema = z.object({ attachmentCreate: z.object({ success: z.boolean() }) });
const EnvelopeSchema = z.object({
  data: z.unknown().optional(),
  errors: z.array(z.object({ message: z.string() })).optional(),
});

const LINKED_ISSUES_QUERY = `query PaseoLinearIssues($url: String!) {
  attachmentsForURL(url: $url) { nodes { issue {
    id identifier title url
    state { id name type color position }
    team { states { nodes { id name type color position } } }
  } } }
}`;
const ISSUE_ID_QUERY = `query PaseoLinearIssue($id: String!) { issue(id: $id) { id } }`;
const LINK_ISSUE_MUTATION = `mutation PaseoLinkIssue($issueId: String!, $url: String!) {
  attachmentCreate(input: { issueId: $issueId, url: $url, title: "Pull request" }) { success }
}`;

class LinearServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinearServiceError";
  }
}

interface PullRequestLookup {
  cwd: string;
  prUrl: string;
}

function validateLookup({ cwd, prUrl }: PullRequestLookup): void {
  if (!isAbsolute(cwd)) throw new LinearServiceError("Workspace path must be absolute");
  const url = new URL(prUrl);
  if (url.protocol !== "https:") throw new LinearServiceError("Pull request URL must use HTTPS");
}

async function queryLinear(cwd: string, query: string, variables: Record<string, string>) {
  let stdout: string;
  try {
    ({ stdout } = await execCommand(
      "linear",
      ["api", query, "--variables-json", JSON.stringify(variables)],
      { cwd, timeout: 15_000, killSignal: "SIGKILL", maxBuffer: 2 * 1024 * 1024 },
    ));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new LinearServiceError("Install the Linear CLI on this host to show linked issues");
    }
    // Process errors include the complete command. Do not echo its arguments or environment.
    throw new LinearServiceError(
      "Linear request failed. Check the host connection and Linear CLI login, then retry",
    );
  }
  const envelope = EnvelopeSchema.parse(JSON.parse(stdout));
  if (envelope.errors?.length) {
    throw new LinearServiceError(envelope.errors.map((error) => error.message).join("; "));
  }
  return envelope.data;
}

function presentIssue(issue: z.infer<typeof IssueSchema>): LinearIssue {
  const started = issue.team.states.nodes
    .filter((state) => state.type === "started")
    .sort((a, b) => a.position - b.position);
  const index = started.findIndex((state) => state.id === issue.state.id);
  const progress = (index + 1) / (started.length + 1);
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url,
    state: {
      name: issue.state.name,
      type: issue.state.type,
      color: issue.state.color,
      progress,
    },
  };
}

interface CacheEntry {
  expiresAt: number;
  result: Promise<LinearIssue[]>;
}

/** Shared across clients so each visible header does not launch another CLI process. */
export class LinearService {
  private readonly cache = new Map<string, CacheEntry>();

  async getIssues(input: PullRequestLookup): Promise<LinearIssue[]> {
    validateLookup(input);
    const key = JSON.stringify({ cwd: input.cwd, prUrl: input.prUrl });
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.result;

    const result = queryLinear(input.cwd, LINKED_ISSUES_QUERY, { url: input.prUrl }).then(
      (data) => {
        const response = LinkedIssuesSchema.parse(data);
        const issues = response.attachmentsForURL.nodes.map(({ issue }) => presentIssue(issue));
        return [...new Map(issues.map((issue) => [issue.id, issue])).values()];
      },
    );
    const entry = { result, expiresAt: Date.now() + 30_000 };
    this.cache.delete(key);
    this.cache.set(key, entry);
    if (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value!);
    try {
      return await result;
    } catch (error) {
      if (this.cache.get(key) === entry) this.cache.delete(key);
      throw error;
    }
  }

  async linkIssue(input: PullRequestLookup & { identifier: string }): Promise<void> {
    validateLookup(input);
    const identifier = input.identifier.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9]*-\d+$/.test(identifier)) {
      throw new LinearServiceError("Enter a Linear issue identifier, such as CMS-664");
    }
    const { issue } = IssueIdSchema.parse(
      await queryLinear(input.cwd, ISSUE_ID_QUERY, { id: identifier }),
    );
    const linked = LinkedSchema.parse(
      await queryLinear(input.cwd, LINK_ISSUE_MUTATION, { issueId: issue.id, url: input.prUrl }),
    );
    if (!linked.attachmentCreate.success)
      throw new LinearServiceError("Linear did not link the issue");
    this.cache.delete(JSON.stringify({ cwd: input.cwd, prUrl: input.prUrl }));
  }
}

export const linearService = new LinearService();
