import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useIsCompactFormFactor } from "@/constants/layout";
import { getDeviceTimeZone } from "@/utils/device-timezone";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { calendarDays, dateText, openSnoozeForm, presetDate, type TimePreset } from "./form-model";
import { useSnoozeDialog, type SnoozeTarget } from "./store";

export function WorkspaceSnoozeHost() {
  const target = useSnoozeDialog((state) => state.target);
  const close = useSnoozeDialog((state) => state.close);
  return target ? (
    <SnoozeDialog
      key={`${target.serverId}:${target.workspaceId}`}
      target={target}
      onClose={close}
    />
  ) : null;
}
function useSnoozeForm(target: SnoozeTarget, onClose: () => void) {
  const [model] = useState(() =>
    openSnoozeForm({
      snooze: target.snooze,
      timezone: getDeviceTimeZone(),
      now: () => new Date(),
      saved: onClose,
      save: async (input) => {
        const client = getHostRuntimeStore().getClient(target.serverId);
        if (!client) throw new Error("Host disconnected");
        await client.setWorkspaceSnooze(target.workspaceId, input);
      },
      check: async () => {
        const client = getHostRuntimeStore().getClient(target.serverId);
        if (!client) throw new Error("Host disconnected");
        await client.checkWorkspaceSnooze(target.workspaceId);
      },
    }),
  );
  useEffect(() => () => model.close(), [model]);
  return model;
}
function SnoozeDialog({ target, onClose }: { target: SnoozeTarget; onClose: () => void }) {
  const { t } = useTranslation();
  const size = useIsCompactFormFactor() ? "md" : "sm";
  const model = useSnoozeForm(target, onClose);
  const state = useSyncExternalStore(model.subscribe, model.getState);
  const latest = useWorkspaceFields(target.serverId, target.workspaceId, (workspace) => ({
    snooze: workspace.snooze,
  }));
  const [openedAt] = useState(() => new Date());
  const presets: Exclude<TimePreset, "custom">[] = ["hour", "day", "tomorrow", "monday"];
  const seen = new Set<number>();
  const lastCheck = latest?.snooze?.lastCheck;
  const nextCheckAt = latest?.snooze?.nextCheckAt;
  const close = useCallback(() => {
    if (!state.pending) onClose();
  }, [state.pending, onClose]);
  const submit = useCallback(() => void model.submit(), [model]);
  const unsnooze = useCallback(() => void model.unsnooze(), [model]);
  const check = useCallback(() => void model.check(), [model]);
  const custom = useCallback(() => model.setPreset("custom"), [model]);
  const previousMonth = useCallback(() => model.moveMonth(-1), [model]);
  const nextMonth = useCallback(() => model.moveMonth(1), [model]);
  const interval = useCallback(
    (value: string) => model.setInterval(value === "1" ? 1 : 24),
    [model],
  );
  const header = useMemo(
    () => ({ title: t("workspaceSnooze.title"), subtitle: target.name }),
    [t, target.name],
  );
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        {target.snooze ? (
          <Button variant="secondary" disabled={state.pending} onPress={unsnooze}>
            {t("workspaceSnooze.unsnooze")}
          </Button>
        ) : null}
        <Button variant="secondary" disabled={state.pending} onPress={close}>
          {t("common.actions.cancel")}
        </Button>
        <Button
          loading={state.pending}
          disabled={state.pending}
          onPress={submit}
          testID="workspace-snooze-submit"
        >
          {t("workspaceSnooze.save")}
        </Button>
      </View>
    ),
    [target.snooze, state.pending, unsnooze, close, submit, t],
  );
  return (
    <AdaptiveModalSheet
      visible
      onClose={close}
      testID="workspace-snooze-dialog"
      header={header}
      footer={footer}
    >
      <View style={styles.body} pointerEvents={state.pending ? "none" : "auto"}>
        <SegmentedControl
          size={size}
          value={state.mode}
          onValueChange={model.setMode}
          options={[
            { value: "time", label: t("workspaceSnooze.time"), testID: "snooze-mode-time" },
            { value: "ai", label: t("workspaceSnooze.ai"), testID: "snooze-mode-ai" },
          ]}
        />
        {state.mode === "time" ? (
          <>
            {presets.map((preset) => {
              const date = presetDate(preset, openedAt);
              if (seen.has(date.getTime())) return null;
              seen.add(date.getTime());
              return (
                <PresetButton
                  key={preset}
                  preset={preset}
                  selected={state.preset === preset}
                  onSelect={model.setPreset}
                >
                  {t(`workspaceSnooze.presets.${preset}`)} ·{" "}
                  {date.toLocaleString([], {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </PresetButton>
              );
            })}
            <Button
              variant={state.preset === "custom" ? "default" : "secondary"}
              onPress={custom}
              testID="snooze-preset-custom"
            >
              {t("workspaceSnooze.presets.custom")}
            </Button>
            {state.preset === "custom" ? (
              <>
                <View style={styles.footer}>
                  <Button
                    variant="ghost"
                    accessibilityLabel={t("workspaceSnooze.previousMonth")}
                    onPress={previousMonth}
                  >
                    ‹
                  </Button>
                  <Text style={styles.text}>
                    {state.month.toLocaleString([], { month: "long", year: "numeric" })}
                  </Text>
                  <Button
                    variant="ghost"
                    accessibilityLabel={t("workspaceSnooze.nextMonth")}
                    onPress={nextMonth}
                  >
                    ›
                  </Button>
                </View>
                <View style={styles.calendar}>
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
                    <Text key={day} style={[styles.day, styles.text]}>
                      {day}
                    </Text>
                  ))}
                  {calendarDays(state.month).map((date, index) => (
                    <View key={date ?? `blank-${index}`} style={styles.day}>
                      {date ? (
                        <CalendarDay
                          date={date}
                          selected={state.date === date}
                          disabled={date < dateText(openedAt)}
                          onSelect={model.setDate}
                        />
                      ) : null}
                    </View>
                  ))}
                </View>
                <Field label={t("workspaceSnooze.clockTime")}>
                  <FormTextInput
                    size={size}
                    initialValue={state.time}
                    onChangeText={model.setTime}
                    placeholder="09:00"
                    testID="snooze-custom-time"
                  />
                </Field>
              </>
            ) : null}
            <Text style={styles.muted}>{getDeviceTimeZone()}</Text>
          </>
        ) : (
          <>
            <Field label={t("workspaceSnooze.condition")}>
              <FormTextInput
                size={size}
                multiline
                maxLength={8000}
                initialValue={state.prompt}
                onChangeText={model.setPrompt}
                placeholder={t("workspaceSnooze.placeholder")}
                testID="snooze-condition"
              />
            </Field>
            <Field label={t("workspaceSnooze.interval")}>
              <SegmentedControl
                size={size}
                value={String(state.intervalHours)}
                onValueChange={interval}
                options={[
                  { value: "1", label: t("workspaceSnooze.hourly") },
                  { value: "24", label: t("workspaceSnooze.daily") },
                ]}
              />
            </Field>
            {lastCheck ? (
              <Text style={styles.text}>
                {t(`workspaceSnooze.result.${lastCheck.status}`)} · {lastCheck.reason}
              </Text>
            ) : null}
            {nextCheckAt ? (
              <Text style={styles.muted}>
                {t("workspaceSnooze.nextCheck", { time: new Date(nextCheckAt).toLocaleString() })}
              </Text>
            ) : null}
            {target.snooze?.config.mode === "ai" ? (
              <Button variant="secondary" onPress={check} testID="snooze-check-now">
                {t("workspaceSnooze.checkNow")}
              </Button>
            ) : null}
            {state.checked ? (
              <Text style={styles.muted}>{t("workspaceSnooze.checkQueued")}</Text>
            ) : null}
          </>
        )}
        {state.error ? (
          <Text accessibilityRole="alert" style={styles.error} testID="snooze-error">
            {state.error}
          </Text>
        ) : null}
      </View>
    </AdaptiveModalSheet>
  );
}
const styles = StyleSheet.create((theme) => ({
  body: { padding: theme.spacing[4], gap: theme.spacing[3] },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    padding: theme.spacing[3],
  },
  calendar: { flexDirection: "row", flexWrap: "wrap" },
  day: { width: "14.2857%", textAlign: "center", minHeight: 32 },
  text: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
}));

function PresetButton({
  preset,
  selected,
  onSelect,
  children,
}: {
  preset: TimePreset;
  selected: boolean;
  onSelect: (preset: TimePreset) => void;
  children: ReactNode;
}) {
  const press = useCallback(() => onSelect(preset), [onSelect, preset]);
  return (
    <Button
      variant={selected ? "default" : "secondary"}
      onPress={press}
      testID={`snooze-preset-${preset}`}
    >
      {children}
    </Button>
  );
}
function CalendarDay({
  date,
  selected,
  disabled,
  onSelect,
}: {
  date: string;
  selected: boolean;
  disabled: boolean;
  onSelect: (date: string) => void;
}) {
  const press = useCallback(() => onSelect(date), [onSelect, date]);
  return (
    <Button
      size="sm"
      variant={selected ? "default" : "ghost"}
      disabled={disabled}
      accessibilityLabel={date}
      onPress={press}
    >
      {String(Number(date.slice(-2)))}
    </Button>
  );
}
