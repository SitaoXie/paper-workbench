import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  Download,
  ExternalLink,
  Loader2,
  Maximize2,
  MessageCircle,
  Sparkles,
  Languages,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  RefreshCw,
} from "lucide-react";
import "./pdf-reader.css";

GlobalWorkerOptions.workerSrc = workerUrl;
export type PdfSelection = {
  text: string;
  page: number;
  intent?: "ask" | "explain" | "translate";
  question?: string;
};
type Props = {
  url: string;
  page: number;
  onPage?: (page: number) => void;
  onAskSelection?: (selection: PdfSelection) => void;
};
type SelectionMenu = { text: string; page: number; left: number; top: number };
type PageSize = { width: number; height: number };

/** Only nearby pages own canvases. Offscreen pages retain their exact geometry. */
function RenderedPage({
  document,
  number,
  scale,
  width,
  height,
  active,
  onNavigate,
}: {
  document: PDFDocumentProxy;
  number: number;
  scale: number;
  width: number;
  height: number;
  active: boolean;
  onNavigate: (page: number) => void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    element.replaceChildren();
    if (!active) return;
    let disposed = false;
    let renderTask: RenderTask | undefined;
    let textLayer: TextLayer | undefined;
    setLoading(true);
    setError("");
    setWarning("");
    (async () => {
      const pdfPage = await document.getPage(number);
      if (disposed) return;
      const viewport = pdfPage.getViewport({ scale });
      const canvas = window.document.createElement("canvas");
      canvas.setAttribute("aria-label", `PDF 第 ${number} 页`);
      canvas.setAttribute("role", "img");
      canvas.dataset.pageNumber = String(number);
      const density = Math.min(
        window.devicePixelRatio || 1,
        2,
        Math.sqrt(12_000_000 / (viewport.width * viewport.height)),
      );
      canvas.width = Math.max(1, Math.floor(viewport.width * density));
      canvas.height = Math.max(1, Math.floor(viewport.height * density));
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const textContainer = window.document.createElement("div");
      textContainer.className = "pdf-text-layer textLayer";
      textContainer.setAttribute("aria-label", `PDF 第 ${number} 页文字`);
      textContainer.style.setProperty(
        "--total-scale-factor",
        String(scale * viewport.userUnit),
      );
      element.replaceChildren(canvas, textContainer);
      renderTask = pdfPage.render({
        canvas,
        viewport,
        transform: density === 1 ? undefined : [density, 0, 0, density, 0, 0],
        background: "#ffffff",
      });
      await renderTask.promise;
      if (disposed) return;
      canvas.dataset.rendered = "true";
      setLoading(false);
      try {
        const content = await pdfPage.getTextContent();
        if (disposed) return;
        textLayer = new TextLayer({
          textContentSource: content,
          container: textContainer,
          viewport,
        });
        await textLayer.render();
        if (!disposed) textContainer.dataset.rendered = "true";
        if (!disposed && !content.items.length)
          setWarning("扫描页 · 无可选择文字");
      } catch {
        if (!disposed) setWarning("文字选择层不可用");
      }
      // PDF annotation destinations preserve the paper's own section, figure and
      // bibliography navigation. Never execute arbitrary annotation actions.
      try {
        const annotations = await pdfPage.getAnnotations({ intent: "display" });
        if (disposed) return;
        const layer = window.document.createElement("div");
        layer.className = "pdf-annotation-layer";
        for (const annotation of annotations) {
          if (annotation.subtype !== "Link" || !Array.isArray(annotation.rect))
            continue;
          if (!annotation.dest && !annotation.url) continue;
          const coordinates = [
            ...viewport.convertToViewportPoint(
              annotation.rect[0],
              annotation.rect[1],
            ),
            ...viewport.convertToViewportPoint(
              annotation.rect[2],
              annotation.rect[3],
            ),
          ];
          if (!coordinates.every(Number.isFinite)) continue;
          const link = window.document.createElement("a");
          link.style.left = `${Math.min(coordinates[0], coordinates[2])}px`;
          link.style.top = `${Math.min(coordinates[1], coordinates[3])}px`;
          link.style.width = `${Math.abs(coordinates[2] - coordinates[0])}px`;
          link.style.height = `${Math.abs(coordinates[3] - coordinates[1])}px`;
          if (annotation.dest) {
            link.href = "#pdf-reference";
            link.title = "跳转到论文引用位置";
            link.setAttribute("aria-label", "跳转到论文引用位置");
            link.onclick = (event) => {
              event.preventDefault();
              void (async () => {
                const destination =
                  typeof annotation.dest === "string"
                    ? await document.getDestination(annotation.dest)
                    : annotation.dest;
                if (!Array.isArray(destination) || destination.length < 1)
                  return;
                const index =
                  typeof destination[0] === "number"
                    ? destination[0]
                    : await document.getPageIndex(destination[0]);
                if (!disposed && Number.isInteger(index))
                  navigateRef.current(index + 1);
              })().catch(() => {});
            };
          } else {
            const target = new URL(annotation.url, window.location.href);
            if (!["https:", "http:", "mailto:"].includes(target.protocol))
              continue;
            link.href = target.href;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.title = target.href;
            link.setAttribute("aria-label", `打开论文链接 ${target.href}`);
          }
          layer.appendChild(link);
        }
        if (!disposed) element.appendChild(layer);
      } catch {
        /* A malformed optional annotation must not hide the paper. */
      }
    })().catch((reason: unknown) => {
      if (
        disposed ||
        (reason instanceof Error &&
          reason.name === "RenderingCancelledException")
      )
        return;
      setLoading(false);
      setError("此页渲染失败");
    });
    return () => {
      disposed = true;
      renderTask?.cancel();
      textLayer?.cancel();
      // Release backing stores as soon as a page leaves the rendering window.
      for (const canvas of element.querySelectorAll("canvas")) {
        canvas.width = 0;
        canvas.height = 0;
      }
      element.replaceChildren();
    };
  }, [document, number, scale, active, retry]);
  return (
    <div
      className="pdf-continuous-page"
      data-pdf-page={number}
      style={{ width, height }}
      aria-label={`第 ${number} 页`}
    >
      <div
        className="pdf-page-surface"
        ref={surface}
        style={{ width, height }}
      />
      {active && loading && (
        <div className="pdf-page-placeholder" role="status">
          <Loader2 size={16} className="spin" />
          正在渲染第 {number} 页…
        </div>
      )}
      {!active && (
        <div className="pdf-page-placeholder" aria-hidden="true">
          {number}
        </div>
      )}
      {active && error && (
        <div className="pdf-page-placeholder" role="alert">
          {error}
          <button
            className="soft-button"
            onClick={() => setRetry((n) => n + 1)}
          >
            <RefreshCw size={13} />
            重试
          </button>
        </div>
      )}
      {active && warning && <span className="pdf-page-warning">{warning}</span>}
      <span className="pdf-page-number" aria-hidden="true">
        {number}
      </span>
    </div>
  );
}

/** Continuous, selectable PDF reading, bounded canvas memory, and citation jumps. */
export default function PdfReader({
  url,
  page,
  onPage,
  onAskSelection,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const selectionAction = useRef(onAskSelection);
  const dismissedSelection = useRef("");
  const lastSelection = useRef("");
  const [selectionQuestion, setSelectionQuestion] = useState("");
  selectionAction.current = onAskSelection;
  const [selectionMenu, setSelectionMenu] = useState<SelectionMenu | null>(
    null,
  );
  const [viewportHeight, setViewportHeight] = useState<number>();
  const onPageRef = useRef(onPage);
  onPageRef.current = onPage;
  const reportedPage = useRef(0);
  const currentPage = useRef(1);
  const scrollFrame = useRef(0);
  const anchor = useRef<{ page: number; fraction: number } | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [visible, setVisible] = useState({ first: 1, last: 3 });
  const [visiblePage, setVisiblePage] = useState(1);
  const scale =
    zoom ??
    (sizes.length
      ? Math.min(2, width / Math.max(...sizes.map((size) => size.width)))
      : 1);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const update = () => {
      const available =
        (window.visualViewport?.height || window.innerHeight) -
        Math.max(0, element.getBoundingClientRect().top) -
        2;
      setViewportHeight(Math.max(220, available));
    };
    update();
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    const observer = new ResizeObserver(update);
    if (element.parentElement) observer.observe(element.parentElement);
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!onAskSelection) return;
    const element = host.current;
    if (!element) return;
    let frame = 0;
    const inspect = () => {
      const selected = window.getSelection();
      if (!selected || selected.isCollapsed || !selected.rangeCount) {
        if (window.document.activeElement?.closest(".pdf-selection-menu"))
          return;
        setSelectionMenu(null);
        return;
      }
      const range = selected.getRangeAt(0);
      const start =
        range.startContainer.nodeType === Node.ELEMENT_NODE
          ? (range.startContainer as Element)
          : range.startContainer.parentElement;
      const end =
        range.endContainer.nodeType === Node.ELEMENT_NODE
          ? (range.endContainer as Element)
          : range.endContainer.parentElement;
      if (
        !start ||
        !end ||
        !element.contains(start) ||
        !element.contains(end) ||
        !start.closest(".pdf-text-layer") ||
        !end.closest(".pdf-text-layer")
      ) {
        setSelectionMenu(null);
        return;
      }
      const text = selected
        .toString()
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 12000);
      if (text === dismissedSelection.current) {
        setSelectionMenu(null);
        return;
      }
      if (text !== lastSelection.current) {
        lastSelection.current = text;
        setSelectionQuestion("");
      }
      if (text.length < 2) {
        setSelectionMenu(null);
        return;
      }
      const bounds = range.getBoundingClientRect();
      const view = element.getBoundingClientRect();
      const viewportBottom = Math.min(window.innerHeight, view.bottom);
      if (bounds.bottom < view.top || bounds.top > viewportBottom) {
        setSelectionMenu(null);
        return;
      }
      const menuWidth = Math.min(380, window.innerWidth - 24);
      const left = Math.max(
        12,
        Math.min(
          bounds.left + bounds.width / 2 - menuWidth / 2,
          window.innerWidth - menuWidth - 12,
        ),
      );
      const top =
        bounds.bottom + 120 < viewportBottom
          ? bounds.bottom + 10
          : Math.max(view.top + 6, bounds.top - 116);
      const sourcePage =
        Number(
          start.closest<HTMLElement>("[data-pdf-page]")?.dataset.pdfPage,
        ) || currentPage.current;
      setSelectionMenu({ text, page: sourcePage, left, top });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(inspect);
    };
    const startSelection = (event: PointerEvent) => {
      if (element.contains(event.target as Node)) {
        dismissedSelection.current = "";
        setSelectionMenu(null);
      }
    };
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dismissedSelection.current = lastSelection.current;
        cancelAnimationFrame(frame);
        setSelectionMenu(null);
      }
    };
    window.document.addEventListener("pointerdown", startSelection);
    window.document.addEventListener("selectionchange", schedule);
    window.document.addEventListener("pointerup", schedule);
    window.document.addEventListener("mouseup", schedule);
    window.document.addEventListener("keyup", schedule);
    window.document.addEventListener("keydown", dismiss);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      window.document.removeEventListener("pointerdown", startSelection);
      window.document.removeEventListener("selectionchange", schedule);
      window.document.removeEventListener("pointerup", schedule);
      window.document.removeEventListener("mouseup", schedule);
      window.document.removeEventListener("keyup", schedule);
      window.document.removeEventListener("keydown", dismiss);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [!!onAskSelection, url]);

  const rememberPosition = useCallback(() => {
    const element = host.current;
    const sheet = element?.querySelector<HTMLElement>(
      `[data-pdf-page="${currentPage.current}"]`,
    );
    if (!element || !sheet) return;
    anchor.current = {
      page: currentPage.current,
      fraction: (element.scrollTop - sheet.offsetTop) / sheet.offsetHeight,
    };
  }, []);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const update = () => {
      rememberPosition();
      setWidth(Math.max(1, element.clientWidth - 32));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [rememberPosition]);

  useEffect(() => {
    let disposed = false;
    setSelectionMenu(null);
    setDocument(null);
    setSizes([]);
    setError("");
    setZoom(null);
    reportedPage.current = 0;
    anchor.current = null;
    const task = getDocument({
      url,
      withCredentials: false,
      useSystemFonts: true,
    });
    (async () => {
      const pdf = await task.promise;
      // Exact dimensions make arbitrary jumps and mixed page sizes stable. Reading
      // page metadata creates no canvases and is bounded to four requests at once.
      const dimensions: PageSize[] = [];
      for (let start = 1; start <= pdf.numPages; start += 4) {
        const batch = await Promise.all(
          Array.from(
            { length: Math.min(4, pdf.numPages - start + 1) },
            async (_, index) => {
              const sheet = await pdf.getPage(start + index);
              const viewport = sheet.getViewport({ scale: 1 });
              return { width: viewport.width, height: viewport.height };
            },
          ),
        );
        if (disposed) return;
        dimensions.push(...batch);
      }
      if (!disposed) {
        setSizes(dimensions);
        setDocument(pdf);
      }
    })().catch((reason: unknown) => {
      if (disposed) return;
      setError(
        reason instanceof Error && reason.name === "PasswordException"
          ? "此 PDF 需要密码。请打开原始文件解锁后重新导入。"
          : "无法加载 PDF。文件可能不可访问或格式不受支持，请重试或打开原始文件。",
      );
    });
    return () => {
      disposed = true;
      void task.destroy().catch(() => {});
    };
  }, [url, retry]);

  const updateVisiblePages = useCallback(() => {
    const element = host.current;
    if (!element || !document) return;
    const top = element.scrollTop;
    const bottom = top + element.clientHeight;
    const margin = Math.max(500, element.clientHeight);
    let first = document.numPages;
    let last = 1;
    let nearest = 1;
    let nearestDistance = Infinity;
    for (const sheet of element.querySelectorAll<HTMLElement>(
      "[data-pdf-page]",
    )) {
      const number = Number(sheet.dataset.pdfPage);
      const sheetTop = sheet.offsetTop;
      const sheetBottom = sheetTop + sheet.offsetHeight;
      if (sheetBottom >= top - margin && sheetTop <= bottom + margin) {
        first = Math.min(first, number);
        last = Math.max(last, number);
      }
      // The page at the upper quarter of the viewport is the active reading page.
      const marker = top + Math.min(element.clientHeight * 0.25, 180);
      const distance =
        marker < sheetTop
          ? sheetTop - marker
          : marker > sheetBottom
            ? marker - sheetBottom
            : 0;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = number;
      }
    }
    setVisible((previous) =>
      previous.first === first && previous.last === last
        ? previous
        : { first, last },
    );
    currentPage.current = nearest;
    setVisiblePage(nearest);
    if (reportedPage.current !== nearest) {
      reportedPage.current = nearest;
      onPageRef.current?.(nearest);
    }
  }, [document]);

  useLayoutEffect(() => {
    const element = host.current;
    if (!element || !document || !width) return;
    const position = anchor.current;
    if (position) {
      const sheet = element.querySelector<HTMLElement>(
        `[data-pdf-page="${position.page}"]`,
      );
      if (sheet)
        element.scrollTop =
          sheet.offsetTop + position.fraction * sheet.offsetHeight;
      anchor.current = null;
    }
    // Initial/external navigation is handled by the next layout effect before
    // any scroll feedback is emitted, preventing a citation jump from bouncing.
  }, [document, width, scale]);

  useLayoutEffect(() => {
    const element = host.current;
    if (!element || !document || !width) return;
    const safePage = Math.max(
      1,
      Math.min(Number.isFinite(page) ? Math.trunc(page) : 1, document.numPages),
    );
    if (safePage !== reportedPage.current) {
      const sheet = element.querySelector<HTMLElement>(
        `[data-pdf-page="${safePage}"]`,
      );
      if (sheet) element.scrollTop = Math.max(0, sheet.offsetTop - 16);
      reportedPage.current = safePage;
      currentPage.current = safePage;
      setVisiblePage(safePage);
      if (safePage !== page) onPageRef.current?.(safePage);
    }
    updateVisiblePages();
  }, [document, page, width, scale, updateVisiblePages]);

  useEffect(() => () => cancelAnimationFrame(scrollFrame.current), []);
  const changeZoom = (next: number | null) => {
    rememberPosition();
    setZoom(next);
  };

  const navigateToPage = (number: number) => {
    if (!document || !host.current) return;
    const next = Math.max(
      1,
      Math.min(document.numPages, Math.trunc(number) || 1),
    );
    const sheet = host.current.querySelector<HTMLElement>(
      `[data-pdf-page="${next}"]`,
    );
    if (sheet) host.current.scrollTop = Math.max(0, sheet.offsetTop - 16);
    updateVisiblePages();
  };
  const askAboutSelection = (intent: "ask" | "explain" | "translate") => {
    if (!selectionMenu) return;
    dismissedSelection.current = selectionMenu.text;
    selectionAction.current?.({
      text: selectionMenu.text,
      page: selectionMenu.page,
      intent,
      question: selectionQuestion.trim() || undefined,
    });
    setSelectionMenu(null);
  };

  return (
    <section className="pdf-reader" aria-label="论文 PDF 阅读器">
      <div className="pdf-zoom-toolbar">
        <div className="pdf-page-navigation">
          <button
            className="icon-button"
            aria-label="上一页"
            disabled={!document || visiblePage <= 1}
            onClick={() => navigateToPage(visiblePage - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <input
            type="number"
            aria-label="PDF 页码"
            min={1}
            max={document?.numPages || 1}
            value={visiblePage}
            disabled={!document}
            onChange={(event) => navigateToPage(Number(event.target.value))}
          />
          <span>/ {document?.numPages || "—"}</span>
          <button
            className="icon-button"
            aria-label="下一页"
            disabled={!document || visiblePage >= document.numPages}
            onClick={() => navigateToPage(visiblePage + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
        {onAskSelection && (
          <span
            className="pdf-selection-hint"
            title="选中文字后提问；聚焦阅读区后使用左右方向键翻页"
          >
            划选文字即可提问
          </span>
        )}
        <div className="pdf-zoom-actions">
          <button
            className="icon-button"
            aria-label="缩小 PDF"
            disabled={!document || scale <= 0.25}
            onClick={() => changeZoom(Math.max(0.25, scale - 0.2))}
          >
            <Minus size={15} />
          </button>
          <output aria-label="PDF 缩放比例">{Math.round(scale * 100)}%</output>
          <button
            className="icon-button"
            aria-label="放大 PDF"
            disabled={!document || scale >= 3}
            onClick={() => changeZoom(Math.min(3, scale + 0.2))}
          >
            <Plus size={15} />
          </button>
          <button
            className={`pdf-fit-button ${zoom === null ? "is-fit" : ""}`}
            disabled={!document}
            onClick={() => changeZoom(null)}
          >
            <Maximize2 size={13} /> 适合宽度
          </button>
        </div>
        <span className="pdf-continuous-indicator" aria-label="当前 PDF 页码">
          {document ? `${visiblePage} / ${document.numPages}` : "连续阅读"}
        </span>
        <div className="pdf-source-actions">
          <a href={url} target="_blank" rel="noreferrer" title="打开原始 PDF">
            <ExternalLink size={14} />
          </a>
          <a href={url} download="paper.pdf" title="下载 PDF">
            <Download size={14} />
          </a>
        </div>
      </div>
      <div
        className="pdf-canvas-viewport"
        ref={host}
        tabIndex={0}
        aria-label="连续滚动论文页面"
        style={
          viewportHeight
            ? { height: viewportHeight, maxHeight: viewportHeight }
            : undefined
        }
        onKeyDown={(event) => {
          if (
            event.target !== event.currentTarget ||
            !document ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey
          )
            return;
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const next = Math.max(
            1,
            Math.min(
              document.numPages,
              currentPage.current + (event.key === "ArrowRight" ? 1 : -1),
            ),
          );
          const sheet = event.currentTarget.querySelector<HTMLElement>(
            `[data-pdf-page="${next}"]`,
          );
          if (sheet)
            event.currentTarget.scrollTop = Math.max(0, sheet.offsetTop - 16);
          updateVisiblePages();
        }}
        aria-busy={!document && !error}
        onScroll={() => {
          cancelAnimationFrame(scrollFrame.current);
          scrollFrame.current = requestAnimationFrame(updateVisiblePages);
        }}
      >
        {!document && !error && (
          <div className="pdf-render-status" role="status">
            <Loader2 size={18} className="spin" />
            正在加载论文…
          </div>
        )}
        {error && (
          <div className="pdf-render-error" role="alert">
            <p>{error}</p>
            <button
              className="soft-button"
              onClick={() => setRetry((n) => n + 1)}
            >
              <RefreshCw size={14} /> 重试
            </button>
            <a href={url} target="_blank" rel="noreferrer">
              打开原始 PDF <ExternalLink size={13} />
            </a>
          </div>
        )}
        {document && width > 0 && (
          <div className="pdf-page-stack">
            {sizes.map((size, index) => (
              <RenderedPage
                key={index + 1}
                document={document}
                number={index + 1}
                scale={scale}
                width={size.width * scale}
                height={size.height * scale}
                active={index + 1 >= visible.first && index + 1 <= visible.last}
                onNavigate={navigateToPage}
              />
            ))}
          </div>
        )}
      </div>
      {selectionMenu &&
        onAskSelection &&
        createPortal(
          <div
            className="pdf-selection-menu"
            role="dialog"
            aria-label="选中文字操作"
            style={{ left: selectionMenu.left, top: selectionMenu.top }}
            onPointerDown={(event) => {
              if (!(event.target instanceof HTMLInputElement))
                event.preventDefault();
            }}
            onMouseDown={(event) => {
              if (!(event.target instanceof HTMLInputElement))
                event.preventDefault();
            }}
          >
            <div className="pdf-selection-question">
              <span className="pdf-selection-source">
                p.{selectionMenu.page}
              </span>
              <input
                aria-label="针对选中文字的问题"
                value={selectionQuestion}
                onChange={(event) => setSelectionQuestion(event.target.value)}
                placeholder="对这段内容有什么疑问？"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    askAboutSelection("ask");
                  }
                }}
              />
            </div>
            <div className="pdf-selection-actions">
              <button
                aria-label="询问助手"
                onClick={() => askAboutSelection("ask")}
              >
                <MessageCircle size={15} />
                询问助手
              </button>
              <button
                aria-label="解释选中内容"
                onClick={() => askAboutSelection("explain")}
              >
                <Sparkles size={15} />
                快速解释
              </button>
              <button
                aria-label="翻译选中内容"
                onClick={() => askAboutSelection("translate")}
              >
                <Languages size={15} />
                翻译这段
              </button>
            </div>
          </div>,
          window.document.body,
        )}
    </section>
  );
}
