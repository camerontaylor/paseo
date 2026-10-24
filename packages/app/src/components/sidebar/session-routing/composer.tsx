import { v4 as uuid } from "uuid";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { type QueueWriter } from "@/composer/actions";
import { createServerQueueFlushClient } from "@/composer/server-queue-flush-client";
import {
  sessionRouteKey,
  useRoutingBridge,
  type RoutingBridgeEntry,
} from "@/components/sidebar/find-or-start";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { openQuickLaunch } from "@/quick-launch/store";
import { getHostRuntimeStore, useHostRegistryLoaded, useHosts } from "@/runtime/host-runtime";
import { SESSION_ROUTING_DRAFT_KEY } from "@/stores/draft-keys";
import { flushDraftPersistStorage, useDraftStore } from "@/stores/draft-store";
import {
  useQueueOutboxStore,
  awaitOutboxHydration,
  flushQueueOutboxForServer,
} from "@/stores/queue-outbox-store";
import { useSessionStore } from "@/stores/session-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { selectRouteBestMatch, type Recipient } from "./model";
import { queueRoutedPrompt } from "./queue-delivery";
import { searchScopedSessions } from "./search";

function currentRecipient(recipient: Recipient): boolean {
  const session = useSessionStore.getState().sessions[recipient.serverId];
  const agent = session?.agents.get(recipient.agentId);
  const workspace = session?.workspaces.get(recipient.workspaceId);
  return Boolean(
    agent &&
    !agent.archivedAt &&
    !agent.parentAgentId &&
    agent.workspaceId === recipient.workspaceId &&
    workspace &&
    !workspace.archivingAt &&
    workspace.projectId === recipient.projectId,
  );
}

async function awaitDraftReady(): Promise<void> {
  const persist = useDraftStore.persist;
  if (!persist.hasHydrated()) {
    await new Promise<void>((resolve) => {
      const unsubscribe = persist.onFinishHydration(() => {
        unsubscribe();
        resolve();
      });
      if (persist.hasHydrated()) {
        unsubscribe();
        resolve();
      }
    });
  }
  await useDraftStore.getState().hydrateDraftInput({ draftKey: SESSION_ROUTING_DRAFT_KEY });
}

function RecipientChoice({
  item,
  onSelect,
}: {
  item: Recipient;
  onSelect: (item: Recipient) => void;
}) {
  const { t } = useTranslation();
  const select = useCallback(() => onSelect(item), [item, onSelect]);
  return (
    <View style={styles.result}>
      <Text style={styles.resultText} numberOfLines={2}>
        {item.title} · {item.projectName} · {item.hostLabel}
      </Text>
      <Button size="xs" variant="ghost" onPress={select}>
        {t("sidebar.routing.useChat")}
      </Button>
    </View>
  );
}

// The panel coordinates draft, host, search, and queue lifecycles in one mounted owner.
// eslint-disable-next-line complexity
export function SessionRoutingComposer() {
  const { t } = useTranslation();
  const { searchQuery, workspacePlacements, serverIds, resolvedProjectFilters } = useSidebarModel();
  const hosts = useHosts();
  const hostRegistryReady = useHostRegistryLoaded();
  const sessions = useSessionStore((store) => store.sessions);
  const record = useDraftStore((store) => store.drafts[SESSION_ROUTING_DRAFT_KEY]);
  const entries = useQueueOutboxStore((store) => store.entries);
  const receipt = useQueueOutboxStore((store) => store.routingReceipt);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"find" | "send">("find");
  const [prompt, setPrompt] = useState("");
  const promptInput = useRef<EditingTextInputHandle>(null);
  const [scope, setScope] = useState<string | null>(null);
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [results, setResults] = useState<Recipient[] | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const deliveryInFlight = useRef(false);
  const requestId = useRef<string | null>(null);
  const hostMembership = JSON.stringify([...serverIds].sort());
  const liveContext = useRef({ searchQuery, scope, hostMembership });
  liveContext.current = { searchQuery, scope, hostMembership };
  const matchingEntries = Object.values(entries).filter(
    (entry) =>
      entry.routingOrigin &&
      entry.routingDraftVersion === record?.version &&
      entry.routingDraftUpdatedAt === record?.updatedAt,
  );
  const pending = matchingEntries.find((entry) => !entry.failedAt) ?? matchingEntries[0];
  const activePending = Boolean(pending && !pending.failedAt);
  const locked = !ready || activePending || busy;
  const currentProject = resolvedProjectFilters.length === 1 ? resolvedProjectFilters[0]! : null;

  useEffect(() => {
    let live = true;
    void Promise.all([awaitDraftReady(), awaitOutboxHydration()])
      .then(() => {
        if (!live) return;
        setPrompt(useDraftStore.getState().getDraftInput(SESSION_ROUTING_DRAFT_KEY)?.text ?? "");
        setReady(true);
        return undefined;
      })
      .catch(() => {
        if (live) setNotice(t("sidebar.routing.draftLoadFailed"));
      });
    return () => {
      live = false;
    };
  }, [t]);

  useEffect(() => {
    if (promptInput.current?.getText() !== prompt) promptInput.current?.replaceText(prompt);
  }, [prompt]);

  useEffect(() => {
    if (!ready) return;
    const saved = useDraftStore.getState().getDraftInput(SESSION_ROUTING_DRAFT_KEY)?.text ?? "";
    setPrompt((previous) => (previous === saved ? previous : saved));
  }, [ready, record?.version]);

  useEffect(() => {
    if (
      !ready ||
      !receipt ||
      !record ||
      receipt.draftVersion !== record.version ||
      receipt.draftUpdatedAt !== record.updatedAt ||
      activePending
    )
      return;
    useDraftStore.getState().clearDraftInput({ draftKey: SESSION_ROUTING_DRAFT_KEY });
    setPrompt("");
    setNotice(
      t("sidebar.routing.queuedTo", {
        project: recipient?.projectName ?? receipt.projectId,
        chat: recipient?.title ?? receipt.agentId,
      }),
    );
  }, [ready, receipt, record, activePending, recipient, t]);

  const manualRecipients = useMemo(() => {
    const placements = new Map(
      workspacePlacements.map((p) => [JSON.stringify([p.serverId, p.workspaceId]), p] as const),
    );
    const found: Recipient[] = [];
    for (const serverId of serverIds) {
      const session = sessions[serverId];
      if (!session) continue;
      for (const agent of session.agents.values()) {
        if (!agent.workspaceId || agent.archivedAt || agent.parentAgentId) continue;
        const placement = placements.get(JSON.stringify([serverId, agent.workspaceId]));
        const workspace = session.workspaces.get(agent.workspaceId);
        if (!placement || !workspace || workspace.archivingAt) continue;
        found.push({
          serverId,
          agentId: agent.id,
          workspaceId: agent.workspaceId,
          projectId: workspace.projectId,
          projectName: placement.projectName,
          projectViewKey: placement.projectViewKey,
          hostLabel: hosts.find((host) => host.serverId === serverId)?.label ?? serverId,
          title: agent.title || placement.name,
          excerpt: "",
          confidence: 0,
        });
      }
    }
    return found;
  }, [hosts, serverIds, sessions, workspacePlacements]);
  const routableKeys = useMemo(
    () => new Set(manualRecipients.map(sessionRouteKey)),
    [manualRecipients],
  );
  const setDraft = useCallback((text: string) => {
    setPrompt(text);
    useDraftStore.getState().editDraftText({
      draftKey: SESSION_ROUTING_DRAFT_KEY,
      text,
      keepActive: true,
    });
  }, []);

  const deliver = useCallback(
    async (target: Recipient, text = prompt) => {
      if (deliveryInFlight.current) return;
      const currentDraft = useDraftStore.getState().drafts[SESSION_ROUTING_DRAFT_KEY];
      if (
        currentDraft &&
        Object.values(useQueueOutboxStore.getState().entries).some(
          (entry) =>
            entry.routingOrigin &&
            !entry.failedAt &&
            entry.routingDraftVersion === currentDraft.version &&
            entry.routingDraftUpdatedAt === currentDraft.updatedAt,
        )
      )
        return;
      deliveryInFlight.current = true;
      const body = text.trim();
      if (!body || activePending) {
        deliveryInFlight.current = false;
        return;
      }
      const client = getHostRuntimeStore().getClient(target.serverId);
      const serverInfo = useSessionStore.getState().sessions[target.serverId]?.serverInfo;
      if (!client || !serverInfo) {
        setNotice(t("sidebar.routing.offline"));
        deliveryInFlight.current = false;
        return;
      }
      // Every send gets one stable ID before durable staging. A pending entry prevents a second ID.
      const itemId = uuid();
      try {
        if (!record || record.input.text !== body) {
          useDraftStore.getState().editDraftText({
            draftKey: SESSION_ROUTING_DRAFT_KEY,
            text: body,
            keepActive: true,
          });
        }
        await flushDraftPersistStorage();
        const saved = useDraftStore.getState().drafts[SESSION_ROUTING_DRAFT_KEY];
        if (!saved || saved.input.text !== body)
          throw new Error(t("sidebar.routing.draftLoadFailed"));
        const queue: QueueWriter = {
          read: (agentId) =>
            useSessionStore.getState().sessions[target.serverId]?.queuedMessages.get(agentId) ?? [],
          write: (updater) =>
            useSessionStore.getState().setQueuedMessages(target.serverId, updater),
        };
        await queueRoutedPrompt({
          recipient: target,
          text: body,
          itemId,
          client,
          queue,
          encodeImages: async () => undefined,
          applySnapshot: (snapshot) =>
            useSessionStore.getState().applyAgentQueueSnapshot(target.serverId, snapshot),
          outbox: {
            serverId: target.serverId,
            add: (entry) =>
              useQueueOutboxStore.getState().add({ ...entry, serverId: target.serverId }),
            remove: (id) => useQueueOutboxStore.getState().removeDurably(id),
            flush: () =>
              flushQueueOutboxForServer({
                serverId: target.serverId,
                client: createServerQueueFlushClient({ client, serverId: target.serverId }),
                applySnapshot: (snapshot) =>
                  useSessionStore.getState().applyAgentQueueSnapshot(target.serverId, snapshot),
              }),
          },
          features: serverInfo.features,
          isHostEligible: () =>
            serverIds.includes(target.serverId) &&
            client.getConnectionState().status === "connected",
          isDestinationCurrent: () => currentRecipient(target),
          routingOrigin: true,
          routingDraftVersion: saved.version,
          routingDraftUpdatedAt: saved.updatedAt,
        });
        setRecipient(target);
        setNotice(t("sidebar.routing.awaitingAck"));
      } catch (error) {
        setNotice(error instanceof Error ? error.message : t("sidebar.routing.sendFailed"));
        setRecipient(null);
      } finally {
        deliveryInFlight.current = false;
      }
    },
    [activePending, prompt, record, serverIds, t],
  );

  const search = useCallback(
    // Every guard here protects a stale match from dispatching a prompt.
    // eslint-disable-next-line complexity
    async (text: string, sendBest = false) => {
      const query = text.trim();
      if (!query || inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setNotice("");
      const id = uuid();
      requestId.current = id;
      const draftBefore = sendBest
        ? useDraftStore.getState().drafts[SESSION_ROUTING_DRAFT_KEY]
        : null;
      const matchingHosts = hostMembership;
      try {
        const outcome = await searchScopedSessions({
          query,
          scope,
          hostRegistryReady,
          placements: workspacePlacements,
          hosts: serverIds.map((serverId) => {
            const session = useSessionStore.getState().sessions[serverId];
            const client = getHostRuntimeStore().getClient(serverId);
            return {
              serverId,
              label: hosts.find((host) => host.serverId === serverId)?.label ?? serverId,
              connected: client?.getConnectionState().status === "connected",
              directoryReady: session?.hasHydratedWorkspaces === true,
              supportsSearch: session?.serverInfo?.features?.sessionSearch === true,
              search: (candidateQuery: string, workspaceIds: string[]) => {
                if (!client) throw new Error(t("sidebar.routing.offline"));
                return client.searchSessions({ query: candidateQuery, workspaceIds });
              },
            };
          }),
        });
        if (requestId.current !== id) return;
        if (
          liveContext.current.scope !== scope ||
          liveContext.current.hostMembership !== matchingHosts ||
          (!sendBest && liveContext.current.searchQuery.trim() !== query)
        ) {
          setNotice(t("sidebar.routing.previousResults"));
          return;
        }
        if (sendBest) {
          const current = useDraftStore.getState().drafts[SESSION_ROUTING_DRAFT_KEY];
          if (
            !draftBefore ||
            !current ||
            current.version !== draftBefore.version ||
            current.updatedAt !== draftBefore.updatedAt ||
            current.input.text.trim() !== query
          ) {
            setNotice(t("sidebar.routing.previousResults"));
            return;
          }
        }
        setResults(outcome.recipients);
        const failure = outcome.failures.map((item) => item.reason).join(" ");
        setNotice(
          failure ||
            t("sidebar.routing.searchCoverage", {
              searched: outcome.searchedCount,
              total: outcome.totalCount,
            }),
        );
        if (sendBest && !outcome.incomplete) {
          const best = selectRouteBestMatch(outcome.recipients);
          if (best) await deliver(best, query);
          else
            setNotice(
              t(
                outcome.recipients.length
                  ? "sidebar.routing.routeAmbiguous"
                  : "sidebar.routing.noMatch",
              ),
            );
        }
      } catch (error) {
        if (requestId.current === id)
          setNotice(error instanceof Error ? error.message : t("sidebar.routing.matchFailed"));
      } finally {
        if (requestId.current === id) {
          inFlight.current = false;
          setBusy(false);
        }
      }
    },
    [scope, hostRegistryReady, workspacePlacements, serverIds, hosts, t, deliver, hostMembership],
  );

  const findWithAi = useCallback(() => {
    if (!ready || busy || activePending) return;
    setMode("find");
    setOpen(true);
    void search(searchQuery);
  }, [ready, busy, activePending, search, searchQuery]);
  const sendHere = useCallback(
    (target: { serverId: string; agentId: string }) => {
      if (!ready || busy || activePending) return;
      const chosen = manualRecipients.find(
        (candidate) =>
          candidate.serverId === target.serverId && candidate.agentId === target.agentId,
      );
      if (!chosen) return;
      if (!prompt.trim() && searchQuery.trim()) setDraft(searchQuery.trim());
      setScope(null);
      setRecipient(chosen);
      setMode("send");
      setOpen(true);
    },
    [ready, busy, activePending, manualRecipients, prompt, searchQuery, setDraft],
  );
  const register = useRoutingBridge((bridge) => bridge.register);
  const unregister = useRoutingBridge((bridge) => bridge.unregister);
  useEffect(() => {
    const entry: RoutingBridgeEntry = { sendHere, findWithAi, routableKeys, locked };
    register(entry);
    return () => unregister(entry);
  }, [sendHere, findWithAi, routableKeys, locked, register, unregister]);

  const visible = (results ?? manualRecipients).filter(
    (item) => scope === null || item.projectViewKey === scope,
  );
  const failed = !activePending && pending?.failedAt;
  useEffect(() => {
    if (!failed) return;
    setRecipient(null);
    setNotice(t("sidebar.routing.invalidDestination"));
  }, [failed, t]);
  const openSend = useCallback(() => {
    setMode("send");
    setOpen(true);
  }, []);
  const chooseAll = useCallback(() => setScope(null), []);
  const chooseCurrent = useCallback(() => setScope(currentProject), [currentProject]);
  const closePanel = useCallback(() => setOpen(false), []);
  const findAgain = useCallback(() => {
    void search(searchQuery);
  }, [search, searchQuery]);
  const routeBest = useCallback(() => {
    void search(prompt, true);
  }, [search, prompt]);
  const queueHere = useCallback(() => {
    if (recipient) void deliver(recipient);
  }, [recipient, deliver]);
  const startNew = useCallback(() => openQuickLaunch({ prompt }), [prompt]);
  const openReceipt = useCallback(() => {
    if (receipt)
      navigateToAgent({
        serverId: receipt.serverId,
        agentId: receipt.agentId,
      });
  }, [receipt]);
  const moveDraft = useCallback(() => {
    if (!receipt) return;
    setDraft(receipt.text);
    setNotice(t("sidebar.routing.copyWarning"));
    setRecipient(null);
    setMode("send");
    setResults(null);
  }, [receipt, setDraft, t]);
  const chooseRecipient = useCallback(
    (item: Recipient) => {
      setRecipient(item);
      setMode("send");
      if (!prompt.trim() && searchQuery.trim()) setDraft(searchQuery.trim());
    },
    [prompt, searchQuery, setDraft],
  );
  return (
    <View style={styles.outer}>
      <View style={styles.actions}>
        <Button size="xs" variant="ghost" onPress={findWithAi} disabled={!ready || busy}>
          {t("sidebar.routing.findWithAi")}
        </Button>
        <Button size="xs" variant="ghost" onPress={openSend} disabled={!ready}>
          {t("sidebar.routing.sendToChat")}
        </Button>
      </View>
      {open ? (
        <View style={styles.panel}>
          <View style={styles.actions}>
            <Button size="xs" variant="ghost" onPress={chooseAll}>
              {t("sidebar.routing.allProjects")}
            </Button>
            {currentProject ? (
              <Button size="xs" variant="ghost" onPress={chooseCurrent}>
                {t("sidebar.routing.currentProject", {
                  name:
                    workspacePlacements.find((p) => p.projectViewKey === currentProject)
                      ?.projectName ?? currentProject,
                })}
              </Button>
            ) : null}
            <Button size="xs" variant="ghost" onPress={closePanel}>
              {t("sidebar.routing.clear")}
            </Button>
          </View>
          {mode === "send" ? (
            <EditingTextInput
              ref={promptInput}
              initialValue={prompt}
              onChangeText={setDraft}
              editable={ready && !activePending}
              multiline
              placeholder={t("sidebar.routing.promptPlaceholder")}
              style={styles.input}
              testID="session-routing-draft"
            />
          ) : null}
          <View style={styles.actions}>
            {mode === "find" ? (
              <Button
                size="xs"
                variant="secondary"
                onPress={findAgain}
                disabled={busy || !searchQuery.trim()}
              >
                {t("sidebar.routing.findWithAi")}
              </Button>
            ) : (
              <>
                <Button
                  size="xs"
                  variant="secondary"
                  onPress={routeBest}
                  disabled={busy || activePending || !prompt.trim()}
                >
                  {t("sidebar.routing.routeBestMatch")}
                </Button>
                {recipient ? (
                  <Button
                    size="xs"
                    onPress={queueHere}
                    disabled={busy || activePending || !prompt.trim()}
                  >
                    {t("sidebar.routing.queueHere")}
                  </Button>
                ) : null}
              </>
            )}
            {mode === "send" && prompt.trim() ? (
              <Button size="xs" variant="ghost" onPress={startNew}>
                {t("sidebar.routing.routeNewConversation")}
              </Button>
            ) : null}
          </View>
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          {failed ? (
            <Text style={styles.notice}>{t("sidebar.routing.invalidDestination")}</Text>
          ) : null}
          {receipt && !prompt.trim() ? (
            <View style={styles.actions}>
              <Button size="xs" variant="ghost" onPress={openReceipt}>
                {t("sidebar.routing.openChat")}
              </Button>
              <Button size="xs" variant="ghost" onPress={moveDraft}>
                {t("sidebar.routing.moveDraft")}
              </Button>
            </View>
          ) : null}
          {visible.slice(0, 20).map((item) => (
            <RecipientChoice key={sessionRouteKey(item)} item={item} onSelect={chooseRecipient} />
          ))}
          {results?.length === 0 ? (
            <Text style={styles.notice}>{t("sidebar.routing.noChats")}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  outer: { paddingHorizontal: 10, paddingBottom: 4 },
  actions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4 },
  panel: {
    padding: 8,
    gap: 8,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
  },
  input: { minHeight: 66, color: theme.colors.foreground, fontSize: 13, textAlignVertical: "top" },
  notice: { color: theme.colors.foregroundMuted, fontSize: 12 },
  result: { flexDirection: "row", alignItems: "center", gap: 4 },
  resultText: { flex: 1, color: theme.colors.foreground, fontSize: 12 },
}));
