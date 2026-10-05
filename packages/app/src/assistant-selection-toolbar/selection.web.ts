import { createAssistantSelectionClipboardContent } from "@/assistant-selection-copy/content.web";

const ASSISTANT_SELECTOR = '[data-testid="assistant-message"]';

function containingElement(node: Node): Element | null {
  return node instanceof Element ? node : node.parentElement;
}

/** Restrict actions to one assistant response inside the owning transcript. */
export function readAssistantSelection(root: HTMLElement, selection: Selection | null) {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  const start = containingElement(range.startContainer)?.closest(ASSISTANT_SELECTOR);
  const end = containingElement(range.endContainer)?.closest(ASSISTANT_SELECTOR);
  if (!start || !end || !root.contains(start) || !root.contains(end)) return null;
  const messageId = start.closest("[data-message-id]")?.getAttribute("data-message-id");
  if (!messageId || end.closest("[data-message-id]")?.getAttribute("data-message-id") !== messageId)
    return null;
  const content = createAssistantSelectionClipboardContent(selection);
  if (!content?.plainText.trim()) return null;
  // Freeze both text and geometry before an action moves focus or opens a pane.
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return {
    messageId,
    quote: `${content.plainText
      .split(/\r?\n/)
      .map((line) => `> ${line}`)
      .join("\n")}\n\n`,
    rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
  };
}
