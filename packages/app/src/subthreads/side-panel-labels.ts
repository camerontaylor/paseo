import type { SidePanelMode, SubthreadSelection } from "./model";

/**
 * Per-session side-panel state, stored through the existing agent-label API on the owning host
 * (the same mechanism as session pins). Any client, the CLI, or an agent's `update_agent` tool can
 * set them, so an agent can put a checklist beside a conversation without new daemon APIs, and
 * the choice survives reloads, app updates, and device switches. Old clients keep the labels and
 * ignore them.
 *
 *   paseo agent update <id> --label paseo.side-panel=checklist
 *   paseo agent update <id> --label paseo.checklist-url=https://host/checklist
 *   paseo agent update <id> --label paseo.side-panel=        (close)
 */
export const SIDE_PANEL_LABEL = "paseo.side-panel";
export const CHECKLIST_URL_LABEL = "paseo.checklist-url";
export const SIDE_PANEL_SELECTION_LABEL = "paseo.side-panel-selection";

/** `undefined` when the label is absent (no stored choice); `null` when it says closed. */
export function parseSidePanelLabel(value: string | undefined): SidePanelMode | null | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "subagents" || normalized === "checklist") return normalized;
  return null;
}

/** Only absolute HTTPS URLs are embedded; anything else is ignored rather than framed. */
export function parseChecklistUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" && url.hostname ? url.toString() : null;
  } catch {
    return null;
  }
}

export function sidePanelLabelPatch(panel: SidePanelMode | null): Record<string, string> {
  return { [SIDE_PANEL_LABEL]: panel ?? "" };
}

/** The chosen child belongs to the parent session, including across app reloads. */
export function parseSidePanelSelection(value: string | undefined): SubthreadSelection | null {
  if (!value) return null;
  const colon = value.indexOf(":");
  if (colon < 0) return null;
  const kind = value.slice(0, colon);
  if (kind !== "paseo" && kind !== "provider") return null;
  try {
    const id = decodeURIComponent(value.slice(colon + 1));
    if (!id || id.length > 256) return null;
    return { kind, id };
  } catch {
    return null;
  }
}

export function sidePanelSelectionPatch(
  selection: SubthreadSelection | null,
): Record<string, string> {
  return {
    [SIDE_PANEL_SELECTION_LABEL]: selection
      ? `${selection.kind}:${encodeURIComponent(selection.id)}`
      : "",
  };
}
