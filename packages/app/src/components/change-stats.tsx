import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { type DiffStat as DiffStatValue } from "@getpaseo/protocol/diff-stat";
import { DiffStat } from "@/components/diff-stat";
import { summarizeChangeStats } from "@/components/change-stats-summary";
import { useSessionStore } from "@/stores/session-store";

interface ChangeStatsProps extends DiffStatValue {
  serverId?: string;
  testID?: string;
}

/**
 * Categorized change summary: the production stat next to the muted total. A host
 * that does not advertise `changeBreakdown` sends no breakdown, so the summary
 * falls back to the total alone.
 */
export function ChangeStats({ serverId, testID, ...stat }: ChangeStatsProps) {
  const { t } = useTranslation();
  // COMPAT(changeBreakdown): added in v0.11.1-fork (B9), remove gate after 2027-04-14.
  const supported = useSessionStore((state) =>
    serverId ? state.sessions[serverId]?.serverInfo?.features?.changeBreakdown === true : true,
  );
  const summary = summarizeChangeStats({ ...stat, supported });
  if (!summary) return null;
  return (
    <View style={styles.summary} testID={testID}>
      {summary.showProduction && summary.production && (
        <View style={styles.summaryGroup} accessibilityLabel={t("changeStats.code")}>
          {summary.estimated && <Text style={styles.label}>≈</Text>}
          <DiffStat {...summary.production} />
        </View>
      )}
      <View style={styles.summaryGroup} accessibilityLabel={t("changeStats.total")}>
        <DiffStat additions={stat.additions} deletions={stat.deletions} muted />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  summary: { flexDirection: "row", alignItems: "center", flexShrink: 0, gap: theme.spacing[2] },
  summaryGroup: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  label: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
}));
