import { useMutation } from "@tanstack/react-query";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useCallback,
  type ReactNode,
  type Dispatch,
} from "react";
import { Text, View, ScrollView } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useShallow } from "zustand/react/shallow";
import { useTranslation } from "react-i18next";
import { v4 as uuid } from "uuid";
import { Button } from "@/components/ui/button";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { SESSION_ROUTING_DRAFT_KEY as ROUTING_DRAFT_KEY } from "@/stores/draft-keys";
import { useDraftStore, awaitDraftHydration } from "@/stores/draft-store";
import {
  useQueueOutboxStore,
  awaitOutboxHydration,
  type PendingQueueEnqueue,
} from "@/stores/queue-outbox-store";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { deliverRoutedPrompt } from "./delivery";
import {
  automaticRecipient,
  initialRoutingState,
  recipientInScope,
  routingReducer,
  type Recipient,
  type RoutingAction,
  type RoutingState,
} from "./model";

interface MatchRequest {
  query: string;
  scope: string | null;
}
interface MatchResponse {
  recipients: Recipient[];
  notice: string;
  complete: boolean;
}
interface ActiveMatch {
  requestId: string;
  mode: RoutingState["mode"];
  scope: string | null;
  hosts: string;
  query: string;
  draft: string;
  draftVersion: number;
  draftUpdatedAt: number;
}

export function SessionRoutingComposer({
  children,
}: {
  children: (submit: () => void) => ReactNode;
}) {
  const { t } = useTranslation();
  const { searchQuery, allProjects, workspacePlacements, serverIds, hostRegistryLoaded } =
    useSidebarModel();
  const [state, reduce] = useReducer(routingReducer, initialRoutingState);
  const pendingItemId = state.phase.status === "pending" ? state.phase.itemId : null;
  const rejection = useQueueOutboxStore((store) =>
    pendingItemId ? store.rejections[pendingItemId] : undefined,
  );
  const acknowledgement = useQueueOutboxStore((store) =>
    pendingItemId ? store.acknowledgements[pendingItemId] : undefined,
  );
  const pendingOutbox = useQueueOutboxStore(
    useShallow((store) => Object.values(store.entries).filter((entry) => entry.routingOrigin)),
  );
  const [savedDraftVersion, savedDraftUpdatedAt] = useDraftStore(
    useShallow((store) => [
      store.drafts[ROUTING_DRAFT_KEY]?.version,
      store.drafts[ROUTING_DRAFT_KEY]?.updatedAt,
    ]),
  );
  const hosts = useHosts();
  const selection = useActiveWorkspaceSelection();
  const request = useRef<string | null>(null);
  const activeMatch = useRef<ActiveMatch | null>(null);
  const submitting = useRef<string | null>(null);
  const hostMembership = JSON.stringify([...serverIds].sort());
  const latest = useRef({ state, serverIds, hostMembership, searchQuery });
  latest.current = { state, serverIds, hostMembership, searchQuery };
  const dispatch = useCallback(
    (action: RoutingAction) => {
      latest.current.state = routingReducer(latest.current.state, action);
      reduce(action);
    },
    [reduce],
  );
  const matchesContext = useCallback((context: ActiveMatch) => {
    const current = latest.current;
    if (
      current.state.mode !== context.mode ||
      current.state.scope !== context.scope ||
      current.hostMembership !== context.hosts
    )
      return false;
    if (context.mode === "find") return current.searchQuery === context.query;
    const draft = useDraftStore.getState().drafts[ROUTING_DRAFT_KEY];
    return (
      current.state.sendDraft === context.draft &&
      current.state.draftVersion === context.draftVersion &&
      current.state.draftUpdatedAt === context.draftUpdatedAt &&
      (draft?.version ?? 0) === context.draftVersion &&
      (draft?.updatedAt ?? 0) === context.draftUpdatedAt
    );
  }, []);
  const cancelMatch = useCallback(
    (requestId: string) => {
      if (request.current === requestId) request.current = null;
      if (activeMatch.current?.requestId === requestId) activeMatch.current = null;
      if (submitting.current === requestId) submitting.current = null;
      dispatch({ type: "cancelMatch", requestId });
    },
    [dispatch],
  );
  const sendInput = useRef<EditingTextInputHandle>(null);
  const agentMaps = useSessionStore(
    useShallow((snapshot) => serverIds.map((serverId) => snapshot.sessions[serverId]?.agents)),
  );
  const currentProject = workspacePlacements.find(
    (placement) =>
      placement.serverId === selection?.serverId &&
      placement.workspaceId === selection?.workspaceId,
  );
  const manualRecipients = useMemo(() => {
    const byWorkspace = new Map(
      workspacePlacements.map((placement) => [
        JSON.stringify([placement.serverId, placement.workspaceId]),
        placement,
      ]),
    );
    const recipients: Recipient[] = [];
    for (const agents of agentMaps) {
      if (!agents) continue;
      for (const agent of agents.values()) {
        if (agent.archivedAt || agent.parentAgentId || !agent.workspaceId) continue;
        const placement = byWorkspace.get(JSON.stringify([agent.serverId, agent.workspaceId]));
        const workspace = useSessionStore
          .getState()
          .sessions[agent.serverId]?.workspaces.get(agent.workspaceId);
        if (!placement || !workspace) continue;
        recipients.push({
          serverId: agent.serverId,
          agentId: agent.id,
          workspaceId: agent.workspaceId,
          projectId: workspace.projectId,
          projectName: placement.projectName,
          projectViewKey: placement.projectViewKey,
          hostLabel:
            hosts.find((host) => host.serverId === agent.serverId)?.label ?? agent.serverId,
          title: agent.title || placement.name,
          excerpt: "",
          confidence: 0,
        });
      }
    }
    return recipients;
  }, [agentMaps, hosts, workspacePlacements]);

  const recipientDirectory = useRef({ manualRecipients, hosts });
  recipientDirectory.current = { manualRecipients, hosts };

  const match = useMutation({
    mutationFn: async ({ query, scope }: MatchRequest): Promise<MatchResponse> => {
      const scoped = workspacePlacements.filter(
        (placement) => scope === null || placement.projectViewKey === scope,
      );
      const hostIds = serverIds;
      const responses = await Promise.allSettled(
        hostIds.map(async (serverId) => {
          const session = useSessionStore.getState().sessions[serverId];
          if (!session?.hasHydratedWorkspaces)
            throw new Error(t("sidebar.routing.directoryUnavailable"));
          const workspaceIds = scoped
            .filter((placement) => placement.serverId === serverId)
            .map((placement) => placement.workspaceId);
          if (workspaceIds.length === 0) return { recipients: [], searched: 0, total: 0 };
          if (!session?.serverInfo?.features?.sessionSearch)
            throw new Error(t("sidebar.routing.updateHost"));
          const client = getHostRuntimeStore().getClient(serverId);
          if (!client || client.getConnectionState().status !== "connected")
            throw new Error(t("sidebar.routing.offline"));
          const payload = await client.searchSessions({
            query,
            workspaceIds,
          });
          const recipients: Recipient[] = [];
          for (const result of payload.results) {
            const placement = scoped.find(
              (entry) => entry.serverId === serverId && entry.workspaceId === result.workspaceId,
            );
            if (!placement) throw new Error(t("sidebar.routing.invalidDestination"));
            recipients.push({
              ...result,
              serverId,
              projectViewKey: placement.projectViewKey,
              hostLabel: hosts.find((host) => host.serverId === serverId)?.label ?? serverId,
            });
          }
          return { recipients, searched: payload.searchedCount, total: payload.totalCount };
        }),
      );
      const recipients: Recipient[] = [];
      const failures: string[] = hostRegistryLoaded
        ? []
        : [t("sidebar.routing.directoryUnavailable")];
      let searched = 0,
        total = 0;
      for (const response of responses) {
        if (response.status === "rejected") {
          failures.push(
            response.reason instanceof Error
              ? response.reason.message
              : t("sidebar.routing.matchFailed"),
          );
          continue;
        }
        recipients.push(...response.value.recipients);
        searched += response.value.searched;
        total += response.value.total;
      }
      recipients.sort((a, b) => b.confidence - a.confidence);
      const notices = failures.map((message) => message.slice(0, 240));
      notices.push(
        t(searched < total ? "sidebar.routing.searchLimit" : "sidebar.routing.searchCoverage", {
          searched,
          total,
        }),
      );
      return {
        recipients,
        notice: notices.join(" "),
        complete: failures.length === 0 && searched === total,
      };
    },
  });

  const delivery = useMutation({
    mutationFn: async (input: {
      recipient: Recipient;
      text: string;
      itemId: string;
      draftVersion: number;
      draftUpdatedAt?: number;
    }) => {
      if (!latest.current.serverIds.includes(input.recipient.serverId))
        throw new Error(t("sidebar.routing.invalidDestination"));
      const client = getHostRuntimeStore().getClient(input.recipient.serverId);
      if (!client) throw new Error(t("sidebar.routing.offline"));
      const session = useSessionStore.getState().sessions[input.recipient.serverId];
      if (
        !session?.serverInfo?.features?.sessionSearch ||
        !session.serverInfo.features.agentMessageQueue
      )
        throw new Error(t("sidebar.routing.updateHost"));
      return deliverRoutedPrompt({
        ...input,
        client,
        isHostEligible: () => latest.current.serverIds.includes(input.recipient.serverId),
        outbox: useQueueOutboxStore.getState(),
        applySnapshot: (snapshot) =>
          useSessionStore.getState().applyAgentQueueSnapshot(input.recipient.serverId, snapshot),
      });
    },
  });

  const locked = isRoutingLocked(state);
  // Validate the currently owned lookup before input becomes interactive. A
  // delayed passive effect from an older render must never cancel a newer one.
  useLayoutEffect(() => {
    const context = activeMatch.current;
    if (context && !matchesContext(context)) cancelMatch(context.requestId);
  });
  useEffect(() => {
    dispatch({ type: "hosts", serverIds: latest.current.serverIds });
  }, [hostMembership, state.recipient?.serverId, dispatch]);
  useEffect(() => {
    let active = true;
    void Promise.all([awaitDraftHydration(), awaitOutboxHydration()])
      .then(async () => {
        if (useDraftStore.getState().drafts[ROUTING_DRAFT_KEY]?.routingClear)
          await useQueueOutboxStore.getState().recoverRoutingDraft();
        await useDraftStore.getState().hydrateDraftInput({ draftKey: ROUTING_DRAFT_KEY });
        if (!active) return undefined;
        // Migration/acknowledgement may change the record during an await. Read
        // the text and ownership together only after both persisted stores load.
        const draftStore = useDraftStore.getState();
        const record = draftStore.drafts[ROUTING_DRAFT_KEY];
        const entry = Object.values(useQueueOutboxStore.getState().entries).find(
          (pending) =>
            pending.routingOrigin &&
            !pending.removalRequested &&
            pending.routingDraftVersion === (record?.version ?? 0) &&
            pending.routingDraftUpdatedAt === (record?.updatedAt ?? 0),
        );
        dispatch({
          type: "restoreDraft",
          text: draftStore.getDraftInput(ROUTING_DRAFT_KEY)?.text ?? "",
          version: record?.version ?? 0,
          updatedAt: record?.updatedAt ?? 0,
          pending: entry
            ? pendingRecovery(
                entry,
                recipientDirectory.current.manualRecipients,
                recipientDirectory.current.hosts,
              )
            : undefined,
        });
        return undefined;
      })
      .catch(() => {
        if (active)
          dispatch({
            type: "phase",
            phase: { status: "error", message: t("sidebar.routing.draftLoadFailed") },
          });
      });
    return () => {
      active = false;
    };
  }, [t, dispatch]);
  useEffect(() => {
    if (!state.draftReady || state.phase.status === "sending" || state.phase.status === "pending")
      return;
    const entry = pendingOutbox.find(
      (pending) =>
        !pending.removalRequested &&
        pending.routingDraftVersion === state.draftVersion &&
        pending.routingDraftUpdatedAt === state.draftUpdatedAt,
    );
    if (!entry) return;
    dispatch(pendingRecovery(entry, manualRecipients, hosts));
  }, [
    manualRecipients,
    hosts,
    pendingOutbox,
    state.draftReady,
    state.phase.status,
    state.sendDraft,
    state.draftVersion,
    state.draftUpdatedAt,
    dispatch,
  ]);
  useEffect(() => {
    if (state.phase.status === "pending" && rejection)
      dispatch({ type: "phase", phase: { status: "error", message: rejection } });
  }, [rejection, state.phase.status, dispatch]);
  useEffect(() => {
    if (state.phase.status !== "pending" || !acknowledgement) return;
    dispatch({ type: "acknowledged", itemId: state.phase.itemId, queued: acknowledgement.queued });
  }, [acknowledgement, state.phase, dispatch]);
  useEffect(() => {
    if (
      !state.draftReady ||
      savedDraftVersion === undefined ||
      (savedDraftVersion === state.draftVersion && savedDraftUpdatedAt === state.draftUpdatedAt)
    )
      return;
    const draft = useDraftStore.getState().getDraftInput(ROUTING_DRAFT_KEY);
    if (draft)
      dispatch({
        type: "syncDraft",
        text: draft.text,
        version: savedDraftVersion,
        updatedAt: useDraftStore.getState().drafts[ROUTING_DRAFT_KEY]?.updatedAt ?? 0,
      });
  }, [
    savedDraftVersion,
    savedDraftUpdatedAt,
    state.draftReady,
    state.draftVersion,
    state.draftUpdatedAt,
    dispatch,
  ]);
  useEffect(() => {
    if (sendInput.current && sendInput.current.getText() !== state.sendDraft)
      sendInput.current.replaceText(state.sendDraft);
  }, [state.sendDraft, state.draftVersion]);
  useEffect(
    () => () => {
      request.current = null;
      activeMatch.current = null;
    },
    [],
  );

  const send = useCallback(
    async (
      recipient: Recipient,
      text: string,
      itemId = uuid(),
      draftVersion = state.draftVersion,
      draftUpdatedAt = state.draftUpdatedAt,
    ) => {
      const current = latest.current;
      const retry =
        current.state.phase.status === "pending" && current.state.phase.itemId === itemId;
      if (
        !current.serverIds.includes(recipient.serverId) ||
        (!retry && !recipientInScope(recipient, current.state.scope))
      )
        return;
      if (
        !retry &&
        (!current.state.draftReady ||
          current.state.phase.status === "pending" ||
          current.state.phase.status === "sending")
      )
        return;
      request.current = null;
      dispatch({
        type: "phase",
        phase: { status: "sending", recipient, text, itemId, draftVersion, draftUpdatedAt },
      });
      try {
        const result = await delivery.mutateAsync({
          recipient,
          text,
          itemId,
          draftVersion,
          draftUpdatedAt,
        });
        dispatch({ type: "acknowledged", itemId, queued: result.queued });
      } catch (error) {
        const message = error instanceof Error ? error.message : t("sidebar.routing.sendFailed");
        const deliveryAcknowledgement = useQueueOutboxStore.getState().acknowledgements[itemId];
        const stored = useQueueOutboxStore.getState().entries[itemId];
        if (deliveryAcknowledgement)
          dispatch({ type: "acknowledged", itemId, queued: deliveryAcknowledgement.queued });
        else if (!stored) dispatch({ type: "phase", phase: { status: "error", message } });
        else
          dispatch({
            type: "phase",
            phase: {
              status: "pending",
              recipient,
              text,
              itemId,
              draftVersion,
              draftUpdatedAt,
              error: message,
            },
          });
      }
    },
    [delivery, state.draftVersion, state.draftUpdatedAt, t, dispatch],
  );

  const submit = useCallback(async () => {
    if (submitting.current || locked) return;
    const text = state.mode === "find" ? searchQuery : state.sendDraft;
    if (!text.trim()) return;
    const mode = state.mode;
    const submitted = latest.current.state;
    const requestId = uuid();
    const context: ActiveMatch = {
      requestId,
      mode,
      scope: submitted.scope,
      hosts: latest.current.hostMembership,
      query: latest.current.searchQuery,
      draft: submitted.sendDraft,
      draftVersion: submitted.draftVersion,
      draftUpdatedAt: submitted.draftUpdatedAt,
    };
    const isCurrentMatch = () => {
      const current = latest.current;
      return (
        request.current === requestId &&
        current.state.phase.status === "matching" &&
        current.state.phase.requestId === requestId &&
        matchesContext(context)
      );
    };
    submitting.current = requestId;
    try {
      if (mode === "send" && state.recipient) {
        await send(state.recipient, text);
        return;
      }
      request.current = requestId;
      activeMatch.current = context;
      dispatch({ type: "phase", phase: { status: "matching", requestId, mode, text } });
      const result = await match.mutateAsync({ query: text, scope: state.scope });
      if (!isCurrentMatch()) {
        cancelMatch(requestId);
        return;
      }
      const recipient = result.complete ? automaticRecipient(result.recipients) : null;
      if (mode === "send" && recipient) {
        request.current = null;
        await send(recipient, text, undefined, submitted.draftVersion, submitted.draftUpdatedAt);
        return;
      }
      dispatch({
        type: "matched",
        requestId,
        recipients: result.recipients,
        notice: result.notice,
      });
    } catch (error) {
      if (!isCurrentMatch()) {
        cancelMatch(requestId);
        return;
      }
      dispatch({
        type: "phase",
        phase: {
          status: "error",
          message: error instanceof Error ? error.message : t("sidebar.routing.matchFailed"),
        },
      });
    } finally {
      if (submitting.current === requestId) submitting.current = null;
    }
  }, [locked, state, searchQuery, match, send, t, dispatch, matchesContext, cancelMatch]);

  const select = useCallback(
    (recipient: Recipient | null) => {
      const current = latest.current;
      if (current.state.phase.status === "sending" || current.state.phase.status === "pending")
        return;
      if (
        recipient &&
        (!current.serverIds.includes(recipient.serverId) ||
          !recipientInScope(recipient, current.state.scope))
      )
        return;
      if (request.current && submitting.current === request.current) submitting.current = null;
      request.current = null;
      dispatch({ type: "recipient", recipient });
    },
    [dispatch],
  );
  const open = useCallback((recipient: Recipient) => {
    navigateToAgent({
      serverId: recipient.serverId,
      agentId: recipient.agentId,
      workspaceId: recipient.workspaceId,
    });
  }, []);
  const setFindMode = useCallback(() => {
    dispatch({ type: "mode", mode: "find" });
  }, [dispatch]);
  const setSendMode = useCallback(() => {
    dispatch({ type: "mode", mode: "send" });
  }, [dispatch]);
  const setAllProjects = useCallback(() => {
    dispatch({ type: "scope", scope: null });
  }, [dispatch]);
  const setCurrentProject = useCallback(() => {
    if (currentProject) dispatch({ type: "scope", scope: currentProject.projectViewKey });
  }, [currentProject, dispatch]);
  const togglePicker = useCallback(() => {
    dispatch({ type: "picker", open: !state.picker });
  }, [state.picker, dispatch]);
  const openPicker = useCallback(() => {
    dispatch({ type: "picker", open: true });
  }, [dispatch]);
  const setDraft = useCallback(
    (text: string) => {
      useDraftStore.getState().editDraftText({ draftKey: ROUTING_DRAFT_KEY, text });
      dispatch({
        type: "draft",
        text,
        version: useDraftStore.getState().drafts[ROUTING_DRAFT_KEY]?.version ?? 0,
        updatedAt: useDraftStore.getState().drafts[ROUTING_DRAFT_KEY]?.updatedAt ?? 0,
      });
    },
    [dispatch],
  );
  const setPickerQuery = useCallback(
    (text: string) => {
      dispatch({ type: "pickerQuery", text });
    },
    [dispatch],
  );
  const selectAutomatic = useCallback(() => {
    select(null);
  }, [select]);
  const submitFromButton = useCallback(() => {
    void submit();
  }, [submit]);
  const sendChoice = useCallback(
    (recipient: Recipient) => {
      if (submitting.current) return;
      const submissionId = uuid();
      submitting.current = submissionId;
      void send(recipient, state.sendDraft).finally(() => {
        if (submitting.current === submissionId) submitting.current = null;
      });
    },
    [send, state.sendDraft],
  );
  const retryDelivery = useCallback(() => {
    const phase = state.phase;
    if (phase.status !== "pending" || submitting.current) return;
    const submissionId = uuid();
    submitting.current = submissionId;
    void send(
      phase.recipient,
      phase.text,
      phase.itemId,
      phase.draftVersion,
      phase.draftUpdatedAt,
    ).finally(() => {
      if (submitting.current === submissionId) submitting.current = null;
    });
  }, [send, state.phase]);
  const scopeName =
    allProjects.find((project) => project.viewKey === state.scope)?.projectName ??
    t("sidebar.routing.allProjects");
  const pickerQuery = state.pickerQuery.normalize("NFKC").toLocaleLowerCase();
  const pickerRecipients = manualRecipients.filter(
    (recipient) =>
      recipientInScope(recipient, state.scope) &&
      `${recipient.projectName} ${recipient.title} ${recipient.hostLabel}`
        .normalize("NFKC")
        .toLocaleLowerCase()
        .includes(pickerQuery),
  );

  return (
    <View style={styles.container} testID="session-routing-composer">
      <View style={styles.row}>
        <Button
          size="xs"
          variant={state.mode === "find" ? "secondary" : "ghost"}
          disabled={locked}
          accessibilityLabel={t("sidebar.routing.findMode")}
          testID="routing-find-mode"
          onPress={setFindMode}
        >
          {t("sidebar.routing.find")}
        </Button>
        <Button
          size="xs"
          variant={state.mode === "send" ? "secondary" : "ghost"}
          disabled={locked}
          accessibilityLabel={t("sidebar.routing.sendMode")}
          testID="routing-send-mode"
          onPress={setSendMode}
        >
          {t("sidebar.routing.sendPrompt")}
        </Button>
        <DropdownMenu compactMode="sheet">
          <DropdownMenuTrigger
            disabled={locked}
            accessibilityRole="button"
            accessibilityLabel={t("sidebar.routing.scope", { name: scopeName })}
            testID="routing-scope"
          >
            <Text style={styles.muted} numberOfLines={1}>
              {scopeName}
            </Text>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sheetTitle={t("sidebar.routing.chooseScope")}>
            <DropdownMenuItem onSelect={setAllProjects}>
              {t("sidebar.routing.allProjects")}
            </DropdownMenuItem>
            {currentProject ? (
              <DropdownMenuItem onSelect={setCurrentProject}>
                {t("sidebar.routing.currentProject", { name: currentProject.projectName })}
              </DropdownMenuItem>
            ) : null}
            {allProjects.map((project) => (
              <RoutingScopeOption
                key={project.viewKey}
                name={project.projectName}
                scope={project.viewKey}
                dispatch={dispatch}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </View>
      {state.mode === "find" ? (
        children(submitFromButton)
      ) : (
        <>
          <Button
            size="xs"
            variant="ghost"
            disabled={locked}
            testID="routing-recipient"
            onPress={togglePicker}
          >
            {t("sidebar.routing.to", {
              name: state.recipient
                ? `${state.recipient.projectName} · ${state.recipient.title}`
                : t("sidebar.routing.automatic"),
            })}
          </Button>
          <EditingTextInput
            ref={sendInput}
            key="send"
            initialValue={state.sendDraft}
            onChangeText={setDraft}
            editable={!locked}
            multiline
            placeholder={t("sidebar.routing.promptPlaceholder")}
            accessibilityLabel={t("sidebar.routing.promptPlaceholder")}
            testID="routing-send-draft"
            style={styles.input}
          />
        </>
      )}
      {state.picker ? (
        <View style={styles.results}>
          <EditingTextInput
            initialValue={state.pickerQuery}
            onChangeText={setPickerQuery}
            placeholder={t("sidebar.routing.pickPlaceholder")}
            accessibilityLabel={t("sidebar.routing.pickPlaceholder")}
            testID="routing-picker-query"
            style={styles.input}
          />
          <Button size="sm" variant="ghost" onPress={selectAutomatic}>
            {t("sidebar.routing.automatic")}
          </Button>
          <ScrollView style={styles.resultScroll}>
            {pickerRecipients.map((recipient) => (
              <PickerRecipientRow
                key={JSON.stringify([recipient.serverId, recipient.agentId])}
                recipient={recipient}
                onSelect={select}
              />
            ))}
          </ScrollView>
          {pickerRecipients.length === 0 ? (
            <Text style={styles.muted}>{t("sidebar.routing.noChats")}</Text>
          ) : null}
        </View>
      ) : null}
      <View style={styles.row}>
        <Text style={styles.hint}>
          {state.mode === "find"
            ? t("sidebar.routing.searchOnly")
            : t("sidebar.routing.repliesThere")}
        </Text>
        <Button
          size="xs"
          disabled={locked || !(state.mode === "find" ? searchQuery : state.sendDraft).trim()}
          loading={state.phase.status === "matching" || state.phase.status === "sending"}
          onPress={submitFromButton}
          accessibilityLabel={t(routingSubmitLabel(state.mode))}
          testID="routing-submit"
        >
          {state.mode === "find" ? t("sidebar.routing.find") : t("sidebar.routing.send")}
        </Button>
      </View>
      <RoutingOutcome
        phase={state.phase}
        onSelect={select}
        onOpen={open}
        onSend={sendChoice}
        onRetry={retryDelivery}
      />
      {state.phase.status === "results" && state.phase.recipients.length === 0 ? (
        <Button size="sm" variant="outline" onPress={openPicker}>
          {t("sidebar.routing.chooseChat")}
        </Button>
      ) : null}
    </View>
  );
}

function isRoutingLocked(state: RoutingState): boolean {
  return !state.draftReady || state.phase.status === "sending" || state.phase.status === "pending";
}

function pendingRecovery(
  entry: PendingQueueEnqueue,
  recipients: readonly Recipient[],
  hosts: readonly { serverId: string; label?: string }[],
): Extract<RoutingAction, { type: "restorePending" }> {
  const display = recipients.find(
    (candidate) => candidate.serverId === entry.serverId && candidate.agentId === entry.agentId,
  );
  const sameDestination =
    display &&
    display.workspaceId === entry.expectedWorkspaceId &&
    display.projectId === entry.expectedProjectId;
  const recipient: Recipient = {
    serverId: entry.serverId,
    agentId: entry.agentId,
    workspaceId: entry.expectedWorkspaceId ?? "",
    projectId: entry.expectedProjectId ?? "",
    projectName: sameDestination
      ? display.projectName
      : (entry.expectedProjectId ?? entry.serverId),
    projectViewKey: sameDestination ? display.projectViewKey : "",
    hostLabel: hosts.find((host) => host.serverId === entry.serverId)?.label ?? entry.serverId,
    title: display?.title ?? entry.agentId,
    excerpt: "",
    confidence: 0,
  };
  return {
    type: "restorePending",
    recipient,
    text: entry.text,
    itemId: entry.itemId,
    draftVersion: entry.routingDraftVersion ?? 0,
    draftUpdatedAt: entry.routingDraftUpdatedAt,
  };
}

function RoutingOutcome({
  phase,
  onSelect,
  onOpen,
  onSend,
  onRetry,
}: {
  phase: import("./model").RoutingPhase;
  onSelect: (recipient: Recipient) => void;
  onOpen: (recipient: Recipient) => void;
  onSend: (recipient: Recipient) => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const openReceipt = useCallback(() => {
    if ("recipient" in phase) onOpen(phase.recipient);
  }, [phase, onOpen]);
  if (phase.status === "error")
    return (
      <Text accessibilityLiveRegion="polite" style={styles.muted}>
        {phase.message}
      </Text>
    );
  if (phase.status === "pending")
    return (
      <View style={styles.results}>
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          {t("sidebar.routing.awaitingAck")} {phase.error}
        </Text>
        <Button size="sm" variant="outline" onPress={onRetry}>
          {t("sidebar.routing.retry")}
        </Button>
        <Button size="sm" variant="ghost" onPress={openReceipt}>
          {t("sidebar.routing.openChat")}
        </Button>
      </View>
    );
  if (phase.status === "acknowledged")
    return (
      <View style={styles.results}>
        <Text accessibilityLiveRegion="polite" style={styles.receipt}>
          {t(phase.queued ? "sidebar.routing.queuedTo" : "sidebar.routing.routedTo", {
            project: phase.recipient.projectName,
            chat: phase.recipient.title,
          })}
        </Text>
        <Button size="sm" variant="ghost" onPress={openReceipt}>
          {t("sidebar.routing.openChat")}
        </Button>
      </View>
    );
  if (phase.status !== "results") return null;
  let headingKey:
    | "sidebar.routing.noMatch"
    | "sidebar.routing.found"
    | "sidebar.routing.disambiguate" = "sidebar.routing.noMatch";
  if (phase.recipients.length > 0)
    headingKey = phase.mode === "find" ? "sidebar.routing.found" : "sidebar.routing.disambiguate";
  return (
    <View style={styles.results}>
      {phase.notice ? <Text style={styles.muted}>{phase.notice}</Text> : null}
      <Text accessibilityLiveRegion="polite" style={styles.muted}>
        {t(headingKey)}
      </Text>
      <ScrollView style={styles.resultScroll}>
        {phase.recipients.map((recipient) => (
          <RoutingResult
            key={JSON.stringify([recipient.serverId, recipient.agentId])}
            recipient={recipient}
            mode={phase.mode}
            onOpen={onOpen}
            onSelect={onSelect}
            onSend={onSend}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function RoutingScopeOption({
  name,
  scope,
  dispatch,
}: {
  name: string;
  scope: string;
  dispatch: Dispatch<RoutingAction>;
}) {
  const selectScope = useCallback(() => dispatch({ type: "scope", scope }), [dispatch, scope]);
  return <DropdownMenuItem onSelect={selectScope}>{name}</DropdownMenuItem>;
}
function PickerRecipientRow({
  recipient,
  onSelect,
}: {
  recipient: Recipient;
  onSelect: (recipient: Recipient) => void;
}) {
  const { t } = useTranslation();
  const selectRecipient = useCallback(() => onSelect(recipient), [onSelect, recipient]);
  const name = `${recipient.projectName} · ${recipient.title} · ${recipient.hostLabel}`;
  return (
    <Button
      size="sm"
      variant="ghost"
      onPress={selectRecipient}
      accessibilityLabel={t("sidebar.routing.useNamedChat", { name })}
    >
      {name}
    </Button>
  );
}
function RoutingResult({
  recipient,
  mode,
  onOpen,
  onSelect,
  onSend,
}: {
  recipient: Recipient;
  mode: "find" | "send";
  onOpen: (recipient: Recipient) => void;
  onSelect: (recipient: Recipient) => void;
  onSend: (recipient: Recipient) => void;
}) {
  const { t } = useTranslation();
  const open = useCallback(() => onOpen(recipient), [onOpen, recipient]);
  const choose = useCallback(() => {
    if (mode === "find") onSelect(recipient);
    else onSend(recipient);
  }, [mode, onSelect, onSend, recipient]);
  return (
    <View style={styles.result}>
      <Text style={styles.title}>{recipient.title}</Text>
      <Text style={styles.muted}>
        {recipient.projectName} · {recipient.hostLabel}
      </Text>
      <Text numberOfLines={3} style={styles.muted}>
        {recipient.excerpt}
      </Text>
      <View style={styles.row}>
        <Button size="xs" variant="ghost" onPress={open}>
          {t("sidebar.routing.openChat")}
        </Button>
        <Button size="xs" variant="outline" onPress={choose}>
          {t(mode === "find" ? "sidebar.routing.useChat" : "sidebar.routing.sendHere")}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    gap: theme.spacing[2],
  },
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1], flexWrap: "wrap" },
  input: {
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface1,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[2],
    minHeight: 56,
    maxHeight: 140,
    fontSize: theme.fontSize.sm,
  },
  hint: { flex: 1, color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  receipt: { color: theme.colors.accent, fontSize: theme.fontSize.sm },
  results: { gap: theme.spacing[2] },
  resultScroll: { maxHeight: 260 },
  result: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
}));

function routingSubmitLabel(mode: "find" | "send") {
  return mode === "find" ? "sidebar.routing.findAction" : "sidebar.routing.sendAction";
}
