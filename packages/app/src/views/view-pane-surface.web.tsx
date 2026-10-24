import { SplitContainer } from "@/components/split-container";
import type { ViewPaneSurfaceProps } from "@/views/view-pane-surface.types";

export function ViewPaneSurface({
  renderEmptyPane: _renderEmptyPane,
  ...props
}: ViewPaneSurfaceProps) {
  return <SplitContainer {...props} />;
}
