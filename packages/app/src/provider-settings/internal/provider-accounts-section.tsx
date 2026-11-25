import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, View } from "react-native";
import {
  ProviderAccountSheet,
  type ProviderAccountSaveInput,
} from "@/components/provider-account-sheet";
import { SettingsCard, SettingsDetailRow } from "@/components/settings";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import {
  canAddProviderAccount,
  resolveProviderAccountBaseId,
} from "@/provider-accounts/provider-account-form-model";
import { useHostFeature } from "@/runtime/host-features";
import { settingsStyles } from "@/styles/settings";
import type { ProviderEntry } from "./provider-config";

type ProviderConfig = NonNullable<
  ReturnType<typeof useDaemonConfig>["config"]
>["providers"][string];

interface ProviderAccountTarget {
  baseProviderId: string;
  baseProviderLabel: string;
  account?: { providerId: string; config: ProviderConfig };
}

/**
 * Fork: provider accounts. A builtin provider offers Add account, which writes a custom provider
 * that extends it; such an account offers Edit account. Hidden when neither applies.
 */
export function ProviderAccountsSection({
  serverId,
  entry,
  label,
}: {
  serverId: string;
  entry: ProviderEntry;
  label: string;
}) {
  const { t } = useTranslation();
  const supportsReplace = useHostFeature(serverId, "providerConfigReplace");
  const supportsRename = useHostFeature(serverId, "providerConfigRename");
  const { entries, refresh } = useProvidersSnapshot(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  const [target, setTarget] = useState<ProviderAccountTarget | null>(null);

  const provider = entry.provider;
  const accountBaseId = resolveProviderAccountBaseId(provider, config?.providers);
  const canAdd = canAddProviderAccount({ providerId: provider, source: entry.source });
  const canEdit = supportsReplace && entry.source === "custom" && accountBaseId !== null;
  const existingProviderIds = useMemo(
    () => (entries ?? []).map((candidate) => candidate.provider),
    [entries],
  );

  const openAdd = useCallback(() => {
    setTarget({ baseProviderId: provider, baseProviderLabel: label });
  }, [label, provider]);
  const openEdit = useCallback(() => {
    const providerConfig = config?.providers[provider];
    if (!providerConfig || !accountBaseId) return;
    const baseProviderLabel =
      entries?.find((candidate) => candidate.provider === accountBaseId)?.label ?? accountBaseId;
    setTarget({
      baseProviderId: accountBaseId,
      baseProviderLabel,
      account: { providerId: provider, config: providerConfig },
    });
  }, [accountBaseId, config?.providers, entries, provider]);
  const close = useCallback(() => setTarget(null), []);
  const save = useCallback(
    async ({ providerId, originalProviderId, patch }: ProviderAccountSaveInput) => {
      try {
        await patchConfig(patch);
        await refresh(
          originalProviderId && originalProviderId !== providerId
            ? [originalProviderId, providerId]
            : [providerId],
        );
        return true;
      } catch (error) {
        Alert.alert(
          t("settings.providers.account.errorTitle"),
          error instanceof Error ? error.message : String(error),
        );
        return false;
      }
    },
    [patchConfig, refresh, t],
  );

  if (!canAdd && !canEdit) return null;
  return (
    <View style={settingsStyles.section}>
      <SettingsCard>
        {canAdd ? (
          <SettingsDetailRow
            label={t("settings.providers.actions.addAccount")}
            onPress={openAdd}
            testID={`provider-add-account-${provider}`}
          />
        ) : null}
        {canEdit ? (
          <SettingsDetailRow
            label={t("settings.providers.actions.editAccount")}
            onPress={openEdit}
            testID={`provider-edit-account-${provider}`}
          />
        ) : null}
      </SettingsCard>
      {target ? (
        <ProviderAccountSheet
          key={`${target.account ? "edit" : "add"}:${target.account?.providerId ?? target.baseProviderId}`}
          visible
          baseProviderId={target.baseProviderId}
          baseProviderLabel={target.baseProviderLabel}
          existingProviderIds={existingProviderIds}
          account={target.account}
          supportsProviderConfigRename={supportsRename}
          onClose={close}
          onSave={save}
        />
      ) : null}
    </View>
  );
}
