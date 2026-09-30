import { resolveAgentDefault, type AgentDefaults } from "@getpaseo/protocol/agent-defaults";
import type { FormInitialValues } from "@/provider-selection/resolve-agent-form";

export function findDefaultProjectId(input: {
  workingDir: string;
  projects: Iterable<{ projectId: string; projectRootPath: string }>;
  workspaces: Iterable<{ projectId: string; workspaceDirectory: string }>;
}): string | null {
  for (const project of input.projects) {
    if (project.projectRootPath === input.workingDir) return project.projectId;
  }
  for (const workspace of input.workspaces) {
    if (workspace.workspaceDirectory === input.workingDir) return workspace.projectId;
  }
  return null;
}

export function seedAgentDefaults(input: {
  defaults: AgentDefaults | undefined;
  projectId: string | null;
  initialValues: FormInitialValues | undefined;
}): FormInitialValues | undefined {
  // Forks and handoffs carry an explicit launch choice and keep it intact.
  if (input.initialValues?.provider) return input.initialValues;
  const selection = resolveAgentDefault(input.defaults, input.projectId);
  return selection ? { ...selection, ...input.initialValues } : input.initialValues;
}
