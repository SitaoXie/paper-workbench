import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, GripVertical } from "lucide-react";

const DESKTOP_MIN = 1000;
const MIN_WIDTH = 420;
const MAX_WIDTH = 720;
const WIDTH_PREFERENCE = "paper-workbench:assistant-width";
function savedAssistantWidth(): number | null {
  try {
    const value = Number(window.localStorage.getItem(WIDTH_PREFERENCE));
    return Number.isFinite(value) && value >= MIN_WIDTH && value <= MAX_WIDTH ? value : null;
  } catch { return null; }
}
function responsiveWidth(viewport: number) {
  // A phone width must never become the desktop width preference.
  const desktopViewport = viewport < DESKTOP_MIN ? 1440 : viewport;
  return Math.round(Math.max(MIN_WIDTH, Math.min(maximumWidth(desktopViewport), desktopViewport * 0.46)));
}
function maximumWidth(viewport: number) {
  // Keep a useful reading column beside the rail, even on small laptops.
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, viewport - 488));
}
export function defaultAssistantWidth() {
  const viewport = typeof window === "undefined" ? 1440 : window.innerWidth;
  return savedAssistantWidth() ?? responsiveWidth(viewport);
}

type Props = {
  width: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
  children: ReactNode;
};

/** A resizable reading companion. Its parent owns width and open state so
 * resizing or closing never remounts the PDF or discards the selected quote. */
export default function AssistantDock({ width, onWidthChange, onClose, children }: Props) {
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

  useEffect(() => {
    const resize = () => {
      const nextViewport = window.innerWidth;
      setViewport(nextViewport);
      if (nextViewport < DESKTOP_MIN) return;
      const preferred = manualWidth.current ?? responsiveWidth(nextViewport);
      const nextWidth = Math.max(MIN_WIDTH, Math.min(maximumWidth(nextViewport), preferred));
      if (nextWidth !== widthRef.current) callback.current(nextWidth);
    };
    resize();
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); cancelAnimationFrame(frame.current); };
  }, []);

  const change = (next: number) => {
    queuedWidth.current = Math.round(Math.max(MIN_WIDTH, Math.min(maximumWidth(window.innerWidth), next)));
    manualWidth.current = queuedWidth.current;
    try { window.localStorage.setItem(WIDTH_PREFERENCE, String(queuedWidth.current)); } catch { /* Width remains a session preference if storage is unavailable. */ }
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => callback.current(queuedWidth.current));
  };
  const stopResize = () => {
    cancelAnimationFrame(frame.current);
    callback.current(queuedWidth.current);
    setResizing(false);
  };

  return <div
    ref={host}
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
      aria-label="调整助手宽度"
      aria-orientation="vertical"
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={maximumWidth(viewport)}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      title="拖动调整宽度，或用左右方向键调整"
      onPointerDown={event => {
        if (event.button !== 0 || viewport < DESKTOP_MIN) return;
        event.preventDefault();
        queuedWidth.current = width;
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
        const next = event.key === "ArrowLeft" ? width + step : event.key === "ArrowRight" ? width - step : event.key === "Home" ? MIN_WIDTH : event.key === "End" ? maximumWidth(viewport) : null;
        if (next === null) return;
        event.preventDefault();
        change(next);
      }}
    ><GripVertical size={13}/></div>
    <div className="assistant-dock-mobile-bar"><button onClick={onClose}><ArrowLeft size={17}/>返回论文</button></div>
    {children}
  </div>;
}
