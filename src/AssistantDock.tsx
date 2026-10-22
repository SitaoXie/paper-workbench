import { useLocale } from "./i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, GripVertical } from "lucide-react";

import { ASSISTANT_DESKTOP_MIN as DESKTOP_MIN, ASSISTANT_MIN_WIDTH as MIN_WIDTH, initialAssistantWidth, maximumAssistantWidth as maximumWidth, responsiveAssistantWidth as responsiveWidth, savedAssistantWidth, saveAssistantWidth } from "./assistant-layout";
export const defaultAssistantWidth = initialAssistantWidth;

type Props = {
  width: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
  children: ReactNode;
  controls?: ReactNode;
};

/** A resizable reading companion. Its parent owns width and open state so
 * resizing or closing never remounts the PDF or discards the selected quote. */
export default function AssistantDock({ width, onWidthChange, onClose, children, controls }: Props) {
  const { t } = useLocale();
  const [viewport, setViewport] = useState(() => window.innerWidth);
  const [resizing, setResizing] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const callback = useRef(onWidthChange);
  callback.current = onWidthChange;
  const manualWidth = useRef(savedAssistantWidth());
  const widthRef = useRef(width);
  widthRef.current = width;
  const frame = useRef(0);
  const queuedWidth = useRef(width);
  const renderedWidth = useRef(width);
  if (renderedWidth.current !== width) {
    renderedWidth.current = width;
    if (!frame.current) queuedWidth.current = width;
  }

  useEffect(() => {
    const resize = () => {
      const nextViewport = window.innerWidth;
      setViewport(nextViewport);
      if (nextViewport < DESKTOP_MIN) return;
      const preferred = manualWidth.current ?? responsiveWidth(nextViewport);
      const nextWidth = Math.max(MIN_WIDTH, Math.min(maximumWidth(nextViewport), preferred));
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      queuedWidth.current = nextWidth;
      if (nextWidth !== widthRef.current) callback.current(nextWidth);
    };
    resize();
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); cancelAnimationFrame(frame.current); };
  }, []);

  const change = (next: number) => {
    queuedWidth.current = Math.round(Math.max(MIN_WIDTH, Math.min(maximumWidth(window.innerWidth), next)));
    manualWidth.current = queuedWidth.current;
    saveAssistantWidth(queuedWidth.current);
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      callback.current(queuedWidth.current);
    });
  };
  const stopResize = () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    callback.current(queuedWidth.current);
    setResizing(false);
  };

  return <div
    ref={host}
    id="paper-companion"
    className={`assistant-dock ${resizing ? "is-resizing" : ""}`}
    data-testid="assistant-dock"
    onKeyDown={event => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); return; }
      if (event.key !== "Tab" || viewport >= DESKTOP_MIN) return;
      // Narrow screens use an overlay. Keep keyboard navigation in the visible
      // panel while retaining the underlying paper's position and selection.
      const controls = Array.from(host.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]') || []).filter(element => element.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && window.document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}
  >
    <div
      className="assistant-dock-resizer"
      role="separator"
      aria-label={t("调整助手宽度")}
      aria-orientation="vertical"
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={maximumWidth(viewport)}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      title={t("拖动调整宽度，或用左右方向键调整")}
      onPointerDown={event => {
        if (event.button !== 0 || viewport < DESKTOP_MIN) return;
        event.preventDefault();
        if (!frame.current) queuedWidth.current = width;
        event.currentTarget.setPointerCapture(event.pointerId);
        setResizing(true);
      }}
      onPointerMove={event => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        change(window.innerWidth - 16 - event.clientX);
      }}
      onPointerUp={event => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        stopResize();
      }}
      onPointerCancel={stopResize}
      onKeyDown={event => {
        const step = event.shiftKey ? 64 : 16;
        const next = event.key === "ArrowLeft" ? queuedWidth.current + step : event.key === "ArrowRight" ? queuedWidth.current - step : event.key === "Home" ? MIN_WIDTH : event.key === "End" ? maximumWidth(viewport) : null;
        if (next === null) return;
        event.preventDefault();
        change(next);
      }}
    ><GripVertical size={13}/></div>
    <div className="assistant-dock-mobile-bar"><button onClick={onClose}><ArrowLeft size={17}/>{t("返回论文")}</button></div>
    {children}
    {controls && <div className="companion-footer">{controls}</div>}
  </div>;
}
