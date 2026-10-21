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
  Highlighter,
  Underline,
  StickyNote,
  PenLine,
  Undo2,
  Save,
  X,
  Check,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import AnnotationLayer from "./AnnotationLayer";
import { selectedPdfText } from "./pdf-selection-text";
import {
  annotationColors,
  normalizedSelectionRects,
  type Annotation,
  type AnnotationDraft,
  type AnnotationColor,
  type AnnotationRect,
  type InkStroke,
} from "./reader-annotations";
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
  annotations?: Annotation[];
  onCreateAnnotation?: (draft: AnnotationDraft) => Promise<Annotation | void>;
  onSelectAnnotation?: (id: string) => void;
  onInlineAssist?: (payload: {
    text: string;
    page: number;
    language?: string;
    kind: "translation" | "explanation";
  }) => Promise<{ text: string; source?: string; createdAt?: string }>;
  language?: string;
  annotationFocus?: { id: string; nonce: number };
};
type SelectionMenu = {
  text: string;
  page: number;
  left: number;
  top: number;
  rects: AnnotationRect[];
  segments: { page: number; text: string; rects: AnnotationRect[] }[];
};
type InlineResult = {
  selection: SelectionMenu;
  kind: "translation" | "explanation";
  language: string;
  loading: boolean;
  text: string;
  error: string;
  saved?: boolean;
  source?: string;
};
type PageSize = { width: number; height: number };
type InkDraft = { page: number; stroke: InkStroke; color: AnnotationColor };
function restoredInkDrafts(url: string): InkDraft[] {
  try {
    const value: unknown = JSON.parse(
      sessionStorage.getItem(`paper-workbench:ink-draft:${url}`) || "[]",
    );
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (item): item is InkDraft =>
          item &&
          Number.isInteger(item.page) &&
          item.page > 0 &&
          item.color in annotationColors &&
          item.stroke?.width > 0 &&
          item.stroke.width <= 0.05 &&
          Array.isArray(item.stroke.points) &&
          item.stroke.points.length <= 4000 &&
          item.stroke.points.every(
            (point: { x: number; y: number }) =>
              Number.isFinite(point.x) &&
              Number.isFinite(point.y) &&
              point.x >= 0 &&
              point.x <= 1 &&
              point.y >= 0 &&
              point.y <= 1,
          ),
      )
      .slice(0, 1000);
  } catch {
    return [];
  }
}

/** Only nearby pages own canvases. Offscreen pages retain their exact geometry. */
function RenderedPage({
  document,
  number,
  scale,
  width,
  height,
  active,
  onNavigate,
  annotations,
  drawing,
  annotationColor,
  strokes,
  onStroke,
  onSelectAnnotation,
  focusedAnnotation,
  language,
}: {
  document: PDFDocumentProxy;
  number: number;
  scale: number;
  width: number;
  height: number;
  active: boolean;
  onNavigate: (page: number) => void;
  annotations: Annotation[];
  drawing: boolean;
  annotationColor: AnnotationColor;
  strokes: { stroke: InkStroke; color: AnnotationColor }[];
  onStroke: (stroke: InkStroke) => void;
  onSelectAnnotation?: (id: string) => void;
  focusedAnnotation?: string;
  language: string;
}) {
  const t = (zh: string, en: string) => (language.startsWith("en") ? en : zh);
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
      canvas.setAttribute(
        "aria-label",
        t(`PDF 第 ${number} 页`, `PDF page ${number}`),
      );
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
      textContainer.setAttribute(
        "aria-label",
        t(`PDF 第 ${number} 页文字`, `PDF page ${number} text`),
      );
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
          setWarning(
            t("扫描页 · 无可选择文字", "Scanned page · No selectable text"),
          );
      } catch {
        if (!disposed)
          setWarning(t("文字选择层不可用", "Text selection is unavailable"));
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
            link.title = t("跳转到论文引用位置", "Go to paper reference");
            link.setAttribute(
              "aria-label",
              t("跳转到论文引用位置", "Go to paper reference"),
            );
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
            link.setAttribute(
              "aria-label",
              t(
                `打开论文链接 ${target.href}`,
                `Open paper link ${target.href}`,
              ),
            );
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
      setError(t("此页渲染失败", "This page could not be rendered"));
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
  }, [document, number, scale, active, retry, language]);
  return (
    <div
      className="pdf-continuous-page"
      data-pdf-page={number}
      style={{ width, height }}
      aria-label={t(`第 ${number} 页`, `Page ${number}`)}
    >
      <div
        className="pdf-page-surface"
        ref={surface}
        style={{ width, height }}
      />
      {active && (
        <AnnotationLayer
          annotations={annotations}
          drawing={drawing}
          color={annotationColor}
          drafts={strokes}
          focusedId={focusedAnnotation}
          onStroke={onStroke}
          onSelect={onSelectAnnotation}
          language={language}
        />
      )}
      {active && loading && (
        <div className="pdf-page-placeholder" role="status">
          <Loader2 size={16} className="spin" />
          {t(`正在渲染第 ${number} 页…`, `Rendering page ${number}…`)}
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
            {t("重试", "Retry")}
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
  annotations = [],
  onCreateAnnotation,
  onSelectAnnotation,
  onInlineAssist,
  language = "zh-CN",
  annotationFocus,
}: Props) {
  const english = language.startsWith("en");
  const t = (zh: string, en: string) => (english ? en : zh);
  const [paperColors, setPaperColors] = useState<"theme" | "original">(() => {
    try {
      return localStorage.getItem("pw-pdf-colors") === "original"
        ? "original"
        : "theme";
    } catch {
      return "theme";
    }
  });
  const [annotationColor, setAnnotationColor] =
    useState<AnnotationColor>("yellow");
  const [inkColor, setInkColor] = useState<AnnotationColor>("blue");
  const [annotationBusy, setAnnotationBusy] = useState(false);
  const [annotationError, setAnnotationError] = useState("");
  const [annotationStatus, setAnnotationStatus] = useState("");
  const [noteEditor, setNoteEditor] = useState<SelectionMenu | null>(null);
  const [noteBody, setNoteBody] = useState("");
  const [noteTags, setNoteTags] = useState("");
  const [inlineResult, setInlineResult] = useState<InlineResult | null>(null);
  const [selectionLanguage, setSelectionLanguage] = useState(language);
  useEffect(() => { setSelectionLanguage(language); }, [language]);
  const inlineRequest = useRef(0);
  const [drawing, setDrawing] = useState(false);
  const [inkDrafts, setInkDrafts] = useState<InkDraft[]>(() =>
    restoredInkDrafts(url),
  );
  const saveBusy = useRef(false);
  const [, refreshAnchoredPopover] = useState(0);

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
    try {
      localStorage.setItem("pw-pdf-colors", paperColors);
    } catch {
      /* Reading preferences also work when browser storage is unavailable. */
    }
  }, [paperColors]);

  useEffect(() => {
    // Keep unfinished handwriting across reader unmounts / reloads in this tab.
    // Committed annotations still go only through the explicit Save action.
    try {
      const key = `paper-workbench:ink-draft:${url}`;
      if (inkDrafts.length)
        sessionStorage.setItem(key, JSON.stringify(inkDrafts));
      else sessionStorage.removeItem(key);
    } catch {
      /* Storage may be disabled; the in-memory draft remains available. */
    }
  }, [inkDrafts]);

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
    if (!onAskSelection && !onCreateAnnotation && !onInlineAssist) return;
    const element = host.current;
    if (!element) return;
    let frame = 0;
    const inspect = () => {
      const selected = window.getSelection();
      if (!selected || selected.isCollapsed || !selected.rangeCount) {
        if (
          window.document.activeElement?.closest(
            ".pdf-selection-menu, .pdf-inline-assist, .pdf-note-editor",
          )
        )
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
      const text = selectedPdfText(range, element).slice(0, 12000);
      if (text === dismissedSelection.current) {
        setSelectionMenu(null);
        return;
      }
      if (text !== lastSelection.current) {
        lastSelection.current = text;
        setSelectionQuestion("");
        setInlineResult(null);
        inlineRequest.current += 1;
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
      const menuWidth = Math.min(420, window.innerWidth - 24);
      const left = Math.max(
        12,
        Math.min(
          bounds.left + bounds.width / 2 - menuWidth / 2,
          window.innerWidth - menuWidth - 12,
        ),
      );
      const menuHeight = onCreateAnnotation ? 330 : 240;
      const top =
        bounds.bottom + menuHeight < viewportBottom
          ? bounds.bottom + 10
          : Math.max(12, Math.min(bounds.top - menuHeight, viewportBottom - menuHeight));
      const sourcePage =
        Number(
          start.closest<HTMLElement>("[data-pdf-page]")?.dataset.pdfPage,
        ) || currentPage.current;
      const segments = Array.from(
        element.querySelectorAll<HTMLElement>("[data-pdf-page]"),
      )
        .filter((sheet) => range.intersectsNode(sheet))
        .flatMap((sheet) => {
          const textLayer = sheet.querySelector(".pdf-text-layer");
          if (!textLayer) return [];
          const clipped = range.cloneRange();
          if (!sheet.contains(range.startContainer))
            clipped.setStart(textLayer, 0);
          if (!sheet.contains(range.endContainer))
            clipped.setEnd(textLayer, textLayer.childNodes.length);
          const rects = normalizedSelectionRects(clipped, sheet);
          return rects.length
            ? [
                {
                  page: Number(sheet.dataset.pdfPage),
                  text: selectedPdfText(clipped, sheet).slice(0, 12000),
                  rects,
                },
              ]
            : [];
        });
      setSelectionMenu({
        text,
        page: sourcePage,
        left,
        top,
        rects:
          segments.find((segment) => segment.page === sourcePage)?.rects || [],
        segments,
      });
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
        setNoteEditor(null);
        setInlineResult(null);
        inlineRequest.current += 1;
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
  }, [!!onAskSelection, !!onCreateAnnotation, !!onInlineAssist, url]);

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
    setInlineResult(null);
    setNoteEditor(null);
    setInkDrafts(restoredInkDrafts(url));
    setDrawing(false);
    setAnnotationError("");
    setAnnotationStatus("");
    inlineRequest.current += 1;
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
          ? t(
              "此 PDF 需要密码。请打开原始文件解锁后重新导入。",
              "This PDF is password protected. Unlock the original file and import it again.",
            )
          : t(
              "无法加载 PDF。文件可能不可访问或格式不受支持，请重试或打开原始文件。",
              "Could not load this PDF. Retry or open the original file.",
            ),
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

  useEffect(() => {
    if (!annotationFocus || !document || !host.current) return;
    const annotation = annotations.find(
      (item) => item.id === annotationFocus.id,
    );
    if (!annotation) return;
    const sheet = host.current.querySelector<HTMLElement>(
      `[data-pdf-page="${annotation.page}"]`,
    );
    if (!sheet) return;
    const y =
      annotation.rects?.[0]?.y ?? annotation.strokes?.[0]?.points[0]?.y ?? 0;
    host.current.scrollTop = Math.max(
      0,
      sheet.offsetTop +
        y * sheet.offsetHeight -
        Math.min(120, host.current.clientHeight * 0.22),
    );
    updateVisiblePages();
  }, [annotationFocus?.id, annotationFocus?.nonce, document]);

  useEffect(() => {
    if (!inlineResult && !noteEditor) return;
    let frame = 0;
    const reposition = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        refreshAnchoredPopover((value) => value + 1),
      );
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("resize", reposition);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("resize", reposition);
    };
  }, [!!inlineResult, !!noteEditor]);

  useEffect(
    () => () => {
      inlineRequest.current += 1;
    },
    [],
  );

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
  const dismissSelection = (selection: SelectionMenu) => {
    dismissedSelection.current = selection.text;
    setSelectionMenu(null);
  };
  const askAboutSelection = () => {
    if (!selectionMenu) return;
    dismissSelection(selectionMenu);
    selectionAction.current?.({
      text: selectionMenu.text,
      page: selectionMenu.page,
      intent: "ask",
      question: selectionQuestion.trim() || undefined,
    });
  };
  const saveAnnotation = async (
    kind: "highlight" | "underline" | "note",
    selection = selectionMenu,
  ) => {
    if (!selection || !onCreateAnnotation || saveBusy.current) return;
    if (selection.segments.some((segment) => segment.rects.length > 300)) {
      setAnnotationError(
        t(
          "选区过长，请缩短选区后保存。",
          "This selection is too long. Select a shorter passage before saving.",
        ),
      );
      return;
    }
    saveBusy.current = true;
    setAnnotationBusy(true);
    setAnnotationError("");
    setAnnotationStatus("");
    try {
      const pendingSegments = selection.segments.length
        ? [...selection.segments]
        : [
            {
              page: selection.page,
              text: selection.text,
              rects: selection.rects,
            },
          ];
      for (const segment of pendingSegments) {
        await onCreateAnnotation({
          kind,
          page: segment.page,
          quote: segment.text,
          rects: segment.rects,
          color: annotationColor,
          ...(kind === "note"
            ? {
                body: noteBody.trim(),
                tags: noteTags
                  .split(/[,，]/)
                  .map((tag) => tag.trim())
                  .filter(Boolean),
              }
            : {}),
        });
        selection.segments = selection.segments.filter(
          (item) => item !== segment,
        );
      }
      dismissSelection(selection);
      setNoteEditor(null);
      setNoteBody("");
      setNoteTags("");
      setAnnotationStatus(t("已保存到笔记", "Saved to notes"));
    } catch (reason) {
      setAnnotationError(
        reason instanceof Error
          ? reason.message
          : t("保存失败，请重试", "Could not save. Try again."),
      );
    } finally {
      saveBusy.current = false;
      setAnnotationBusy(false);
    }
  };
  const runInline = async (
    kind: "translation" | "explanation",
    selection = selectionMenu,
    resultLanguage = selectionLanguage,
  ) => {
    if (!selection) return;
    dismissSelection(selection);
    setNoteEditor(null);
    const request = ++inlineRequest.current;
    setInlineResult({
      selection,
      kind,
      language: resultLanguage,
      loading: true,
      text: "",
      error: "",
    });
    try {
      if (!onInlineAssist)
        throw new Error(
          t(
            "请先配置模型连接，再重试就地翻译或解释。",
            "Configure a model connection, then retry inline translation or explanation.",
          ),
        );
      const result = await onInlineAssist({
        text: selection.text,
        page: selection.page,
        language: resultLanguage,
        kind,
      });
      if (request === inlineRequest.current)
        setInlineResult({
          selection,
          kind,
          language: resultLanguage,
          loading: false,
          text: result.text,
          error: "",
          source: result.source,
        });
    } catch (reason) {
      if (request === inlineRequest.current)
        setInlineResult({
          selection,
          kind,
          language: resultLanguage,
          loading: false,
          text: "",
          error:
            reason instanceof Error
              ? reason.message
              : t("请求失败，请重试", "Request failed. Try again."),
        });
    }
  };
  const saveInline = async () => {
    if (!inlineResult?.text || !onCreateAnnotation || saveBusy.current) return;
    if (inlineResult.selection.rects.length > 300) {
      setAnnotationError(
        t(
          "选区过长，请缩短选区后保存。",
          "This selection is too long. Select a shorter passage before saving.",
        ),
      );
      return;
    }
    saveBusy.current = true;
    setAnnotationBusy(true);
    setAnnotationError("");
    const result = inlineResult;
    try {
      await onCreateAnnotation({
        kind: result.kind,
        page: result.selection.page,
        quote: result.selection.text,
        rects: result.selection.rects,
        body: result.text,
        color: annotationColor,
        language: result.language,
        tags: [result.language],
      });
      setInlineResult((current) =>
        current === result ? { ...current, saved: true } : current,
      );
      setAnnotationStatus(t("已保存到笔记", "Saved to notes"));
    } catch (reason) {
      setAnnotationError(
        reason instanceof Error
          ? reason.message
          : t("保存失败，请重试", "Could not save. Try again."),
      );
    } finally {
      saveBusy.current = false;
      setAnnotationBusy(false);
    }
  };
  const saveInk = async () => {
    if (!inkDrafts.length || !onCreateAnnotation || saveBusy.current) return;
    saveBusy.current = true;
    setAnnotationBusy(true);
    setAnnotationError("");
    const captured = [...inkDrafts];
    try {
      const groups = new Map<string, typeof inkDrafts>();
      for (const draft of captured) {
        const key = `${draft.page}:${draft.color}`;
        groups.set(key, [...(groups.get(key) || []), draft]);
      }
      for (const group of groups.values()) {
        const batches: InkDraft[][] = [];
        let batch: InkDraft[] = [],
          points = 0;
        for (const item of group) {
          if (
            batch.length >= 200 ||
            points + item.stroke.points.length > 12000
          ) {
            batches.push(batch);
            batch = [];
            points = 0;
          }
          batch.push(item);
          points += item.stroke.points.length;
        }
        if (batch.length) batches.push(batch);
        for (const batch of batches) {
          await onCreateAnnotation({
            kind: "ink",
            page: batch[0].page,
            color: batch[0].color,
            strokes: batch.map((item) => item.stroke),
          });
          // A successful batch leaves the draft immediately, so retry cannot duplicate it.
          setInkDrafts((current) =>
            current.filter((item) => !batch.includes(item)),
          );
        }
      }
      setAnnotationStatus(t("手写笔记已保存", "Handwriting saved"));
    } catch (reason) {
      setAnnotationError(
        reason instanceof Error
          ? reason.message
          : t("保存失败，请重试", "Could not save. Try again."),
      );
    } finally {
      saveBusy.current = false;
      setAnnotationBusy(false);
    }
  };
  const colorPicker = (mode: "annotation" | "ink" = "annotation") => (
    <div
      className="pdf-annotation-colors"
      role="group"
      aria-label={t("标注颜色", "Annotation color")}
    >
      {(Object.keys(annotationColors) as AnnotationColor[]).map((color) => (
        <button
          key={color}
          type="button"
          className={
            (mode === "ink" ? inkColor : annotationColor) === color
              ? "is-selected"
              : ""
          }
          style={{ background: annotationColors[color] }}
          aria-label={
            english
              ? color
              : {
                  yellow: "黄色",
                  green: "绿色",
                  blue: "蓝色",
                  pink: "粉色",
                  purple: "紫色",
                }[color]
          }
          aria-pressed={(mode === "ink" ? inkColor : annotationColor) === color}
          onClick={() =>
            mode === "ink" ? setInkColor(color) : setAnnotationColor(color)
          }
        >
          {(mode === "ink" ? inkColor : annotationColor) === color && (
            <Check size={13} />
          )}
        </button>
      ))}
    </div>
  );
  const floatingPosition = (selection: SelectionMenu) => {
    const sheet = host.current?.querySelector<HTMLElement>(
      `[data-pdf-page="${selection.page}"]`,
    );
    const bounds = sheet?.getBoundingClientRect();
    const rect = selection.rects[0];
    const top =
      bounds && rect
        ? bounds.top + (rect.y + rect.height) * bounds.height + 8
        : selection.top;
    return {
      left: Math.max(
        12,
        Math.min(
          selection.left,
          window.innerWidth - Math.min(420, window.innerWidth - 24) - 12,
        ),
      ),
      top: Math.max(
        12,
        Math.min(
          top,
          window.innerHeight - Math.min(440, window.innerHeight * 0.65) - 12,
        ),
      ),
    };
  };

  return (
    <section
      className="pdf-reader"
      data-paper-colors={paperColors}
      aria-label={t("论文 PDF 阅读器", "Paper PDF reader")}
    >
      <div className="pdf-zoom-toolbar">
        <div className="pdf-page-navigation">
          <button
            className="icon-button"
            aria-label={t("上一页", "Previous page")}
            disabled={!document || visiblePage <= 1}
            onClick={() => navigateToPage(visiblePage - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <input
            type="number"
            aria-label={t("PDF 页码", "PDF page number")}
            min={1}
            max={document?.numPages || 1}
            value={visiblePage}
            disabled={!document}
            onChange={(event) => navigateToPage(Number(event.target.value))}
          />
          <span>/ {document?.numPages || "—"}</span>
          <button
            className="icon-button"
            aria-label={t("下一页", "Next page")}
            disabled={!document || visiblePage >= document.numPages}
            onClick={() => navigateToPage(visiblePage + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
        {onAskSelection && (
          <span
            className="pdf-selection-hint"
            title={t(
              "选择文字以标注、解释、翻译或提问；左右方向键翻页",
              "Select text to annotate, explain, translate or ask; arrow keys change pages",
            )}
          >
            <span className="pdf-selection-hint-full">
              {t("划词 · 标注 · 翻译", "Select · Annotate · Translate")}
            </span>
            <span className="pdf-selection-hint-compact">
              {t("选择文字", "Select text")}
            </span>
          </span>
        )}
        <div className="pdf-zoom-actions">
          <button
            className="icon-button"
            aria-label={t("缩小 PDF", "Zoom out PDF")}
            disabled={!document || scale <= 0.25}
            onClick={() => changeZoom(Math.max(0.25, scale - 0.2))}
          >
            <Minus size={15} />
          </button>
          <output aria-label={t("PDF 缩放比例", "PDF zoom level")}>
            {Math.round(scale * 100)}%
          </output>
          <button
            className="icon-button"
            aria-label={t("放大 PDF", "Zoom in PDF")}
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
            <Maximize2 size={13} /> {t("适合宽度", "Fit width")}
          </button>
        </div>
        <span
          className="pdf-continuous-indicator"
          aria-label={t("当前 PDF 页码", "Current PDF page")}
        >
          {document
            ? `${visiblePage} / ${document.numPages}`
            : t("连续阅读", "Continuous reading")}
        </span>
        <div className="pdf-source-actions">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            title={t("打开原始 PDF", "Open original PDF")}
            aria-label={t("打开原始 PDF", "Open original PDF")}
          >
            <ExternalLink size={14} />
          </a>
          <a
            href={url}
            download="paper.pdf"
            title={t("下载 PDF", "Download PDF")}
            aria-label={t("下载 PDF", "Download PDF")}
          >
            <Download size={14} />
          </a>
        </div>
      </div>
      <div className="pdf-annotation-toolbar">
        <label className="pdf-paper-colors">
          <span>{t("纸张", "Paper")}</span>
          <select
            aria-label={t("PDF 纸张颜色", "PDF paper colors")}
            value={paperColors}
            onChange={(event) =>
              setPaperColors(event.target.value as "theme" | "original")
            }
          >
            <option value="theme">{t("跟随主题", "Follow theme")}</option>
            <option value="original">{t("原始颜色", "Original colors")}</option>
          </select>
        </label>
        {onCreateAnnotation && (
          <>
            <button
              type="button"
              className={`pdf-ink-toggle ${drawing ? "is-active" : ""}`}
              aria-pressed={drawing}
              onClick={() => {
                setDrawing((value) => !value);
                setSelectionMenu(null);
                window.getSelection()?.removeAllRanges();
              }}
            >
              <PenLine size={15} />
              {drawing ? t("结束手写", "Finish drawing") : t("手写", "Draw")}
            </button>
            {drawing ? (
              <>
                {colorPicker("ink")}
                <span className="pdf-ink-hint">
                  {t(
                    "在纸面上书写，保存后同步至笔记",
                    "Draw on a page, then save to notes",
                  )}
                </span>
              </>
            ) : (
              <span className="pdf-ink-hint">
                {t(
                  "选中文字即可高亮、划线或添加笔记",
                  "Select text to highlight, underline or add a note",
                )}
              </span>
            )}
            {!!inkDrafts.length && (
              <>
                <span className="pdf-ink-count">
                  {inkDrafts.length} {t("笔未保存", "unsaved strokes")}
                </span>
                <button
                  type="button"
                  disabled={annotationBusy}
                  onClick={() =>
                    setInkDrafts((current) => current.slice(0, -1))
                  }
                >
                  <Undo2 size={14} />
                  {t("撤销", "Undo")}
                </button>
                <button
                  type="button"
                  disabled={annotationBusy}
                  onClick={() => void saveInk()}
                >
                  <Save size={14} />
                  {t("保存手写", "Save drawing")}
                </button>
                <button
                  type="button"
                  disabled={annotationBusy}
                  aria-label={t("清除未保存手写", "Discard unsaved drawing")}
                  onClick={() => setInkDrafts([])}
                >
                  <X size={14} />
                </button>
              </>
            )}
            {(annotationStatus || annotationError) && (
              <span
                className={`pdf-annotation-status ${annotationError ? "is-error" : ""}`}
                role={annotationError ? "alert" : "status"}
              >
                {annotationError || annotationStatus}
              </span>
            )}
          </>
        )}
        <span className="pdf-theme-color-notice">
          {t(
            "深色显示会调整图色，核对图表请选「原始颜色」。",
            "Dark display adjusts figure colors. Choose Original colors to verify charts.",
          )}
        </span>
      </div>
      <div
        className="pdf-canvas-viewport"
        ref={host}
        tabIndex={0}
        aria-label={t("连续滚动论文页面", "Continuous paper pages")}
        style={
          viewportHeight
            ? { height: viewportHeight, maxHeight: viewportHeight }
            : undefined
        }
        onClick={(event) => {
          if (
            drawing ||
            !onSelectAnnotation ||
            (window.getSelection()?.toString().trim().length || 0) > 0 ||
            (event.target as HTMLElement).closest("button, a")
          )
            return;
          const sheet = (event.target as HTMLElement).closest<HTMLElement>(
            "[data-pdf-page]",
          );
          if (!sheet) return;
          const bounds = sheet.getBoundingClientRect();
          const x = (event.clientX - bounds.left) / bounds.width;
          const y = (event.clientY - bounds.top) / bounds.height;
          const selected = [...annotations]
            .reverse()
            .find(
              (item) =>
                item.page === Number(sheet.dataset.pdfPage) &&
                item.rects?.some(
                  (rect) =>
                    x >= rect.x &&
                    x <= rect.x + rect.width &&
                    y >= rect.y &&
                    y <= rect.y + rect.height + 0.003,
                ),
            );
          if (selected) onSelectAnnotation(selected.id);
        }}
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
            {t("正在加载论文…", "Loading paper…")}
          </div>
        )}
        {error && (
          <div className="pdf-render-error" role="alert">
            <p>{error}</p>
            <button
              className="soft-button"
              onClick={() => setRetry((n) => n + 1)}
            >
              <RefreshCw size={14} /> {t("重试", "Retry")}
            </button>
            <a href={url} target="_blank" rel="noreferrer">
              {t("打开原始 PDF", "Open original PDF")}{" "}
              <ExternalLink size={13} />
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
                annotations={annotations.filter(
                  (annotation) => annotation.page === index + 1,
                )}
                drawing={drawing}
                annotationColor={inkColor}
                strokes={inkDrafts.filter((item) => item.page === index + 1)}
                onStroke={(stroke) =>
                  setInkDrafts((current) => [
                    ...current,
                    { page: index + 1, stroke, color: inkColor },
                  ])
                }
                onSelectAnnotation={onSelectAnnotation}
                focusedAnnotation={annotationFocus?.id}
                language={language}
              />
            ))}
          </div>
        )}
      </div>
      {selectionMenu &&
        !drawing &&
        !inlineResult &&
        !noteEditor &&
        createPortal(
          <div
            className="pdf-selection-menu"
            role="dialog"
            aria-label={t("选中文字操作", "Selected text actions")}
            style={{ left: selectionMenu.left, top: selectionMenu.top, maxHeight: `calc(100dvh - ${selectionMenu.top + 12}px)` }}
            onPointerDown={(event) => {
              if (!(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLSelectElement))
                event.preventDefault();
            }}
            onMouseDown={(event) => {
              if (!(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLSelectElement))
                event.preventDefault();
            }}
          >
            <div className="pdf-selection-question">
              <span className="pdf-selection-source">
                p.{selectionMenu.page}
              </span>
              {onAskSelection && (
                <input
                  aria-label={t(
                    "针对选中文字的问题",
                    "Question about selected text",
                  )}
                  value={selectionQuestion}
                  onChange={(event) => setSelectionQuestion(event.target.value)}
                  placeholder={t(
                    "对这段内容有什么疑问？",
                    "What would you like to ask?",
                  )}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      askAboutSelection();
                    }
                  }}
                />
              )}
              <button
                className="pdf-popover-close"
                aria-label={t("关闭选区菜单", "Close selection menu")}
                onClick={() => dismissSelection(selectionMenu)}
              >
                <X size={14} />
              </button>
            </div>
            <label className="pdf-selection-language">{t("结果语言", "Result language")}
              <select aria-label={t("选文结果语言", "Selection result language")} value={selectionLanguage.startsWith("en") ? "en" : "zh-CN"} onChange={event => setSelectionLanguage(event.target.value)}>
                <option value="zh-CN">中文</option><option value="en">English</option>
              </select>
            </label>
            <div className="pdf-selection-actions">
              {onAskSelection && (
                <button
                  aria-label={t("询问助手", "Ask assistant")}
                  onClick={askAboutSelection}
                >
                  <MessageCircle size={15} />
                  {t("提问", "Ask")}
                </button>
              )}
              <button
                aria-label={t("解释选中内容", "Explain selection")}
                onClick={() => void runInline("explanation")}
              >
                <Sparkles size={15} />
                {t("就地解释", "Explain")}
              </button>
              <button
                aria-label={t("翻译选中内容", "Translate selection")}
                onClick={() => void runInline("translation")}
              >
                <Languages size={15} />
                {t("就地翻译", "Translate")}
              </button>
            </div>
            {onCreateAnnotation && (
              <div className="pdf-selection-annotations">
                {colorPicker()}
                <div className="pdf-selection-actions">
                  <button
                    disabled={annotationBusy}
                    aria-label={t("高亮选中内容", "Highlight selection")}
                    onClick={() => void saveAnnotation("highlight")}
                  >
                    <Highlighter size={14} />
                    {t("高亮", "Highlight")}
                  </button>
                  <button
                    disabled={annotationBusy}
                    aria-label={t("划线选中内容", "Underline selection")}
                    onClick={() => void saveAnnotation("underline")}
                  >
                    <Underline size={14} />
                    {t("划线", "Underline")}
                  </button>
                  <button
                    aria-label={t("添加选区笔记", "Add selection note")}
                    onClick={() => {
                      dismissSelection(selectionMenu);
                      setNoteEditor(selectionMenu);
                      setNoteBody("");
                      setNoteTags("");
                      setAnnotationError("");
                    }}
                  >
                    <StickyNote size={14} />
                    {t("笔记", "Note")}
                  </button>
                </div>
              </div>
            )}
            {annotationError && (
              <p role="alert" className="pdf-popover-error">
                {annotationError}
              </p>
            )}
          </div>,
          window.document.body,
        )}
      {noteEditor &&
        createPortal(
          <div
            className="pdf-note-editor"
            role="dialog"
            aria-label={t("添加笔记", "Add note")}
            style={floatingPosition(noteEditor)}
          >
            <header>
              <strong>
                <StickyNote size={15} />
                {t("笔记", "Note")} · p.{noteEditor.page}
              </strong>
              <button
                aria-label={t("关闭笔记编辑", "Close note editor")}
                onClick={() => setNoteEditor(null)}
              >
                <X size={16} />
              </button>
            </header>
            <blockquote>{noteEditor.text}</blockquote>
            <textarea
              autoFocus
              aria-label={t("笔记内容", "Note text")}
              placeholder={t(
                "记录理解、疑问或下一步…",
                "Your thoughts, questions or next steps…",
              )}
              value={noteBody}
              onChange={(event) => setNoteBody(event.target.value)}
            />
            <input
              aria-label={t("笔记标签", "Note tags")}
              placeholder={t("标签，用逗号分隔", "Tags, separated by commas")}
              value={noteTags}
              onChange={(event) => setNoteTags(event.target.value)}
            />
            <footer>
              {colorPicker()}
              <button
                className="pdf-note-save"
                disabled={annotationBusy || !noteBody.trim()}
                onClick={() => void saveAnnotation("note", noteEditor)}
              >
                <Save size={14} />
                {t("保存笔记", "Save note")}
              </button>
            </footer>
            {annotationError && (
              <p role="alert" className="pdf-popover-error">
                {annotationError}
              </p>
            )}
          </div>,
          window.document.body,
        )}
      {inlineResult &&
        createPortal(
          <div
            className="pdf-inline-assist"
            role="dialog"
            aria-label={t("就地阅读助手", "Inline reading assistant")}
            style={floatingPosition(inlineResult.selection)}
          >
            <header>
              <strong>
                {inlineResult.kind === "translation" ? (
                  <Languages size={15} />
                ) : (
                  <Sparkles size={15} />
                )}
                {inlineResult.kind === "translation"
                  ? t("翻译", "Translation")
                  : t("解释", "Explanation")}{" "}
                · p.{inlineResult.selection.page}
              </strong>
              <div>
                <select
                  aria-label={t("就地结果语言", "Inline result language")}
                  value={
                    inlineResult.language.startsWith("en") ? "en" : "zh-CN"
                  }
                  onChange={(event) =>
                    void runInline(
                      inlineResult.kind,
                      inlineResult.selection,
                      event.target.value,
                    )
                  }
                >
                  <option value="zh-CN">中文</option>
                  <option value="en">English</option>
                </select>
                <button
                  aria-label={t("关闭就地助手", "Close inline assistant")}
                  onClick={() => {
                    setInlineResult(null);
                    inlineRequest.current += 1;
                  }}
                >
                  <X size={16} />
                </button>
              </div>
            </header>
            <div className="pdf-inline-scroll">
              <details>
                <summary>{t("原文", "Original text")}</summary>
                <blockquote>{inlineResult.selection.text}</blockquote>
              </details>
              {inlineResult.loading ? (
                <p className="pdf-inline-loading" role="status">
                  <Loader2 size={17} className="spin" />
                  {t("正在阅读这段内容…", "Reading this passage…")}
                </p>
              ) : inlineResult.error ? (
                <p className="pdf-popover-error" role="alert">
                  {inlineResult.error}
                </p>
              ) : (
                <div className="pdf-inline-markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {inlineResult.text}
                  </ReactMarkdown>
                </div>
              )}
              {annotationError && (
                <p className="pdf-popover-error" role="alert">
                  {annotationError}
                </p>
              )}
            </div>
            <footer>
              <button
                disabled={inlineResult.loading}
                onClick={() =>
                  void runInline(
                    inlineResult.kind,
                    inlineResult.selection,
                    inlineResult.language,
                  )
                }
              >
                <RefreshCw size={14} />
                {t("重试", "Retry")}
              </button>
              {onCreateAnnotation && (
                <button
                  disabled={
                    annotationBusy ||
                    inlineResult.loading ||
                    !inlineResult.text ||
                    inlineResult.saved
                  }
                  onClick={() => void saveInline()}
                >
                  {inlineResult.saved ? (
                    <Check size={14} />
                  ) : (
                    <Save size={14} />
                  )}
                  {inlineResult.saved
                    ? t("已保存", "Saved")
                    : t("保存到笔记", "Save to notes")}
                </button>
              )}
            </footer>
          </div>,
          window.document.body,
        )}
    </section>
  );
}
