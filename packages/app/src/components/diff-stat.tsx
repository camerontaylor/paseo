import { View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { formatDiffCount } from "@/git/file-header-presentation";

interface DiffStatProps {
  additions: number;
  deletions: number;
  testID?: string;
  muted?: boolean;
}

export function DiffStat({ additions, deletions, testID, muted = false }: DiffStatProps) {
  return (
    <View style={styles.row} testID={testID}>
      <Text style={[styles.additions, muted && styles.muted]}>+{formatDiffCount(additions)}</Text>
      <Text style={[styles.deletions, muted && styles.muted]}>-{formatDiffCount(deletions)}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  muted: { color: theme.colors.foregroundMuted },
  row: {
    flexDirection: "row",
    alignItems: "center",
    height: 20,
    gap: 4,
    flexShrink: 0,
  },
  additions: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.statusSuccess,
  },
  deletions: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.statusDanger,
  },
}));
