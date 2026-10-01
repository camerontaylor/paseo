import { z } from "zod";

export const LinearIssueSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  url: z.string(),
  state: z.object({
    name: z.string(),
    type: z.string(),
    color: z.string(),
    /** Fraction of the started-state circle, based on the team's workflow order. */
    progress: z.number(),
  }),
});

export type LinearIssue = z.infer<typeof LinearIssueSchema>;

export const LinearGetIssuesRequestSchema = z.object({
  type: z.literal("checkout.linear.get_issues.request"),
  cwd: z.string(),
  prUrl: z.string(),
  requestId: z.string(),
});

export const LinearGetIssuesResponseSchema = z.object({
  type: z.literal("checkout.linear.get_issues.response"),
  payload: z.object({
    issues: z.array(LinearIssueSchema),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const LinearLinkIssueRequestSchema = z.object({
  type: z.literal("checkout.linear.link_issue.request"),
  cwd: z.string(),
  prUrl: z.string(),
  identifier: z.string(),
  requestId: z.string(),
});

export const LinearLinkIssueResponseSchema = z.object({
  type: z.literal("checkout.linear.link_issue.response"),
  payload: z.object({
    success: z.boolean(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export type LinearGetIssuesRequest = z.infer<typeof LinearGetIssuesRequestSchema>;
export type LinearGetIssuesResponse = z.infer<typeof LinearGetIssuesResponseSchema>;
export type LinearLinkIssueRequest = z.infer<typeof LinearLinkIssueRequestSchema>;
export type LinearLinkIssueResponse = z.infer<typeof LinearLinkIssueResponseSchema>;
