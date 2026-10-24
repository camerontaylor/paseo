import { normalizeInlinePathTarget, type InlinePathTarget } from "./parse";
import {
  normalizeWorkspaceFileLocation,
  type WorkspaceFileLocation,
  type OpenFileDisposition,
} from "@/workspace/file-open";
import { isAbsolutePath } from "@/utils/path";

interface PathOpenInput {
  file?: string;
  directory: string;
  lineStart?: number;
  workspaceRoot: string;
  client: { listDirectory(root: string, path: string): Promise<unknown> } | null;
}

type PathOpenTarget = { kind: "file" } | { kind: "directory"; directoryPath: string };

/** Resolve workspace folders from filesystem facts, including names that contain dots. */
export async function resolveInlinePathOpen(input: PathOpenInput): Promise<PathOpenTarget> {
  if (!input.file) {
    return { kind: "directory", directoryPath: input.directory };
  }
  if (
    input.lineStart !== undefined ||
    isAbsolutePath(input.file) ||
    !input.workspaceRoot.trim() ||
    !input.client
  ) {
    return { kind: "file" };
  }
  try {
    await input.client.listDirectory(input.workspaceRoot, input.file);
  } catch {
    return { kind: "file" };
  }
  return { kind: "directory", directoryPath: input.file };
}

export function createInlinePathOpener(input: {
  workspaceRoot: string;
  sourceCwd?: string;
  onError?: (error: "pathUnavailable" | "outsideWorkspaceDirectory" | null) => void;
  client: PathOpenInput["client"];
  openFile: (location: WorkspaceFileLocation, disposition: OpenFileDisposition) => void;
  openDirectory: (path: string) => void;
}) {
  let generation = 0;
  return {
    async open(target: InlinePathTarget, disposition: OpenFileDisposition) {
      const ownGeneration = ++generation;
      const normalized = normalizeInlinePathTarget(target.path, {
        sourceCwd: input.sourceCwd ?? input.workspaceRoot,
        workspaceRoot: input.workspaceRoot,
      });
      if (!normalized) {
        input.onError?.("pathUnavailable");
        return;
      }
      if ("error" in normalized) {
        input.onError?.(normalized.error);
        return;
      }
      input.onError?.(null);
      const destination = await resolveInlinePathOpen({
        ...normalized,
        lineStart: target.lineStart,
        workspaceRoot: input.workspaceRoot,
        client: input.client,
      });
      if (ownGeneration !== generation) return;
      if (destination.kind === "directory") {
        input.openDirectory(destination.directoryPath);
      } else if (normalized.file) {
        const location = normalizeWorkspaceFileLocation({
          path: normalized.file,
          lineStart: target.lineStart,
          lineEnd: target.lineEnd,
        });
        if (location) input.openFile(location, disposition);
      }
    },
    cancel() {
      generation += 1;
    },
  };
}
