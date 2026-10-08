import { useRpc } from "@getpaseo/plugin/client";
import { useCallback } from "react";
import {
  SettingsAction,
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "@getpaseo/plugin/client/ui";
import { statusRpc } from "../shared/status";

export function Settings() {
  const status = useRpc(statusRpc);
  const refresh = useCallback(() => void status({}), [status]);
  return (
    <SettingsSection title="Provider">
      <SettingsCard>
        <SettingsRow label="Native SDK imports" />
        <SettingsAction label="Provider status" actionLabel="Refresh" onPress={refresh} />
      </SettingsCard>
    </SettingsSection>
  );
}
