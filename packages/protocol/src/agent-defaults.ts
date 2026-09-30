import { z } from "zod";

export const AgentDefaultSchema = z.object({
  provider: z.string().min(1),
  model: z.string(),
});

// Null clears one override without replacing other projects' defaults.
export const AgentDefaultsSchema = z.object({
  host: AgentDefaultSchema.nullable().optional(),
  projects: z.record(z.string(), AgentDefaultSchema.nullable()).optional(),
});

export type AgentDefault = z.infer<typeof AgentDefaultSchema>;
export type AgentDefaults = z.infer<typeof AgentDefaultsSchema>;

export function resolveAgentDefault(
  defaults: AgentDefaults | undefined,
  projectId: string | null | undefined,
): AgentDefault | undefined {
  return (projectId ? defaults?.projects?.[projectId] : null) ?? defaults?.host ?? undefined;
}
