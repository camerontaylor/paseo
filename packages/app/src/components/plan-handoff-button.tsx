import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react-native";
import type { AgentDeepLinkTarget } from "@getpaseo/protocol/agent-deep-link";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore } from "@/stores/session-store";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useDraftStore } from "@/stores/draft-store";
import { buildDraftStoreKey, generateDraftId } from "@/stores/draft-keys";
import { buildPlanHandoffPrompt } from "./plan-handoff";

export function PlanHandoffButton({ source, text }: { source: AgentDeepLinkTarget; text: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [handedOff, setHandedOff] = useState(false);
  const inProgress = useRef(false);

  const handlePress = useCallback(() => {
    if (inProgress.current) return;
    inProgress.current = true;
    try {
      const session = useSessionStore.getState().sessions[source.serverId];
      const agent = session?.agents.get(source.agentId);
      const workspaceId = agent?.workspaceId;
      if (!session?.client || !agent || !workspaceId || !session.workspaces.has(workspaceId)) {
        throw new Error("Source workspace unavailable");
      }

      const draftId = generateDraftId();
      useDraftStore.getState().saveDraftInput({
        draftKey: buildDraftStoreKey({ ...source, draftId }),
        draft: {
          text: buildPlanHandoffPrompt({
            plan: text,
            source,
            instruction: t("agentStream.permission.handoffPrompt"),
          }),
          attachments: [],
        },
      });
      navigateToWorkspace({
        serverId: source.serverId,
        workspaceId,
        target: {
          kind: "draft",
          draftId,
          setup: {
            provider: agent.provider,
            cwd: agent.cwd,
            model: agent.model,
            thinkingOptionId: agent.thinkingOptionId ?? null,
            modeId: null,
            featureValues: Object.fromEntries(
              (agent.features ?? []).map((feature) => [feature.id, feature.value]),
            ),
          },
        },
      });
      setHandedOff(true);
    } catch {
      inProgress.current = false;
      toast.error(t("agentStream.permission.handoffFailed"));
    }
  }, [source, text, t, toast]);

  return (
    <Button
      variant="outline"
      size="sm"
      leftIcon={ArrowRight}
      disabled={handedOff}
      onPress={handlePress}
      testID="permission-plan-handoff"
    >
      {t(handedOff ? "agentStream.permission.handedOff" : "agentStream.permission.handOff")}
    </Button>
  );
}
