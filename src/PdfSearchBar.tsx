import { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ChevronDown, ChevronUp, Loader2, Search, X } from "lucide-react";
import { buildPdfSearchIndex, searchPdfText, type PdfSearchIndex, type PdfSearchMatch } from "./pdf-search";
import "./pdf-search.css";

export type PdfSearchBarProps = {
  document: PDFDocumentProxy | null;
  language: string;
  open: boolean;
  onClose: () => void;
  onResult: (match: PdfSearchMatch | null) => void;
};

export default function PdfSearchBar({ document, language, open, onClose, onResult }: PdfSearchBarProps) {
  const t = (zh: string, en: string) => language.startsWith("en") ? en : zh;
  const input = useRef<HTMLInputElement>(null);
  const callbacks = useRef({ onClose, onResult }); callbacks.current = { onClose, onResult };
  const currentDocument = useRef(document); currentDocument.current = document;
  const cache = useRef<{ document: PDFDocumentProxy; index: PdfSearchIndex } | null>(null);
  const [state, setState] = useState<{ document: PDFDocumentProxy | null; index: PdfSearchIndex | null }>({ document: null, index: null });
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState({ query: "", index: 0 });
  const lastEmitted = useRef<string | null>(null);
  const emitClear = () => { lastEmitted.current = null; callbacks.current.onResult(null); };

  useEffect(() => { setQuery(""); setSelection({ query: "", index: 0 }); setState({ document, index: null }); cache.current = null; emitClear(); }, [document]);
  useEffect(() => {
    if (!open) { emitClear(); return; }
    const frame = requestAnimationFrame(() => { input.current?.focus(); input.current?.select(); });
    return () => cancelAnimationFrame(frame);
  }, [open, document]);
  useEffect(() => {
    if (!open || !document) return;
    if (cache.current?.document === document) { setState(cache.current); return; }
    const controller = new AbortController();
    setState({ document, index: { pages: [], pageCount: document.numPages, indexed: 0, failedPages: [] } });
    void buildPdfSearchIndex(document, { signal: controller.signal, onProgress: index => {
      if (!controller.signal.aborted && currentDocument.current === document) setState({ document, index });
    } }).then(index => {
      if (!controller.signal.aborted && currentDocument.current === document) { cache.current = { document, index }; setState({ document, index }); }
    }).catch(() => { /* Cancellation/document teardown leaves no stale search result. */ });
    return () => controller.abort();
  }, [document, open]);

  const index = state.document === document ? state.index : null;
  const results = useMemo(() => index && query.trim() ? searchPdfText(index, query) : { matches: [], truncated: false }, [index, query]);
  const selectedIndex = selection.query === query ? Math.min(selection.index, Math.max(0, results.matches.length - 1)) : 0;
  const selected = results.matches[selectedIndex];
  useEffect(() => {
    if (!open || !query.trim() || !selected) { if (lastEmitted.current !== null) emitClear(); return; }
    if (lastEmitted.current === selected.key) return;
    lastEmitted.current = selected.key; callbacks.current.onResult(selected);
  }, [open, query, selected]);

  function move(direction: number) {
    if (!results.matches.length) return;
    setSelection({ query, index: (selectedIndex + direction + results.matches.length) % results.matches.length });
  }
  function close() { emitClear(); callbacks.current.onClose(); }
  const indexing = Boolean(document && (!index || index.indexed < document.numPages));
  if (!open) return null;
  return <section className="pdf-search-bar" role="search" aria-label={t("PDF 正文查找", "PDF text search")}>
    <div className="pdf-search-controls">
      <Search size={16} aria-hidden="true" />
      <input ref={input} type="search" value={query} disabled={!document} autoComplete="off" spellCheck={false}
        aria-label={t("在 PDF 正文中查找", "Find in PDF text")} placeholder={t("查找整篇论文…", "Find throughout the paper…")}
        onChange={event => { emitClear(); setQuery(event.target.value); setSelection({ query: event.target.value, index: 0 }); }}
        onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
          if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); move(event.shiftKey ? -1 : 1); }
        }} />
      <span className="pdf-search-count" aria-label={t("查找结果计数", "Search result count")}>{results.matches.length ? `${selectedIndex + 1} / ${results.matches.length}${results.truncated ? "+" : ""}` : "0 / 0"}</span>
      <button type="button" disabled={!results.matches.length} aria-label={t("上一个结果", "Previous result")} title={t("上一个结果（Shift+Enter）", "Previous result (Shift+Enter)")} onClick={() => move(-1)}><ChevronUp size={17} /></button>
      <button type="button" disabled={!results.matches.length} aria-label={t("下一个结果", "Next result")} title={t("下一个结果（Enter）", "Next result (Enter)")} onClick={() => move(1)}><ChevronDown size={17} /></button>
      <button type="button" aria-label={t("关闭正文查找", "Close PDF search")} title={t("关闭（Esc）", "Close (Esc)")} onClick={close}><X size={17} /></button>
    </div>
    <div className="pdf-search-status" role="status" aria-live="polite">
      {!document ? t("正在加载 PDF…", "Loading PDF…") : indexing ? <><Loader2 size={13} className="spin" />{t(`正在索引 ${index?.indexed || 0} / ${document.numPages} 页`, `Indexing ${index?.indexed || 0} / ${document.numPages} pages`)}</> :
        query.trim() && !selected ? t("可提取文字中没有匹配结果", "No matches in extracted text") :
        selected ? t(`第 ${selected.page} 页 · Enter / Shift+Enter 切换结果`, `Page ${selected.page} · Enter / Shift+Enter to navigate`) : t("搜索全部页面的本地 PDF 文字", "Search local PDF text across all pages")}
      {!!index?.failedPages.length && <span>{t(` · ${index.failedPages.length} 页文字读取失败`, ` · Text unavailable on ${index.failedPages.length} pages`)}</span>}
      {results.truncated && <span>{t(" · 结果较多，请缩小关键词范围", " · Many matches; refine your search")}</span>}
    </div>
  </section>;
}
