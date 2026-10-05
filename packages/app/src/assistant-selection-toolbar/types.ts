import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import type { AssistantTurnForkBoundary } from "@/agent-stream/turn-boundary";

export interface SelectedAssistantText {
  quote: string;
  messageId: string;
  boundary: AssistantTurnForkBoundary;
}

export interface AssistantSelectionToolbarSurfaceProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  active: boolean;
  onQuote?: (quote: string) => void;
  onReply?: (selection: SelectedAssistantText) => Promise<void>;
  resolveBoundary: (messageId: string) => AssistantTurnForkBoundary | undefined;
}
