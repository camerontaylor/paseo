import { useCallback, useState } from "react";
import { Text } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { MenuItem, MenuTextField, useMenuContext } from "@/components/ui/menu";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { linearIssuesKey, type LinearWorkspaceTarget } from "./query";

export function LinkLinearIssuePage({ target }: { target: LinearWorkspaceTarget }) {
  const { t } = useTranslation();
  const menu = useMenuContext("LinkLinearIssuePage");
  const [identifier, setIdentifier] = useState("");
  const client = useHostRuntimeClient(target.serverId);
  const connected = useHostRuntimeIsConnected(target.serverId);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => {
      if (!client || !target.prUrl) throw new Error(t("workspace.linear.unavailable"));
      const result = await client.linkLinearIssue({
        cwd: target.cwd,
        prUrl: target.prUrl,
        identifier: identifier.trim(),
      });
      if (!result.success) throw new Error(result.error ?? t("workspace.linear.linkFailed"));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: linearIssuesKey(target) });
      menu.setOpen(false);
    },
  });
  const valid = /^[A-Z][A-Z0-9]*-\d+$/i.test(identifier.trim());
  const disabled = !connected || !valid || mutation.isPending;
  const submit = useCallback(() => {
    if (!disabled) mutation.mutate();
  }, [disabled, mutation]);

  return (
    <>
      <MenuTextField
        placeholder={t("workspace.linear.identifier")}
        onChangeText={setIdentifier}
        onSubmitEditing={submit}
        editable={!mutation.isPending}
        autoFocus
        testID="linear-issue-identifier"
      />
      <MenuItem
        testID="linear-link-submit"
        disabled={disabled}
        status={mutation.isPending ? "pending" : "idle"}
        pendingLabel={t("workspace.linear.linking")}
        closeOnSelect={false}
        onSelect={submit}
      >
        {t("workspace.linear.link")}
      </MenuItem>
      {mutation.error ? (
        <Text accessibilityRole="alert" style={styles.error} testID="linear-link-error">
          {mutation.error.message}
        </Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  error: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[3],
  },
}));
