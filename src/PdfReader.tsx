import {citationHighlightLifetime,readyPdfTextLayer} from './citation-highlight';
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
  ArrowLeft,
  SlidersHorizontal,
  Search,
  ListTree,
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
import Mark from "./Markdown";
import AnnotationLayer from "./AnnotationLayer";
import { selectedPdfText } from "./pdf-selection-text";
import { capturePdfSelectionAnchor, restorePdfSelectionAnchor, type PdfSelectionAnchor } from "./pdf-selection-anchor";
import AgentSelectionBridge from "./AgentSelectionBridge";
import { selectionBindingKey } from "./selection-agent-task";
import { readSelectionExecution, saveSelectionExecution, type SelectionExecution } from "./selection-execution";
import { resolvePdfDestination } from "./pdf-destination";
import { pdfLinkText, pdfLinkLabel } from "./pdf-link-label";
import PdfReferencePreview, { type PdfReferenceRequest } from "./PdfReferencePreview";
import { validPdfPosition, type PdfReadingPosition } from "./reading-position";
import PdfSearchBar from "./PdfSearchBar";
import PdfOutline from "./PdfOutline";
import PdfPageNumber from "./PdfPageNumber";
import { bindPdfTextLayerItems, highlightPdfSearchMatch, indexPdfTextPage, searchPdfText, type PdfSearchMatch, type PdfSearchRect } from "./pdf-search";
import {
  annotationColors,
  annotationSegments,
  annotationPageLabel,
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
  pages?: number[];
  intent?: "ask" | "explain" | "translate";
  question?: string;
};
type Props = {
  url: string;
  paperId?: string;
  modelReady?: boolean;
  page: number;
  onPage?: (page: number) => void;
  active?: boolean;
  navigation?: { page: number; nonce: number; fromOverview?: boolean; quote?: string; position?: PdfReadingPosition };
  onReturnToOverview?: () => void;
  onManageFigures?: (page:number) => void;
  initialPosition?: PdfReadingPosition;
  onPositionChange?: (position: PdfReadingPosition) => void;
  capturePosition?: { current: (() => void) | undefined };
  onAskSelection?: (selection: PdfSelection) => Promise<boolean>;
  annotations?: Annotation[];
  onCreateAnnotation?: (draft: AnnotationDraft) => Promise<Annotation | void>;
  onSelectAnnotation?: (id: string, page?: number) => void;
  onHideAnnotation?: (id:string, hidden:boolean) => Promise<void>;
  onInlineAssist?: (payload: {
    text: string;
    page: number;
    pages?: number[];
    language?: string;
    kind: "translation" | "explanation";
  }) => Promise<{ text: string; source?: string; createdAt?: string }>;
  language?: string;
  annotationFocus?: { id: string; nonce: number; page?: number };
};
type SelectionMenu = {
  anchor?: PdfSelectionAnchor;
  text: string;
  tooLong?: boolean;
  page: number;
  left: number;
  top: number;
  rects: AnnotationRect[];
  segments: { page: number; text: string; rects: AnnotationRect[] }[];
};
function selectionAnchors(selection: SelectionMenu) {
  const segments = (selection.segments.length ? selection.segments : [{page:selection.page,text:selection.text,rects:selection.rects}])
    .map(segment => ({page:segment.page,quote:segment.text,rects:segment.rects}));
  return {...segments[0], ...(segments.length > 1 ? {segments} : {})};
}
function selectionTooLong(selection: SelectionMenu) {
  const segments = selectionAnchors(selection).segments || [selectionAnchors(selection)];
  return selection.tooLong || segments.length > 20 || segments.reduce((total,segment)=>total+(segment.rects?.length || 0),0)>300 || segments.reduce((total,segment)=>total+(segment.quote?.length || 0),0)>12000;
}
type InlineResult = {
  selection: SelectionMenu;
  kind: "translation" | "explanation";
  language: string;
  loading: boolean;
  text: string;
  error: string;
  saved?: boolean;
  annotationId?: string;
  source?: string;
};
type PageSize = { width: number; height: number };
type ReadingPosition = { page: number; fraction: number; left: number; zoom: number | null };
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
export function RenderedPage({
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
  searchMatch,
  citationTarget = false,
  onSearchLocated,
  paperColors,
}: {
  document: PDFDocumentProxy;
  number: number;
  scale: number;
  width: number;
  height: number;
  active: boolean;
  onNavigate: (page: number, point?: {x?:number;y?:number}) => void;
  annotations: Annotation[];
  drawing: boolean;
  annotationColor: AnnotationColor;
  strokes: { stroke: InkStroke; color: AnnotationColor }[];
  onStroke: (stroke: InkStroke) => void;
  onSelectAnnotation?: (id: string) => void;
  focusedAnnotation?: string;
  language: string;
  searchMatch: PdfSearchMatch | null;
  citationTarget?: boolean;
  onSearchLocated: (match: PdfSearchMatch, rect?: DOMRect) => void;
  paperColors: "theme" | "original";
}) {
  const t = (zh: string, en: string) => (language.startsWith("en") ? en : zh);
  const surface = useRef<HTMLDivElement>(null);
  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [retry, setRetry] = useState(0);
  const [textRevision, setTextRevision] = useState(0);
  const [searchRects, setSearchRects] = useState<PdfSearchRect[]>([]);
  const [reference, setReference] = useState<PdfReferenceRequest>();
  const referenceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeReference = useCallback(() => { clearTimeout(referenceTimer.current); setReference(undefined); }, []);
  const leaveReference = useCallback(() => { clearTimeout(referenceTimer.current); referenceTimer.current = setTimeout(() => setReference(current => current?.pinned ? current : undefined), 180); }, []);
  useEffect(() => { if (!active) closeReference(); return () => clearTimeout(referenceTimer.current); }, [active, closeReference]);
  useEffect(() => {
    const opened = (event: Event) => { if (!surface.current?.contains((event as CustomEvent<Node>).detail)) closeReference(); };
    window.document.addEventListener("pw-pdf-reference-open", opened);
    return () => window.document.removeEventListener("pw-pdf-reference-open", opened);
  }, [closeReference]);
  const searchLocated = useRef(onSearchLocated); searchLocated.current = onSearchLocated;
  useLayoutEffect(() => {
    const container = readyPdfTextLayer(surface.current,scale);
    if (!active || !searchMatch || !container) { setSearchRects([]); if(searchMatch)searchLocated.current(searchMatch); return; }
    const result = highlightPdfSearchMatch(container, searchMatch);
    setSearchRects(result.rects);
    searchLocated.current(searchMatch, result.firstRect);
  }, [searchMatch, textRevision, active, scale]);
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    element.replaceChildren();
    setSearchRects([]);
    if(searchMatch)searchLocated.current(searchMatch);
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
        if (!disposed) {
          bindPdfTextLayerItems(textLayer.textDivs, content.items);
          textContainer.dataset.renderScale = String(scale);
          textContainer.dataset.rendered = "true";
          setTextRevision(value => value + 1);
        }
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
        let referenceIndex = 0;
        const surfaceBounds = element.getBoundingClientRect();
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
            const left = Math.min(coordinates[0], coordinates[2]) + surfaceBounds.left;
            const top = Math.min(coordinates[1], coordinates[3]) + surfaceBounds.top;
            const width = Math.abs(coordinates[2] - coordinates[0]);
            const height = Math.abs(coordinates[3] - coordinates[1]);
            const text = pdfLinkText(textContainer, {left,top,right:left+width,bottom:top+height,width,height});
            const index = referenceIndex++;
            link.href = `#pdf-reference-${number}-${index+1}`;
            link.setAttribute("aria-label", pdfLinkLabel(text, number, index, language.startsWith("en")));
            link.dataset.referenceText = text;
            const openPreview = (pinned: boolean) => { clearTimeout(referenceTimer.current); window.document.dispatchEvent(new CustomEvent("pw-pdf-reference-open", {detail:link})); setReference({anchor:link,destination:annotation.dest,label:text || t("论文引用", "Paper reference"),pinned}); };
            link.onpointerenter = event => { if (event.pointerType !== "touch") { clearTimeout(referenceTimer.current); referenceTimer.current = setTimeout(() => openPreview(false), 350); } };
            link.onpointerleave = leaveReference;
            const isCitation = typeof annotation.dest === "string" && /(?:^|[._-])(?:cite|citation|bib|footnote|fn)(?:[._-]|$)/i.test(annotation.dest);
            if (isCitation) link.setAttribute("aria-haspopup", "dialog");
            link.onclick = (event) => {
              event.preventDefault();
              if (isCitation) { openPreview(true); return; }
              closeReference();
              void (async () => {
                const destination = await resolvePdfDestination(document, annotation.dest);
                if (!disposed && destination) navigateRef.current(destination.page, destination);
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
      closeReference();
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
      data-citation-target={citationTarget || undefined}
      style={{ width, height }}
      aria-label={t(`第 ${number} 页`, `Page ${number}`)}
    >
      <div
        className="pdf-page-surface"
        ref={surface}
        style={{ width, height }}
      />
      {active && reference && <PdfReferencePreview document={document} request={reference} language={language} paperColors={paperColors} onClose={closeReference} onNavigate={onNavigate} onPointerEnter={() => clearTimeout(referenceTimer.current)} onPointerLeave={leaveReference}/>}
      {active && searchMatch && <div className="pdf-search-highlights" aria-hidden="true">{searchRects.map((rect, index) => <span key={index} className="pdf-search-highlight" style={{left:`${rect.x * 100}%`, top:`${rect.y * 100}%`, width:`${rect.width * 100}%`, height:`${rect.height * 100}%`}} />)}</div>}
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
  paperId,
  modelReady = true,
  page,
  onPage,
  active = true,
  navigation,
  onReturnToOverview,
  onManageFigures,
  initialPosition,
  onPositionChange,
  capturePosition: capturePositionRef,
  onAskSelection,
  annotations = [],
  onCreateAnnotation,
  onSelectAnnotation,
  onInlineAssist,
  onHideAnnotation,
  language = "zh-CN",
  annotationFocus,
}: Props) {
  const activeRef = useRef(active);
  activeRef.current = active;
  const initialPositionRef = useRef(initialPosition); initialPositionRef.current = initialPosition;
  const initialPositionApplied = useRef(false);
  const positionChanged = useRef(onPositionChange); positionChanged.current = onPositionChange;
  const [navigationHistory, setNavigationHistory] = useState<ReadingPosition[]>([]);
  const appliedNavigation = useRef<number | undefined>(undefined);
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
  useEffect(() => {
    if (!annotationStatus) return;
    const timer = window.setTimeout(() => setAnnotationStatus(""), 5000);
    return () => window.clearTimeout(timer);
  }, [annotationStatus]);
  const [noteEditor, setNoteEditor] = useState<SelectionMenu | null>(null);
  const [noteBody, setNoteBody] = useState("");
  const [noteTags, setNoteTags] = useState("");
  const [inlineResult, setInlineResult] = useState<InlineResult | null>(null);
  const [selectionLanguage, setSelectionLanguage] = useState(language);
  useEffect(() => { setSelectionLanguage(language); }, [language]);
  const inlineRequest = useRef(0);
  const askingSelection = useRef(false);
  const [selectionAsking, setSelectionAsking] = useState(false);
  const locatedAnnotation = useRef('');
  // Retain the chosen column while a wider viewport temporarily clamps its
  // scroll offset. A subsequent real pan replaces this reading intention.
  const horizontalAnchor = useRef({ left: initialPosition?.left || 0, viewport: 0, content: 0 });
  const restoreHorizontal = useCallback(() => {
    const element = host.current;
    if (!element) return;
    element.scrollLeft = horizontalAnchor.current.left;
    horizontalAnchor.current.viewport = element.clientWidth;
    horizontalAnchor.current.content = element.scrollWidth;
  }, []);
  const setHorizontal = (left: number) => {
    horizontalAnchor.current.left = Math.max(0, left);
    restoreHorizontal();
  };
  const recordHorizontalScroll = () => {
    const element = host.current, previous = horizontalAnchor.current;
    if (!element || previous.viewport !== element.clientWidth || previous.content !== element.scrollWidth) return;
    const maximum = Math.max(0, element.scrollWidth - element.clientWidth);
    if (previous.left > maximum && element.scrollLeft >= maximum - 1) return;
    previous.left = element.scrollLeft;
  };
  const [selectionExecution,setSelectionExecution] = useState<SelectionExecution>(readSelectionExecution);
  const useSelectionAgent = !modelReady || selectionExecution === 'agent';
  const [drawing, setDrawing] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const outlineButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { setOutlineOpen(false); }, [url, active]);
  const [searchMatch, setSearchMatch] = useState<PdfSearchMatch | null>(null);
  const [citationMatch, setCitationMatch] = useState<PdfSearchMatch | null>(null);
  const [citationStatus, setCitationStatus] = useState<"loading" | "matched" | "missing" | "ambiguous" | "page" | null>(null);
  const citationRequest = useRef(0);
  const citationLifetime = useRef(citationHighlightLifetime());
  const [citationPage,setCitationPage]=useState<number|null>(null);
  useEffect(()=>()=>citationLifetime.current.dispose(),[]);
  useEffect(()=>{if(!active){citationLifetime.current.pause();setCitationPage(null);setCitationStatus(current=>current==="page"?null:current);}},[active]);
  const processedCitation = useRef<{document:PDFDocumentProxy;nonce:number} | null>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const searchOriginSaved = useRef(false);
  const searchLocatedKey = useRef("");
  useEffect(() => {
    if (!active) { setSearchOpen(false); return; }
    const find = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "f") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("textarea,input,[contenteditable='true']") && !target.closest(".pdf-search-bar")) return;
      event.preventDefault(); setSearchOpen(true); setOutlineOpen(false); setToolsOpen(false);
    };
    window.document.addEventListener("keydown", find);
    return () => window.document.removeEventListener("keydown", find);
  }, [active]);
  useEffect(() => { if (!searchOpen) { searchOriginSaved.current = false; searchLocatedKey.current = ""; } }, [searchOpen]);
  const toolsHost = useRef<HTMLDivElement>(null);
  const toolsButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!active) { setToolsOpen(false); return; }
    if (!toolsOpen) return;
    const outside = (event: PointerEvent) => {
      if (!toolsHost.current?.contains(event.target as Node)) setToolsOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setToolsOpen(false); toolsButton.current?.focus({ preventScroll: true }); }
    };
    window.document.addEventListener("pointerdown", outside);
    window.document.addEventListener("keydown", escape);
    return () => { window.document.removeEventListener("pointerdown", outside); window.document.removeEventListener("keydown", escape); };
  }, [toolsOpen, active]);
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
  const selectionPopup = useRef<HTMLDivElement>(null), inlinePopup = useRef<HTMLDivElement>(null), notePopup = useRef<HTMLDivElement>(null);
  const draftChip = useRef<HTMLDivElement>(null), selectionInput = useRef<HTMLInputElement>(null);
  const [draftFolded, setDraftFolded] = useState(false), [draftRestoring, setDraftRestoring] = useState(false);
  const [draftLocationUnavailable, setDraftLocationUnavailable] = useState(false);
  const [draftChipPosition, setDraftChipPosition] = useState({top: 12, left: 12});
  const restoringDraft = useRef(false), draftRestoreToken = useRef(0), draftRestoreFrame = useRef(0);
  const draftSelection = inlineResult?.selection || noteEditor || selectionMenu;
  const draftState = useRef({selection: draftSelection, folded: draftFolded, preserve: false});
  draftState.current = {selection: draftSelection, folded: draftFolded, preserve: !!selectionQuestion.trim() || !!inlineResult || !!noteEditor || selectionAsking};
  const clearSelectionDraft = () => {
    draftRestoreToken.current++; cancelAnimationFrame(draftRestoreFrame.current); restoringDraft.current=false;
    inlineRequest.current++; askingSelection.current=false; setSelectionAsking(false);
    dismissedSelection.current=lastSelection.current; setSelectionMenu(null); setInlineResult(null); setNoteEditor(null);
    setSelectionQuestion(""); setDraftFolded(false); setDraftRestoring(false); setDraftLocationUnavailable(false); setAnnotationError("");
  };
  useEffect(() => { clearSelectionDraft(); }, [url, paperId, language, active]);
  useEffect(() => () => { draftRestoreToken.current++; cancelAnimationFrame(draftRestoreFrame.current); }, []);
  const updateDraftChip = () => {
    const element=host.current;if(!element)return;
    const view=element.getBoundingClientRect(), viewport=window.visualViewport;
    const top=Math.max((viewport?.offsetTop || 0)+8,Math.min(view.top+8,(viewport?.offsetTop || 0)+(viewport?.height || window.innerHeight)-60));
    const left=Math.max(12,Math.min(view.left+12,window.innerWidth-Math.min(300,window.innerWidth-24)-12));
    setDraftChipPosition(old=>old.top===top&&old.left===left?old:{top,left});
  };
  const minimizeDraft = () => {
    draftRestoreToken.current++;cancelAnimationFrame(draftRestoreFrame.current);restoringDraft.current=false;setDraftRestoring(false);
    updateDraftChip();setDraftFolded(true);
    draftRestoreFrame.current=requestAnimationFrame(()=>draftChip.current?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true}));
  };
  const [viewportHeight, setViewportHeight] = useState<number>();
  const onPageRef = useRef(onPage);
  onPageRef.current = onPage;
  const reportedPage = useRef(0);
  const currentPage = useRef(1);
  const scrollFrame = useRef(0);
  const anchor = useRef<{ page: number; fraction: number; left?: number } | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState<number | null>(initialPosition?.zoom ?? null);
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
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
      if (!activeRef.current) return;
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
  }, [active, searchOpen]);

  useEffect(() => {
    if (!onAskSelection && !onCreateAnnotation && !onInlineAssist) return;
    const element = host.current;
    if (!element) return;
    let frame = 0;
    const inspect = () => {
      if (!activeRef.current || restoringDraft.current || askingSelection.current) return;
      if (window.document.activeElement?.closest(".pdf-selection-menu, .pdf-inline-assist, .pdf-note-editor, .pdf-selection-draft-chip")) return;
      const selected = window.getSelection();
      if (!selected || selected.isCollapsed || selected.rangeCount !== 1) return;
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
      ) return;
      const rawText = selectedPdfText(range, element), text = rawText.slice(0, 12000);
      // A transient one-character Range is not a new usable source selection.
      if (text.trim().length < 2 || text === dismissedSelection.current) return;
      const savedAnchor = capturePdfSelectionAnchor(range, element);
      const previousAnchor = draftState.current.selection?.anchor;
      if (previousAnchor && savedAnchor && previousAnchor.start.page===savedAnchor.start.page && previousAnchor.start.offset===savedAnchor.start.offset && previousAnchor.end.page===savedAnchor.end.page && previousAnchor.end.offset===savedAnchor.end.offset && previousAnchor.text===savedAnchor.text) return;
      if (text !== lastSelection.current || savedAnchor !== previousAnchor) {
        lastSelection.current = text;
        setSelectionQuestion("");
        setInlineResult(null); setNoteEditor(null); setAnnotationError(""); setDraftFolded(false); setDraftLocationUnavailable(false);
        inlineRequest.current += 1;
      }
      const bounds = range.getBoundingClientRect();
      const view = element.getBoundingClientRect();
      const viewportBottom = Math.min(window.innerHeight, view.bottom);
      if (bounds.bottom < view.top || bounds.top > viewportBottom) return;
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
        anchor: savedAnchor,
        text,
        tooLong: rawText.length > 12000,
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
      const target=event.target;
      if(!(target instanceof Element) || target.closest('.pdf-selection-menu,.pdf-inline-assist,.pdf-note-editor,.pdf-selection-draft-chip'))return;
      const sourceGesture=element.contains(target)&&!!target.closest('.pdf-text-layer');
      if(draftState.current.selection){
        // A pointer down is not yet a new selection: keep questions, notes,
        // agent tasks and responses until another valid Range is captured.
        if(draftState.current.preserve){updateDraftChip();setDraftFolded(true);}
        else clearSelectionDraft();
      }
      if(sourceGesture){dismissedSelection.current="";if(!draftState.current.preserve)lastSelection.current="";}
    };
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        cancelAnimationFrame(frame);
        if(!draftState.current.preserve){clearSelectionDraft();return;}
        const focused=window.document.activeElement;
        if(selectionPopup.current?.contains(focused)||inlinePopup.current?.contains(focused)||notePopup.current?.contains(focused))minimizeDraft();
        else {updateDraftChip();setDraftFolded(true);}
      }
    };
    window.document.addEventListener("pointerdown", startSelection);
    window.document.addEventListener("selectionchange", schedule);
    window.document.addEventListener("pointerup", schedule);
    window.document.addEventListener("mouseup", schedule);
    window.document.addEventListener("keyup", schedule);
    window.document.addEventListener("keydown", dismiss);
    window.addEventListener("resize", schedule);

    return () => {
      cancelAnimationFrame(frame);
      window.document.removeEventListener("pointerdown", startSelection);
      window.document.removeEventListener("selectionchange", schedule);
      window.document.removeEventListener("pointerup", schedule);
      window.document.removeEventListener("mouseup", schedule);
      window.document.removeEventListener("keyup", schedule);
      window.document.removeEventListener("keydown", dismiss);
      window.removeEventListener("resize", schedule);

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
      if (!activeRef.current || element.clientWidth === 0) return;
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
    setZoom(initialPositionRef.current?.zoom ?? null);
    horizontalAnchor.current = {left: initialPositionRef.current?.left || 0, viewport: 0, content: 0};
    initialPositionApplied.current = false;
    appliedNavigation.current = undefined;
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
    if (!activeRef.current || !element || !document) return;
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
    const sheet = element.querySelector<HTMLElement>(`[data-pdf-page="${nearest}"]`);
    if (initialPositionApplied.current && sheet?.offsetHeight) positionChanged.current?.({page:nearest,fraction:(element.scrollTop-sheet.offsetTop)/sheet.offsetHeight,left:horizontalAnchor.current.left,zoom:zoomRef.current});
  }, [document]);

  useLayoutEffect(() => {
    if (!capturePositionRef) return;
    const capture = () => {
      if (!activeRef.current || !document || !initialPositionApplied.current || !host.current) return;
      // A browser Back can precede the pending scroll animation frame. Read
      // the current DOM while it still belongs to the departing history entry.
      cancelAnimationFrame(scrollFrame.current);
      recordHorizontalScroll();
      updateVisiblePages();
    };
    capturePositionRef.current = capture;
    return () => { if (capturePositionRef.current === capture) capturePositionRef.current = undefined; };
  }, [capturePositionRef, document, updateVisiblePages]);

  useLayoutEffect(() => () => {
    const element = host.current;
    const sheet = element?.querySelector<HTMLElement>(`[data-pdf-page="${currentPage.current}"]`);
    if (activeRef.current && initialPositionApplied.current && element && sheet?.offsetHeight)
      positionChanged.current?.({page:currentPage.current,fraction:(element.scrollTop-sheet.offsetTop)/sheet.offsetHeight,left:horizontalAnchor.current.left,zoom:zoomRef.current});
  }, []);

  useLayoutEffect(() => {
    const element = host.current;
    if (!active || !element || !document || !width) return;
    const position = anchor.current;
    if (position) {
      const sheet = element.querySelector<HTMLElement>(
        `[data-pdf-page="${position.page}"]`,
      );
      if (sheet) {
        element.scrollTop = sheet.offsetTop + position.fraction * sheet.offsetHeight;
        if (position.left !== undefined) horizontalAnchor.current.left = position.left;
      }
      anchor.current = null;
    }
    restoreHorizontal();
    // Initial/external navigation is handled by the next layout effect before
    // any scroll feedback is emitted, preventing a citation jump from bouncing.
  }, [document, width, scale, active]);

  const capturePosition = (): ReadingPosition | undefined => {
    const element = host.current;
    const sheet = element?.querySelector<HTMLElement>(`[data-pdf-page="${currentPage.current}"]`);
    if (!element || !sheet || !sheet.offsetHeight) return;
    return { page: currentPage.current, fraction: (element.scrollTop - sheet.offsetTop) / sheet.offsetHeight, left: horizontalAnchor.current.left, zoom };
  };
  const rememberJump = () => {
    const position = capturePosition();
    if (position) setNavigationHistory(history => [...history, position].slice(-30));
  };
  useLayoutEffect(() => {
    if (!active || initialPositionApplied.current || !document || !width || !host.current) return;
    // A citation clicked while the PDF loads is the reader's latest intent.
    // Restoring the old page here would enqueue onPage(oldPage), which can
    // overwrite the citation on the following controlled render.
    if (navigation && appliedNavigation.current !== navigation.nonce) {
      initialPositionApplied.current = true;
      anchor.current = null;
      return;
    }
    const position = initialPositionRef.current;
    if (position && zoom !== position.zoom) { setZoom(position.zoom); return; }
    initialPositionApplied.current = true;
    if (!position) return;
    const next = Math.max(1, Math.min(document.numPages, position.page));
    const sheet = host.current.querySelector<HTMLElement>(`[data-pdf-page="${next}"]`);
    if (!sheet) return;
    anchor.current = null;
    host.current.scrollTop = sheet.offsetTop + position.fraction * sheet.offsetHeight;
    setHorizontal(position.left);
    reportedPage.current = next; currentPage.current = next; setVisiblePage(next);
    onPageRef.current?.(next);
  }, [active, document, width, zoom, navigation?.nonce]);
  useLayoutEffect(() => {
    if (!active || !navigation || appliedNavigation.current === navigation.nonce || !document || !width || !host.current) return;
    const position = validPdfPosition(navigation.position) ? navigation.position : undefined;
    // Browser history carries an exact reading position. Apply the requested
    // zoom before using page geometry, and never create another PDF jump.
    if (position && zoom !== position.zoom) { anchor.current = null; setZoom(position.zoom); return; }
    const next = Math.max(1, Math.min(document.numPages, position?.page ?? navigation.page));
    const sheet = host.current.querySelector<HTMLElement>(`[data-pdf-page="${next}"]`);
    if (!sheet) return;
    if (navigation.fromOverview || position) setNavigationHistory([]);
    else if (reportedPage.current) rememberJump();
    appliedNavigation.current = navigation.nonce;
    anchor.current = null;
    host.current.scrollTop = position ? sheet.offsetTop + position.fraction * sheet.offsetHeight : Math.max(0, sheet.offsetTop - 16);
    if (position) setHorizontal(position.left);
    reportedPage.current = next;
    currentPage.current = next;
    setVisiblePage(next);
    updateVisiblePages();
  }, [navigation?.nonce, active, document, width, zoom]);

  useEffect(() => {
    if (!active || !document || !navigation || !width) return;
    if (processedCitation.current?.document === document && processedCitation.current.nonce === navigation.nonce) return;
    processedCitation.current = {document,nonce:navigation.nonce};
    const request = ++citationRequest.current;
    const citationKey=`citation:${navigation.nonce}`;
    citationLifetime.current.begin(citationKey);
    setCitationPage(null);setCitationMatch(null); setCitationStatus(null);
    const quote = navigation?.quote?.trim();
    if (navigation.position) return;
    setSearchOpen(false);setSearchMatch(null);
    if (!quote || quote.length > 500) {
      setCitationPage(navigation.page);setCitationStatus("page");
      citationLifetime.current.shown(citationKey,()=>{setCitationPage(null);setCitationStatus(current=>current==="page"?null:current);});
      return;
    }
    let disposed = false, finished = false;
    setSearchOpen(false); setSearchMatch(null); setCitationStatus("loading");
    const pageNumber = navigation.page;
    void (async () => {
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > document.numPages) throw new Error("Invalid source page");
      const source = await document.getPage(pageNumber);
      const content = await source.getTextContent();
      if (disposed || request !== citationRequest.current) return;
      finished = true;
      const page = indexPdfTextPage(content.items, pageNumber);
      const {matches} = searchPdfText({pages:[page],pageCount:1,indexed:1,failedPages:[]},quote,2);
      if (matches.length !== 1) { setCitationStatus(matches.length ? "ambiguous" : "missing"); return; }
      searchLocatedKey.current = "";
      setCitationMatch({...matches[0],key:citationKey});
    })().catch(() => { if (!disposed && request === citationRequest.current) { finished = true; setCitationStatus("missing"); } });
    return () => {
      disposed = true;
      if (!finished && request === citationRequest.current) processedCitation.current = null;
    };
  }, [navigation?.nonce, document, active, width]);

  useLayoutEffect(() => {
    const element = host.current;
    if (!active || !element || !document || !width) return;
    if (navigation && appliedNavigation.current !== navigation.nonce) return;
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
  }, [document, page, width, scale, active, updateVisiblePages]);

  useEffect(() => {
    if (!active || !annotationFocus || !document || !width || !host.current) return;
    const requestKey = JSON.stringify([url,annotationFocus.id,annotationFocus.nonce,annotationFocus.page]);
    if (locatedAnnotation.current === requestKey) return;
    const annotation = annotations.find(
      (item) => item.id === annotationFocus.id,
    );
    if (!annotation) return;
    const segment = annotationSegments(annotation).find(item => item.page === annotationFocus.page) || annotationSegments(annotation)[0];
    const sheet = host.current.querySelector<HTMLElement>(`[data-pdf-page="${segment.page}"]`);
    if (!sheet) return;
    locatedAnnotation.current = requestKey;
    const y =
      segment.rects?.[0]?.y ?? annotation.strokes?.[0]?.points[0]?.y ?? 0;
    host.current.scrollTop = Math.max(
      0,
      sheet.offsetTop +
        y * sheet.offsetHeight -
        Math.min(120, host.current.clientHeight * 0.22),
    );
    const rects = segment.rects || [];
    const points = annotation.strokes?.flatMap(stroke => stroke.points) || [];
    if (rects.length || points.length) {
      const left = sheet.offsetLeft + Math.min(...(rects.length ? rects.map(rect => rect.x) : points.map(point => point.x))) * sheet.offsetWidth;
      const right = sheet.offsetLeft + Math.max(...(rects.length ? rects.map(rect => rect.x + rect.width) : points.map(point => point.x))) * sheet.offsetWidth;
      const viewport = host.current, margin = 24;
      if (left < viewport.scrollLeft + margin || right > viewport.scrollLeft + viewport.clientWidth - margin)
        setHorizontal(Math.max(0, left - margin));
      else setHorizontal(viewport.scrollLeft);
    }
    updateVisiblePages();
  }, [annotationFocus?.id, annotationFocus?.nonce, annotationFocus?.page, document, width, active]);

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
    horizontalAnchor.current.left = next === null ? 0 : horizontalAnchor.current.left * next / scale;
    setZoom(next);
  };

  const navigateToPage = (number: number, point?: {x?:number;y?:number}) => {
    if (!active || !document || !host.current) return;
    citationRequest.current++;
    citationLifetime.current.dispose();setCitationPage(null);
    setCitationMatch(null); setCitationStatus(null);
    const next = Math.max(
      1,
      Math.min(document.numPages, Math.trunc(number) || 1),
    );
    const sheet = host.current.querySelector<HTMLElement>(
      `[data-pdf-page="${next}"]`,
    );
    if (sheet) {
      const top = Math.max(0, sheet.offsetTop + (point?.y || 0) * sheet.offsetHeight - 16);
      const left = point?.x === undefined ? host.current.scrollLeft : Math.max(0, sheet.offsetLeft + point.x * sheet.offsetWidth - 24);
      if (Math.abs(host.current.scrollTop - top) > 2 || Math.abs(host.current.scrollLeft - left) > 2) rememberJump();
      host.current.scrollTop = top;
      if (point?.x !== undefined) setHorizontal(left);
    }
    updateVisiblePages();
  };
  const showSearchResult = (match: PdfSearchMatch | null) => {
    setSearchMatch(match);
    if (!match || !host.current || !activeRef.current) return;
    citationRequest.current++;
    citationLifetime.current.dispose();setCitationPage(null);
    setCitationMatch(null); setCitationStatus(null);
    if (!searchOriginSaved.current) { rememberJump(); searchOriginSaved.current = true; }
    searchLocatedKey.current = "";
    const sheet = host.current.querySelector<HTMLElement>(`[data-pdf-page="${match.page}"]`);
    if (sheet) host.current.scrollTop = Math.max(0, sheet.offsetTop - 16);
    updateVisiblePages();
  };
  const locateSearchText = (match: PdfSearchMatch, rect?: DOMRect) => {
    const element = host.current;
    const isCitation=match.key===citationMatch?.key;
    if(!rect||!activeRef.current||!element?.clientHeight){if(isCitation)citationLifetime.current.pause();return;}
    if(isCitation){
      setCitationStatus("matched");
      citationLifetime.current.shown(match.key,()=>{setCitationMatch(current=>current?.key===match.key?null:current);setCitationStatus(current=>current==="matched"?null:current);});
    }
    if (searchLocatedKey.current === match.key) return;
    searchLocatedKey.current = match.key;
    const bounds = element.getBoundingClientRect();
    element.scrollTop += rect.top - bounds.top - Math.min(100, element.clientHeight * .22);
    if (rect.left < bounds.left + 16 || rect.right > bounds.right - 16)
      setHorizontal(element.scrollLeft + rect.left - bounds.left - 24);
    else setHorizontal(element.scrollLeft);
    updateVisiblePages();
  };
  const returnToReading = () => {
    citationRequest.current++;
    citationLifetime.current.dispose();setCitationPage(null);
    setCitationMatch(null); setCitationStatus(null);
    const position = navigationHistory.at(-1);
    if (!position) { onReturnToOverview?.(); return; }
    setNavigationHistory(history => history.slice(0, -1));
    const sheet = host.current?.querySelector<HTMLElement>(`[data-pdf-page="${position.page}"]`);
    if (!host.current || !sheet) return;
    anchor.current = position;
    setZoom(position.zoom);
    host.current.scrollTop = sheet.offsetTop + position.fraction * sheet.offsetHeight;
    setHorizontal(position.left);
    updateVisiblePages();
  };
  const dismissSelection = (selection: SelectionMenu) => {
    dismissedSelection.current = selection.text;
    setSelectionMenu(null);
  };
  const askAboutSelection = async () => {
    if (!selectionMenu || selectionTooLong(selectionMenu) || askingSelection.current) return;
    const selection = selectionMenu, request = ++inlineRequest.current;
    askingSelection.current = true; setSelectionAsking(true); setAnnotationError('');
    try {
      const accepted = await selectionAction.current?.({text: selection.text, page: selection.page,
        pages: [...new Set(selection.segments.map(segment => segment.page))].sort((a,b)=>a-b),
        intent: "ask", question: selectionQuestion.trim() || undefined });
      if (request !== inlineRequest.current) return;
      if (accepted) clearSelectionDraft();
      else setAnnotationError(t('未能创建提问会话，选文与问题已保留，请重试。','Could not create a question session. Your selection and question are preserved; try again.'));
    } catch (reason) { if(request === inlineRequest.current) setAnnotationError(reason instanceof Error ? reason.message : t('创建会话失败，请重试。','Could not create a session. Try again.')); }
    finally { if (request === inlineRequest.current) { askingSelection.current = false; setSelectionAsking(false); } }
  };
  const saveAnnotation = async (
    kind: "highlight" | "underline" | "note",
    selection = selectionMenu,
  ) => {
    if (!selection || !onCreateAnnotation || saveBusy.current) return;
    if (selectionTooLong(selection)) {
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
      await onCreateAnnotation({
          kind,
          ...selectionAnchors(selection),
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
      dismissSelection(selection);
      setNoteEditor(null);
      setNoteBody("");
      setNoteTags("");
      setAnnotationStatus(selection.segments.length > 1 ? t(`已将 ${selection.segments.length} 页选文保存为一条笔记`, `Saved the ${selection.segments.length}-page selection as one note`) : t("已保存到笔记", "Saved to notes"));
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
    execution: SelectionExecution = useSelectionAgent ? 'agent' : 'api',
  ) => {
    if (!selection || selectionTooLong(selection)) return;
    dismissSelection(selection);
    autoSaveAttempt.current = "";
    setNoteEditor(null);
    const request = ++inlineRequest.current;
    setInlineResult({
      selection,
      kind,
      language: resultLanguage,
      loading: execution === 'api',
      text: "",
      error: "",
    });
    if (execution === 'agent') return;
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
        pages: [...new Set(selection.segments.map(segment => segment.page))].sort((a,b)=>a-b),
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
  const autoSaveAttempt = useRef('');
  const saveInline = async () => {
    if (!inlineResult?.text || !onCreateAnnotation || saveBusy.current) return;
    if (selectionTooLong(inlineResult.selection)) {
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
      const existing = annotations.find(note => note.kind === result.kind && note.language === result.language && note.body === result.text && JSON.stringify(annotationSegments(note)) === JSON.stringify(annotationSegments({...selectionAnchors(result.selection)})));
      const saved = existing || await onCreateAnnotation({
        kind: result.kind,
        ...selectionAnchors(result.selection),
        body: result.text,
        color: annotationColor,
        language: result.language,
        tags: [result.language],
      });
      setInlineResult((current) =>
        current === result ? { ...current, saved: true, annotationId: saved?.id } : current,
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
  useEffect(() => {
    if (!inlineResult?.text || inlineResult.saved || inlineResult.loading || inlineResult.error || !onCreateAnnotation) return;
    const key = JSON.stringify([url, inlineResult.selection.text, inlineResult.selection.segments, inlineResult.kind, inlineResult.language, inlineResult.text]);
    if (autoSaveAttempt.current === key || saveBusy.current) return;
    autoSaveAttempt.current = key;
    void saveInline();
  }, [inlineResult, onCreateAnnotation]);
  const reopenInline = (id:string, page:number) => {
    const note = annotations.find(note => note.id === id);
    if (!note || !['translation','explanation'].includes(note.kind) || !note.body) { onSelectAnnotation?.(id,page); return; }
    const segments = annotationSegments(note).map(segment=>({page:segment.page,text:segment.quote || '',rects:segment.rects || []}));
    const first = segments.find(segment=>segment.page===page) || segments[0];
    inlineRequest.current++; setDraftFolded(false); setDraftLocationUnavailable(false); setSelectionMenu(null); setNoteEditor(null); setAnnotationError('');
    setInlineResult({kind:note.kind as 'translation'|'explanation',language:note.language || language,text:note.body,loading:false,error:'',saved:true,annotationId:id,
      selection:{page:first.page,text:segments.map(segment=>segment.text).join('\n'),rects:first.rects,segments,left:24,top:80}});
  };
  const hideInlineMarker = async () => {
    const id=inlineResult?.annotationId;if(!id || !onHideAnnotation)return;
    try { await onHideAnnotation(id,true); clearSelectionDraft(); }
    catch(reason) {setAnnotationError((reason as Error).message);}
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

  const restoreSelectionDraft = () => {
    const selection=draftState.current.selection, element=host.current;
    if(!selection || !element || restoringDraft.current)return;
    const token=++draftRestoreToken.current, origin={top:element.scrollTop,left:element.scrollLeft};
    restoringDraft.current=true;setDraftRestoring(true);setDraftLocationUnavailable(false);
    const finish=(range?:Range)=>{
      if(token!==draftRestoreToken.current)return;
      setDraftLocationUnavailable(!range);setDraftFolded(false);setDraftRestoring(false);
      if(!range){element.scrollTop=origin.top;setHorizontal(origin.left);updateVisiblePages();}
      const position=floatingPosition(selection);setSelectionMenu(current=>current?{...current,...position}:current);
      draftRestoreFrame.current=requestAnimationFrame(()=>{
        if(token!==draftRestoreToken.current)return;
        const input=selectionInput.current;
        if(input && !input.disabled)input.focus({preventScroll:true});
        else (inlinePopup.current || notePopup.current || selectionPopup.current)?.focus({preventScroll:true});
        if(range){const selected=window.getSelection();selected?.removeAllRanges();selected?.addRange(range);}
        draftRestoreFrame.current=requestAnimationFrame(()=>{if(token===draftRestoreToken.current)restoringDraft.current=false;});
      });
    };
    const anchor=selection.anchor;
    if(!anchor || selectionTooLong(selection)){finish();return;}
    const checked=restorePdfSelectionAnchor(anchor,element);
    if(checked.status==='changed'){finish();return;}
    const sheet=element.querySelector<HTMLElement>(`[data-pdf-page="${selection.page}"]`), rect=selection.rects[0];
    if(!sheet || !rect){finish();return;}
    // Source geometry belongs to the original rotated PDF viewport, not a
    // possibly disconnected Range. Existing zoom and horizontal intent survive.
    element.scrollTop=Math.max(0,sheet.offsetTop+rect.y*sheet.offsetHeight-Math.min(100,element.clientHeight*.22));
    const left=sheet.offsetLeft+rect.x*sheet.offsetWidth, right=left+rect.width*sheet.offsetWidth;
    if(left<element.scrollLeft+16 || right>element.scrollLeft+element.clientWidth-16)setHorizontal(Math.max(0,left-24));
    updateVisiblePages();
    const deadline=performance.now()+6000;
    const attempt=()=>{
      if(token!==draftRestoreToken.current || !activeRef.current)return;
      const restored=restorePdfSelectionAnchor(anchor,element);
      if(restored.status==='ready'){finish(restored.range);return;}
      if(restored.status==='changed' || performance.now()>deadline){finish();return;}
      draftRestoreFrame.current=requestAnimationFrame(attempt);
    };
    draftRestoreFrame.current=requestAnimationFrame(attempt);
  };
  useEffect(()=>{
    if(!active || !draftSelection)return;
    let frame=0;
    const update=()=>{
      frame=0;if(restoringDraft.current || !host.current)return;
      updateDraftChip();
      const element=host.current, view=element.getBoundingClientRect(), viewport=window.visualViewport;
      const top=Math.max(view.top,viewport?.offsetTop || 0), bottom=Math.min(view.bottom,(viewport?.offsetTop || 0)+(viewport?.height || window.innerHeight));
      const left=Math.max(view.left,viewport?.offsetLeft || 0),right=Math.min(view.right,(viewport?.offsetLeft || 0)+(viewport?.width || window.innerWidth));
      const selection=draftState.current.selection;
      if(!selection)return;
      const visible=selection.segments.some(segment=>{
        const sheet=element.querySelector<HTMLElement>(`[data-pdf-page="${segment.page}"]`)?.getBoundingClientRect();
        return sheet && segment.rects.some(rect=>sheet.top+(rect.y+rect.height)*sheet.height>top && sheet.top+rect.y*sheet.height<bottom && sheet.left+(rect.x+rect.width)*sheet.width>left && sheet.left+rect.x*sheet.width<right);
      });
      if(!visible)setDraftFolded(true);
      // Never auto-open a preserved draft when its source or response returns.
    };
    const schedule=(event:Event)=>{
      if(event.target instanceof Element && event.target.closest('.pdf-selection-menu,.pdf-inline-assist,.pdf-note-editor,.pdf-selection-draft-chip'))return;
      if(!frame)frame=requestAnimationFrame(update);
    };
    window.document.addEventListener('scroll',schedule,true);window.addEventListener('resize',schedule);
    window.visualViewport?.addEventListener('resize',schedule);window.visualViewport?.addEventListener('scroll',schedule);
    const observer=new ResizeObserver(()=>{if(!frame)frame=requestAnimationFrame(update);});if(host.current)observer.observe(host.current);
    return()=>{cancelAnimationFrame(frame);observer.disconnect();window.document.removeEventListener('scroll',schedule,true);window.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('scroll',schedule);};
  },[active,!!draftSelection,url,language]);
  const draftStatus=draftRestoring?t("正在返回原文…","Returning to source…"):selectionAsking?t("正在创建会话","Creating session"):inlineResult?.loading?t("处理中","Processing"):(inlineResult?.error || annotationError)?t("处理未完成","Needs attention"):inlineResult?.text?t("结果已保留","Result preserved"):selectionQuestion?t("问题已保留","Question preserved"):t("选文已保留","Selection preserved");

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
            onClick={() => navigateToPage(currentPage.current - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <PdfPageNumber page={visiblePage} total={document?.numPages || 1}
            label={t("PDF 页码", "PDF page number")} disabled={!document} onNavigate={navigateToPage} />
          <span>/ {document?.numPages || "—"}</span>
          <button
            className="icon-button"
            aria-label={t("下一页", "Next page")}
            disabled={!document || visiblePage >= document.numPages}
            onClick={() => navigateToPage(currentPage.current + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
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
            aria-label={t("适合宽度", "Fit width")}
            title={t("适合宽度", "Fit width")}
            disabled={!document}
            onClick={() => changeZoom(null)}
          >
            <Maximize2 size={15} /> <span>{t("适合宽度", "Fit width")}</span>
          </button>
        </div>
        <button ref={outlineButton} type="button" className="pdf-outline-toggle" aria-label={t("PDF 目录", "PDF outline")} title={t("PDF 目录", "PDF outline")} aria-expanded={outlineOpen} aria-controls="pdf-outline-panel" onClick={() => { setOutlineOpen(value => !value); setSearchOpen(false); setToolsOpen(false); }}><ListTree size={17} /></button>
        <button ref={searchButton} type="button" className="pdf-find-toggle" aria-label={t("查找 PDF 正文", "Find in PDF")} title={t("查找 PDF 正文（⌘/Ctrl F）", "Find in PDF (⌘/Ctrl F)")} aria-expanded={searchOpen} onClick={() => { setSearchOpen(value => !value); setToolsOpen(false); setOutlineOpen(false); }}><Search size={16} /></button>
        {onCreateAnnotation && <button
          className={`pdf-draw-button ${drawing ? "is-active" : ""}`}
          aria-pressed={drawing}
          aria-label={drawing ? t("结束手写", "Finish drawing") : t("手写", "Draw")}
          title={drawing ? t("结束手写", "Finish drawing") : t("手写", "Draw")}
          onClick={() => { setDrawing(value => !value); setSelectionMenu(null); window.getSelection()?.removeAllRanges(); }}
        ><PenLine size={16} /></button>}
        <div className="pdf-tools" ref={toolsHost}>
          <button ref={toolsButton} className="pdf-tools-toggle" aria-expanded={toolsOpen} aria-label={t("阅读工具", "Reading tools")} title={t("阅读工具", "Reading tools")} onClick={() => { setToolsOpen(value => !value); setOutlineOpen(false); }}><SlidersHorizontal size={17} /></button>
          {toolsOpen && <div className="pdf-tools-popover" role="region" aria-label={t("PDF 阅读设置", "PDF reading settings")}>
            <label className="pdf-paper-colors"><span>{t("纸张", "Paper")}</span>
              <select aria-label={t("PDF 纸张颜色", "PDF paper colors")} value={paperColors} onChange={event => setPaperColors(event.target.value as "theme" | "original")}>
                <option value="theme">{t("跟随主题", "Follow theme")}</option><option value="original">{t("原始颜色", "Original colors")}</option>
              </select>
            </label>
            <span className="pdf-theme-color-notice">{t("深色显示会调整图色，核对图表请选「原始颜色」。", "Dark display adjusts figure colors. Choose Original colors to verify charts.")}</span>
        <div className="pdf-source-actions">
          {onManageFigures && <button className="text-button" onClick={() => {setToolsOpen(false);onManageFigures(currentPage.current);}}>{t("核对图表裁切", "Review figure crops")}</button>}
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
            <p className="pdf-tools-hint">{t("选择文字可高亮、笔记、翻译或提问。聚焦纸面后，用左右方向键翻页。", "Select text to highlight, annotate, translate or ask. Focus the page and use arrow keys to change pages.")}</p>
          </div>}
        </div>
      </div>
      {(drawing || inkDrafts.length > 0) && <div className="pdf-annotation-toolbar">
        {onCreateAnnotation && (
          <>
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
          </>
        )}
      </div>}
      <PdfOutline document={document} language={language} open={active && outlineOpen} onClose={() => { setOutlineOpen(false); outlineButton.current?.focus({preventScroll:true}); }} onNavigate={navigateToPage} currentPage={visiblePage} onFind={() => { setOutlineOpen(false); setSearchOpen(true); }} />
      <PdfSearchBar document={document} language={language} open={active && searchOpen} onClose={() => { setSearchOpen(false); searchButton.current?.focus({preventScroll:true}); }} onResult={showSearchResult} />
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
        onCopy={event => {
          const selection = window.getSelection();
          if (!selection?.rangeCount || selection.isCollapsed) return;
          const range = selection.getRangeAt(0);
          if (!event.currentTarget.contains(range.commonAncestorContainer)) return;
          const text = selectedPdfText(range, event.currentTarget);
          if (text) { event.clipboardData.setData("text/plain", text); event.preventDefault(); }
        }}
        onScroll={() => {
          recordHorizontalScroll();
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
                citationTarget={citationPage===index+1}
                active={active && (citationMatch?.page===index+1 || (index + 1 >= visible.first && index + 1 <= visible.last) || (!!draftSelection && !selectionTooLong(draftSelection) && (draftRestoring || !draftFolded) && draftSelection.segments.some(segment => segment.page === index + 1)))}
                onNavigate={navigateToPage}
                searchMatch={searchMatch?.page === index + 1 ? searchMatch : citationMatch?.page === index + 1 ? citationMatch : null}
                onSearchLocated={locateSearchText}
                paperColors={paperColors}
                annotations={annotations.filter(note=>!note.markerHidden).flatMap(annotation => annotationSegments(annotation).filter(segment => segment.page === index + 1).map(segment => ({...annotation,...segment})))}
                drawing={drawing}
                annotationColor={inkColor}
                strokes={inkDrafts.filter((item) => item.page === index + 1)}
                onStroke={(stroke) =>
                  setInkDrafts((current) => [
                    ...current,
                    { page: index + 1, stroke, color: inkColor },
                  ])
                }
                onSelectAnnotation={id => reopenInline(id, index + 1)}
                focusedAnnotation={annotationFocus?.id}
                language={language}
              />
            ))}
          </div>
        )}
      </div>
      {active && onHideAnnotation && annotations.some(note=>note.markerHidden) && <button className="pdf-restore-markers" onClick={()=>void Promise.all(annotations.filter(note=>note.markerHidden).map(note=>onHideAnnotation(note.id,false))).catch(reason=>setAnnotationError(reason.message))}>{t('恢复隐藏的标记','Restore hidden markers')} ({annotations.filter(note=>note.markerHidden).length})</button>}
      {active && (annotationStatus || (annotationError && !noteEditor && !inlineResult && !selectionMenu)) && <div className={`pdf-annotation-feedback ${annotationError ? "is-error" : ""}`} role={annotationError ? "alert" : "status"}>
        {annotationError ? <span>{annotationError}</span> : <><Check size={15}/><span>{annotationStatus}</span></>}
        <button aria-label={t("关闭保存提示", "Dismiss save status")} onClick={() => { setAnnotationStatus(""); setAnnotationError(""); }}><X size={14}/></button>
      </div>}
      {active && citationStatus && <div className="pdf-citation-status" role="status">
        {citationStatus === "loading" ? <><Loader2 size={13} className="spin"/>{t("正在核对引用原文…", "Locating the source passage…")}</> : citationStatus === "matched" ? t(`已定位原文 · p.${citationMatch?.page}`, `Source passage located · p.${citationMatch?.page}`) : citationStatus === "page" ? t(`已打开第 ${citationPage} 页 · 此引用未提供段落原文`, `Opened page ${citationPage} · No exact passage was supplied`) : citationStatus === "ambiguous" ? t("此页有多处相同文字，已打开源页。", "Several passages match. Opened the source page.") : t("引文未在此页精确匹配，已打开源页。", "No exact passage match. Opened the source page.")}
        <button aria-label={t("关闭引用定位提示", "Dismiss citation status")} onClick={() => setCitationStatus(null)}><X size={13}/></button>
      </div>}
      {active && (navigationHistory.length > 0 || onReturnToOverview) && <button className="pdf-reading-return" onClick={returnToReading}><ArrowLeft size={15} /><span>{navigationHistory.length ? t("回到上次阅读位置", "Back to previous position") : t("返回摘要阅读位置", "Back to overview position")}</span></button>}
      {active && draftSelection && draftFolded && createPortal(<div className="pdf-selection-draft-chip" ref={draftChip} role="region" aria-label={t("PDF选文草稿","PDF selection draft")} style={draftChipPosition}>
        <button className="pdf-draft-restore" disabled={draftRestoring} onClick={restoreSelectionDraft} aria-label={t("返回选文草稿","Return to selected draft")}><ArrowLeft size={17}/><span><strong>{t("返回选文草稿","Return to selected draft")}</strong><small role="status">{draftStatus} · p.{draftSelection.page}</small></span></button>
        <button className="pdf-draft-discard" aria-label={t("丢弃选文草稿","Discard selection draft")} onClick={clearSelectionDraft}><X size={16}/></button>
      </div>,window.document.body)}
      {active && selectionMenu &&
        !drawing &&
        !inlineResult &&
        !noteEditor &&
        createPortal(
          <div
            className="pdf-selection-menu"
            ref={selectionPopup} hidden={draftFolded} tabIndex={-1}
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
                {annotationPageLabel(selectionAnchors(selectionMenu))}
              </span>
              {onAskSelection && (
                <input
                  ref={selectionInput}
                  aria-label={t(
                    "针对选中文字的问题",
                    "Question about selected text",
                  )}
                  value={selectionQuestion}
                  disabled={selectionAsking || !!selectionTooLong(selectionMenu)}
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
              <button className="pdf-popover-close" aria-label={t("收起选文草稿", "Minimize selection draft")} onClick={minimizeDraft}><Minus size={14}/></button>
              <button
                className="pdf-popover-close"
                aria-label={t("关闭选区菜单", "Close selection menu")}
                onClick={clearSelectionDraft}
              >
                <X size={14} />
              </button>
            </div>
            {draftLocationUnavailable && <p className="pdf-draft-location-notice" role="status">{t("原选文位置已变化，无法精确恢复。草稿已保留，请重新选择原文以定位。", "The source location has changed and cannot be restored precisely. Your draft is preserved; select the source again to relocate it.")}</p>}
            <label className="pdf-selection-language">{t("结果语言", "Result language")}
              <select aria-label={t("选文结果语言", "Selection result language")} value={selectionLanguage.startsWith("en") ? "en" : "zh-CN"} onChange={event => setSelectionLanguage(event.target.value)}>
                <option value="zh-CN">中文</option><option value="en">English</option>
              </select>
            </label>
            {paperId && <label className="selection-execution">{t('处理方式','Process with')}<select aria-label={t('选文处理方式','Selection processing method')} value={useSelectionAgent?'agent':'api'} onChange={event=>{const value=event.target.value as SelectionExecution;setSelectionExecution(value);saveSelectionExecution(value);}}><option value="api" disabled={!modelReady}>{t('模型 API','Model API')}</option><option value="agent">Codex / Claude</option></select></label>}
            <div className="pdf-selection-actions">
              {onAskSelection && (
                <button
                  aria-label={t("询问助手", "Ask assistant")}
                  disabled={selectionAsking || !!selectionTooLong(selectionMenu)}
                  onClick={askAboutSelection}
                >
                  <MessageCircle size={15} />
                  {selectionAsking ? t("创建中…", "Creating…") : t("提问", "Ask")}
                </button>
              )}
              <button
                aria-label={t("解释选中内容", "Explain selection")}
                disabled={!!selectionTooLong(selectionMenu)}
                onClick={() => void runInline("explanation")}
              >
                <Sparkles size={15} />
                {t("就地解释", "Explain")}
              </button>
              <button
                aria-label={t("翻译选中内容", "Translate selection")}
                disabled={!!selectionTooLong(selectionMenu)}
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
                    disabled={annotationBusy || !!selectionTooLong(selectionMenu)}
                    aria-label={t("高亮选中内容", "Highlight selection")}
                    onClick={() => void saveAnnotation("highlight")}
                  >
                    <Highlighter size={14} />
                    {t("高亮", "Highlight")}
                  </button>
                  <button
                    disabled={annotationBusy || !!selectionTooLong(selectionMenu)}
                    aria-label={t("划线选中内容", "Underline selection")}
                    onClick={() => void saveAnnotation("underline")}
                  >
                    <Underline size={14} />
                    {t("划线", "Underline")}
                  </button>
                  <button
                    aria-label={t("添加选区笔记", "Add selection note")}
                    disabled={!!selectionTooLong(selectionMenu)}
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
            {selectionTooLong(selectionMenu) && <p role="alert" className="pdf-popover-error">{t('选区过长。请缩短至 12,000 字、20 页以内，再进行提问、翻译或保存。','This selection is too long. Select at most 12,000 characters across 20 pages before asking, translating or saving.')}</p>}
            {annotationError && (
              <p role="alert" className="pdf-popover-error">
                {annotationError}
              </p>
            )}
          </div>,
          window.document.body,
        )}
      {active && noteEditor &&
        createPortal(
          <div
            className="pdf-note-editor"
            ref={notePopup} hidden={draftFolded} tabIndex={-1}
            role="dialog"
            aria-label={t("添加笔记", "Add note")}
            style={floatingPosition(noteEditor)}
          >
            <header>
              <strong>
                <StickyNote size={15} />
                {t("笔记", "Note")} · {annotationPageLabel(selectionAnchors(noteEditor))}
              </strong>
              <button aria-label={t("收起选文草稿", "Minimize selection draft")} onClick={minimizeDraft}><Minus size={16}/></button>
              <button
                aria-label={t("关闭笔记编辑", "Close note editor")}
                onClick={clearSelectionDraft}
              >
                <X size={16} />
              </button>
            </header>
            {draftLocationUnavailable && <p className="pdf-draft-location-notice" role="status">{t("原选文位置已变化，无法精确恢复。草稿已保留，请重新选择原文以定位。", "The source location has changed and cannot be restored precisely. Your draft is preserved; select the source again to relocate it.")}</p>}
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
      {active && inlineResult &&
        createPortal(
          <div
            className="pdf-inline-assist"
            ref={inlinePopup} hidden={draftFolded} tabIndex={-1}
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
                · {annotationPageLabel(selectionAnchors(inlineResult.selection))}
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
                <button aria-label={t("收起选文草稿", "Minimize selection draft")} onClick={minimizeDraft}><Minus size={16}/></button>
                <button
                  aria-label={t("关闭就地助手", "Close inline assistant")}
                  onClick={clearSelectionDraft}
                >
                  <X size={16} />
                </button>
              </div>
            </header>
            <div className="pdf-inline-scroll">
              {draftLocationUnavailable && <p className="pdf-draft-location-notice" role="status">{t("原选文位置已变化，无法精确恢复。草稿已保留，请重新选择原文以定位。", "The source location has changed and cannot be restored precisely. Your draft is preserved; select the source again to relocate it.")}</p>}
              {paperId && <label className="selection-execution">{t('处理方式','Process with')}<select aria-label={t('就地处理方式','Inline processing method')} value={useSelectionAgent?'agent':'api'} onChange={event=>{const value=event.target.value as SelectionExecution;setSelectionExecution(value);saveSelectionExecution(value);void runInline(inlineResult.kind,inlineResult.selection,inlineResult.language,value);}}><option value="api" disabled={!modelReady}>{t('模型 API','Model API')}</option><option value="agent">Codex / Claude</option></select></label>}
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
                  <Mark>
                    {inlineResult.text}
                  </Mark>
                </div>
              )}
              {annotationError && (
                <p className="pdf-popover-error" role="alert">
                  {annotationError}
                </p>
              )}
              {paperId && <AgentSelectionBridge
                key={selectionBindingKey({paperId,sourceScope:'pdf',page:inlineResult.selection.page,pages:inlineResult.selection.segments.map(segment=>segment.page),text:inlineResult.selection.text,kind:inlineResult.kind,language:inlineResult.language})}
                binding={{paperId,sourceScope:'pdf',page:inlineResult.selection.page,pages:inlineResult.selection.segments.map(segment=>segment.page),text:inlineResult.selection.text,kind:inlineResult.kind,language:inlineResult.language}}
                primary={useSelectionAgent}
                onResult={activity=>{inlineRequest.current++;setInlineResult(current=>current ? {...current,text:activity.result!.text,source:activity.source?.model || activity.source?.agent || t('订阅助手','Subscription agent'),loading:false,error:'',saved:false} : current);}}/>}
            </div>
            <footer>
              {inlineResult.annotationId && onHideAnnotation && <button onClick={()=>void hideInlineMarker()}>{t('隐藏标记','Hide marker')}</button>}
              {inlineResult.source && <span className="inline-result-source" title={inlineResult.source}>{inlineResult.source}</span>}
              {!useSelectionAgent && <button
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
              </button>}
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
