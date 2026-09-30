import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { AgentDefault } from "@getpaseo/protocol/agent-defaults";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { buildSelectableProviderSelectorProviders } from "@/provider-selection/provider-selection";
import { settingsStyles } from "@/styles/settings";

export function AgentDefaultsSection({
  serverId,
  projectId,
  workingDir,
}: {
  serverId: string;
  projectId?: string;
  workingDir?: string;
}) {
  const { t } = useTranslation();
  const supported = useHostFeature(serverId, "agentDefaults");
  return (
    <SettingsSection title={t("settings.agentDefaults.title")} testID="agent-defaults-section">
      <SettingsCard>
        {supported ? (
          <AgentDefaultsPicker serverId={serverId} projectId={projectId} workingDir={workingDir} />
        ) : (
          <SettingsRow label={t("settings.agentDefaults.updateHost")} />
        )}
      </SettingsCard>
    </SettingsSection>
  );
}

function AgentDefaultsPicker({
  serverId,
  projectId,
  workingDir,
}: {
  serverId: string;
  projectId?: string;
  workingDir?: string;
}) {
  const { t } = useTranslation();
  const connected = useHostRuntimeIsConnected(serverId);
  const { config, error, patchConfig } = useDaemonConfig(serverId);
  const { entries, isLoading, refresh, refetchIfStale } = useProvidersSnapshot(serverId, {
    cwd: workingDir,
  });
  const providers = useMemo(() => buildSelectableProviderSelectorProviders(entries), [entries]);
  const defaults = config?.agentDefaults;
  const selection = projectId ? defaults?.projects?.[projectId] : defaults?.host;
  const inheritedLabel = t(
    projectId ? "settings.agentDefaults.inherit" : "settings.agentDefaults.remember",
  );
  const mutation = useMutation({
    mutationFn: async (next: AgentDefault | null) => {
      const result = await patchConfig({
        agentDefaults: projectId ? { projects: { [projectId]: next } } : { host: next },
      });
      if (!result) throw new Error(t("workspace.terminal.hostDisconnected"));
    },
  });
  const { mutate, isPending } = mutation;
  const select = useCallback(
    (provider: string, model: string) => mutate({ provider, model }),
    [mutate],
  );
  const reset = useCallback(() => mutate(null), [mutate]);
  const open = useCallback(
    () => refetchIfStale(selection?.provider),
    [refetchIfStale, selection?.provider],
  );
  const retry = useCallback(
    (provider: string) => {
      void refresh([provider]);
    },
    [refresh],
  );
  const errorText = mutation.error ? String(mutation.error) : error;
  const renderInheritedTrigger = useCallback(
    () => <Text style={settingsStyles.rowTitle}>{inheritedLabel}</Text>,
    [inheritedLabel],
  );

  return (
    <SettingsRow label={t("settings.agentDefaults.model")} error={errorText ?? undefined}>
      <View style={styles.controls}>
        <CombinedModelSelector
          providers={providers}
          selectedProvider={selection?.provider ?? ""}
          selectedModel={selection?.model ?? ""}
          onSelect={select}
          isLoading={isLoading}
          disabled={!connected || config === null || isPending}
          serverId={serverId}
          desktopPlacement="top-start"
          desktopMinWidth={320}
          onOpen={open}
          onRetryProvider={retry}
          renderTrigger={!selection ? renderInheritedTrigger : undefined}
        />
        {selection ? (
          <Button
            variant="ghost"
            size="sm"
            onPress={reset}
            disabled={isPending || !connected}
            testID="agent-defaults-reset"
          >
            {inheritedLabel}
          </Button>
        ) : null}
      </View>
    </SettingsRow>
  );
}

const styles = StyleSheet.create((theme) => ({
  controls: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: theme.spacing[2] },
}));
