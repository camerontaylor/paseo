import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useFetchQuery } from "@/data/query";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";

export function usePackageScriptDiscovery({
  serverId,
  workspaceId,
  scripts: workspaceScripts,
  menuOpen,
}: {
  serverId: string;
  workspaceId: string;
  scripts: WorkspaceDescriptor["scripts"];
  menuOpen: boolean;
}) {
  const { t } = useTranslation();
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  // COMPAT(packageJsonScripts): added in fork v0.10.1, remove gate after 2027-04-01.
  const supportsPackages = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.packageJsonScripts === true,
  );
  const packageQuery = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 0,
    queryKey: ["workspace-package-scripts", serverId, workspaceId],
    enabled: menuOpen && supportsPackages && client !== null,
    queryFn: async () => {
      if (!client) throw new Error(t("common.errors.daemonClientUnavailable"));
      const result = await client.listWorkspaceScripts(workspaceId);
      if (result.error) throw new Error(result.error);
      return { scripts: result.scripts ?? [] };
    },
  });
  const scripts = useMemo(() => {
    if (!packageQuery.data) return workspaceScripts;
    const live = new Map(workspaceScripts.map((script) => [script.scriptName, script]));
    const discovered = packageQuery.data.scripts.filter((script) => script.packageJson);
    const packageIds = new Set(discovered.map((script) => script.scriptName));
    const configured = workspaceScripts.filter(
      (script) =>
        !script.packageJson ||
        (script.lifecycle === "running" && !packageIds.has(script.scriptName)),
    );
    return [...configured, ...discovered.map((script) => live.get(script.scriptName) ?? script)];
  }, [packageQuery.data, workspaceScripts]);
  return { scripts, packageQuery, supportsPackages };
}
