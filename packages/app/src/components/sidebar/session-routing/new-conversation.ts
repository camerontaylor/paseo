import type { NewConversationWorkspace } from "./model";

export interface NewConversationCandidate extends NewConversationWorkspace {
  workspaceDirectory?: string;
  projectRootPath?: string;
}

export function defaultNewConversationWorkspace(input: {
  workspaces: readonly NewConversationCandidate[];
  serverIds: readonly string[];
  scope: string | null;
  active: { serverId: string; workspaceId: string } | null;
}): NewConversationWorkspace | null {
  const eligible = input.workspaces.filter(
    (workspace) =>
      input.serverIds.includes(workspace.serverId) &&
      (input.scope === null || workspace.projectViewKey === input.scope),
  );
  if (input.scope !== null) {
    return (
      eligible.find(
        (workspace) =>
          workspace.serverId === input.active?.serverId &&
          workspace.workspaceId === input.active?.workspaceId,
      ) ?? (eligible.length === 1 ? eligible[0]! : null)
    );
  }
  let serverId = input.serverIds.length === 1 ? input.serverIds[0] : null;
  if (input.active && input.serverIds.includes(input.active.serverId))
    serverId = input.active.serverId;
  const scratch = eligible.filter(
    (workspace) =>
      workspace.serverId === serverId &&
      [workspace.workspaceDirectory, workspace.projectRootPath].some(
        (path) =>
          path?.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop()?.toLowerCase() ===
          "tmpworkspace",
      ),
  );
  // Prefer the root workspace over one of its worktrees; ambiguity stays visible.
  const roots = scratch.filter(
    (workspace) => workspace.workspaceDirectory === workspace.projectRootPath,
  );
  if (roots.length === 1) return roots[0]!;
  return scratch.length === 1 ? scratch[0]! : null;
}

export async function prepareNewConversationDraft(input: {
  workspace: NewConversationWorkspace;
  text: string;
  draftId: string;
  save: (draftId: string, text: string) => void;
  flush: () => Promise<void>;
  isEligible: () => boolean;
  navigate: (input: {
    serverId: string;
    workspaceId: string;
    target: { kind: "draft"; draftId: string };
  }) => void;
}): Promise<void> {
  if (!input.isEligible()) throw new Error("Choose an available workspace.");
  input.save(input.draftId, input.text);
  await input.flush();
  if (!input.isEligible()) throw new Error("Choose an available workspace.");
  input.navigate({
    serverId: input.workspace.serverId,
    workspaceId: input.workspace.workspaceId,
    target: { kind: "draft", draftId: input.draftId },
  });
}
