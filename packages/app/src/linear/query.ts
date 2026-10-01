import { useFetchQuery } from "@/data/query";
import { useIsFocused } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

export interface LinearWorkspaceTarget {
  serverId: string;
  cwd: string;
  prUrl: string | null;
}

export function linearIssuesKey({ serverId, cwd, prUrl }: LinearWorkspaceTarget) {
  return ["linear-issues", serverId, cwd, prUrl] as const;
}

export function useLinearIssues(target: LinearWorkspaceTarget) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(target.serverId);
  const connected = useHostRuntimeIsConnected(target.serverId);
  const focused = useIsFocused();
  const supported = useSessionStore(
    (state) => state.sessions[target.serverId]?.serverInfo?.features?.linearIssues === true,
  );
  const enabled = supported && connected && focused && Boolean(target.prUrl);
  const query = useFetchQuery({
    queryKey: linearIssuesKey(target),
    enabled,
    queryFn: async () => {
      if (!client || !target.prUrl) throw new Error(t("workspace.linear.unavailable"));
      const result = await client.getLinearIssues({ cwd: target.cwd, prUrl: target.prUrl });
      if (result.error) throw new Error(result.error);
      return result.issues;
    },
    dataShape: "value",
    staleTimeMs: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  return { query, supported, connected, client };
}
