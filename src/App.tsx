import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ArrowUp,
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
import SelectionTools from "./SelectionTools";
import ReadingOverview from "./ReadingOverview";
import NotebookPanel from "./NotebookPanel";
import ReadingHistory from "./ReadingHistory";
import type { Annotation, AnnotationDraft } from "./reader-annotations";
import type { Activity } from "./types";
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
import ReadingTools, { ModelSelect } from "./ReadingTools";
const PdfFigure = lazy(() => import("./PdfFigure"));

type View = "discover" | "library" | "saved" | "research" | "paper";
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
  const [assistant, setAssistant] = useState(false);
  const [notebook, setNotebook] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [annotationsLoading, setAnnotationsLoading] = useState(false);
  const [annotationFocus, setAnnotationFocus] = useState<{
    id: string;
    nonce: number;
  }>();
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string>();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [dockWidth, setDockWidth] = useState(defaultAssistantWidth);
  const [selectedPassage, setSelectedPassage] = useState<{
    text: string;
    page?: number;
    sourceLabel?: string;
  } | null>(null);
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
  const [prompt, setPrompt] = useState("");
  const [chatting, setChatting] = useState(false);
  const [conversationBusy, setConversationBusy] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [copyState, setCopyState] = useState(false);
  const [showCite, setShowCite] = useState(false);
  const [pdfPage, setPdfPage] = useState(1);
  const [conversations, setConversations] = useState<
    { id: string; title: string; messageCount: number }[]
  >([]);
  const [showHistory, setShowHistory] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const paperRef = useRef<string | undefined>(undefined);
  const searchToken = useRef(0);
  const paperMutation = useRef(0);
  const annotationMutation = useRef(0);
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
  function selectAnnotation(entry: Annotation) {
    setSelectedAnnotationId(entry.id || undefined);
    if (entry.id) {
      setAnnotationFocus({ id: entry.id, nonce: Date.now() });
      goToPage(entry.page);
    }
  }
  async function inlineAssist(input: {
    text: string;
    page: number;
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
    });
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
      const revision = paperMutation.current, annotationRevision = annotationMutation.current;
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
        if (!disposed && paperRef.current === id && !chatting) {
          if (!conversationId && c.conversationId) setConversationId(c.conversationId);
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
    api<{ papers: Paper[] }>("/papers")
      .then((r) => setPapers(r.papers))
      .catch((e) => setError(e.message));
    api<Settings>("/settings")
      .then(setSettings)
      .catch((e) => setError(e.message));
    const id = new URLSearchParams(location.search).get("paper");
    if (id)
      api<{ paper: Paper }>(`/papers/${encodeURIComponent(id)}`)
        .then((r) => openPaper(r.paper))
        .catch((e) => setError(e.message));
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
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [chat, chatting, assistant, view]);
  async function refresh() {
    const r = await api<{ papers: Paper[] }>("/papers");
    setPapers(r.papers);
  }
  function navigate(v: View) {
    setView(v);
    setError("");
    setMobileNav(false);
    setResults(null);
    history.replaceState({}, "", location.pathname);
    if (v !== "paper") paperRef.current = undefined;
    if (v === "research") {
      setChat([]);
      setConversationId(undefined);
      setPrompt("");
      setSelectedPassage(null);
      setShowHistory(false);
      api<{ messages: Message[]; conversationId?: string }>("/chats")
        .then((r) => {
          if (paperRef.current === undefined) { setChat(r.messages); setConversationId(r.conversationId); }
        })
        .catch(() => {});
    }
  }
  async function openPaper(p: Paper) {
    paperRef.current = p.id;
    setPaper(p);
    setView("paper");
    setExpanded(false);
    setTab(new URLSearchParams(location.search).has("page") ? "paper" : "summary");
    setPrompt("");
    setShowHistory(false);
    setPdfPage(
      Math.max(
        1,
        Number(new URLSearchParams(location.search).get("page")) || 1,
      ),
    );
    setSelectedPassage(null);
    setActivities([]);
    setConversationId(undefined);
    setChat([]);
    setError("");
    history.replaceState({}, "", `?paper=${encodeURIComponent(p.id)}`);
    try {
      const [detail, r] = await Promise.all([
        api<{ paper: Paper }>(`/papers/${encodeURIComponent(p.id)}`),
        api<{ messages: Message[]; conversationId?: string }>(
          `/chats?paperId=${encodeURIComponent(p.id)}`,
        ),
      ]);
      if (paperRef.current === p.id) {
        setPaper(detail.paper);
        setChat(r.messages);
        setConversationId(r.conversationId);
      }
    } catch (e) {
      setError((e as Error).message);
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
  async function ask(text = prompt) {
    if (!text.trim() || chatting || conversationBusy) return;
    const id = view === "paper" ? paper?.id : undefined;
    const previous = chat;
    const passage = selectedPassage;
    const message = passage
      ? `${text.trim()}\n\n${passage.sourceLabel || t("选中的原文", "Selected passage")}${passage.page ? ` [p.${passage.page}]` : ""}:\n> ${passage.text.replace(/\n/g, "\n> ")}`
      : text.trim();
    setPrompt("");
    setSelectedPassage(null);
    setChat((xs) => [...xs, { role: "user", content: message }]);
    setChatting(true);
    setError("");
    try {
      const r = await api<{ message: Message }>("/chat", {
        method: "POST",
        body: JSON.stringify({
          paperId: id,
          conversationId,
          message,
          history: previous,
        }),
      });
      if (paperRef.current === id) setChat((xs) => [...xs, r.message]);
    } catch (e) {
      setError((e as Error).message);
      if (paperRef.current === id) {
        setChat(previous);
        setPrompt(text);
        setSelectedPassage(passage);
      }
    } finally {
      setChatting(false);
    }
  }
  async function remove(p: Paper) {
    if (!confirm(t(`从本地文库删除《${p.title}》及其解读、笔记和会话？`, `Delete “${p.title}” and its overviews, notes and conversations from your local library?`))) return;
    try {
      await api(`/papers/${p.id}`, { method: "DELETE" });
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
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState(true);
      setTimeout(() => setCopyState(false), 1800);
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
  const agentQuestion = selectedPassage
    ? `${prompt.trim() || t("请解释这段原文")}\n\n${selectedPassage.sourceLabel || t("选中的原文", "Selected passage")}${selectedPassage.page ? ` [p.${selectedPassage.page}]` : ""}:\n${selectedPassage.text}`
    : prompt;
  const abstractText =
    translationFor("abstract")?.markdown ||
    paper?.abstract ||
    paper?.text?.slice(0, 1800) ||
    "";
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
    if (!element || expanded) return;
    const update = () =>
      setAbstractOverflow(element.scrollHeight > element.clientHeight + 1);
    const observer = new ResizeObserver(update);
    observer.observe(element);
    update();
    return () => observer.disconnect();
  }, [abstractText, expanded, view, tab]);
  useEffect(() => {
    if (assistant) {
      const timer = setTimeout(
        () => composerRef.current?.focus({ preventScroll: true }),
        100,
      );
      return () => clearTimeout(timer);
    }
  }, [assistant]);
  async function askSelection(selection: {
    text: string;
    page?: number;
    sourceLabel?: string;
    intent?: "ask" | "explain" | "translate";
    question?: string;
  }) {
    if (chatting || conversationBusy || !paper) return;
    const id = paper.id;
    setConversationBusy(true);
    setError("");
    try {
      const response = await api<{ conversationId: string }>("/chats/new", {
        method: "POST",
        body: JSON.stringify({
          paperId: id,
          kind: "question",
          metadata: { quote: selection.text, page: selection.page },
        }),
      });
      if (paperRef.current !== id) return;
      setConversationId(response.conversationId);
      setChat([]);
      setShowHistory(false);
      setSelectedPassage({ text: selection.text, page: selection.page, sourceLabel: selection.sourceLabel });
      setPrompt(
        selection.question?.trim() ||
          t("关于这段原文，", "About this passage, "),
      );
      setNotebook(false);
      setAssistant(true);
      requestAnimationFrame(() =>
        composerRef.current?.focus({ preventScroll: true }),
      );
    } catch (e) {
      if (paperRef.current === id) setError((e as Error).message);
    } finally {
      setConversationBusy(false);
    }
  }
  const updateCurrentPaper = (updated: Paper) => {
    if (paperRef.current === updated.id) { paperMutation.current++; setPaper(updated); }
  };

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
    const context = view === "paper" ? paper?.id : undefined;
    try {
      const created = await api<{ conversationId: string }>("/chats/new", {
        method: "POST",
        body: JSON.stringify({
          paperId: view === "paper" ? paper?.id : undefined,
        }),
      });
      if (paperRef.current !== context) return;
      setConversationId(created.conversationId);
      setChat([]);
      setPrompt("");
      setSelectedPassage(null);
      setShowHistory(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConversationBusy(false);
    }
  }
  async function listConversations() {
    if (conversationBusy || chatting) return;
    setConversationBusy(true);
    const context = view === "paper" ? paper?.id : undefined;
    try {
      const r = await api<{
        conversations: { id: string; title: string; messageCount: number }[];
      }>(
        "/conversations" +
          (view === "paper" && paper
            ? "?paperId=" + encodeURIComponent(paper.id)
            : ""),
      );
      if (paperRef.current !== context) return;
      setConversations(r.conversations);
      if (context) {
        const result = await api<{ activities: Activity[] }>(
          `/papers/${context}/activities`,
        );
        if (paperRef.current !== context) return;
        setActivities(result.activities || []);
      }
      setShowHistory(!showHistory);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConversationBusy(false);
    }
  }
  async function selectConversation(id: string) {
    if (conversationBusy || chatting) return;
    setConversationBusy(true);
    const context = view === "paper" ? paper?.id : undefined;
    try {
      const r = await api<{ messages: Message[] }>("/conversations/active", {
        method: "PUT",
        body: JSON.stringify({
          paperId: view === "paper" ? paper?.id : undefined,
          conversationId: id,
        }),
      });
      if (paperRef.current !== context) return;
      setChat(r.messages);
      setConversationId(id);
      setPrompt("");
      setSelectedPassage(null);
      setShowHistory(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConversationBusy(false);
    }
  }
  function goToPage(page: number) {
    setPdfPage(Math.max(1, Math.min(page, paper?.pageCount || page)));
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
              paper={view === "paper" ? paper : undefined}
              conversations={conversations}
              activities={activities}
              busy={conversationBusy || chatting}
              onClose={() => setShowHistory(false)}
              onConversation={selectConversation}
              onPage={(page) => {
                goToPage(page);
                setShowHistory(false);
                setAssistant(false);
              }}
              onOverview={() => {
                setTab("summary");
                setShowHistory(false);
                setAssistant(false);
              }}
              onVersion={async (id) => {
                if (!paper) return;
                try {
                  const r = await api<{ paper: Paper }>(`/papers/${paper.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ activeReadingId: id }),
                  });
                  updateCurrentPaper(r.paper);
                  setTab("summary");
                  setShowHistory(false);
                  setAssistant(false);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
              onSaveActivity={async (activity) => {
                if (!activity.page || (activity.sourceScope && activity.sourceScope !== "pdf")) return;
                await createAnnotation({
                  kind: activity.kind,
                  page: activity.page,
                  quote: activity.quote || activity.text,
                  body:
                    typeof activity.result === "string"
                      ? activity.result
                      : activity.result?.text || "",
                  color: "blue",
                });
              }}
            />
          )}
        </>
        <div className="conversation">
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
                <div key={i} className={`message ${m.role}`}>
                  {m.role === "assistant" && (
                    <div className="message-label">
                      <Sparkles size={14} /> {t("研究助手")}
                    </div>
                  )}
                  <Mark onPage={view === "paper" ? goToPage : undefined}>
                    {m.content}
                  </Mark>
                </div>
              ))}
              {chatting && (
                <div className="thinking">
                  <Loader2 size={16} className="spin" /> {t("正在阅读与思考…")}
                </div>
              )}
              <div ref={chatEnd} />
            </div>
          )}
        </div>
        <div className="composer-wrap">
          {!modelReady && (
            <button
              className="setup-hint"
              onClick={() => { setMobileNav(false); setShowSettings(true); }}
            >
              <Settings2 size={13} /> {t("配置模型 API，开启完整问答")}{" "}
              <ChevronRight size={13} />
            </button>
          )}
          {selectedPassage && (
            <div className="selected-passage">
              <div>
                {selectedPassage.page ? <button className="citation-link" onClick={() => goToPage(selectedPassage.page!)}>
                  {t("已选原文 · p.")}{selectedPassage.page}
                </button> : <span>{selectedPassage.sourceLabel || t("已选文本", "Selected text")}</span>}
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
              <ModelSelect
                settings={settings}
                onChange={setSettings}
                disabled={chatting || reporting || translating}
              />
              {paper && view === "paper" && (
                <button
                  type="button"
                  className="icon-button subscription-chat"
                  aria-label={copyState ? t("任务已复制 · 在代理会话中粘贴") : t("用 Codex / Claude 订阅回答 · 复制任务")}
                  title={copyState ? t("任务已复制 · 在代理会话中粘贴") : t("用 Codex / Claude 订阅回答 · 复制任务")}
                  onClick={() =>
                    copy(
                      `在 Paper Workbench 项目中使用 skills/paper-workbench/SKILL.md。工作台 ${location.origin}，论文 ID ${paper.id}。读取 source 后，用当前已登录的代理会话回答：${agentQuestion.trim() || t("这篇论文的核心贡献和证据边界是什么？")}。用 ${language} 回答，附页码证据；不要调用工作台模型生成接口。通过 CLI answer 写回问题和答案，不覆盖对话历史。`,
                    )
                  }
                >
                  {copyState ? <Check size={17} /> : <Code2 size={17} />}
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
                  onClick={() => setTab("summary")}
                >
                  <Sparkles size={14} /> {t("摘要")}
                </button>
                <button
                  role="tab"
                  aria-selected={tab === "paper"}
                  className={tab === "paper" ? "selected" : ""}
                  onClick={() => setTab("paper")}
                >
                  <FileText size={14} /> {t("论文")}
                </button>
              </div>
              <button
                className={`toolbar-notebook ${notebook ? "is-open" : ""}`}
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
              <article
                className={`paper-content ${tab === "paper" ? "reader-content" : ""}`}
              >
                {tab === "summary" ? (
                  <>
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
                    />
                    <section className="abstract-section">
                      <h2>
                        {t("原始摘要")}{" "}
                        <span>
                          {translationFor("abstract")
                            ? `译文 · ${language}`
                            : t("Abstract · 原文")}
                        </span>
                      </h2>
                      {translationStatus("abstract")}
                      <div
                        ref={abstractRef}
                        className={`abstract-text ${expanded ? "expanded" : ""}`}
                      >
                        <SelectionTools paperId={paper.id} scope="abstract" language={language} model={settings.model} onAsk={(text, sourceLabel)=>void askSelection({text,sourceLabel})}>
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
                        onClick={() => setTab("paper")}
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
                      key={paper.id}
                      paper={paper}
                      language={language}
                      original={showOriginal}
                      settings={settings}
                      onSettings={setSettings}
                      onConfigure={() => setShowSettings(true)}
                      onUpdated={updateCurrentPaper}
                      onPage={goToPage}
                      onError={setError}
                      onBusy={setReporting}
                      onAskSelection={(text,sourceLabel)=>void askSelection({text,sourceLabel})}
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
                  </>
                ) : (
                  <>
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
                          page={pdfPage}
                          onPage={goToPage}
                          onAskSelection={askSelection}
                          annotations={annotations}
                          onCreateAnnotation={createAnnotation}
                          onSelectAnnotation={(id) => {
                            const entry = annotations.find((a) => a.id === id);
                            if (entry) selectAnnotation(entry);
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
                  </>
                )}
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
                      page={pdfPage}
                      loading={annotationsLoading}
                      onClose={() => setNotebook(false)}
                      onSelect={(entry, locate = true) => { if (locate) selectAnnotation(entry); else setSelectedAnnotationId(entry.id || undefined); }}
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
                      onClick={() => copy(bib)}
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
                          <p>{p.abstract || p.text?.slice(0, 300)}</p>
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
            <button className="primary-button" onClick={() => copy(bib)}>
              {copyState ? <Check size={15} /> : <Copy size={15} />}{" "}
              {copyState ? t("已复制") : t("复制 BibTeX")}
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
