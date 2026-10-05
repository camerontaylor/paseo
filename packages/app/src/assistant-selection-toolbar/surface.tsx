import { AssistantSelectionCopySurface } from "@/assistant-selection-copy/surface";
import type { AssistantSelectionToolbarSurfaceProps } from "./types";

export function AssistantSelectionToolbarSurface({
  children,
  style,
}: AssistantSelectionToolbarSurfaceProps) {
  return <AssistantSelectionCopySurface style={style}>{children}</AssistantSelectionCopySurface>;
}
