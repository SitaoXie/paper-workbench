import { prepareAgentQuestionTask } from "./agent-task";
import { parseReadingSectionLocation, readingSectionUrl, READING_SECTION_EVENT } from "./reading-sections";
import { activityResultText, usableActivityResult } from "./activity-result";
import { useChatScroll } from "./useChatScroll";
import { adoptChatScroll, readChatScroll, removePaperChatScroll } from "./chat-scroll";
import "./chat-scroll.css";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import {
  ArrowUp,
  ArrowDown,
  ArrowUpRight,
  BookOpen,
  Bookmark,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  Copy,
  Code2,
  Download,
  ExternalLink,
  FilePlus2,
  FileText,
  FlaskConical,
  Globe2,
  History,
  Layers3,
  Library,
  Languages,
  Link2,
  Loader2,
  Menu,
  MessageSquare,
  Moon,
  NotebookPen,
  PanelRightClose,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import Mark from "./Markdown";
import MessageActions from "./MessageActions";
import SelectionTools from "./SelectionTools";
import ReadingOverview from "./ReadingOverview";
import NotebookPanel from "./NotebookPanel";
import ReadingHistory from "./ReadingHistory";
import PaperCardExcerpt from "./PaperCardExcerpt";
import { flushReadingPositions, pdfDocumentKey, positionHash, readReadingPosition, removeReadingPosition, saveOverviewPosition, savePdfPosition, saveReadingTab, type OverviewReadingContext, type OverviewReadingPosition, type PdfReadingPosition } from "./reading-position";
import type { Annotation, AnnotationDraft } from "./reader-annotations";
import type { Activity, Conversation } from "./types";
import { adoptChatDraft, chatDraftKey, clearChatDraft, readChatDraft, removePaperDrafts, writeChatDraft, type DraftPassage } from "./chat-drafts";
import { useLocale, t, getLocale } from "./i18n";
import { lazy, Suspense } from "react";
const PdfReader = lazy(() => import("./PdfReader"));
import {
  api,
  type Paper,
  type Settings,
  type Message,
  type Figure,
} from "./types";
import SettingsDialog from "./SettingsDialog";
import AssistantDock, { defaultAssistantWidth } from "./AssistantDock";
import { readCompanionMode, saveCompanionMode, type CompanionMode } from "./assistant-layout";
import { selectionErrorMessage } from "./selection-errors";
import { pageLabel } from "./page-label";
import ReadingTools, { ModelSelect } from "./ReadingTools";
const PdfFigure = lazy(() => import("./PdfFigure"));

type View = "discover" | "library" | "saved" | "research" | "paper";
function passageMetadata(passage: DraftPassage) {
  return {quote:passage.text,page:passage.page,pages:passage.pages,sourceScope:passage.sourceScope,readingId:passage.readingId};
}
const suggestions = () => [
  t("这篇论文的核心贡献是什么？"),
  t("方法有哪些假设与局限？"),
  t("与已有方法相比有什么不同？"),
  t("帮我制定一个复现清单"),
];
const welcomeQueries = [
  "Reinforcement learning",
  "Reasoning & inference",
  "Language models",
  "Computer vision",
];
const exampleUrl = "https://arxiv.org/abs/1706.03762";

function date(value?: string) {
  if (!value) return t("本地论文");
  const d = new Date(value);
  return isNaN(d.getTime())
    ? t("本地论文")
    : d.toLocaleDateString(getLocale() === "zh" ? "zh-CN" : "en", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}
function download(text: string, name: string, type = "text/markdown") {
  const u = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}

export default function App() {
  const { locale, setLocale } = useLocale();
  const [view, setView] = useState<View>("discover");
  const [papers, setPapers] = useState<Paper[]>([]);
  const [paper, setPaper] = useState<Paper | null>(null);
  const [tab, setTab] = useState<"summary" | "paper">("summary");
  const [pdfVisited, setPdfVisited] = useState(false);
  const [pdfNavigation, setPdfNavigation] = useState<{ page: number; nonce: number; fromOverview?: boolean; quote?: string }>();
  const [overviewReturn, setOverviewReturn] = useState(false);
  const overviewScroll = useRef(0);
  const summaryRef = useRef<HTMLElement>(null);
  const [initialPdfPosition, setInitialPdfPosition] = useState<PdfReadingPosition>();
  const [initialPresentation, setInitialPresentation] = useState<"article" | "interactive">();
  const [overviewContext, setOverviewContext] = useState<(OverviewReadingContext & { paperId: string; source: string })>();
  const restoringOverview = useRef(false);
  const navigationSequence = useRef(0);
  function changePaperTab(next: "summary" | "paper") {
    if (next === tab) return;
    if (tab === "summary") rememberOverview(true);
    if (next === "paper") setPdfVisited(true);
    setTab(next);
  }
  useLayoutEffect(() => {
    if (view === "paper" && tab === "paper") window.scrollTo({ top: 0, behavior: "instant" });
  }, [tab, view, paper?.id]);
  const [companion, setCompanion] = useState<CompanionMode>(readCompanionMode);
  const companionRef = useRef(companion);
  const assistant = companion === "assistant", notebook = companion === "notebook";
  function changeCompanion(next: CompanionMode) {
    chatScroll.remember();
    companionRef.current = next;
    setCompanion(next);
    saveCompanionMode(next);
  }
  function setAssistant(open: boolean) {
    changeCompanion(open ? "assistant" : companionRef.current === "assistant" ? null : companionRef.current);
  }
  function setNotebook(open: boolean) {
    changeCompanion(open ? "notebook" : companionRef.current === "notebook" ? null : companionRef.current);
  }
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [annotationsLoading, setAnnotationsLoading] = useState(false);
  const [annotationFocus, setAnnotationFocus] = useState<{
    id: string;
    nonce: number;
    page?: number;
  }>();
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string>();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [dockWidth, setDockWidth] = useState(defaultAssistantWidth);
  const [draft, setDraft] = useState(() => readChatDraft(chatDraftKey()));
  const prompt = draft.text, selectedPassage = draft.passage;
  const [abstractOverflow, setAbstractOverflow] = useState(false);
  const abstractRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [theme, setTheme] = useState(
    () => localStorage.getItem("pw-theme") || "light",
  );
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<Settings>({
    provider: "openai",
    baseUrl: "",
    model: "",
    apiKeyConfigured: false,
  });
  const [showImport, setShowImport] = useState(false);
  const [url, setUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Paper[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchSource, setSearchSource] = useState("all");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [reporting, setReporting] = useState(false);
  const [language, setLanguage] = useState(() =>
    locale === "en" ? "en" : "zh-CN",
  );
  useEffect(() => {
    setLanguage(locale === "en" ? "en" : "zh-CN");
  }, [locale]);
  const [showOriginal, setShowOriginal] = useState(false);
  const [translating, setTranslating] = useState(false);
  useEffect(() => {
    localStorage.setItem("pw-language", language);
  }, [language]);
  const [expanded, setExpanded] = useState(false);
  const [chat, setChat] = useState<Message[]>([]);
  const [chatting, setChatting] = useState(false);
  const [conversationBusy, setConversationBusy] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [copyState, setCopyState] = useState<{kind: "citation" | "agent"; context: string} | null>(null);
  const [copyingAgent, setCopyingAgent] = useState(false);
  const [showCite, setShowCite] = useState(false);
  const [pdfPage, setPdfPage] = useState(1);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const paperRef = useRef<string | undefined>(undefined);
  const searchToken = useRef(0);
  const paperMutation = useRef(0);
  const annotationMutation = useRef(0);
  const chatContext = useRef({ paperId: undefined as string | undefined, conversationId: undefined as string | undefined, key: chatDraftKey() });
  const pendingChats = useRef(new Set<string>());
  const chatScroll = useChatScroll(chatContext.current.key, chat, chatting);
  const navigationRevision = useRef(0);
  const initialized = useRef(false);
  const initialNavigation = useRef((() => {
    const params = new URLSearchParams(location.search);
    const page = Number(params.get("page"));
    return { paperId: params.get("paper"), page: Number.isInteger(page) && page > 0 ? page : undefined };
  })());
  useEffect(() => {
    const followSectionLink = () => {
      if (view === "paper" && paper && !new URLSearchParams(location.search).has("page") && parseReadingSectionLocation(location.href, paper.id)) {
        setTab("summary"); setOverviewReturn(false);
      }
    };
    window.addEventListener("hashchange", followSectionLink);
    return () => window.removeEventListener("hashchange", followSectionLink);
  }, [view, paper?.id]);
  function setPrompt(text: string) {
    setDraft(writeChatDraft(chatContext.current.key, { ...readChatDraft(chatContext.current.key), text }));
  }
  function setSelectedPassage(passage: DraftPassage | null) {
    setDraft(writeChatDraft(chatContext.current.key, { text: readChatDraft(chatContext.current.key).text, passage, contextPolicy: passage ? undefined : "omit" }));
  }
  function activateChat(paperId?: string, nextId?: string, adoptPending = false) {
    chatScroll.remember();
    const next = { paperId, conversationId: nextId, key: chatDraftKey(paperId, nextId) };
    if (nextId && !chatContext.current.conversationId && chatContext.current.paperId === paperId)
      adoptChatScroll(chatContext.current.key, next.key);
    if (adoptPending && !chatContext.current.conversationId && chatContext.current.paperId === paperId)
      adoptChatDraft(chatContext.current.key, next.key);
    chatContext.current = next;
    setConversationId(nextId);
    setDraft(readChatDraft(next.key));
    setChatting(pendingChats.current.has(next.key));
    setConversationBusy(false);
    return next;
  }
  useEffect(() => {
    if (view !== "paper" || !paper?.id) return;
    const id = paper.id;
    let disposed = false;
    setAnnotationsLoading(true);
    setAnnotations([]);
    setSelectedAnnotationId(undefined);
    setAnnotationFocus(undefined);
    api<{ annotations: Annotation[] }>(`/papers/${id}/annotations`)
      .then((r) => {
        if (!disposed) setAnnotations(r.annotations || []);
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
      })
      .finally(() => {
        if (!disposed) setAnnotationsLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [view, paper?.id]);
  async function createAnnotation(
    draft: AnnotationDraft,
  ): Promise<Annotation | void> {
    const id = paper?.id;
    if (!id) return;
    annotationMutation.current++;
    const result = await api<{ annotation: Annotation }>(
      `/papers/${id}/annotations`,
      { method: "POST", body: JSON.stringify(draft) },
    );
    annotationMutation.current++;
    if (paperRef.current === id)
      setAnnotations((old) => [...old.filter(a => a.id !== result.annotation.id), result.annotation]);
    return result.annotation;
  }
  async function mutateAnnotation(
    id: string,
    patch?: Partial<Annotation>,
    remove = false,
    restore = false,
  ) {
    const paperId = paper?.id;
    if (!paperId) return;
    annotationMutation.current++;
    const result = await api<{ annotation: Annotation }>(
      `/papers/${paperId}/annotations/${id}`,
      {
        method: remove ? "DELETE" : "PATCH",
        ...(remove
          ? {}
          : { body: JSON.stringify(restore ? { restore: true } : patch) }),
      },
    );
    annotationMutation.current++;
    if (paperRef.current !== paperId) return;
    setAnnotations((old) =>
      remove
        ? old.filter((a) => a.id !== id)
        : restore
          ? [...old.filter((a) => a.id !== id), result.annotation]
          : old.map((a) => (a.id === id ? result.annotation : a)),
    );
  }
  function selectAnnotation(entry: Annotation, page = entry.page) {
    setSelectedAnnotationId(entry.id || undefined);
    if (entry.id) {
      setAnnotationFocus({ id: entry.id, nonce: Date.now(), page });
      goToPage(page);
    }
  }
  async function inlineAssist(input: {
    text: string;
    page: number;
    pages?: number[];
    kind: "translation" | "explanation";
    language?: string;
  }) {
    if (!paper) throw new Error(t("请先打开论文。", "Open a paper first."));
    const response = await api<{
      result: {
        text: string;
        source?: Record<string, string>;
        createdAt?: string;
      };
      activity: Activity;
    }>(`/papers/${paper.id}/assist`, {
      method: "POST",
      body: JSON.stringify({ ...input, language: input.language || language }),
    }).catch(reason => { throw new Error(selectionErrorMessage(reason, getLocale())); });
    if (paperRef.current === paper.id)
      setActivities((old) => [response.activity, ...old]);
    return {
      ...response.result,
      source:
        response.result.source?.model ||
        response.result.source?.agent ||
        response.result.source?.kind,
    };
  }
  // External agent results arrive through the same API; keep a visible paper live.
  useEffect(() => {
    if (view !== "paper" || !paper?.id || conversationBusy) return;
    const id = paper.id;
    let disposed = false,
      pending = false;
    const update = async () => {
      if (document.hidden || pending) return;
      pending = true;
      const revision = paperMutation.current, annotationRevision = annotationMutation.current, context = chatContext.current;
      try {
        const r = await api<{ paper: Paper }>(
          `/papers/${encodeURIComponent(id)}`,
        );
        if (!disposed && paperRef.current === id && revision === paperMutation.current)
          setPaper((old) =>
            JSON.stringify(old) === JSON.stringify(r.paper) ? old : r.paper,
          );
        const c = await api<{ messages: Message[]; conversationId?: string }>(
          `/chats?paperId=${encodeURIComponent(id)}${conversationId ? `&conversationId=${encodeURIComponent(conversationId)}` : ""}`,
        );
        if (!disposed && paperRef.current === id && !pendingChats.current.has(context.key) && chatContext.current === context) {
          if (!conversationId && c.conversationId) activateChat(id, c.conversationId, true);
          setChat((old) =>
            JSON.stringify(old) === JSON.stringify(c.messages)
              ? old
              : c.messages,
          );
        }
        const notes = await api<{annotations: Annotation[]}>(`/papers/${id}/annotations`);
        if (!disposed && paperRef.current === id && annotationRevision === annotationMutation.current)
          setAnnotations(old => JSON.stringify(old) === JSON.stringify(notes.annotations) ? old : notes.annotations || []);
      } catch {
        /* Visible requests surface their own actionable errors. */
      } finally {
        pending = false;
      }
    };
    const timer = setInterval(update, 4000);
    window.addEventListener("focus", update);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, [view, paper?.id, chatting, conversationBusy, conversationId]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("pw-theme", theme);
  }, [theme]);
  useEffect(() => {
    // StrictMode runs effects twice. Keep the initial URL intent and launch only
    // one initial navigation; a later user navigation always takes precedence.
    if (initialized.current) return;
    initialized.current = true;
    const revision = navigationRevision.current;
    api<{ papers: Paper[] }>("/papers")
      .then((r) => setPapers(r.papers))
      .catch((e) => setError(e.message));
    api<Settings>("/settings")
      .then(setSettings)
      .catch((e) => setError(e.message));
    const { paperId: id, page } = initialNavigation.current;
    if (id)
      api<{ paper: Paper }>(`/papers/${encodeURIComponent(id)}`)
        .then((r) => { if (navigationRevision.current === revision) openPaper(r.paper, { page }); })
        .catch((e) => { if (navigationRevision.current === revision) setError(e.message); });
  }, []);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(""), 3500);
      return () => clearTimeout(t);
    }
  }, [notice]);
  useEffect(() => {
    if (!showImport && !showSettings && !showCite) return;
    const previous = document.activeElement as HTMLElement;
    const focusable = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          "[role=dialog] button:not(:disabled), [role=dialog] input:not(:disabled), [role=dialog] select, [role=dialog] textarea, [role=dialog] a[href]",
        ),
      ).filter((el) => el.offsetParent !== null);
    const timer = setTimeout(() => focusable()[0]?.focus(), 0);
    const trap = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !importing) {
        setShowImport(false);
        setShowSettings(false);
        setShowCite(false);
      }
      if (e.key === "Tab") {
        const items = focusable();
        const first = items[0],
          last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [showImport, showSettings, showCite, importing]);
  async function refresh() {
    const r = await api<{ papers: Paper[] }>("/papers");
    setPapers(r.papers);
  }
  function navigate(v: View) {
    rememberOverview(true);
    if (view === "paper" && paper) saveReadingTab(paper.id, pdfDocumentKey(paper), tab);
    flushReadingPositions();
    navigationRevision.current++;
    setView(v);
    setError("");
    setMobileNav(false);
    setResults(null);
    history.replaceState({}, "", location.pathname);
    if (v !== "paper") paperRef.current = undefined;
    const context = activateChat();
    if (v === "research") {
      setChat([]);
      setShowHistory(false);
      setConversationBusy(true);
      api<{ messages: Message[]; conversationId?: string }>("/chats")
        .then((r) => {
          if (chatContext.current === context) {
            activateChat(undefined, r.conversationId, true);
            setChat(r.messages);
          }
        })
        .catch((e) => { if (chatContext.current === context) setError(e.message); })
        .finally(() => { if (chatContext.current === context) setConversationBusy(false); });
    }
  }
  async function openPaper(p: Paper, intent?: { page?: number }) {
    rememberOverview(true);
    if (view === "paper" && paper) saveReadingTab(paper.id, pdfDocumentKey(paper), tab);
    flushReadingPositions();
    const saved = readReadingPosition(p.id, pdfDocumentKey(p));
    const previousOverview = saved?.overviews.find(position => position.language === language && (!p.activeReadingId || position.versionId === p.activeReadingId));
    setOverviewContext(undefined);
    setInitialPresentation(previousOverview?.presentation);
    const explicitPage = intent?.page;
    const resume = explicitPage ? { page: explicitPage, fraction: 0, left: 0, zoom: saved?.pdf?.zoom ?? null } : saved?.pdf;
    setInitialPdfPosition(resume);
    const revision = ++navigationRevision.current;
    paperRef.current = p.id;
    const context = activateChat(p.id);
    setConversationBusy(true);
    setPaper(p);
    setView("paper");
    setExpanded(!!previousOverview?.expanded);
    const startInPdf = !!explicitPage || (!parseReadingSectionLocation(location.href, p.id) && saved?.tab === "paper");
    const startPage = Math.max(1, Math.min(resume?.page || 1, p.pageCount || resume?.page || 1));
    overviewScroll.current = 0;
    setPdfVisited(startInPdf);
    setPdfNavigation(undefined);
    setOverviewReturn(false);
    setTab(startInPdf ? "paper" : "summary");
    setShowHistory(false);
    setPdfPage(startPage);
    setActivities([]);
    setChat([]);
    setError("");
    history.replaceState({}, "", `${location.pathname}?paper=${encodeURIComponent(p.id)}${explicitPage ? `&page=${startPage}` : ""}${location.hash}`);
    try {
      const [detail, r] = await Promise.all([
        api<{ paper: Paper }>(`/papers/${encodeURIComponent(p.id)}`),
        api<{ messages: Message[]; conversationId?: string }>(
          `/chats?paperId=${encodeURIComponent(p.id)}`,
        ),
      ]);
      if (navigationRevision.current === revision && paperRef.current === p.id) {
        setPaper(detail.paper);
        setPapers(previous => previous.map(item => item.id === detail.paper.id ? detail.paper : item));
        if (chatContext.current === context) {
          activateChat(p.id, r.conversationId, true);
          setChat(r.messages);
        }
      }
    } catch (e) {
      if (navigationRevision.current === revision) setError((e as Error).message);
    } finally {
      if (chatContext.current === context) setConversationBusy(false);
    }
  }
  async function importUrl(value = url) {
    if (!value.trim()) return;
    setImporting(true);
    setError("");
    try {
      const r = await api<{ paper: Paper }>("/import", {
        method: "POST",
        body: JSON.stringify({ url: value.trim() }),
      });
      await refresh();
      openPaper(r.paper);
      setShowImport(false);
      setUrl("");
      setNotice(t("论文已加入你的文库"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImporting(false);
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError(t("请选择 PDF 文件。"));
      return;
    }
    setImporting(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const r = await api<{ paper: Paper }>("/upload", {
        method: "POST",
        body,
      });
      await refresh();
      openPaper(r.paper);
      setShowImport(false);
      setNotice(t("PDF 已解析并加入文库"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  async function search(q = query, source = searchSource) {
    if (!q.trim()) return;
    const token = ++searchToken.current;
    setQuery(q);
    setSearching(true);
    setError("");
    rememberOverview(true);
    flushReadingPositions();
    navigationRevision.current++;
    paperRef.current = undefined;
    activateChat();
    setView("discover");
    try {
      const r = await api<{ papers: Paper[]; warnings?: string[] }>(
        "/search?q=" + encodeURIComponent(q) + "&source=" + source,
      );
      if (token === searchToken.current) {
        setResults(r.papers);
        if (r.warnings?.length) setError(r.warnings.join(" "));
      }
    } catch (e) {
      if (token === searchToken.current) {
        setError((e as Error).message);
        setResults([]);
      }
    } finally {
      if (token === searchToken.current) setSearching(false);
    }
  }
  async function selectResult(p: Paper) {
    const stored = papers.find((x) => x.id === p.id || x.url === p.url);
    if (stored) openPaper(stored);
    else await importUrl(p.url);
  }
  async function favorite(p: Paper) {
    try {
      const r = await api<{ paper: Paper }>(`/papers/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ favorite: !p.favorite }),
      });
      setPapers((xs) => xs.map((x) => (x.id === p.id ? r.paper : x)));
      if (paperRef.current === p.id) setPaper(r.paper);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function generate() {
    if (!paper || reporting) return;
    const id = paper.id;
    setReporting(true);
    setError("");
    try {
      const r = await api<{ paper: Paper }>(`/papers/${id}/report`, {
        method: "POST",
        body: JSON.stringify({ adversarial: true, language }),
      });
      if (paperRef.current === id) setPaper(r.paper);
      await refresh();
      setNotice(t("报告已生成"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReporting(false);
    }
  }
  async function translate(target: "abstract" | "summary" | "report") {
    if (!paper || translating) return;
    const id = paper.id;
    setTranslating(true);
    setError("");
    try {
      const r = await api<{ paper: Paper }>(`/papers/${id}/translate`, {
        method: "POST",
        body: JSON.stringify({ language, target }),
      });
      if (paperRef.current === id) {
        setPaper(r.paper);
        setShowOriginal(false);
      }
      setNotice(t("译文已保存，原文保持不变"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTranslating(false);
    }
  }
  async function ask(text = prompt, branch?: { history: Message[] }) {
    const context = chatContext.current;
    if (!text.trim() || pendingChats.current.has(context.key) || (conversationBusy && !branch)) return;
    chatScroll.followLatest(context.key);
    const previous = branch?.history || chat;
    const passage = readChatDraft(context.key).passage;
    // Keep the submitted draft until success. Editing while the request is in
    // flight creates a newer revision which this request must never clear.
    const submitted = writeChatDraft(context.key, { text, passage, contextPolicy: readChatDraft(context.key).contextPolicy, verbatim: readChatDraft(context.key).verbatim });
    setDraft(submitted);
    const message = passage && !submitted.verbatim
      ? `${text.trim()}\n\n${passage.sourceLabel || t("选中的原文", "Selected passage")}${passage.page ? ` [${pageLabel(passage.page,passage.pages)}]` : ""}:\n> ${passage.text.replace(/\n/g, "\n> ")}`
      : text.trim();
    const metadata = context.paperId && passage ? passageMetadata(passage) : submitted.contextPolicy === "omit" ? null : undefined;
    setChat((xs) => [...xs, { role: "user", content: message, ...(metadata ? { metadata } : {}) }]);
    pendingChats.current.add(context.key);
    setChatting(true);
    setError("");
    try {
      const r = await api<{ message: Message; userMessage?: Message; conversationId?: string }>("/chat", {
        method: "POST",
        body: JSON.stringify({
          paperId: context.paperId,
          conversationId: context.conversationId,
          message,
          ...(!submitted.verbatim ? { questionText: text.trim() } : {}),
          ...(metadata !== undefined ? { metadata } : {}),
          // Saved sessions carry server-verified source provenance. Sending a
          // text-only UI copy would discard it and bypass stale-evidence checks.
          ...(!context.conversationId ? { history: previous } : {}),
        }),
      });
      clearChatDraft(context.key, submitted.revision);
      if (!context.conversationId && r.conversationId)
        adoptChatDraft(context.key, chatDraftKey(context.paperId, r.conversationId));
      if (chatContext.current.key === context.key) {
        if (!context.conversationId && r.conversationId) activateChat(context.paperId, r.conversationId);
        else setDraft(readChatDraft(context.key));
        setChat((xs) => [...xs.map((item, index) => index === previous.length && r.userMessage ? r.userMessage : item), r.message]);
      }
    } catch (e) {
      if (chatContext.current.key === context.key) {
        setError((e as Error).message);
        setChat(previous);
        setDraft(readChatDraft(context.key));
      }
    } finally {
      pendingChats.current.delete(context.key);
      if (chatContext.current.key === context.key) setChatting(false);
    }
  }
  async function branchQuestion(question: Message, action: "edit" | "retry") {
    const context = chatContext.current;
    if (!question.id || !context.conversationId || chatting || conversationBusy) return;
    setConversationBusy(true); setError("");
    try {
      const response = await api<{ conversationId: string; messages: Message[]; draft: { message: string; metadata: Message["metadata"] | null; verbatim?: boolean } }>(
        `/conversations/${encodeURIComponent(context.conversationId)}/branch`,
        { method: "POST", body: JSON.stringify({ paperId: context.paperId || null, messageId: question.id, action }) },
      );
      if (chatContext.current !== context) return;
      const next = activateChat(context.paperId, response.conversationId);
      const metadata = response.draft.metadata;
      setDraft(writeChatDraft(next.key, {
        text: response.draft.message,
        passage: metadata?.quote ? { text: metadata.quote, page: metadata.page, pages: metadata.pages, sourceScope:metadata.sourceScope,readingId:metadata.readingId } : null,
        contextPolicy: metadata ? undefined : "omit", verbatim: response.draft.verbatim,
      }));
      setChat(response.messages); setShowHistory(false);
      setNotice(t("已创建分支，原对话仍保留在历史中。", "Created a branch. The original conversation remains in history."));
      if (action === "retry" && modelReady) await ask(response.draft.message, {history:response.messages});
      else requestAnimationFrame(() => composerRef.current?.focus({preventScroll:true}));
    } catch (reason) {
      if (chatContext.current === context) setError((reason as Error).message);
    } finally {
      if (chatContext.current === context) setConversationBusy(false);
    }
  }
  async function remove(p: Paper) {
    if (!confirm(t(`从本地文库删除《${p.title}》及其解读、笔记和会话？`, `Delete “${p.title}” and its overviews, notes and conversations from your local library?`))) return;
    try {
      await api(`/papers/${p.id}`, { method: "DELETE" });
      removePaperDrafts(p.id);
      removePaperChatScroll(p.id);
      removeReadingPosition(p.id);
      await refresh();
      if (paperRef.current === p.id) {
        setPaper(null);
        navigate("library");
      }
      setNotice(t("已从本地文库删除"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function copy(text: string, kind: "citation" | "agent", context: string) {
    try {
      await navigator.clipboard.writeText(text);
      const confirmation = { kind, context };
      setCopyState(confirmation);
      setTimeout(() => setCopyState(current => current === confirmation ? null : current), 1800);
    } catch {
      setError(t("无法访问剪贴板，请使用下载。"));
    }
  }
  const modelReady =
    settings.modelConfigured ??
    (settings.apiKeyConfigured ||
      /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?=[:/]|$)/.test(
        settings.baseUrl,
      ));
  const pdfSource = paper?.localPdfUrl || paper?.pdfUrl;
  const translations = showOriginal
    ? undefined
    : paper?.translations?.[language];
  const translationFor = (target: "abstract" | "summary" | "report") =>
    translations?.[target]?.stale ? undefined : translations?.[target];
  const agentQuestion = selectedPassage && !draft.verbatim
    ? `${prompt.trim() || t("请解释这段原文")}\n\n${selectedPassage.sourceLabel || t("选中的原文", "Selected passage")}${selectedPassage.page ? ` [${pageLabel(selectedPassage.page,selectedPassage.pages)}]` : ""}:\n${selectedPassage.text}`
    : prompt;
  const agentCopied = copyState?.kind === "agent" && copyState.context === JSON.stringify([paper?.id, conversationId, agentQuestion, language, locale]);
  const citationCopied = copyState?.kind === "citation" && copyState.context === paper?.id;
  async function prepareCurrentAgentQuestionTask() {
    const context = chatContext.current;
    if (!paper || context.paperId !== paper.id) throw new Error(t("论文仍在加载，请稍后重试。", "The paper is still loading. Try again shortly."));
    const currentDraft = readChatDraft(context.key);
    const result = await prepareAgentQuestionTask({
      origin: location.origin, paperId: paper.id, conversationId: context.conversationId,
      sessionKey: context, question: agentQuestion.trim() || t("这篇论文的核心贡献和证据边界是什么？", "What are the paper's main contributions and evidence limits?"),
      language, locale, omitConversationSelection: currentDraft.contextPolicy === "omit",
      metadata: currentDraft.passage ? passageMetadata(currentDraft.passage) : undefined,
    }, body => api<{conversationId:string}>("/chats/new", {method:"POST",body:JSON.stringify(body)}));
    if (chatContext.current !== context) throw new Error(t("已切换会话，请在当前会话重新复制任务。", "The conversation changed. Copy a task from the current conversation."));
    if (!context.conversationId) activateChat(context.paperId, result.conversationId, true);
    return result;
  }
  async function copyAgentQuestion() {
    setCopyingAgent(true);
    try {
      const result = await prepareCurrentAgentQuestionTask();
      await copy(result.task, "agent", JSON.stringify([paper?.id, result.conversationId, agentQuestion, language, locale]));
    }
    catch (reason) { setError((reason as Error).message); }
    finally { setCopyingAgent(false); }
  }
  const abstractText =
    translationFor("abstract")?.markdown ||
    paper?.abstract ||
    paper?.text?.slice(0, 1800) ||
    "";
  function overviewAnchors() {
    return Array.from(summaryRef.current?.querySelectorAll<HTMLElement>('h1, .abstract-text p, .reading-prose h2, .reading-prose h3, .reading-prose p, .reading-prose li, .reading-prose figure') || []).filter(element => element.getBoundingClientRect().height > 0);
  }
  function rememberOverview(force = false) {
    if (view !== "paper" || tab !== "summary" || !paper || overviewContext?.paperId !== paper.id || (restoringOverview.current && !force)) return;
    const elements = overviewAnchors();
    const index = elements.findIndex(element => element.getBoundingClientRect().bottom > 90);
    const element = index >= 0 ? elements[index] : undefined;
    const position: OverviewReadingPosition = {
      ...overviewContext,
      scrollY: Math.max(0, window.scrollY),
      expanded,
      anchor: element ? { index, hash: positionHash(element.textContent || ''), offset: element.getBoundingClientRect().top } : undefined,
    };
    overviewScroll.current = position.scrollY;
    saveOverviewPosition(paper.id, overviewContext.source, position);
  }
  useEffect(() => {
    if (view !== "paper" || !paper) return;
    saveReadingTab(paper.id, pdfDocumentKey(paper), tab);
    if (tab !== "summary") return;
    let frame = 0;
    const capture = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => rememberOverview()); };
    const flush = () => { rememberOverview(true); flushReadingPositions(); };
    window.addEventListener('scroll', capture, { passive: true });
    window.addEventListener('pagehide', flush);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', capture); window.removeEventListener('pagehide', flush); };
  }, [view, tab, paper?.id, overviewContext?.key, expanded]);
  useEffect(() => {
    const flush = () => flushReadingPositions();
    window.addEventListener('pagehide', flush);
    return () => { flush(); window.removeEventListener('pagehide', flush); };
  }, []);
  useLayoutEffect(() => {
    if (view !== 'paper' || tab !== 'summary' || !paper || overviewContext?.paperId !== paper.id || !summaryRef.current) return;
    const saved = readReadingPosition(paper.id, overviewContext.source)?.overviews.find(position => position.key === overviewContext.key);
    let frame = 0, stopped = false;
    restoringOverview.current = true;
    const restore = () => {
      if (stopped) return;
      const elements = overviewAnchors();
      const anchor = saved?.anchor;
      const element = anchor ? elements[anchor.index] : undefined;
      const top = element && anchor && positionHash(element.textContent || '') === anchor.hash
        ? window.scrollY + element.getBoundingClientRect().top - anchor.offset
        : saved?.scrollY || 0;
      window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
      overviewScroll.current = Math.max(0, top);
    };
    const stop = () => { stopped = true; restoringOverview.current = false; cancelAnimationFrame(frame); observer.disconnect(); rememberOverview(true); };
    const sectionNavigation = (event: Event) => {
      if ((event as CustomEvent<{paperId?:string}>).detail?.paperId === paper.id) stop();
    };
    const resize = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(restore); };
    const observer = new ResizeObserver(resize);
    restore(); observer.observe(summaryRef.current);
    const timeout = setTimeout(stop, 1200);
    for (const event of ['wheel', 'pointerdown', 'touchstart', 'keydown']) window.addEventListener(event, stop, { once: true, passive: true });
    window.addEventListener(READING_SECTION_EVENT, sectionNavigation);
    return () => {
      stopped = true; restoringOverview.current = false; clearTimeout(timeout); cancelAnimationFrame(frame); observer.disconnect();
      for (const event of ['wheel', 'pointerdown', 'touchstart', 'keydown']) window.removeEventListener(event, stop);
      window.removeEventListener(READING_SECTION_EVENT, sectionNavigation);
    };
  }, [view, tab, paper?.id, overviewContext?.key]);
  const summaryText =
    translationFor("summary")?.markdown || paper?.summary?.markdown || "";
  const reportText =
    translationFor("report")?.markdown || paper?.report?.markdown || "";
  function translationStatus(target: "abstract" | "summary" | "report") {
    if (showOriginal) return null;
    const sourceLanguage =
      target === "abstract"
        ? t("原文")
        : paper?.[target]?.language || t("原文");
    const sourceText = target === "abstract" ? paper?.abstract || "" : "";
    const inferredLanguage = sourceText ? (/[\u4e00-\u9fff]/.test(sourceText) ? "zh" : /[a-zA-Z]/.test(sourceText) ? "en" : "") : "";
    if (translationFor(target) || sourceLanguage === language || (inferredLanguage && language.startsWith(inferredLanguage))) return null;
    return (
      <p className="translation-missing">
        {translations?.[target]?.stale
          ? t("原文已更新，当前译文需要重新生成。")
          : t(`尚无 ${language} 译文，正在显示${sourceLanguage === t("原文") ? t("原文") : sourceLanguage + t(" 内容")}。`, `No ${language} translation yet; showing ${sourceLanguage}.`)}
        <button
          className="text-button"
          disabled={translating}
          onClick={() =>
            modelReady ? translate(target) : setShowSettings(true)
          }
        >
          {t("翻译此段")}
        </button>
      </p>
    );
  }
  useEffect(() => {
    const element = abstractRef.current;
    if (!element || expanded || tab !== "summary") return;
    const update = () => {
      if (element.clientWidth) setAbstractOverflow(element.scrollHeight > element.clientHeight + 1);
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    update();
    return () => observer.disconnect();
  }, [abstractText, expanded, view, tab]);
  useEffect(() => {
    if (assistant) {
      const timer = setTimeout(() => {
        // Reopening old messages is a reading action. A delayed composer focus
        // must also respect any control the user has already focused.
        if (document.activeElement?.closest(".assistant-panel") || readChatScroll(chatContext.current.key)?.following === false) return;
        composerRef.current?.focus({ preventScroll: true });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [assistant]);
  const selectionSessionPending = useRef(false);
  async function askSelection(selection: {
    text: string;
    page?: number;
    pages?: number[];
    sourceScope?: DraftPassage['sourceScope'];
    readingId?: string;
    sourceLabel?: string;
    intent?: "ask" | "explain" | "translate";
    question?: string;
  }): Promise<boolean> {
    if (conversationBusy || selectionSessionPending.current || !paper) return false;
    selectionSessionPending.current = true;
    const id = paper.id;
    const context = chatContext.current;
    setConversationBusy(true);
    setError("");
    try {
      const response = await api<{ conversationId: string }>("/chats/new", {
        method: "POST",
        body: JSON.stringify({
          paperId: id,
          kind: "question",
          metadata: passageMetadata({...selection,sourceScope:selection.sourceScope || (selection.page?'pdf':undefined)}),
        }),
      });
      if (chatContext.current !== context) return false;
      activateChat(id, response.conversationId);
      setChat([]);
      setShowHistory(false);
      setSelectedPassage({ text: selection.text, page: selection.page, pages: selection.pages, sourceLabel: selection.sourceLabel,sourceScope:selection.sourceScope || (selection.page?'pdf':undefined),readingId:selection.readingId });
      setPrompt(
        selection.question?.trim() ||
          t("关于这段原文，", "About this passage, "),
      );
      setNotebook(false);
      setAssistant(true);
      requestAnimationFrame(() =>
        composerRef.current?.focus({ preventScroll: true }),
      );
      return true;
    } catch (e) {
      if (chatContext.current === context) setError((e as Error).message);
      return false;
    } finally {
      selectionSessionPending.current = false;
      if (chatContext.current === context) setConversationBusy(false);
    }
  }
  const updateCurrentPaper = (updated: Paper) => {
    if (paperRef.current === updated.id) { paperMutation.current++; setPaper(updated); }
    setPapers(previous => previous.map(item => item.id === updated.id ? updated : item));
  };
  function openQuestionSource(metadata: Message['metadata']) {
    if (!paper || !metadata) return;
    if (metadata.sourceScope === 'reading' && metadata.readingId) {
      history.pushState({},'',readingSectionUrl(location.href,paper.id,metadata.readingId,0));
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      changePaperTab('summary');
      setAssistant(false);
    } else if (metadata.page) goToPage(metadata.page,(!metadata.pages || metadata.pages.length===1) && metadata.quote && metadata.quote.length<=500 ? metadata.quote : undefined);
    else { changePaperTab('summary');setAssistant(false);requestAnimationFrame(()=>summaryRef.current?.scrollTo({top:0})); }
  }

  const bib = paper
    ? `@misc{${paper.id.replace(/[^a-z0-9]/gi, "")},\n  title = {${paper.title}},\n  author = {${paper.authors.join(" and ")}},\n  year = {${new Date(paper.publishedAt || paper.createdAt).getFullYear()}},\n  url = {${paper.url}}\n}`
    : "";
  const navItems: [View, typeof Search, string][] = [
    ["discover", Search, t("搜索")],
    ["library", Library, t("文库")],
    ["saved", Bookmark, t("收藏")],
    ["research", Sparkles, t("研究助手")],
  ];
  const list =
    view === "saved"
      ? papers.filter((p) => p.favorite)
      : view === "discover" && results !== null
        ? results
        : papers;
  async function newConversation() {
    if (conversationBusy || chatting) return;
    setConversationBusy(true);
    const context = chatContext.current;
    try {
      const created = await api<{ conversationId: string }>("/chats/new", {
        method: "POST",
        body: JSON.stringify({ paperId: context.paperId }),
      });
      if (chatContext.current !== context) return;
      activateChat(context.paperId, created.conversationId);
      setChat([]);
      setShowHistory(false);
    } catch (e) {
      if (chatContext.current === context) setError((e as Error).message);
    } finally {
      if (chatContext.current === context) setConversationBusy(false);
    }
  }
  async function listConversations() {
    if (conversationBusy || chatting) return;
    setConversationBusy(true);
    const context = chatContext.current;
    try {
      const r = await api<{ conversations: Conversation[] }>(
        "/conversations" + (context.paperId ? "?paperId=" + encodeURIComponent(context.paperId) : ""),
      );
      if (chatContext.current !== context) return;
      setConversations(r.conversations.map(conversation => {
        const saved = readChatDraft(chatDraftKey(context.paperId, conversation.id));
        return { ...conversation, draft: !!(saved.text || saved.passage), title: conversation.messageCount ? conversation.title : saved.text || saved.passage?.text || conversation.title };
      }));
      if (context.paperId) {
        const result = await api<{ activities: Activity[] }>(`/papers/${context.paperId}/activities`);
        if (chatContext.current !== context) return;
        setActivities(result.activities || []);
      }
      setShowHistory(!showHistory);
    } catch (e) {
      if (chatContext.current === context) setError((e as Error).message);
    } finally {
      if (chatContext.current === context) setConversationBusy(false);
    }
  }
  async function selectConversation(id: string) {
    if (conversationBusy || chatting) return;
    setConversationBusy(true);
    const context = chatContext.current;
    try {
      const r = await api<{ messages: Message[] }>("/conversations/active", {
        method: "PUT",
        body: JSON.stringify({ paperId: context.paperId, conversationId: id }),
      });
      if (chatContext.current !== context) return;
      activateChat(context.paperId, id);
      setChat(r.messages);
      setShowHistory(false);
    } catch (e) {
      if (chatContext.current === context) setError((e as Error).message);
    } finally {
      if (chatContext.current === context) setConversationBusy(false);
    }
  }
  function goToPage(page: number, quote?: string) {
    const next = Math.max(1, Math.min(page, paper?.pageCount || page));
    if (tab === "summary") {
      rememberOverview(true);
      setOverviewReturn(true);
    }
    setPdfPage(next);
    setPdfNavigation({ page: next, nonce: ++navigationSequence.current, fromOverview: tab === "summary", quote });
    setPdfVisited(true);
    setTab("paper");
  }
  function assistantPanel(full = false) {
    return (
      <aside
        className={`assistant-panel ${full ? "full-assistant" : "assistant-docked"}`}
        aria-label={t("研究助手")}
      >
        <div className="assistant-header">
          <span>
            <Sparkles size={17} /> {t("研究助手")}
          </span>
          <div>
            <button
              className="icon-button"
              title={t("对话历史")}
              aria-label={t("对话历史")}
              disabled={chatting || conversationBusy}
              onClick={listConversations}
            >
              <History size={16} />
            </button>
            <button
              className="icon-button"
              title={t("新对话")}
              aria-label={t("新对话")}
              disabled={chatting || conversationBusy}
              onClick={newConversation}
            >
              <Plus size={17} />
            </button>
            {!full && (
              <button
                className="icon-button"
                aria-label={t("关闭助手")}
                onClick={() => setAssistant(false)}
              >
                <PanelRightClose size={17} />
              </button>
            )}
          </div>
        </div>
        <>
          {showHistory && (
            <ReadingHistory
              key={view === 'paper' ? paper?.id : 'research'}
              paper={view === "paper" ? paper : undefined}
              conversations={conversations}
              activities={activities}
              busy={conversationBusy || chatting}
              onClose={() => setShowHistory(false)}
              onConversation={selectConversation}
              onPage={(page,quote) => {
                goToPage(page,quote);
                setShowHistory(false);
                setAssistant(false);
              }}
              onOverview={() => {
                setTab("summary");
                setShowHistory(false);
                setAssistant(false);
              }}
              onVersion={(id) => {
                if (!paper) return;
                openQuestionSource({sourceScope:'reading', readingId:id});
                setShowHistory(false);
              }}
              onSaveActivity={async (activity) => {
                if (!activity.page || (activity.pages?.length || 0) > 1 || (activity.sourceScope && activity.sourceScope !== "pdf") || !usableActivityResult(activity.result)) return;
                await createAnnotation({
                  kind: activity.kind,
                  page: activity.page,
                  quote: activity.quote || activity.text,
                  body: activityResultText(activity.result),
                  color: "blue",
                });
              }}
            />
          )}
        </>
        <div className="conversation-frame">
        <div className="conversation" ref={chatScroll.ref} onScroll={chatScroll.onScroll} tabIndex={0} aria-label={t("对话消息", "Conversation messages")}>
          {chat.length === 0 ? (
            <div className="assistant-welcome">
              <div className="assistant-symbol">
                <Sparkles size={27} strokeWidth={1.2} />
              </div>
              <h2>
                {full ? (
                  <>
                    {t("让好问题，")}
                    <br />
                    {t("带你走得更远。")}
                  </>
                ) : (
                  <>
                    {t("理解、质疑，")}
                    <br />
                    {t("或在这篇论文的基础上探索。")}
                  </>
                )}
              </h2>
              <p>
                {full
                  ? t("连接你的模型，探索文库中的想法与证据。")
                  : t("从一个问题开始，找到值得深究的线索。")}
              </p>
              <div className="suggestion-grid">
                {suggestions().map((s, i) => (
                  <button key={s} onClick={() => ask(s)} disabled={chatting}>
                    <span>
                      {
                        [
                          <BookOpen size={16} />,
                          <FlaskConical size={16} />,
                          <Layers3 size={16} />,
                          <FileText size={16} />,
                        ][i]
                      }
                    </span>
                    {s}
                    <ArrowUpRight size={13} />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="messages">
              {chat.map((m, i) => (
                <div key={i} className={`message ${m.role}`} data-chat-anchor={chatScroll.anchors[i]}>
                  {m.role === "assistant" && (
                    <div className="message-label">
                      <Sparkles size={14} /> {t("研究助手")}
                    </div>
                  )}
                  {m.role === "user" && view === "paper" && (m.metadata?.page || m.metadata?.sourceScope === 'reading' || m.metadata?.sourceScope === 'abstract') && <button className="message-source-link citation-link" onClick={() => openQuestionSource(m.metadata)}>
                    <FileText size={12}/>{m.metadata?.sourceScope === 'reading' ? t('AI 解读选文 · 查看版本','AI overview selection · View version') : m.metadata?.sourceScope === 'abstract' ? t('摘要选文','Abstract selection') : `${t("提问选文", "Question source")} · ${pageLabel(m.metadata!.page,m.metadata!.pages)}`}
                  </button>}
                  <Mark onPage={view === "paper" ? goToPage : undefined}>
                    {m.content}
                  </Mark>
                  <MessageActions message={m} paper={view === "paper" ? paper || undefined : undefined} question={chat.slice(0, i).reverse().find(item => item.role === "user")}
                    busy={chatting || conversationBusy} onBranch={(message, action) => void branchQuestion(message, action)}/>
                </div>
              ))}
              {chatting && (
                <div className="thinking">
                  <Loader2 size={16} className="spin" /> {t("正在阅读与思考…")}
                </div>
              )}
            </div>
          )}
        </div>
        {chatScroll.away && <button className={`chat-latest ${chatScroll.unread ? "has-unread" : ""}`} onClick={() => chatScroll.followLatest(undefined, true)} aria-label={chatScroll.unread ? t("有新消息，跳到最新消息", "New messages, jump to latest") : t("跳到最新消息", "Jump to latest messages")}>
          <ArrowDown size={14}/><span aria-live="polite" aria-atomic="true">{chatScroll.unread ? t("有新消息", "New messages") : t("回到最新消息", "Jump to latest")}</span>
        </button>}
        </div>
        <div className="composer-wrap">
          {!modelReady && (
            <button
              className="setup-hint"
              onClick={() => { setMobileNav(false); setShowSettings(true); }}
            >
              <Settings2 size={13} /> {paper && view === "paper"
                ? t("可用下方 Codex / Claude 订阅入口问答，也可在此连接 API。", "Use Codex / Claude below, or connect an API here.")
                : t("配置模型 API，开启完整问答")}{" "}<ChevronRight size={13} />
            </button>
          )}
          {selectedPassage && (
            <div className="selected-passage">
              <div>
                {selectedPassage.page ? <button className="citation-link" onClick={() => goToPage(selectedPassage.page!)}>
                  {t("已选原文", "Selected passage")} · {pageLabel(selectedPassage.page,selectedPassage.pages)}
                </button> : selectedPassage.sourceScope === 'reading' ? <button className="citation-link" onClick={()=>openQuestionSource(passageMetadata(selectedPassage))}>{t('AI 解读选文 · 查看版本','AI overview selection · View version')}</button> : <span>{selectedPassage.sourceLabel || (selectedPassage.sourceScope === 'abstract' ? t('摘要选文','Abstract selection') : t("已选文本", "Selected text"))}</span>}
                <button
                  className="icon-button"
                  aria-label={t("移除选中原文")}
                  onClick={() => setSelectedPassage(null)}
                >
                  <X size={13} />
                </button>
              </div>
              <blockquote>{selectedPassage.text}</blockquote>
            </div>
          )}
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              ask();
            }}
          >
            <textarea
              aria-label={t("向研究助手提问")}
              ref={composerRef}
              placeholder={
                full ? t("问一个研究问题…") : t("询问有关这篇论文的问题…")
              }
              value={prompt}
              disabled={conversationBusy}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  ask();
                }
              }}
            />
            <div className="composer-bottom">
              <button
                type="button"
                className="icon-button"
                aria-label={t("上传论文到助手")}
                onClick={() => fileRef.current?.click()}
                disabled={importing || chatting}
              >
                <Plus size={19} />
              </button>
              {(modelReady || view !== "paper") && <ModelSelect
                settings={settings}
                onChange={setSettings}
                disabled={chatting || reporting || translating}
              />}
              {paper && view === "paper" && (
                <button
                  type="button"
                  className="icon-button subscription-chat"
                  aria-label={agentCopied ? t("任务已复制 · 在代理会话中粘贴") : t("用 Codex / Claude 订阅回答 · 复制任务")}
                  title={agentCopied ? t("任务已复制 · 在代理会话中粘贴") : t("用 Codex / Claude 订阅回答 · 复制任务")}
                  disabled={copyingAgent || conversationBusy}
                  onClick={() => void copyAgentQuestion()}
                >
                  {copyingAgent ? <Loader2 size={17} className="spin"/> : agentCopied ? <Check size={17} /> : <Code2 size={17} />}
                  {!modelReady && <span>Codex / Claude</span>}
                </button>
              )}
              <button
                type="button"
                className="icon-button"
                aria-label={t("管理模型连接")}
                title={`${t("管理模型连接")} · ${modelReady ? t("AI 回答可能有误，请核对原文证据。") : t("未连接模型 · 当前仅提供原文摘录")}`}
                onClick={() => { setMobileNav(false); setShowSettings(true); }}
              >
                <Settings2 size={14} />
              </button>
              <button
                className="send-button"
                aria-label={t("发送问题")}
                disabled={!prompt.trim() || chatting || conversationBusy}
              >
                {chatting ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  <ArrowUp size={18} />
                )}
              </button>
            </div>
          </form>
        </div>
      </aside>
    );
  }
  function companionToggle() {
    const open = assistant || notebook;
    return <div className="companion-actions">
      <button className={`companion-note-toggle ${notebook ? "is-open" : ""}`}
        aria-label={notebook ? t("收起笔记", "Collapse notebook") : t("打开笔记", "Open notebook")}
        title={notebook ? t("收起笔记", "Collapse notebook") : t("打开笔记", "Open notebook")} aria-expanded={notebook}
        onClick={()=>{ setNotebook(!notebook); setAssistant(false); setMobileNav(false); }}><NotebookPen size={20}/></button>
      <button className={`assistant-bubble ${assistant ? "is-open" : ""}`}
        aria-label={assistant ? t("收起悬浮助手") : t("打开悬浮助手")}
        title={assistant ? t("收起助手", "Collapse assistant") : t("问论文")}
        aria-expanded={assistant} aria-controls={open ? "paper-companion" : undefined}
        onClick={() => { setAssistant(!assistant); setNotebook(false); setMobileNav(false); }}>
        <MessageSquare size={23}/><span>{t("问论文")}</span>
      </button>
    </div>;
  }
  return (
    <div
      className={`app-shell ${view !== "paper" ? "expanded-navigation" : ""} ${view === "paper" && (assistant || notebook) ? "has-assistant-dock" : ""}`}
      style={{ "--assistant-width": `${dockWidth}px` } as CSSProperties}
    >
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => upload(e.target.files?.[0])}
      />
      <button
        className="mobile-menu icon-button"
        aria-label={t("展开导航")}
        onClick={() => setMobileNav(!mobileNav)}
      >
        <Menu />
      </button>
      <nav
        className={`rail ${mobileNav ? "mobile-open" : ""}`}
        aria-label={t("主导航")}
      >
        <button
          className="brand"
          aria-label={t("Paper Workbench 首页")}
          onClick={() => navigate("discover")}
        >
          p<span>·</span>
        </button>
        <div className="rail-main">
          {navItems.map(([id, Icon, label]) => (
            <button
              key={id}
              className={`rail-item ${view === id ? "active" : ""}`}
              onClick={() => navigate(id)}
              title={label}
              aria-label={label}
            >
              <Icon size={21} strokeWidth={1.6} />
              <span>{id === "research" && locale === "en" ? "Research" : label}</span>
            </button>
          ))}
          <div className="rail-divider" />
          <button
            className="rail-item"
            onClick={() => {
              setError("");
              setShowImport(true);
              setMobileNav(false);
            }}
            title={t("导入论文")}
          >
            <FilePlus2 size={21} strokeWidth={1.6} />
            <span>{t("导入")}</span>
          </button>
        </div>
        <div className="rail-bottom">
          <button className="rail-item" aria-label={t("切换为英文", "Switch to Chinese")} title={t("切换为英文", "Switch to Chinese")} onClick={() => setLocale(locale === "zh" ? "en" : "zh")}>
            <Languages size={20} strokeWidth={1.6} /><span>{locale === "zh" ? "English" : "中文"}</span>
          </button>
          <button
            className="rail-item"
            title={t("模型设置")}
            onClick={() => { setMobileNav(false); setShowSettings(true); }}
          >
            <Settings2 size={20} strokeWidth={1.6} />
            <span>{t("模型")}</span>
          </button>
          <button
            className="icon-button theme-toggle"
            aria-label={
              theme === "light" ? t("切换深色主题") : t("切换浅色主题")
            }
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          >
            {theme === "light" ? <Moon size={19} /> : <Sun size={19} />}
          </button>
          <div className="local-avatar" title={t("本地工作区")}>
            <span />
          </div>
        </div>
      </nav>
      <main
        className={`workspace ${view === "paper" ? "paper-workspace" : ""} ${view === "paper" && (assistant || notebook) ? "has-docked-assistant" : ""} ${tab === "paper" ? "continuous-reading" : ""}`}
      >
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button
              className="icon-button"
              aria-label={t("关闭错误提示")}
              onClick={() => setError("")}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {view === "paper" && paper ? (
          <>
            <header className="paper-toolbar">
              <button
                className="back-button"
                onClick={() => navigate("library")}
              >
                <ChevronLeft size={15} /> {t("文库")}
              </button>
              <div className="segmented" role="tablist">
                <button
                  role="tab"
                  aria-selected={tab === "summary"}
                  className={tab === "summary" ? "selected" : ""}
                  onClick={() => changePaperTab("summary")}
                >
                  <Sparkles size={14} /> {t("摘要")}
                </button>
                <button
                  role="tab"
                  aria-selected={tab === "paper"}
                  className={tab === "paper" ? "selected" : ""}
                  onClick={() => changePaperTab("paper")}
                >
                  <FileText size={14} /> {t("论文")}
                </button>
              </div>
              <button
                className={`toolbar-notebook ${notebook ? "is-open" : ""}`}
                aria-label={t("笔记与批注", "Notes & annotations")}
                title={t("笔记与批注", "Notes & annotations")}
                onClick={() => {
                  setNotebook(!notebook);
                  setAssistant(false);
                }}
              >
                <NotebookPen size={17} />
                <span>{t("笔记", "Notes")}</span>
                <small>{annotations.length || ""}</small>
              </button>
              <button
                className={`toolbar-assistant ${assistant ? "is-open" : ""}`}
                onClick={() => {
                  setAssistant(!assistant);
                  setNotebook(false);
                }}
                title={t("切换助手")}
              >
                <MessageSquare size={17} />
                <span>{t("助手")}</span>
              </button>
            </header>
            <div
              className={`paper-layout ${tab === "paper" ? "reader-wide" : ""}`}
            >
              <article ref={summaryRef} className="paper-content paper-summary" hidden={tab !== "summary"} key={`summary-${paper.id}`}>
                    <div className="paper-date">
                      <span>{date(paper.publishedAt || paper.createdAt)}</span>
                      <span className="language-label">
                        {paper.source === "pdf" ? "PDF" : t("论文")}{" "}
                        {t("· 本地文库")}
                      </span>
                    </div>
                    <h1>{paper.title}</h1>
                    <div className="author-list">
                      {paper.authors.length ? (
                        paper.authors.map((a) => <span key={a}>{a}</span>)
                      ) : (
                        <span>{t("本地导入文献")}</span>
                      )}
                    </div>
                    <div className="tag-list">
                      {paper.tags?.slice(0, 4).map((t) => (
                        <span key={t}>{t}</span>
                      ))}
                    </div>
                    <>
                      {paper.metadataOnly && (
                        <div className="coverage-warning">
                          <FileText size={14} />
                          <span>
                            {t(
                              "仅获取到摘要与元数据，未获取全文。报告和问答将明确标注这一限制。",
                            )}
                          </span>
                        </div>
                      )}
                    </>
                    <ReadingTools
                      key={paper.id}
                      paper={paper}
                      language={language}
                      onLanguage={setLanguage}
                      original={showOriginal}
                      onOriginal={setShowOriginal}
                      translating={translating}
                      onTranslate={translate}
                      onUpdated={updateCurrentPaper}
                      onError={setError}
                      onSettings={() => setShowSettings(true)}
                      modelReady={!!modelReady}
                      question={agentQuestion}
                      conversationId={conversationId}
                      onPrepareQuestionTask={prepareCurrentAgentQuestionTask}
                    />
                    <section className="abstract-section">
                      <h2>
                        {paper.abstractIsExcerpt ? t("首页摘录", "Opening excerpt") : t("原始摘要")}{" "}
                        <span>
                          {translationFor("abstract")
                            ? `译文 · ${language}`
                            : paper.abstractIsExcerpt ? t("原文摘录", "Source excerpt") : t("Abstract · 原文")}
                        </span>
                      </h2>
                      {paper.abstractIsExcerpt && <p className="abstract-excerpt-notice">{t("未识别出独立摘要，以下显示论文开头的原文摘录。", "A separate abstract was not identified. This is an excerpt from the beginning of the source.")}</p>}
                      {translationStatus("abstract")}
                      <div
                        ref={abstractRef}
                        className={`abstract-text ${expanded ? "expanded" : ""}`}
                      >
                        <SelectionTools active={tab === "summary"} paperId={paper.id} scope="abstract" sourceLabel={paper.abstractIsExcerpt ? t("首页摘录选文", "Opening excerpt selection") : undefined} language={language} model={settings.model} modelReady={!!modelReady} onAsk={(text, sourceLabel, question,source)=>askSelection({text,sourceLabel,question,...source})}>
                          <Mark>{abstractText.replace(/\\emph\{([^}]+)\}/g, "*$1*")}</Mark>
                        </SelectionTools>
                      </div>
                      {(abstractOverflow || expanded) && (
                        <button
                          className="expand-abstract"
                          onClick={() => setExpanded(!expanded)}
                        >
                          {expanded ? t("收起摘要") : t("展开摘要")}
                          <ChevronDown
                            size={13}
                            className={expanded ? "rotate" : ""}
                          />
                        </button>
                      )}
                    </section>
                    <div className="paper-actions">
                      <button
                        className="primary-button"
                        onClick={() => changePaperTab("paper")}
                      >
                        <BookOpen size={15} /> {t("阅读论文")}
                      </button>
                      {paper.url && (
                        <a
                          className="soft-button"
                          href={paper.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink size={14} /> {t("原文")}
                        </a>
                      )}
                      <div className="action-spacer" />
                      <button
                        className={`icon-button ${paper.favorite ? "bookmarked" : ""}`}
                        aria-label={
                          paper.favorite ? t("取消收藏") : t("收藏论文")
                        }
                        onClick={() => favorite(paper)}
                      >
                        <Bookmark
                          size={17}
                          fill={paper.favorite ? "currentColor" : "none"}
                        />
                      </button>
                      <button
                        className="soft-button"
                        onClick={() => setShowCite(true)}
                      >
                        <span className="quote-icon">“</span> {t("引用")}
                      </button>
                    </div>
                    <ReadingOverview
                      active={tab === "summary"}
                      key={paper.id}
                      paper={paper}
                      language={language}
                      original={showOriginal}
                      initialPresentation={initialPresentation}
                      positionContext={positionHash(JSON.stringify([abstractText, expanded]))}
                      onReadingContextChange={context => {
                        const key = positionHash(JSON.stringify([context.key, abstractText, expanded]));
                        setOverviewContext(previous => previous?.paperId === paper.id && previous.key === key ? previous : { ...context, key, paperId: paper.id, source: pdfDocumentKey(paper) });
                      }}
                      settings={settings}
                      onSettings={setSettings}
                      onConfigure={() => setShowSettings(true)}
                      onUpdated={updateCurrentPaper}
                      onPage={goToPage}
                      onError={setError}
                      onBusy={setReporting}
                      onAskSelection={(text,sourceLabel,question,source)=>askSelection({text,sourceLabel,question,...source})}
                    />
                    <section className="source-section">
                      <div>
                        <Link2 size={15} />
                        <span>{t("来源与证据")}</span>
                      </div>
                      <p>
                        {paper.pageCount
                          ? t(`已解析 ${paper.pageCount} 页 PDF`, `${paper.pageCount} PDF pages extracted`)
                          : t("已导入可提取的正文")}{" "}
                        {t("· 保存在本地工作区")}
                      </p>
                      {paper.url && (
                        <a href={paper.url} target="_blank" rel="noreferrer">
                          {paper.url}
                          <ArrowUpRight size={13} />
                        </a>
                      )}
                    </section>
              </article>
              <article className="paper-content reader-content" hidden={tab !== "paper"} key={`pdf-${paper.id}`}>
                {pdfVisited && <>
                    {pdfSource ? (
                      <Suspense
                        fallback={
                          <div className="loading-state">
                            <Loader2 className="spin" />
                            <p>{t("正在加载论文阅读器…")}</p>
                          </div>
                        }
                      >
                        <PdfReader
                          url={pdfSource}
                          paperId={paper.id}
                          modelReady={!!modelReady}
                          page={pdfPage}
                          initialPosition={initialPdfPosition}
                          onPositionChange={position => savePdfPosition(paper.id, pdfDocumentKey(paper), position)}
                          active={tab === "paper"}
                          navigation={pdfNavigation}
                          onPage={setPdfPage}
                          onReturnToOverview={overviewReturn ? () => { changePaperTab("summary"); setOverviewReturn(false); } : undefined}
                          onAskSelection={askSelection}
                          annotations={annotations}
                          onCreateAnnotation={createAnnotation}
                          onSelectAnnotation={(id, page) => {
                            const entry = annotations.find((a) => a.id === id);
                            if (entry) selectAnnotation(entry, page);
                            setNotebook(true);
                            setAssistant(false);
                          }}
                          onInlineAssist={inlineAssist}
                          language={language}
                          annotationFocus={annotationFocus}
                        />
                      </Suspense>
                    ) : (
                      <div className="text-reader">
                        <div className="reader-note">
                          <FileText size={16} />{" "}
                          {t("正文阅读 · 此来源没有可用的 PDF 文件")}
                        </div>
                        <h1>{paper.title}</h1>
                        <div>{paper.text || paper.abstract}</div>
                      </div>
                    )}
                    <div className="reader-fallback">
                      {t("PDF 无法显示时，可")}{" "}
                      <a
                        href={pdfSource || paper.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t("打开原始文件")} <ArrowUpRight size={12} />
                      </a>{" "}
                      {t("或")}{" "}
                      <button
                        onClick={() =>
                          download(
                            paper.text,
                            `${paper.title.slice(0, 80)}.txt`,
                            "text/plain",
                          )
                        }
                      >
                        {t("下载提取正文")}
                      </button>
                      。
                    </div>
                  </>}
              </article>
              {assistant || notebook ? (
                <AssistantDock
                  controls={companionToggle()}
                  width={dockWidth}
                  onWidthChange={setDockWidth}
                  onClose={() => {
                    setAssistant(false);
                    setNotebook(false);
                  }}
                >
                  {notebook ? (
                    <NotebookPanel
                      key={paper.id}
                      paperId={paper.id}
                      annotations={annotations}
                      selectedId={selectedAnnotationId}
                      selectionNonce={annotationFocus?.nonce}
                      page={pdfPage}
                      loading={annotationsLoading}
                      onClose={() => setNotebook(false)}
                      onSelect={(entry, locate = true, page) => { if (locate) selectAnnotation(entry, page); else setSelectedAnnotationId(entry.id || undefined); }}
                      onCreate={createAnnotation}
                      onUpdate={(id, patch) => mutateAnnotation(id, patch)}
                      onDelete={(id) => mutateAnnotation(id, undefined, true)}
                      onRestore={(id) =>
                        mutateAnnotation(id, undefined, false, true)
                      }
                    />
                  ) : (
                    assistantPanel()
                  )}
                </AssistantDock>
              ) : tab !== "paper" ? (
                <aside className="paper-details">
                  <div className="detail-heading">
                    <FlaskConical size={17} /> {t("研究工作区")}
                  </div>
                  <p>{t("沿着论文中的证据，探索下一个问题。")}</p>
                  <button
                    className="primary-button"
                    onClick={() => setAssistant(true)}
                  >
                    <Sparkles size={14} /> {t("打开助手")}
                  </button>
                  <hr />
                  <div className="detail-line">
                    <span>{t("来源")}</span>
                    <b>{paper.source}</b>
                  </div>
                  <div className="detail-line">
                    <span>{t("阅读状态")}</span>
                    <b>{t("已保存")}</b>
                  </div>
                  <hr />
                  <div className="detail-heading">
                    BibTeX
                    <button
                      className="icon-button"
                      aria-label={t("复制引用")}
                      onClick={() => copy(bib, "citation", paper?.id || "")}
                    >
                      <Copy size={14} />
                    </button>
                  </div>
                  <pre>{bib}</pre>
                  <button
                    className="text-button danger"
                    onClick={() => remove(paper)}
                  >
                    <Trash2 size={14} /> {t("删除论文")}
                  </button>
                </aside>
              ) : null}
            </div>
          </>
        ) : view === "research" ? (
          <div className="research-page">
            <header className="page-header">
              <div className="breadcrumb">
                <Sparkles size={16} /> {t("研究助手")}
              </div>
              <span className="local-badge">
                <span /> {t("本地工作区")}
              </span>
            </header>
            {assistantPanel(true)}
          </div>
        ) : (
          <>
            <header className="page-header">
              <div className="breadcrumb">
                {view === "discover" ? (
                  <Search size={16} />
                ) : view === "saved" ? (
                  <Bookmark size={16} />
                ) : (
                  <Library size={16} />
                )}{" "}
                {view === "discover"
                  ? t("探索")
                  : view === "saved"
                    ? t("收藏")
                    : t("我的文库")}
              </div>
              <div className="header-actions">
                <span className="local-badge">
                  <span /> {t("本地工作区")}
                </span>
                <button
                  className="soft-button"
                  onClick={() => setShowImport(true)}
                >
                  <Plus size={15} /> {t("导入论文")}
                </button>
              </div>
            </header>
            <div
              className={`library-page ${view === "discover" ? "discovery-page" : ""}`}
            >
              {view === "discover" ? (
                <section className="discovery-hero">
                  <h1>{t("追踪最新研究")}</h1>
                  <p>{t("探索值得阅读的论文，发现下一个研究方向。")}</p>
                  <div className="discovery-prompts">
                    {[
                      t("最近有哪些值得读的论文？"),
                      t("谁在研究这个方向？"),
                      t("帮我整理有据可查的综述"),
                    ].map((s, i) => (
                      <button
                        key={s}
                        onClick={() => {
                          navigate("research");
                          setPrompt(s);
                        }}
                      >
                        {
                          [
                            <BookOpen size={17} />,
                            <Globe2 size={17} />,
                            <Layers3 size={17} />,
                          ][i]
                        }
                        <span>{s}</span>
                        <ArrowUpRight size={13} />
                      </button>
                    ))}
                  </div>
                  <form
                    className="search-box"
                    onSubmit={(e) => {
                      e.preventDefault();
                      /^https?:\/\//i.test(query.trim())
                        ? importUrl(query)
                        : search();
                    }}
                  >
                    <Search size={21} />
                    <input
                      aria-label={t("搜索论文或粘贴网址")}
                      placeholder={t("搜索论文，或粘贴 arXiv / 论文网址…")}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <button
                      type="submit"
                      aria-label={t("搜索")}
                      disabled={searching || importing}
                    >
                      {searching || importing ? (
                        <Loader2 size={19} className="spin" />
                      ) : (
                        <ArrowUp size={20} />
                      )}
                    </button>
                  </form>
                  <div className="search-options">
                    <div className="search-sources">
                      {[
                        ["all", t("全部来源")],
                        ["arxiv", "arXiv"],
                        ["local", t("本地文库")],
                      ].map(([s, label]) => (
                        <button
                          key={s}
                          className={searchSource === s ? "selected" : ""}
                          onClick={() => {
                            setSearchSource(s);
                            if (results !== null) search(query, s);
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <button
                      className="text-button"
                      onClick={() => fileRef.current?.click()}
                      disabled={importing}
                    >
                      <Upload size={13} /> {t("上传 PDF")}
                    </button>
                  </div>
                  {results === null && (
                    <div className="topic-chips">
                      {welcomeQueries.map((q) => (
                        <button key={q} onClick={() => search(q)}>
                          {q}
                          <ArrowUpRight size={12} />
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              ) : (
                <div className="library-heading">
                  <div>
                    <span className="eyebrow">YOUR RESEARCH, TOGETHER</span>
                    <h1>
                      {view === "saved" ? t("值得再次阅读。") : t("我的文库")}
                    </h1>
                    <p>
                      {view === "saved"
                        ? t("收藏重要的论文，让想法随时可及。")
                        : t("你的论文、阅读记录与研究报告，都在这里。")}
                    </p>
                  </div>
                  <button
                    className="primary-button"
                    onClick={() => setShowImport(true)}
                  >
                    <Plus size={16} /> {t("导入论文")}
                  </button>
                </div>
              )}
              <section className="papers-section">
                <div className="section-heading">
                  <h2>
                    {view === "discover" && results !== null
                      ? t("搜索结果")
                      : view === "saved"
                        ? t("已收藏")
                        : t("最近阅读")}
                    <span className="count">{list.length}</span>
                  </h2>
                  {view === "discover" && results !== null ? (
                    <button
                      className="text-button"
                      onClick={() => {
                        setResults(null);
                        setQuery("");
                      }}
                    >
                      {t("清除搜索")}
                      <X size={13} />
                    </button>
                  ) : (
                    <span className="muted-label">
                      <History size={13} /> {t("按添加时间")}
                    </span>
                  )}
                </div>
                {searching ? (
                  <div className="loading-state">
                    <Loader2 className="spin" size={25} />
                    <p>{t("正在搜索研究文献…")}</p>
                  </div>
                ) : list.length ? (
                  <div className="paper-list">
                    {list.map((p, i) => (
                      <article className="paper-card" key={p.id || i}>
                        <div
                          className="paper-card-main"
                          role="button"
                          tabIndex={0}
                          onClick={() =>
                            view === "discover" && results !== null
                              ? selectResult(p)
                              : openPaper(p)
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter")
                              view === "discover" && results !== null
                                ? selectResult(p)
                                : openPaper(p);
                          }}
                        >
                          <div className="card-meta">
                            <span>
                              {p.source === "pdf"
                                ? "PDF"
                                : p.source === "arxiv"
                                  ? "arXiv"
                                  : t("论文")}
                            </span>
                            <span>·</span>
                            {date(p.publishedAt || p.createdAt)}
                          </div>
                          <h3>{p.title}</h3>
                          <div className="card-authors">
                            {p.authors?.join(" · ") || t("本地导入文献")}
                          </div>
                          <PaperCardExcerpt paper={p} language={language} />
                          <div className="card-tags">
                            {p.tags?.slice(0, 3).map((t) => (
                              <span key={t}>{t}</span>
                            ))}
                            {p.report && (
                              <span className="report-tag">
                                <Sparkles size={11} /> {t("已生成报告")}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="card-side">
                          <div
                            className="paper-thumbnail"
                            onClick={() =>
                              view === "discover" && results !== null
                                ? selectResult(p)
                                : openPaper(p)
                            }
                            aria-hidden="true"
                          >
                            <div className="mini-title" />
                            {Array.from({ length: 9 }, (_, i) => (
                              <i
                                key={i}
                                style={{ width: `${70 + ((i * 13) % 25)}%` }}
                              />
                            ))}
                            <div className="mini-chart">
                              <span />
                              <span />
                              <span />
                              <span />
                              <span />
                            </div>
                            {Array.from({ length: 5 }, (_, i) => (
                              <i key={i} />
                            ))}
                          </div>
                          {papers.some((x) => x.id === p.id) && (
                            <button
                              className={`icon-button ${p.favorite ? "bookmarked" : ""}`}
                              aria-label={
                                p.favorite ? t("取消收藏") : t("收藏论文")
                              }
                              onClick={() => favorite(p)}
                            >
                              <Bookmark
                                size={16}
                                fill={p.favorite ? "currentColor" : "none"}
                              />
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <div className="empty-illustration">
                      <FileText size={37} strokeWidth={1} />
                      <span>
                        <Plus size={13} />
                      </span>
                    </div>
                    <h3>
                      {results !== null
                        ? t("还没有找到相关论文")
                        : view === "saved"
                          ? t("把值得记住的论文留在这里")
                          : t("你的下一篇好论文，在这里。")}
                    </h3>
                    <p>
                      {results !== null
                        ? t("换个关键词，或选择其他搜索来源再试一次。")
                        : view === "saved"
                          ? t("在论文页面点击收藏，即可加入这份阅读清单。")
                          : t("粘贴一个网址，或上传 PDF，开启你的研究工作区。")}
                    </p>
                    {results === null && view !== "saved" && (
                      <div>
                        <button
                          className="primary-button"
                          onClick={() => setShowImport(true)}
                        >
                          <Plus size={15} /> {t("导入第一篇论文")}
                        </button>
                        <button
                          className="text-button example-link"
                          disabled={importing}
                          onClick={() => importUrl(exampleUrl)}
                        >
                          {t("试读示例论文")} <ArrowUpRight size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </section>
              <footer className="workspace-footer">
                <span className="footer-brand">
                  p<span>·</span>
                </span>
                <span>Paper Workbench</span>
                <span className="footer-separator">/</span>
                <span>{t("为开放的研究而构建")}</span>
                <span className="footer-right">
                  {t("本地存储 · 自由选择模型")}
                </span>
              </footer>
            </div>
          </>
        )}
      </main>
      {view === "paper" && !assistant && !notebook && companionToggle()}
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      {showImport && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget && !importing)
              setShowImport(false);
          }}
        >
          <section
            className="modal import-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-title"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">ADD TO YOUR LIBRARY</span>
                <h2 id="import-title">{t("让一篇论文，成为起点。")}</h2>
              </div>
              <button
                className="icon-button"
                disabled={importing}
                aria-label={t("关闭导入")}
                onClick={() => setShowImport(false)}
              >
                <X size={19} />
              </button>
            </div>
            <p>{t("导入论文网址或 PDF，保存在你的本地文库。")}</p>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                importUrl();
              }}
            >
              <label htmlFor="paper-url">{t("论文网址")}</label>
              <div className="url-input">
                <Link2 size={17} />
                <input
                  id="paper-url"
                  autoFocus
                  type="url"
                  placeholder="https://arxiv.org/abs/…"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                />
              </div>
              <p className="field-hint">
                {t("支持 arXiv、alphaXiv、公开网页和 PDF 链接")}
              </p>
              <button
                className="primary-button wide"
                disabled={importing || !url.trim()}
              >
                {importing ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  <ArrowUpRight size={16} />
                )}{" "}
                {importing ? t("正在获取与解析…") : t("导入论文")}
              </button>
            </form>
            <div className="or-divider">
              <span />
              {t("或者")}
              <span />
            </div>
            <button
              className="upload-zone"
              disabled={importing}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (!importing) upload(e.dataTransfer.files[0]);
              }}
            >
              <Upload size={24} strokeWidth={1.3} />
              <b>{t("拖放 PDF 文件到这里")}</b>
              <span>{t("或点击选择文件 · 最大 25 MB · 文本型 PDF")}</span>
            </button>
            <div className="modal-footnote">
              <ShieldCheck size={13} />{" "}
              {t("文件保存在本机；生成 AI 内容时会将正文发送给你配置的模型。")}
            </div>
          </section>
        </div>
      )}
      {showSettings && (
        <SettingsDialog
          current={settings}
          onClose={() => setShowSettings(false)}
          onSaved={(s) => {
            setSettings(s);
            setNotice(t("模型配置已更新"));
          }}
        />
      )}
      {showCite && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCite(false);
          }}
        >
          <section
            className="modal cite-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cite-title"
          >
            <div className="modal-heading">
              <h2 id="cite-title">{t("引用这篇论文")}</h2>
              <button
                className="icon-button"
                aria-label={t("关闭引用")}
                onClick={() => setShowCite(false)}
              >
                <X size={18} />
              </button>
            </div>
            <pre>{bib}</pre>
            <button className="primary-button" onClick={() => copy(bib, "citation", paper?.id || "")}>
              {citationCopied ? <Check size={15} /> : <Copy size={15} />}{" "}
              {citationCopied ? t("已复制") : t("复制 BibTeX")}
            </button>
            <button
              className="soft-button"
              style={{ marginLeft: 8 }}
              onClick={() =>
                download(bib, "citation.bib", "application/x-bibtex")
              }
            >
              <Download size={15} /> {t("下载 BibTeX")}
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
