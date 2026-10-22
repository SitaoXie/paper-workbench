import { useLocale } from "./i18n";
import { useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  ArrowUpRight,
  Download,
  Loader2,
  RefreshCw,
  X,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from "lucide-react";
import "./pdf-reader.css";

GlobalWorkerOptions.workerSrc = workerUrl;
export type FigureCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};
type Props = {
  url: string;
  page: number;
  crop?: FigureCrop;
  caption?: string;
  captionIsOriginal?: boolean;
  captionLanguage?: string;
  onOpenPage?: (page: number) => void;
};
type SharedPdf = {
  task: ReturnType<typeof getDocument>;
  document: Promise<PDFDocumentProxy>;
  users: number;
  timer?: ReturnType<typeof setTimeout>;
};
const documents = new Map<string, SharedPdf>();
function acquire(url: string) {
  let entry = documents.get(url);
  if (!entry) {
    const task = getDocument({
      url,
      withCredentials: false,
      useSystemFonts: true,
    });
    entry = { task, document: task.promise, users: 0 };
    documents.set(url, entry);
    const created = entry;
    void task.promise.catch(() => {
      if (documents.get(url) === created) documents.delete(url);
    });
  }
  const current = entry;
  clearTimeout(current.timer);
  current.users++;
  return {
    document: current.document,
    release: () => {
      current.users--;
      if (!current.users)
        current.timer = setTimeout(() => {
          if (current.users) return;
          if (documents.get(url) === current) documents.delete(url);
          void current.task.destroy().catch(() => {});
        }, 1000);
    },
  };
}

/** A source-faithful PDF page crop. Coordinates are fractions of the rotated page. */
export default function PdfFigure({
  url,
  page,
  crop,
  caption,
  captionIsOriginal,
  captionLanguage,
  onOpenPage,
}: Props) {
  const { t, locale } = useLocale();
  const host = useRef<HTMLElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const [enlarged, setEnlarged] = useState(false);
  const [nearby, setNearby] = useState(false);
  const [width, setWidth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [ratio, setRatio] = useState<number | undefined>();
  const x = crop?.x ?? 0,
    y = crop?.y ?? 0,
    cropWidth = crop?.width ?? 1,
    cropHeight = crop?.height ?? 1;
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const resize = new ResizeObserver(() =>
      setWidth(Math.max(1, element.clientWidth)),
    );
    resize.observe(element);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNearby(true);
          observer.disconnect();
        }
      },
      { rootMargin: "500px" },
    );
    observer.observe(element);
    return () => {
      resize.disconnect();
      observer.disconnect();
    };
  }, []);
  useEffect(() => {
    if (!nearby || !width) return;
    const element = canvasHost.current;
    if (!element) return;
    let disposed = false;
    let renderTask: RenderTask | undefined;
    const shared = acquire(url);
    setLoading(true);
    setError(false);
    (async () => {
      if (
        ![x, y, cropWidth, cropHeight].every(Number.isFinite) ||
        x < 0 ||
        y < 0 ||
        cropWidth <= 0 ||
        cropHeight <= 0 ||
        x + cropWidth > 1.001 ||
        y + cropHeight > 1.001
      )
        throw new Error("Invalid crop");
      const document = await shared.document;
      if (disposed) return;
      const pdfPage = await document.getPage(
        Math.max(1, Math.min(Math.trunc(page), document.numPages)),
      );
      if (disposed) return;
      const natural = pdfPage.getViewport({ scale: 1 });
      const scale = Math.min(3, width / (natural.width * cropWidth));
      const viewport = pdfPage.getViewport({ scale });
      const renderWidth = viewport.width * cropWidth;
      const renderHeight = viewport.height * cropHeight;
      setRatio(renderWidth / renderHeight);
      const density = Math.min(
        window.devicePixelRatio || 1,
        2,
        Math.sqrt(8_000_000 / (renderWidth * renderHeight)),
      );
      const canvas = window.document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(renderWidth * density));
      canvas.height = Math.max(1, Math.round(renderHeight * density));
      canvas.setAttribute("role", "img");
      canvas.setAttribute(
        "aria-label",
        caption || t(`论文第 ${page} 页${crop ? "图表" : "预览"}`, `${crop ? "Figure" : "Preview"} on page ${page}`),
      );
      canvas.dataset.figurePage = String(page);
      canvas.style.width = "100%";
      canvas.style.height = "auto";
      element.replaceChildren(canvas);
      renderTask = pdfPage.render({
        canvas,
        viewport,
        transform: [
          density,
          0,
          0,
          density,
          -viewport.width * x * density,
          -viewport.height * y * density,
        ],
        background: "#ffffff",
      });
      await renderTask.promise;
      if (!disposed) {
        canvas.dataset.rendered = "true";
        setLoading(false);
      }
    })().catch(() => {
      if (!disposed) {
        setError(true);
        setLoading(false);
      }
    });
    return () => {
      disposed = true;
      renderTask?.cancel();
      shared.release();
      for (const canvas of element.querySelectorAll("canvas")) {
        canvas.width = 0;
        canvas.height = 0;
      }
      element.replaceChildren();
    };
  }, [url, page, x, y, cropWidth, cropHeight, nearby, width, retry, caption, locale]);
  return (
    <figure
      className={`pdf-source-figure ${crop ? "is-crop" : "is-page-preview"}`}
      ref={host}
    >
      <div
        className="pdf-figure-image"
        style={{ aspectRatio: ratio || (crop ? "1.6" : "0.77") }}
      >
        <div ref={canvasHost} />
        {!loading && !error && (
          <button
            className="pdf-figure-enlarge"
            aria-label={t(`放大第 ${page} 页图表`, `Enlarge figure on page ${page}`)}
            onClick={() => setEnlarged(true)}
          >
            <span>
              <Maximize2 size={15} /> {t("放大图表")}
            </span>
          </button>
        )}
        {loading && (
          <span className="pdf-figure-status" role="status">
            <Loader2 className="spin" size={17} />
            {t("加载论文原图")}
          </span>
        )}
        {error && (
          <span className="pdf-figure-status" role="alert">
            {t("原图暂不可用")}{" "}
            <button
              className="soft-button"
              onClick={() => setRetry((n) => n + 1)}
            >
              <RefreshCw size={13} />
              {t("重试")}
            </button>
          </span>
        )}
      </div>
      <figcaption>
        <span lang={captionLanguage}>{caption || (crop ? t("论文原图") : t("论文页面预览"))}{captionIsOriginal && <small className="muted-label"> · {t("原文图注", "Original caption")}</small>}</span>
        <button
          className="pdf-figure-citation"
          aria-label={t(`在论文中查看第 ${page} 页图表`, `View figure on page ${page} in the paper`)}
          disabled={!onOpenPage}
          onClick={() => onOpenPage?.(page)}
        >
          {crop ? t("查看原图") : t("整页预览")} · p.{page} <ArrowUpRight size={12} />
        </button>
      </figcaption>
      {enlarged && (
        <FigureLightbox
          url={url}
          page={page}
          crop={crop}
          caption={caption}
          captionIsOriginal={captionIsOriginal}
          captionLanguage={captionLanguage}
          onOpenPage={onOpenPage}
          onClose={() => setEnlarged(false)}
        />
      )}
    </figure>
  );
}

/** Re-render the same source crop at the requested display size, rather than enlarging a thumbnail. */
function FigureLightbox({
  url,
  page,
  crop,
  caption,
  captionIsOriginal,
  captionLanguage,
  onOpenPage,
  onClose,
}: Props & { onClose: () => void }) {
  const { t, locale } = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [availableHeight, setAvailableHeight] = useState(0);
  const pan = useRef<{x:number;y:number;left:number;top:number;pointerId:number} | undefined>(undefined);
  const zoomCenter = useRef<{x:number;y:number} | undefined>(undefined);
  const changeZoom = (next:number) => {
    const area = scrollArea.current;
    if (area) zoomCenter.current = { x:(area.scrollLeft + area.clientWidth/2)/area.scrollWidth, y:(area.scrollTop + area.clientHeight/2)/area.scrollHeight };
    setZoom(next);
  };
  const downloadFigure = () => {
    const canvas = canvasHost.current?.querySelector("canvas[data-rendered='true']");
    if (!(canvas instanceof HTMLCanvasElement)) return;
    canvas.toBlob(blob => {
      if (!blob) return;
      const href = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = href; link.download = `figure-page-${page}.png`; link.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    }, 'image/png');
  };
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [retry, setRetry] = useState(0);
  const x = crop?.x ?? 0,
    y = crop?.y ?? 0,
    cropWidth = crop?.width ?? 1,
    cropHeight = crop?.height ?? 1;
  useEffect(() => {
    const element = dialog.current;
    const area = scrollArea.current;
    if (!element || !area) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    element.showModal();
    const observer = new ResizeObserver(() => {
      setAvailableWidth(Math.max(1, area.clientWidth - 32));
      setAvailableHeight(Math.max(1, area.clientHeight - 32));
    });
    observer.observe(area);
    return () => {
      observer.disconnect();
      element.close();
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const element = canvasHost.current;
    if (!element || !availableWidth || !availableHeight) return;
    const shared = acquire(url);
    let disposed = false;
    let task: RenderTask | undefined;
    setStatus("loading");
    (async () => {
      const pdf = await shared.document;
      if (disposed) return;
      const pdfPage = await pdf.getPage(
        Math.max(1, Math.min(Math.trunc(page), pdf.numPages)),
      );
      if (disposed) return;
      const natural = pdfPage.getViewport({ scale: 1 });
      const fittedScale = Math.min(availableWidth / (natural.width * cropWidth), availableHeight / (natural.height * cropHeight));
      const scale = fittedScale * zoom;
      const displayWidth = natural.width * cropWidth * scale;
      const viewport = pdfPage.getViewport({ scale });
      const displayHeight = viewport.height * cropHeight;
      const density = Math.min(
        window.devicePixelRatio || 1,
        2,
        Math.sqrt(8_000_000 / (displayWidth * displayHeight)),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(displayWidth * density));
      canvas.height = Math.max(1, Math.round(displayHeight * density));
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", caption || t(`第 ${page} 页图表放大预览`, `Enlarged figure on page ${page}`));
      canvas.dataset.figurePage = String(page);
      element.replaceChildren(canvas);
      const area = scrollArea.current;
      if (area && zoom === 1) {
        area.scrollLeft = 0; area.scrollTop = 0; zoomCenter.current = undefined;
      } else if (area && zoomCenter.current) {
        area.scrollLeft = zoomCenter.current.x * area.scrollWidth - area.clientWidth/2;
        area.scrollTop = zoomCenter.current.y * area.scrollHeight - area.clientHeight/2;
        zoomCenter.current = undefined;
      }
      task = pdfPage.render({
        canvas,
        viewport,
        transform: [
          density,
          0,
          0,
          density,
          -viewport.width * x * density,
          -viewport.height * y * density,
        ],
        background: "#ffffff",
      });
      await task.promise;
      if (!disposed) {
        canvas.dataset.rendered = "true";
        setStatus("ready");
      }
    })().catch(() => {
      if (!disposed) setStatus("error");
    });
    return () => {
      disposed = true;
      task?.cancel();
      shared.release();
      for (const canvas of element.querySelectorAll("canvas")) {
        canvas.width = 0;
        canvas.height = 0;
      }
      element.replaceChildren();
    };
  }, [
    url,
    page,
    x,
    y,
    cropWidth,
    cropHeight,
    availableWidth,
    availableHeight,
    zoom,
    retry,
    caption,
    locale,
  ]);
  return (
    <dialog
      ref={dialog}
      className="pdf-figure-lightbox"
      aria-label={t(`论文原图 · 第 ${page} 页`, `Source figure · Page ${page}`)}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="pdf-figure-lightbox-shell">
        <header className="pdf-figure-lightbox-toolbar">
          {onOpenPage ? <button className="pdf-figure-source-link" onClick={() => { onClose(); onOpenPage(page); }}><span>{t("图表来自", "Figure from")} p.{page}</span><ArrowUpRight size={14}/></button> : <span>{t("论文原图 · p.")}{page}</span>}
          <div>
            <button
              aria-label={t("缩小图表")}
              disabled={zoom <= 1}
              onClick={() => changeZoom(Math.max(1, zoom - 0.25))}
            >
              <ZoomOut size={18} />
            </button>
            <button aria-label={t("图表适应窗口")} onClick={() => changeZoom(1)}>
              {Math.round(zoom * 100)}%
            </button>
            <button
              aria-label={t("放大图表")}
              disabled={zoom >= 3}
              onClick={() => changeZoom(Math.min(3, zoom + 0.25))}
            >
              <ZoomIn size={18} />
            </button>
            <button aria-label={t("下载原图裁切", "Download figure crop")} title={t("下载原图裁切", "Download figure crop")} disabled={status !== "ready"} onClick={downloadFigure}><Download size={18}/></button>
            <button aria-label={t("关闭图表")} onClick={onClose} autoFocus>
              <X size={20} />
            </button>
          </div>
        </header>
        <div
          className="pdf-figure-lightbox-scroll"
          ref={scrollArea}
          tabIndex={0}
          aria-label={t("可滚动的图表预览")}
          data-zoomed={zoom > 1}
          title={zoom > 1 ? t("拖动查看，方向键平移", "Drag to pan, or use arrow keys") : undefined}
          onPointerDown={event => {
            if (event.pointerType !== "mouse" || event.button !== 0 || zoom <= 1) return;
            const area = event.currentTarget;
            pan.current = {x:event.clientX,y:event.clientY,left:area.scrollLeft,top:area.scrollTop,pointerId:event.pointerId};
            area.setPointerCapture(event.pointerId); area.dataset.panning = "true"; event.preventDefault();
          }}
          onPointerMove={event => {
            if (!pan.current || pan.current.pointerId !== event.pointerId) return;
            event.currentTarget.scrollLeft = pan.current.left + pan.current.x - event.clientX;
            event.currentTarget.scrollTop = pan.current.top + pan.current.y - event.clientY;
          }}
          onPointerUp={event => {
            if (pan.current?.pointerId === event.pointerId) { pan.current = undefined; event.currentTarget.releasePointerCapture(event.pointerId); delete event.currentTarget.dataset.panning; }
          }}
          onLostPointerCapture={event => { pan.current = undefined; delete event.currentTarget.dataset.panning; }}
        >
          <div className="pdf-figure-lightbox-canvas" ref={canvasHost} />
        </div>
        {status === "loading" && (
          <div className="pdf-figure-lightbox-status" role="status">
            <Loader2 size={16} className="spin" /> {t("加载原图…")}
          </div>
        )}
        {status === "error" && (
          <div className="pdf-figure-lightbox-status" role="alert">
            {t("原图暂不可用")}{" "}
            <button onClick={() => setRetry((n) => n + 1)}>{t("重试")}</button>
          </div>
        )}
        {caption && <footer lang={captionLanguage}>{caption}{captionIsOriginal && <small className="muted-label"> · {t("原文图注", "Original caption")}</small>}</footer>}
      </div>
    </dialog>
  );
}
