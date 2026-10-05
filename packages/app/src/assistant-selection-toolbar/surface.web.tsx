import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { MessageSquarePlus, Quote } from "lucide-react-native";
import { AssistantSelectionCopySurface } from "@/assistant-selection-copy/surface";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  getOverlayRoot,
  OverlayLayerProvider,
  useOverlayLayer,
  useWebOverlayRegistration,
} from "@/lib/overlay-root";
import { readAssistantSelection } from "./selection.web";
import type { AssistantSelectionToolbarSurfaceProps, SelectedAssistantText } from "./types";

type ToolbarSelection = NonNullable<ReturnType<typeof readAssistantSelection>> & {
  boundary?: SelectedAssistantText["boundary"];
};
const DISPLAY_CONTENTS: CSSProperties = { display: "contents" };
const preserveSelection = (event: PointerEvent<HTMLDivElement>) => event.preventDefault();

export function AssistantSelectionToolbarSurface({
  children,
  style,
  active,
  onQuote,
  onReply,
  resolveBoundary,
}: AssistantSelectionToolbarSurfaceProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const enabled = active && !isCompact && Boolean(onQuote || onReply);
  const rootRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<ToolbarSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const layer = useOverlayLayer("floating");
  const dismiss = useCallback(() => setSelection(null), []);
  const setScope = useWebOverlayRegistration({
    active: enabled && selection !== null,
    layer,
    manageFocus: false,
    onKeyDown: (event) => {
      if (event.key !== "Escape") return false;
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
      dismiss();
      return true;
    },
  });
  const setToolbarRef = useCallback(
    (node: HTMLDivElement | null) => {
      toolbarRef.current = node;
      setScope(node);
    },
    [setScope],
  );

  useEffect(() => {
    if (!enabled) {
      dismiss();
      return;
    }
    let dragging = false;
    let frame = 0;
    const update = () => {
      if (dragging || busyRef.current || toolbarRef.current?.contains(document.activeElement))
        return;
      const root = rootRef.current;
      const next = root ? readAssistantSelection(root, window.getSelection()) : null;
      setSelection(next ? { ...next, boundary: resolveBoundary(next.messageId) } : null);
    };
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(update);
    };
    const pointerDown = (event: globalThis.PointerEvent) => {
      if (toolbarRef.current?.contains(event.target as Node)) return;
      dragging = true;
      dismiss();
    };
    const pointerUp = () => {
      dragging = false;
      scheduleUpdate();
    };
    const scroll = (event: Event) => {
      if (toolbarRef.current?.contains(event.target as Node)) return;
      dismiss();
    };
    document.addEventListener("selectionchange", scheduleUpdate);
    document.addEventListener("pointerdown", pointerDown);
    document.addEventListener("pointerup", pointerUp);
    document.addEventListener("pointercancel", pointerUp);
    document.addEventListener("keyup", scheduleUpdate);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", scheduleUpdate);
      document.removeEventListener("pointerdown", pointerDown);
      document.removeEventListener("pointerup", pointerUp);
      document.removeEventListener("pointercancel", pointerUp);
      document.removeEventListener("keyup", scheduleUpdate);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [dismiss, enabled, resolveBoundary]);

  const act = useCallback(
    async (action: "quote" | "reply") => {
      if (!selection || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        if (action === "quote") {
          dismiss();
          window.getSelection()?.removeAllRanges();
          onQuote?.(selection.quote);
        } else if (selection.boundary && onReply) {
          await onReply({
            quote: selection.quote,
            messageId: selection.messageId,
            boundary: selection.boundary,
          });
          dismiss();
          window.getSelection()?.removeAllRanges();
        }
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [dismiss, onQuote, onReply, selection],
  );

  const addQuote = useCallback(() => void act("quote"), [act]);
  const replyInSideChat = useCallback(() => void act("reply"), [act]);
  const toolbarStyle = useMemo<CSSProperties>(
    () => ({
      position: "fixed",
      pointerEvents: "auto",
      zIndex: layer,
      maxWidth: "calc(100vw - 16px)",
      left: selection?.rect.left ?? 0,
      top: selection?.rect.top ?? 0,
    }),
    [layer, selection],
  );
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!enabled || !selection || !toolbar) return;
    const { width, height } = toolbar.getBoundingClientRect();
    const gap = 8;
    const center = (selection.rect.left + selection.rect.right) / 2;
    const left = Math.max(gap, Math.min(center - width / 2, window.innerWidth - width - gap));
    const above = selection.rect.top - height - gap;
    const preferredTop = above >= gap ? above : selection.rect.bottom + gap;
    const top = Math.max(gap, Math.min(preferredTop, window.innerHeight - height - gap));
    toolbar.style.left = `${left}px`;
    toolbar.style.top = `${top}px`;
  }, [enabled, selection]);

  return (
    <>
      <div ref={rootRef} style={DISPLAY_CONTENTS}>
        <AssistantSelectionCopySurface style={style}>{children}</AssistantSelectionCopySurface>
      </div>
      {enabled && selection
        ? createPortal(
            <OverlayLayerProvider layer={layer}>
              <div
                ref={setToolbarRef}
                role="toolbar"
                aria-label={t("message.actions.selectionToolbar")}
                data-testid="assistant-selection-toolbar"
                onPointerDown={preserveSelection}
                style={toolbarStyle}
              >
                <View style={styles.toolbar}>
                  {onQuote ? (
                    <Button
                      testID="selection-add-to-chat"
                      variant="ghost"
                      size="sm"
                      leftIcon={Quote}
                      disabled={busy}
                      onPress={addQuote}
                    >
                      {t("message.actions.addSelectionToChat")}
                    </Button>
                  ) : null}
                  {onQuote && onReply ? <View style={styles.divider} /> : null}
                  {onReply ? (
                    <Button
                      testID="selection-reply-in-side-chat"
                      variant="ghost"
                      size="sm"
                      leftIcon={MessageSquarePlus}
                      disabled={busy || !selection.boundary}
                      loading={busy}
                      onPress={replyInSideChat}
                    >
                      {t("message.actions.replyToSelection")}
                    </Button>
                  ) : null}
                </View>
              </div>
            </OverlayLayerProvider>,
            getOverlayRoot(),
          )
        : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[1],
    ...theme.shadow.md,
  },
  divider: {
    width: 1,
    height: theme.spacing[4],
    backgroundColor: theme.colors.border,
    marginHorizontal: theme.spacing[1],
  },
}));
