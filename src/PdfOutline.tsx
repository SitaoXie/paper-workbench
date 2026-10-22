import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ChevronDown, ChevronRight, ListTree, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { currentOutlineNode, loadPdfOutline, type PdfOutlineData, type PdfOutlineNode } from './pdf-outline';
import './pdf-outline.css';
export type PdfOutlineProps = {
  document: PDFDocumentProxy | null;
  language: string;
  open: boolean;
  onClose: () => void;
  onNavigate: (page: number, point?: { x?: number; y?: number }) => void;
  currentPage: number;
  onFind?: () => void;
};
export default function PdfOutline({ document, language, open, onClose, onNavigate, currentPage, onFind }: PdfOutlineProps) {
  const t = (zh: string, en: string) => language.startsWith('en') ? en : zh;
  const host = useRef<HTMLElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const currentDocument = useRef(document); currentDocument.current = document;
  const callbacks = useRef({ onClose, onNavigate, onFind }); callbacks.current = { onClose, onNavigate, onFind };
  const [state, setState] = useState<{ document: PDFDocumentProxy | null; data?: PdfOutlineData; error?: boolean }>({ document: null });
  const [expansion, setExpansion] = useState<{ document: PDFDocumentProxy | null; ids: Set<string> }>({ document: null, ids: new Set() });
  const [selected, setSelected] = useState<{ document: PDFDocumentProxy; id: string }>();
  const [retry, setRetry] = useState(0);
  const lastRetry = useRef(0);
  const [placement, setPlacement] = useState({ top: 48, height: 500 });
  const data = state.document === document ? state.data : undefined;
  const activeNode = data ? currentOutlineNode(data, currentPage, selected?.document === document ? selected.id : undefined) : undefined;
  const expanded = expansion.document === document ? expansion.ids : new Set<string>();
  useEffect(() => {
    if (!open || !document) return;
    let disposed = false;
    setState({ document });
    const forceRetry = retry !== lastRetry.current;
    lastRetry.current = retry;
    void loadPdfOutline(document, forceRetry).then(data => {
      if (disposed || currentDocument.current !== document) return;
      setState({ document, data });
      setExpansion(previous => previous.document === document ? previous : { document, ids: new Set(data.flat.filter(node => node.initiallyExpanded).map(node => node.id)) });
    }).catch(() => { if (!disposed && currentDocument.current === document) setState({ document, error: true }); });
    return () => { disposed = true; };
  }, [document, open, retry]);
  useEffect(() => {
    if (!open || !activeNode || !document) return;
    const parts = activeNode.id.split('.');
    setExpansion(previous => {
      const ids = new Set(previous.document === document ? previous.ids : []);
      for (let count = 1; count < parts.length; count++) ids.add(parts.slice(0, count).join('.'));
      return { document, ids };
    });
  }, [open, activeNode?.id, document]);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => closeButton.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [open, document]);
  useEffect(() => {
    if (!open || !data) return;
    // Opening a long outline should show where reading currently is, without
    // moving the PDF or the surrounding document.
    const frame = requestAnimationFrame(() => {
      const scroller = host.current?.querySelector<HTMLElement>('.pdf-outline-scroll');
      const current = scroller?.querySelector<HTMLElement>('[aria-current="location"]');
      if (!scroller || !current) return;
      const box = current.getBoundingClientRect(), viewport = scroller.getBoundingClientRect();
      if (box.top < viewport.top || box.bottom > viewport.bottom)
        scroller.scrollTop += box.top - viewport.top - Math.max(8, (scroller.clientHeight - box.height) / 2);
    });
    return () => cancelAnimationFrame(frame);
  }, [open, data]);
  useLayoutEffect(() => {
    if (!open || !host.current) return;
    const reader = host.current.closest<HTMLElement>('.pdf-reader');
    const toolbar = reader?.querySelector<HTMLElement>('.pdf-zoom-toolbar');
    if (!reader) return;
    const place = () => {
      const readerTop = reader.getBoundingClientRect().top;
      const desiredTop = (toolbar?.getBoundingClientRect().bottom ?? readerTop + 44) + 6;
      const viewportTop = Math.max(8, Math.min(desiredTop, window.innerHeight - 160));
      setPlacement({ top: viewportTop - readerTop, height: Math.max(100, Math.min(560, window.innerHeight - viewportTop - 12)) });
    };
    place(); const observer = new ResizeObserver(place); observer.observe(reader); if (toolbar) observer.observe(toolbar);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, { passive: true });
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place); };
  }, [open]);
  const toggle = (node: PdfOutlineNode) => setExpansion(previous => {
    const ids = new Set(previous.document === document ? previous.ids : []);
    if (ids.has(node.id)) ids.delete(node.id); else ids.add(node.id);
    return { document, ids };
  });
  const title = (node: PdfOutlineNode) => node.title || t('未命名章节', 'Untitled section');
  function entries(nodes: PdfOutlineNode[]) {
    return <ul className="pdf-outline-list">{nodes.map(node => {
      const isExpanded = expanded.has(node.id), current = activeNode?.id === node.id;
      return <li key={node.id} className={current ? 'is-current' : ''}>
        <div className="pdf-outline-row" style={{ paddingInlineStart: Math.min(node.depth, 8) * 12 }}>
          {node.children.length ? <button type="button" className="pdf-outline-expand" aria-label={`${isExpanded ? t('收起', 'Collapse') : t('展开', 'Expand')} ${title(node)}`} aria-expanded={isExpanded} aria-controls={`pdf-outline-children-${node.id}`} onClick={() => toggle(node)}>{isExpanded ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}</button> : <span className="pdf-outline-indent" aria-hidden="true"/>}
          <button type="button" className="pdf-outline-link" disabled={!node.target} aria-current={current ? 'location' : undefined} onClick={() => {
            if (!node.target || currentDocument.current !== document || !document) return;
            setSelected({ document, id: node.id });
            callbacks.current.onNavigate(node.target.page, { x: node.target.x, y: node.target.y });
            callbacks.current.onClose();
          }}>
            <span className="pdf-outline-title">{title(node)}</span>
            <small>{node.target ? <><span>p.{node.target.page}</span>{node.pageLabel && node.pageLabel !== String(node.target.page) && <span> · {t('印刷页', 'printed')} {node.pageLabel}</span>}{current && <span className="pdf-outline-current"> · {t('当前页所在节', 'Current page section')}</span>}</> : node.external ? t('外部目录条目', 'External outline entry') : t('未提供有效页码', 'No valid page destination')}</small>
          </button>
        </div>
        {!!node.children.length && <div id={`pdf-outline-children-${node.id}`} hidden={!isExpanded}>{entries(node.children)}</div>}
      </li>;
    })}</ul>;
  }
  if (!open) return null;
  return <section id="pdf-outline-panel" className="pdf-outline-panel" ref={host} role="dialog" aria-modal="false" aria-labelledby="pdf-outline-title" style={{ top: placement.top, maxHeight: placement.height }} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); callbacks.current.onClose(); }
  }}>
    <header><h2 id="pdf-outline-title"><ListTree size={17}/>{t('论文目录', 'Paper outline')}</h2><button type="button" ref={closeButton} className="pdf-outline-close" aria-label={t('关闭论文目录', 'Close paper outline')} onClick={() => callbacks.current.onClose()}><X size={18}/></button></header>
    <div className="pdf-outline-scroll">
      {!document || (!data && !(state.document === document && state.error)) ? <p className="pdf-outline-message" role="status"><Loader2 className="spin" size={16}/>{t('正在读取 PDF 内嵌目录…', 'Reading the embedded PDF outline…')}</p> : state.document === document && state.error ? <div className="pdf-outline-message" role="alert"><p>{t('无法读取此 PDF 的目录。', 'The PDF outline could not be read.')}</p><button type="button" onClick={() => setRetry(value => value + 1)}><RefreshCw size={14}/>{t('重试', 'Retry')}</button></div> : data?.nodes.length ? <nav aria-label={t('PDF 内嵌目录', 'Embedded PDF outline')}>{entries(data.nodes)}</nav> : <div className="pdf-outline-message"><p>{t('这份 PDF 没有内嵌目录。可使用全文查找定位章节或关键词。', 'This PDF has no embedded outline. Use text search to locate a section or keyword.')}</p>{onFind && <button type="button" onClick={() => callbacks.current.onFind?.()}><Search size={14}/>{t('查找正文', 'Find in text')}</button>}</div>}
    </div>
    {!!data?.nodes.length && <footer>{t('p. 表示 PDF 来源页序；印刷页可能不同。', 'p. is the source PDF page number; printed labels may differ.')}{data.truncated && <span role="status"> {t('目录较大，当前显示前 2000 个条目（最多 31 层）。', 'Large outline: showing up to 2,000 entries and 31 levels.')}</span>}</footer>}
  </section>;
}
