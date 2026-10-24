import type { ComponentProps, ReactNode } from "react";
import type { SplitContainer } from "@/components/split-container";

/**
 * What a View renders its panes with. Web and Electron use the workspace split container;
 * native (iPhone and iPad) shows one pane at a time, as workspaces do on native.
 */
export type ViewPaneSurfaceProps = ComponentProps<typeof SplitContainer> & {
  renderEmptyPane: (paneId: string) => ReactNode;
};
