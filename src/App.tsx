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
  Download,
  ExternalLink,
  FilePlus2,
  FileText,
  FlaskConical,
  Globe2,
  History,
  Layers3,
  Library,
  Link2,
  Loader2,
  Menu,
  MessageSquare,
  Moon,
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
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
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
const suggestions = [
  "这篇论文的核心贡献是什么？",
  "方法有哪些假设与局限？",
  "与已有方法相比有什么不同？",
  "帮我制定一个复现清单",
];
const welcomeQueries = [
  "Reinforcement learning",
  "Reasoning & inference",
  "Language models",
  "Computer vision",
];
const exampleUrl = "https://arxiv.org/abs/1706.03762";
function Mark({
  children,
  onPage,
  figures,
  pdfUrl,
}: {
  children: string;
  onPage?: (page: number) => void;
  figures?: Figure[];
  pdfUrl?: string;
}) {
  if (figures && pdfUrl && /^:::figure[ \t]+[\w-]+[ \t]*$/m.test(children)) {
    const parts = children.split(/^:::figure[ \t]+([\w-]+)[ \t]*$/m);
    return (
      <>
        {parts.map((part, i) => {
          if (i % 2 === 0)
            return (
              <Mark key={i} onPage={onPage}>
                {part}
              </Mark>
            );
          const figure = figures.find((f) => f.id === part);
          return figure ? (
            <Suspense key={i} fallback={<p>正在加载原文图表…</p>}>
              <PdfFigure
                url={pdfUrl}
                page={figure.page}
                crop={figure.crop}
                caption={figure.caption}
                onOpenPage={onPage}
              />
            </Suspense>
          ) : (
            <p key={i} className="muted-label">
              图表 {part} 尚未附上源页。
            </p>
          );
        })}
      </>
    );
  }
  const text = onPage
    ? children.replace(
        /\[p\.(\d+)(?:\s*[-–]\s*(?:p\.)?(\d+))?\]/g,
        (_match, first, last) =>
          `[p.${first}${last ? `–${last}` : ""}](#page=${first})`,
      )
    : children;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        img: ({ alt }) => (
          <span className="muted-label">
            [图片：{alt || "外部图片，未自动加载"}]
          </span>
        ),
        a: ({ children, href }) =>
          href?.startsWith("#page=") && onPage ? (
            <button
              className="citation-link"
              onClick={() => onPage(Number(href.split("=")[1]))}
            >
              {children}
            </button>
          ) : (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
function date(value?: string) {
  if (!value) return "本地论文";
  const d = new Date(value);
  return isNaN(d.getTime())
    ? "本地论文"
    : d.toLocaleDateString("zh-CN", {
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
  const [view, setView] = useState<View>("discover");
  const [papers, setPapers] = useState<Paper[]>([]);
  const [paper, setPaper] = useState<Paper | null>(null);
  const [tab, setTab] = useState<"summary" | "paper">("summary");
  const [assistant, setAssistant] = useState(false);
  const [dockWidth, setDockWidth] = useState(defaultAssistantWidth);
  const [selectedPassage, setSelectedPassage] = useState<{
    text: string;
    page: number;
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
  const [language, setLanguage] = useState(
    () => localStorage.getItem("pw-language") || "zh-CN",
  );
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
  // External agent results arrive through the same API; keep a visible paper live.
  useEffect(() => {
    if (view !== "paper" || !paper?.id || conversationBusy) return;
    const id = paper.id;
    let disposed = false,
      pending = false;
    const update = async () => {
      if (document.hidden || pending) return;
      pending = true;
      try {
        const r = await api<{ paper: Paper }>(
          `/papers/${encodeURIComponent(id)}`,
        );
        if (!disposed && paperRef.current === id)
          setPaper((old) =>
            JSON.stringify(old) === JSON.stringify(r.paper) ? old : r.paper,
          );
        const c = await api<{ messages: Message[] }>(
          `/chats?paperId=${encodeURIComponent(id)}`,
        );
        if (!disposed && paperRef.current === id && !chatting)
          setChat((old) =>
            JSON.stringify(old) === JSON.stringify(c.messages)
              ? old
              : c.messages,
          );
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
  }, [view, paper?.id, chatting, conversationBusy]);

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
      api<{ messages: Message[] }>("/chats")
        .then((r) => {
          if (paperRef.current === undefined) setChat(r.messages);
        })
        .catch(() => {});
    }
  }
  async function openPaper(p: Paper) {
    paperRef.current = p.id;
    setPaper(p);
    setView("paper");
    setExpanded(false);
    setTab("summary");
    setPdfPage(1);
    setSelectedPassage(null);
    setChat([]);
    setError("");
    history.replaceState({}, "", `?paper=${encodeURIComponent(p.id)}`);
    try {
      const [detail, r] = await Promise.all([
        api<{ paper: Paper }>(`/papers/${encodeURIComponent(p.id)}`),
        api<{ messages: Message[] }>(
          `/chats?paperId=${encodeURIComponent(p.id)}`,
        ),
      ]);
      if (paperRef.current === p.id) {
        setPaper(detail.paper);
        setChat(r.messages);
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
      setNotice("论文已加入你的文库");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImporting(false);
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("请选择 PDF 文件。");
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
      setNotice("PDF 已解析并加入文库");
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
      setNotice("报告已生成");
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
      setNotice("译文已保存，原文保持不变");
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
      ? `${text.trim()}\n\n选中的原文 [p.${passage.page}]：\n> ${passage.text.replace(/\n/g, "\n> ")}`
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
    if (!confirm(`从本地文库删除《${p.title}》及其报告？`)) return;
    try {
      await api(`/papers/${p.id}`, { method: "DELETE" });
      await refresh();
      if (paperRef.current === p.id) {
        setPaper(null);
        navigate("library");
      }
      setNotice("已从本地文库删除");
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
      setError("无法访问剪贴板，请使用下载。");
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
    ? `${prompt.trim() || "请解释这段原文"}\n\n选中的原文 [p.${selectedPassage.page}]：\n${selectedPassage.text}`
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
      target === "abstract" ? "原文" : paper?.[target]?.language || "原文";
    if (translationFor(target) || sourceLanguage === language) return null;
    return (
      <p className="translation-missing">
        {translations?.[target]?.stale
          ? "原文已更新，当前译文需要重新生成。"
          : `尚无 ${language} 译文，正在显示${sourceLanguage === "原文" ? "原文" : sourceLanguage + " 内容"}。`}
        <button
          className="text-button"
          disabled={translating}
          onClick={() =>
            modelReady ? translate(target) : setShowSettings(true)
          }
        >
          翻译此段
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
  function askSelection(selection: {
    text: string;
    page: number;
    intent?: "ask" | "explain" | "translate";
    question?: string;
  }) {
    setSelectedPassage({ text: selection.text, page: selection.page });
    setPrompt(
      selection.question?.trim() ||
        (selection.intent === "translate"
          ? `请将选中的原文翻译为 ${language}，保留数学符号和术语。`
          : selection.intent === "explain"
            ? "请用通俗语言解释这段内容，并说明它与论文核心结论的关系。"
            : "关于这段原文，"),
    );
    setAssistant(true);
    requestAnimationFrame(() =>
      composerRef.current?.focus({ preventScroll: true }),
    );
  }
  const updateCurrentPaper = (updated: Paper) => {
    if (paperRef.current === updated.id) setPaper(updated);
  };

  const bib = paper
    ? `@misc{${paper.id.replace(/[^a-z0-9]/gi, "")},\n  title = {${paper.title}},\n  author = {${paper.authors.join(" and ")}},\n  year = {${new Date(paper.publishedAt || paper.createdAt).getFullYear()}},\n  url = {${paper.url}}\n}`
    : "";
  const navItems: [View, typeof Search, string][] = [
    ["discover", Search, "搜索"],
    ["library", Library, "文库"],
    ["saved", Bookmark, "收藏"],
    ["research", Sparkles, "研究助手"],
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
      await api("/chats/new", {
        method: "POST",
        body: JSON.stringify({
          paperId: view === "paper" ? paper?.id : undefined,
        }),
      });
      if (paperRef.current !== context) return;
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
        aria-label="研究助手"
      >
        <div className="assistant-header">
          <span>
            <Sparkles size={17} /> 研究助手
          </span>
          <div>
            <button
              className="icon-button"
              title="对话历史"
              aria-label="对话历史"
              disabled={chatting || conversationBusy}
              onClick={listConversations}
            >
              <History size={16} />
            </button>
            <button
              className="icon-button"
              title="新对话"
              aria-label="新对话"
              disabled={chatting || conversationBusy}
              onClick={newConversation}
            >
              <Plus size={17} />
            </button>
            {!full && (
              <button
                className="icon-button"
                aria-label="关闭助手"
                onClick={() => setAssistant(false)}
              >
                <PanelRightClose size={17} />
              </button>
            )}
          </div>
        </div>
        <>
          {showHistory && (
            <div className="conversation-history">
              <div>
                对话历史
                <button
                  className="icon-button"
                  aria-label="关闭对话历史"
                  onClick={() => setShowHistory(false)}
                >
                  <X size={14} />
                </button>
              </div>
              {conversations.length ? (
                conversations.map((c) => (
                  <button
                    key={c.id}
                    disabled={conversationBusy || chatting}
                    onClick={() => selectConversation(c.id)}
                  >
                    <MessageSquare size={13} />
                    <span>{c.title}</span>
                    <small>{c.messageCount}</small>
                  </button>
                ))
              ) : (
                <p>还没有保存的对话。</p>
              )}
            </div>
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
                    让好问题，
                    <br />
                    带你走得更远。
                  </>
                ) : (
                  <>
                    理解、质疑，
                    <br />
                    或在这篇论文的基础上探索。
                  </>
                )}
              </h2>
              <p>
                {full
                  ? "连接你的模型，探索文库中的想法与证据。"
                  : "从一个问题开始，找到值得深究的线索。"}
              </p>
              <div className="suggestion-grid">
                {suggestions.map((s, i) => (
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
                      <Sparkles size={14} /> 研究助手
                    </div>
                  )}
                  <Mark onPage={view === "paper" ? goToPage : undefined}>
                    {m.content}
                  </Mark>
                </div>
              ))}
              {chatting && (
                <div className="thinking">
                  <Loader2 size={16} className="spin" /> 正在阅读与思考…
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
              onClick={() => setShowSettings(true)}
            >
              <Settings2 size={13} /> 配置模型 API，开启完整问答{" "}
              <ChevronRight size={13} />
            </button>
          )}
          {selectedPassage && (
            <div className="selected-passage">
              <div>
                <button
                  className="citation-link"
                  onClick={() => goToPage(selectedPassage.page)}
                >
                  已选原文 · p.{selectedPassage.page}
                </button>
                <button
                  className="icon-button"
                  aria-label="移除选中原文"
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
              aria-label="向研究助手提问"
              ref={composerRef}
              placeholder={full ? "问一个研究问题…" : "询问有关这篇论文的问题…"}
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
                aria-label="上传论文到助手"
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
              <button
                type="button"
                className="icon-button"
                aria-label="管理模型连接"
                onClick={() => setShowSettings(true)}
              >
                <Settings2 size={14} />
              </button>
              <button
                className="send-button"
                aria-label="发送问题"
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
          {paper && view === "paper" && (
            <button
              type="button"
              className="subscription-chat"
              onClick={() =>
                copy(
                  `在 Paper Workbench 项目中使用 skills/paper-workbench/SKILL.md。工作台 ${location.origin}，论文 ID ${paper.id}。读取 source 后，用当前已登录的代理会话回答：${agentQuestion.trim() || "这篇论文的核心贡献和证据边界是什么？"}。用 ${language} 回答，附页码证据；不要调用工作台模型生成接口。通过 CLI answer 写回问题和答案，不覆盖对话历史。`,
                )
              }
            >
              {copyState
                ? "任务已复制 · 在代理会话中粘贴"
                : "用 Codex / Claude 订阅回答 · 复制任务"}{" "}
              <ArrowUpRight size={11} />
            </button>
          )}
          <div className="composer-note">
            {modelReady
              ? "AI 回答可能有误，请核对原文证据。"
              : "未连接模型 · 当前仅提供原文摘录"}
          </div>
        </div>
      </aside>
    );
  }
  return (
    <div
      className={`app-shell ${view !== "paper" ? "expanded-navigation" : ""} ${view === "paper" && assistant ? "has-assistant-dock" : ""}`}
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
        aria-label="展开导航"
        onClick={() => setMobileNav(!mobileNav)}
      >
        <Menu />
      </button>
      <nav
        className={`rail ${mobileNav ? "mobile-open" : ""}`}
        aria-label="主导航"
      >
        <button
          className="brand"
          aria-label="Paper Workbench 首页"
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
            >
              <Icon size={21} strokeWidth={1.6} />
              <span>{label}</span>
            </button>
          ))}
          <div className="rail-divider" />
          <button
            className="rail-item"
            onClick={() => {
              setError("");
              setShowImport(true);
            }}
            title="导入论文"
          >
            <FilePlus2 size={21} strokeWidth={1.6} />
            <span>导入</span>
          </button>
        </div>
        <div className="rail-bottom">
          <button
            className="rail-item"
            title="模型设置"
            onClick={() => setShowSettings(true)}
          >
            <Settings2 size={20} strokeWidth={1.6} />
            <span>模型</span>
          </button>
          <button
            className="icon-button theme-toggle"
            aria-label={theme === "light" ? "切换深色主题" : "切换浅色主题"}
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          >
            {theme === "light" ? <Moon size={19} /> : <Sun size={19} />}
          </button>
          <div className="local-avatar" title="本地工作区">
            <span />
          </div>
        </div>
      </nav>
      <main
        className={`workspace ${view === "paper" ? "paper-workspace" : ""} ${view === "paper" && assistant ? "has-docked-assistant" : ""} ${tab === "paper" ? "continuous-reading" : ""}`}
      >
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button
              className="icon-button"
              aria-label="关闭错误提示"
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
                <ChevronLeft size={15} /> 文库
              </button>
              <div className="segmented" role="tablist">
                <button
                  role="tab"
                  aria-selected={tab === "summary"}
                  className={tab === "summary" ? "selected" : ""}
                  onClick={() => setTab("summary")}
                >
                  <Sparkles size={14} /> 摘要
                </button>
                <button
                  role="tab"
                  aria-selected={tab === "paper"}
                  className={tab === "paper" ? "selected" : ""}
                  onClick={() => setTab("paper")}
                >
                  <FileText size={14} /> 论文
                </button>
              </div>
              <button
                className={`toolbar-assistant ${assistant ? "is-open" : ""}`}
                onClick={() => setAssistant(!assistant)}
                title="切换助手"
              >
                <MessageSquare size={17} />
                <span>助手</span>
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
                        {paper.source === "pdf" ? "PDF" : "论文"} · 本地文库
                      </span>
                    </div>
                    <h1>{paper.title}</h1>
                    <div className="author-list">
                      {paper.authors.length ? (
                        paper.authors.map((a) => <span key={a}>{a}</span>)
                      ) : (
                        <span>本地导入文献</span>
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
                            仅获取到摘要与元数据，未获取全文。报告和问答将明确标注这一限制。
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
                        原始摘要{" "}
                        <span>
                          {translationFor("abstract")
                            ? `译文 · ${language}`
                            : "Abstract · 原文"}
                        </span>
                      </h2>
                      {translationStatus("abstract")}
                      <div
                        ref={abstractRef}
                        className={`abstract-text ${expanded ? "expanded" : ""}`}
                      >
                        <Mark>
                          {abstractText.replace(/\\emph\{([^}]+)\}/g, "*$1*")}
                        </Mark>
                      </div>
                      {(abstractOverflow || expanded) && (
                        <button
                          className="expand-abstract"
                          onClick={() => setExpanded(!expanded)}
                        >
                          {expanded ? "收起摘要" : "展开摘要"}
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
                        <BookOpen size={15} /> 阅读论文
                      </button>
                      {paper.url && (
                        <a
                          className="soft-button"
                          href={paper.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink size={14} /> 原文
                        </a>
                      )}
                      <div className="action-spacer" />
                      <button
                        className={`icon-button ${paper.favorite ? "bookmarked" : ""}`}
                        aria-label={paper.favorite ? "取消收藏" : "收藏论文"}
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
                        <span className="quote-icon">“</span> 引用
                      </button>
                    </div>
                    {paper.summary && (
                      <section className="insight-summary">
                        <div className="section-heading">
                          <h2>
                            <Sparkles size={19} /> 图文解读
                          </h2>
                          <span className="insight-origin">
                            {paper.summary.source?.agent || "AI"} ·{" "}
                            {translationFor("summary")
                              ? language
                              : paper.summary.language}
                          </span>
                        </div>
                        {translationStatus("summary")}
                        <div className="prose">
                          <Mark
                            onPage={goToPage}
                            figures={paper.figures}
                            pdfUrl={pdfSource}
                          >
                            {summaryText}
                          </Mark>
                        </div>
                      </section>
                    )}
                    {!!paper.figures?.filter(
                      (f) => !summaryText.includes(`:::figure ${f.id}`),
                    ).length &&
                      pdfSource && (
                        <section
                          className="summary-figures"
                          aria-label="论文图表"
                        >
                          <div className="section-heading">
                            <h2>论文图表</h2>
                            <span className="muted-label">
                              来自原始 PDF · 点击定位
                            </span>
                          </div>
                          <Suspense
                            fallback={
                              <p className="muted-label">正在加载论文图表…</p>
                            }
                          >
                            {paper.figures
                              .filter(
                                (f) =>
                                  !summaryText.includes(`:::figure ${f.id}`),
                              )
                              .slice(0, 1)
                              .map((f) => (
                                <PdfFigure
                                  key={f.id}
                                  url={pdfSource}
                                  page={f.page}
                                  crop={f.crop}
                                  caption={f.caption}
                                  onOpenPage={goToPage}
                                />
                              ))}
                            {paper.figures.filter(
                              (f) => !summaryText.includes(`:::figure ${f.id}`),
                            ).length > 1 && (
                              <details className="more-figures">
                                <summary>查看更多图表源页</summary>
                                {paper.figures
                                  .filter(
                                    (f) =>
                                      !summaryText.includes(
                                        `:::figure ${f.id}`,
                                      ),
                                  )
                                  .slice(1)
                                  .map((f) => (
                                    <PdfFigure
                                      key={f.id}
                                      url={pdfSource}
                                      page={f.page}
                                      crop={f.crop}
                                      caption={f.caption}
                                      onOpenPage={goToPage}
                                    />
                                  ))}
                              </details>
                            )}
                          </Suspense>
                        </section>
                      )}
                    <section className="overview-section">
                      <div className="report-model-row">
                        <span>生成 / 翻译模型</span>
                        <ModelSelect
                          settings={settings}
                          onChange={setSettings}
                          disabled={chatting || reporting || translating}
                        />
                      </div>
                      <div className="section-heading">
                        <h2>
                          <Sparkles size={20} /> AI 研读报告
                        </h2>
                        {paper.report && (
                          <div>
                            <button
                              className="icon-button"
                              title="复制报告"
                              aria-label="复制报告"
                              onClick={() => copy(reportText)}
                            >
                              {copyState ? (
                                <Check size={15} />
                              ) : (
                                <Copy size={15} />
                              )}
                            </button>
                            <button
                              className="icon-button"
                              title="下载 Markdown 报告"
                              aria-label="下载报告"
                              onClick={() =>
                                download(
                                  reportText,
                                  `${paper.title.slice(0, 80)}.md`,
                                )
                              }
                            >
                              <Download size={16} />
                            </button>
                          </div>
                        )}
                      </div>
                      {paper.report ? (
                        <>
                          <div
                            className={`report-meta ${paper.report.mode === "extractive" ? "extractive" : ""}`}
                          >
                            <ShieldCheck size={13} />
                            {paper.report.mode === "extractive"
                              ? "原文摘录 · 未使用 AI 模型"
                              : paper.report.source?.agent
                                ? `${paper.report.source.agent} 注入 · ${paper.report.language || "原文"}`
                                : `模型生成 · ${paper.report.coverage === "full-text-extracted" ? "覆盖提取全文" : "基于原文节选"}`}
                            {translationFor("report") && (
                              <span>译文 · {language}</span>
                            )}
                            <span>{date(paper.report.createdAt)}</span>
                          </div>
                          {paper.report.mode !== "extractive" && (
                            <p className="report-reading-note">
                              请对照引用页码核实。
                              {paper.report.mode === "model-adversarial"
                                ? "多个角色由同一模型承担，复核意见不等于独立验证。"
                                : "代理解读与原文分别保存。"}
                            </p>
                          )}
                          {translationStatus("report")}
                          <div className="prose report-prose">
                            <Mark onPage={goToPage}>{reportText}</Mark>
                          </div>
                          {paper.report.stages &&
                            paper.report.stages.length > 1 && (
                              <details className="review-trace">
                                <summary>
                                  <ShieldCheck size={14} /> 查看多角色复核过程{" "}
                                  <span>
                                    {paper.report.stages.length} 个阶段
                                  </span>
                                </summary>
                                {paper.report.stages
                                  .filter((s) => s.role !== "editor")
                                  .map((s) => (
                                    <div className="prose" key={s.role}>
                                      <h3>
                                        {s.role === "researcher"
                                          ? "研究者 · 初稿"
                                          : "质疑者 · 审阅"}
                                      </h3>
                                      <Mark onPage={goToPage}>{s.content}</Mark>
                                    </div>
                                  ))}
                              </details>
                            )}
                          <button
                            className="text-button"
                            onClick={generate}
                            disabled={reporting}
                          >
                            {reporting ? (
                              <Loader2 size={14} className="spin" />
                            ) : (
                              <Sparkles size={14} />
                            )}
                            重新生成报告
                          </button>
                        </>
                      ) : (
                        <div className="generate-card">
                          <div className="generate-icon">
                            <Sparkles size={25} />
                          </div>
                          <h3>从读过，到读懂。</h3>
                          <p>
                            提炼核心贡献、梳理方法与证据，
                            <br />
                            通过多角色复核，找到值得追问的地方。
                          </p>
                          <div className="agent-flow">
                            <span>
                              <BookOpen size={12} /> 研究者
                            </span>
                            <ChevronRight size={12} />
                            <span>
                              <FlaskConical size={12} /> 质疑者
                            </span>
                            <ChevronRight size={12} />
                            <span>
                              <FileText size={12} /> 编辑
                            </span>
                          </div>
                          <button
                            className="primary-button"
                            disabled={reporting}
                            onClick={generate}
                          >
                            {reporting ? (
                              <Loader2 size={15} className="spin" />
                            ) : (
                              <Sparkles size={15} />
                            )}{" "}
                            {reporting
                              ? "正在研读与交叉核验…"
                              : modelReady
                                ? "生成研读报告"
                                : "生成原文摘录"}
                          </button>
                          {!modelReady && (
                            <button
                              className="text-button"
                              onClick={() => setShowSettings(true)}
                            >
                              连接模型，启用 AI 研读 <ArrowUpRight size={12} />
                            </button>
                          )}
                        </div>
                      )}
                    </section>
                    <section className="source-section">
                      <div>
                        <Link2 size={15} />
                        <span>来源与证据</span>
                      </div>
                      <p>
                        {paper.pageCount
                          ? `已解析 ${paper.pageCount} 页 PDF`
                          : "已导入可提取的正文"}{" "}
                        · 保存在本地工作区
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
                            <p>正在加载论文阅读器…</p>
                          </div>
                        }
                      >
                        <PdfReader
                          url={pdfSource}
                          page={pdfPage}
                          onPage={goToPage}
                          onAskSelection={askSelection}
                        />
                      </Suspense>
                    ) : (
                      <div className="text-reader">
                        <div className="reader-note">
                          <FileText size={16} /> 正文阅读 · 此来源没有可用的 PDF
                          文件
                        </div>
                        <h1>{paper.title}</h1>
                        <div>{paper.text || paper.abstract}</div>
                      </div>
                    )}
                    <div className="reader-fallback">
                      PDF 无法显示时，可{" "}
                      <a
                        href={pdfSource || paper.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        打开原始文件 <ArrowUpRight size={12} />
                      </a>{" "}
                      或{" "}
                      <button
                        onClick={() =>
                          download(
                            paper.text,
                            `${paper.title.slice(0, 80)}.txt`,
                            "text/plain",
                          )
                        }
                      >
                        下载提取正文
                      </button>
                      。
                    </div>
                  </>
                )}
              </article>
              {assistant ? (
                <AssistantDock width={dockWidth} onWidthChange={setDockWidth} onClose={() => setAssistant(false)}>
                  {assistantPanel()}
                </AssistantDock>
              ) : tab !== "paper" ? (
                <aside className="paper-details">
                  <div className="detail-heading">
                    <FlaskConical size={17} /> 研究工作区
                  </div>
                  <p>沿着论文中的证据，探索下一个问题。</p>
                  <button
                    className="primary-button"
                    onClick={() => setAssistant(true)}
                  >
                    <Sparkles size={14} /> 打开助手
                  </button>
                  <hr />
                  <div className="detail-line">
                    <span>来源</span>
                    <b>{paper.source}</b>
                  </div>
                  <div className="detail-line">
                    <span>阅读状态</span>
                    <b>已保存</b>
                  </div>
                  <hr />
                  <div className="detail-heading">
                    BibTeX
                    <button
                      className="icon-button"
                      aria-label="复制引用"
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
                    <Trash2 size={14} /> 删除论文
                  </button>
                </aside>
              ) : null}
            </div>
          </>
        ) : view === "research" ? (
          <div className="research-page">
            <header className="page-header">
              <div className="breadcrumb">
                <Sparkles size={16} /> 研究助手
              </div>
              <span className="local-badge">
                <span /> 本地工作区
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
                  ? "探索"
                  : view === "saved"
                    ? "收藏"
                    : "我的文库"}
              </div>
              <div className="header-actions">
                <span className="local-badge">
                  <span /> 本地工作区
                </span>
                <button
                  className="soft-button"
                  onClick={() => setShowImport(true)}
                >
                  <Plus size={15} /> 导入论文
                </button>
              </div>
            </header>
            <div
              className={`library-page ${view === "discover" ? "discovery-page" : ""}`}
            >
              {view === "discover" ? (
                <section className="discovery-hero">
                  <h1>追踪最新研究</h1>
                  <p>探索值得阅读的论文，发现下一个研究方向。</p>
                  <div className="discovery-prompts">
                    {[
                      "最近有哪些值得读的论文？",
                      "谁在研究这个方向？",
                      "帮我整理有据可查的综述",
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
                      aria-label="搜索论文或粘贴网址"
                      placeholder="搜索论文，或粘贴 arXiv / 论文网址…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <button
                      type="submit"
                      aria-label="搜索"
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
                        ["all", "全部来源"],
                        ["arxiv", "arXiv"],
                        ["local", "本地文库"],
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
                      <Upload size={13} /> 上传 PDF
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
                    <h1>{view === "saved" ? "值得再次阅读。" : "我的文库"}</h1>
                    <p>
                      {view === "saved"
                        ? "收藏重要的论文，让想法随时可及。"
                        : "你的论文、阅读记录与研究报告，都在这里。"}
                    </p>
                  </div>
                  <button
                    className="primary-button"
                    onClick={() => setShowImport(true)}
                  >
                    <Plus size={16} /> 导入论文
                  </button>
                </div>
              )}
              <section className="papers-section">
                <div className="section-heading">
                  <h2>
                    {view === "discover" && results !== null
                      ? "搜索结果"
                      : view === "saved"
                        ? "已收藏"
                        : "最近阅读"}
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
                      清除搜索
                      <X size={13} />
                    </button>
                  ) : (
                    <span className="muted-label">
                      <History size={13} /> 按添加时间
                    </span>
                  )}
                </div>
                {searching ? (
                  <div className="loading-state">
                    <Loader2 className="spin" size={25} />
                    <p>正在搜索研究文献…</p>
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
                                  : "论文"}
                            </span>
                            <span>·</span>
                            {date(p.publishedAt || p.createdAt)}
                          </div>
                          <h3>{p.title}</h3>
                          <div className="card-authors">
                            {p.authors?.join(" · ") || "本地导入文献"}
                          </div>
                          <p>{p.abstract || p.text?.slice(0, 300)}</p>
                          <div className="card-tags">
                            {p.tags?.slice(0, 3).map((t) => (
                              <span key={t}>{t}</span>
                            ))}
                            {p.report && (
                              <span className="report-tag">
                                <Sparkles size={11} /> 已生成报告
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
                              aria-label={p.favorite ? "取消收藏" : "收藏论文"}
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
                        ? "还没有找到相关论文"
                        : view === "saved"
                          ? "把值得记住的论文留在这里"
                          : "你的下一篇好论文，在这里。"}
                    </h3>
                    <p>
                      {results !== null
                        ? "换个关键词，或选择其他搜索来源再试一次。"
                        : view === "saved"
                          ? "在论文页面点击收藏，即可加入这份阅读清单。"
                          : "粘贴一个网址，或上传 PDF，开启你的研究工作区。"}
                    </p>
                    {results === null && view !== "saved" && (
                      <div>
                        <button
                          className="primary-button"
                          onClick={() => setShowImport(true)}
                        >
                          <Plus size={15} /> 导入第一篇论文
                        </button>
                        <button
                          className="text-button example-link"
                          disabled={importing}
                          onClick={() => importUrl(exampleUrl)}
                        >
                          试读示例论文 <ArrowUpRight size={13} />
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
                <span>为开放的研究而构建</span>
                <span className="footer-right">本地存储 · 自由选择模型</span>
              </footer>
            </div>
          </>
        )}
      </main>
      {view === "paper" && (
        <button
          className={`assistant-bubble ${assistant ? "is-open" : ""}`}
          aria-label={assistant ? "收起悬浮助手" : "打开悬浮助手"}
          aria-expanded={assistant}
          onClick={() => setAssistant(!assistant)}
        >
          {assistant ? <X size={23} /> : <MessageSquare size={24} />}
          <span>{assistant ? "收起" : "问论文"}</span>
        </button>
      )}
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
                <h2 id="import-title">让一篇论文，成为起点。</h2>
              </div>
              <button
                className="icon-button"
                disabled={importing}
                aria-label="关闭导入"
                onClick={() => setShowImport(false)}
              >
                <X size={19} />
              </button>
            </div>
            <p>导入论文网址或 PDF，保存在你的本地文库。</p>
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
              <label htmlFor="paper-url">论文网址</label>
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
                支持 arXiv、alphaXiv、公开网页和 PDF 链接
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
                {importing ? "正在获取与解析…" : "导入论文"}
              </button>
            </form>
            <div className="or-divider">
              <span />
              或者
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
              <b>拖放 PDF 文件到这里</b>
              <span>或点击选择文件 · 最大 25 MB · 文本型 PDF</span>
            </button>
            <div className="modal-footnote">
              <ShieldCheck size={13} /> 文件保存在本机；生成 AI
              内容时会将正文发送给你配置的模型。
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
            setNotice("模型配置已更新");
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
              <h2 id="cite-title">引用这篇论文</h2>
              <button
                className="icon-button"
                aria-label="关闭引用"
                onClick={() => setShowCite(false)}
              >
                <X size={18} />
              </button>
            </div>
            <pre>{bib}</pre>
            <button className="primary-button" onClick={() => copy(bib)}>
              {copyState ? <Check size={15} /> : <Copy size={15} />}{" "}
              {copyState ? "已复制" : "复制 BibTeX"}
            </button>
            <button
              className="soft-button"
              style={{ marginLeft: 8 }}
              onClick={() =>
                download(bib, "citation.bib", "application/x-bibtex")
              }
            >
              <Download size={15} /> 下载 BibTeX
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
