import { useMemo } from "react";
import { useShallow } from "zustand/shallow";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeIsDirectoryLoading } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import type { FormInitialValues } from "@/provider-selection/resolve-agent-form";
import { findDefaultProjectId, seedAgentDefaults } from "./defaults";

export function useAgentDefaults(input: {
  serverId: string | null;
  workingDir: string;
  initialValues: FormInitialValues | undefined;
}) {
  const supported = useHostFeature(input.serverId, "agentDefaults");
  const { config, error } = useDaemonConfig(supported ? input.serverId : null);
  const directoryLoading = useHostRuntimeIsDirectoryLoading(input.serverId ?? "");
  const { projects, workspaces } = useSessionStore(
    useShallow((state) => ({
      projects: state.sessions[input.serverId ?? ""]?.projects,
      workspaces: state.sessions[input.serverId ?? ""]?.workspaces,
    })),
  );
  const projectId = useMemo(
    () =>
      findDefaultProjectId({
        workingDir: input.workingDir,
        projects: projects?.values() ?? [],
        workspaces: workspaces?.values() ?? [],
      }),
    [input.workingDir, projects, workspaces],
  );
  const initialValues = useMemo(
    () =>
      seedAgentDefaults({
        defaults: config?.agentDefaults,
        projectId,
        initialValues: input.initialValues,
      }),
    [config?.agentDefaults, projectId, input.initialValues],
  );
  return {
    initialValues,
    projectId,
    isLoading: supported && (config === null || directoryLoading),
    error: supported ? error : null,
  };
}
