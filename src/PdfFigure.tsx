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
  onOpenPage,
}: Props) {
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
        caption || `论文第 ${page} 页${crop ? "图表" : "预览"}`,
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
  }, [url, page, x, y, cropWidth, cropHeight, nearby, width, retry]);
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
            aria-label={`放大第 ${page} 页图表`}
            onClick={() => setEnlarged(true)}
          >
            <span>
              <Maximize2 size={15} /> 放大图表
            </span>
          </button>
        )}
        {loading && (
          <span className="pdf-figure-status" role="status">
            <Loader2 className="spin" size={17} />
            加载论文原图
          </span>
        )}
        {error && (
          <span className="pdf-figure-status" role="alert">
            原图暂不可用{" "}
            <button
              className="soft-button"
              onClick={() => setRetry((n) => n + 1)}
            >
              <RefreshCw size={13} />
              重试
            </button>
          </span>
        )}
      </div>
      <figcaption>
        <span>{caption || (crop ? "论文原图" : "论文页面预览")}</span>
        <button
          className="pdf-figure-citation"
          aria-label={`在论文中查看第 ${page} 页图表`}
          disabled={!onOpenPage}
          onClick={() => onOpenPage?.(page)}
        >
          {crop ? "查看原图" : "整页预览"} · p.{page} <ArrowUpRight size={12} />
        </button>
      </figcaption>
      {enlarged && (
        <FigureLightbox
          url={url}
          page={page}
          crop={crop}
          caption={caption}
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
  onClose,
}: Omit<Props, "onOpenPage"> & { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [availableWidth, setAvailableWidth] = useState(0);
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
    const observer = new ResizeObserver(() =>
      setAvailableWidth(Math.max(1, area.clientWidth - 32)),
    );
    observer.observe(area);
    return () => {
      observer.disconnect();
      element.close();
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const element = canvasHost.current;
    if (!element || !availableWidth) return;
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
      const displayWidth = availableWidth * zoom;
      const scale = displayWidth / (natural.width * cropWidth);
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
      canvas.setAttribute("aria-label", caption || `第 ${page} 页图表放大预览`);
      canvas.dataset.figurePage = String(page);
      element.replaceChildren(canvas);
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
    zoom,
    retry,
    caption,
  ]);
  return (
    <dialog
      ref={dialog}
      className="pdf-figure-lightbox"
      aria-label={`论文原图 · 第 ${page} 页`}
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
          <span>论文原图 · p.{page}</span>
          <div>
            <button
              aria-label="缩小图表"
              disabled={zoom <= 1}
              onClick={() => setZoom((z) => Math.max(1, z - 0.25))}
            >
              <ZoomOut size={18} />
            </button>
            <button aria-label="图表适应窗口" onClick={() => setZoom(1)}>
              {Math.round(zoom * 100)}%
            </button>
            <button
              aria-label="放大图表"
              disabled={zoom >= 3}
              onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
            >
              <ZoomIn size={18} />
            </button>
            <button aria-label="关闭图表" onClick={onClose} autoFocus>
              <X size={20} />
            </button>
          </div>
        </header>
        <div
          className="pdf-figure-lightbox-scroll"
          ref={scrollArea}
          tabIndex={0}
          aria-label="可滚动的图表预览"
        >
          <div className="pdf-figure-lightbox-canvas" ref={canvasHost} />
        </div>
        {status === "loading" && (
          <div className="pdf-figure-lightbox-status" role="status">
            <Loader2 size={16} className="spin" /> 加载原图…
          </div>
        )}
        {status === "error" && (
          <div className="pdf-figure-lightbox-status" role="alert">
            原图暂不可用{" "}
            <button onClick={() => setRetry((n) => n + 1)}>重试</button>
          </div>
        )}
        {caption && <footer>{caption}</footer>}
      </div>
    </dialog>
  );
}
