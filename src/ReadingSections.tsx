import { useEffect, useRef, useState, type RefObject } from 'react';
import { ArrowUp, Check, ChevronDown, Copy, List } from 'lucide-react';
import { t } from './i18n';
import { compatibleSectionStructure, READING_SECTION_EVENT, readingSectionId, readingSectionUrl, type ReadingSection, type ReadingSectionLocation } from './reading-sections';
import './reading-sections.css';

type Props = {
  active: boolean; paperId: string; readingId: string; contextKey: string;
  sections: ReadingSection[]; contentRef: RefObject<HTMLDivElement | null>;
  intent?: ReadingSectionLocation & { revision: number };
  onNavigate: (index: number) => void; onError: (message: string) => void;
};
/** A compact overlay menu. Opening it never moves the reading's content. */
export default function ReadingSections({ active, paperId, readingId, contextKey, sections, contentRef, intent, onNavigate, onError }: Props) {
  const [open, setOpen] = useState(false), [current, setCurrent] = useState(0), [copied, setCopied] = useState(false);
  const [placement, setPlacement] = useState({ side: 'below', height: 400 });
  const host = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const currentRef = useRef({ index: 0, offset: 0, progress: 0 });
  const previous = useRef({ paperId, readingId, contextKey, sections });
  const activeRef = useRef(active); activeRef.current = active;
  const run = useRef(0);
  const pending = useRef<(() => void) | undefined>(undefined);
  const lastIntent = useRef<number | undefined>(undefined);
  const externalNavigationUntil = useRef(0);
  const elementFor = (index: number) => index === 0 ? contentRef.current : document.getElementById(readingSectionId(readingId, index));
  const topOffset = () => (document.querySelector('.paper-toolbar')?.getBoundingClientRect().height || 68) + (host.current?.getBoundingClientRect().height || 38) + 14;
  function jump(index: number, offset = topOffset(), progress?: number) {
    if (!elementFor(index) || !activeRef.current) return;
    pending.current?.();
    const token = ++run.current;
    let frame = 0;
    let observer: ResizeObserver | undefined;
    const scroll = () => {
      const element = elementFor(index);
      if (run.current !== token || !activeRef.current || !element?.isConnected) return;
      window.dispatchEvent(new CustomEvent(READING_SECTION_EVENT, { detail: { paperId, readingId, section: index } }));
      const bounds = element.getBoundingClientRect();
      const end = elementFor(index + 1)?.getBoundingClientRect().top ?? contentRef.current?.getBoundingClientRect().bottom ?? bounds.bottom;
      const span = Math.max(1, end - bounds.top - 16);
      const destinationOffset = progress === undefined ? offset : topOffset() - span * progress;
      window.scrollTo({ top: Math.max(0, window.scrollY + bounds.top - destinationOffset), behavior: 'instant' });
      currentRef.current = { index, offset: destinationOffset, progress: progress ?? 0 }; setCurrent(index);
    };
    // Parent context restoration commits before this frame; explicit navigation wins.
    frame = requestAnimationFrame(() => {
      scroll();
      observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(scroll); });
      if (contentRef.current) observer.observe(contentRef.current);
    });
    const stop = () => { ++run.current; cancelAnimationFrame(frame); observer?.disconnect(); clearTimeout(timeout); for (const event of ['wheel','pointerdown','touchstart','keydown']) window.removeEventListener(event, stop); pending.current = undefined; };
    const timeout = setTimeout(stop, 1200);
    for (const event of ['wheel','pointerdown','touchstart','keydown']) window.addEventListener(event, stop, { once: true, passive: true });
    pending.current = stop;
  }
  useEffect(() => () => { pending.current?.(); lastIntent.current = undefined; }, []);
  useEffect(()=>{
    const sourceNavigation=(event:Event)=>{
      const detail=(event as CustomEvent<{paperId?:string;navigation?:string}>).detail;
      if(detail?.paperId!==paperId||detail.navigation!=='source')return;
      pending.current?.();externalNavigationUntil.current=performance.now()+1500;
    };
    const userNavigation=()=>{externalNavigationUntil.current=0;};
    window.addEventListener(READING_SECTION_EVENT,sourceNavigation);
    for(const event of ['wheel','pointerdown','touchstart','keydown'])window.addEventListener(event,userNavigation,{passive:true});
    return()=>{window.removeEventListener(READING_SECTION_EVENT,sourceNavigation);for(const event of ['wheel','pointerdown','touchstart','keydown'])window.removeEventListener(event,userNavigation);};
  },[paperId]);
  useEffect(() => {
    if (!active) { setOpen(false); pending.current?.(); return; }
    let frame = 0;
    const update = () => {
      frame = 0;
      const boundary = topOffset();
      let index = 0;
      for (const section of sections) { const element = elementFor(section.index); if (element && element.getBoundingClientRect().top <= boundary + 12) index = section.index; else break; }
      const element = elementFor(index);
      const offset = element?.getBoundingClientRect().top ?? boundary;
      const end = elementFor(index + 1)?.getBoundingClientRect().top ?? contentRef.current?.getBoundingClientRect().bottom ?? boundary;
      const progress = Math.max(0, Math.min(1, (boundary - offset) / Math.max(1, end - offset - 16)));
      currentRef.current = { index, offset, progress }; setCurrent(index);
    };
    const queue = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    window.addEventListener('scroll', queue, { passive: true }); window.addEventListener('resize', queue);
    queue();
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', queue); window.removeEventListener('resize', queue); };
  }, [active, readingId, sections]);
  useEffect(() => {
    const before = previous.current;
    previous.current = { paperId, readingId, contextKey, sections };
    if (!active) return;
    if (intent && intent.readingId === readingId && intent.revision !== lastIntent.current) {
      lastIntent.current = intent.revision;
      jump(intent.section); return;
    }
    if (before.paperId !== paperId || before.readingId !== readingId) return;
    if(performance.now()<externalNavigationUntil.current)return;
    if (before.contextKey !== contextKey && currentRef.current.index > 0 && compatibleSectionStructure(before.sections, sections)) jump(currentRef.current.index, currentRef.current.offset, currentRef.current.progress);
  }, [active, paperId, readingId, contextKey, sections, intent]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!host.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  function placeMenu() {
    const bounds = host.current?.getBoundingClientRect();
    if (!bounds) return;
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const toolbarHeight = document.querySelector('.paper-toolbar')?.getBoundingClientRect().height || 68;
    const below = viewportHeight - bounds.bottom - 13, above = bounds.top - toolbarHeight - 13;
    const limit = Math.min(400, viewportHeight * .55);
    const side = below >= Math.min(limit, 220) || below >= above ? 'below' : 'above';
    const height = Math.max(60, Math.min(limit, side === 'below' ? below : above));
    setPlacement(previous => previous.side === side && previous.height === height ? previous : { side, height });
  }
  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', placeMenu); window.addEventListener('scroll', placeMenu, { passive: true });
    return () => { window.removeEventListener('resize', placeMenu); window.removeEventListener('scroll', placeMenu); };
  }, [open]);
  async function copyCurrent() {
    const link = readingSectionUrl(location.href, paperId, readingId, current);
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { history.replaceState({}, '', link); onError(t('无法复制章节链接，请复制浏览器地址。', 'Unable to copy the section link. Copy the browser address instead.')); }
  }
  if (!sections.length) return null;
  const minDepth = Math.min(...sections.map(section => section.depth));
  const title = sections.find(section => section.index === current)?.title;
  return <div ref={host} className="reading-section-nav" aria-label={t('解读章节导航', 'Overview section navigation')} onKeyDown={event => { if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus({ preventScroll: true }); } }}>
    <button ref={trigger} type="button" className="reading-section-trigger" aria-expanded={open} aria-controls="reading-section-menu" onClick={() => { if (!open) placeMenu(); setOpen(!open); }} title={title}>
      <List size={15}/><span>{title || t('本页章节', 'On this page')}</span><ChevronDown size={13}/>
    </button>
    <button className="icon-button" type="button" aria-label={t('复制当前章节链接', 'Copy current section link')} title={t('复制当前章节链接', 'Copy current section link')} onClick={() => void copyCurrent()}>{copied ? <Check size={14}/> : <Copy size={14}/>}</button>
    <button className="icon-button" type="button" aria-label={t('返回解读顶部', 'Back to overview top')} title={t('返回解读顶部', 'Back to overview top')} onClick={() => { setOpen(false); onNavigate(0); }}><ArrowUp size={15}/></button>
    <span className="sr-only" role="status">{copied ? t('章节链接已复制', 'Section link copied') : ''}</span>
    {open && <nav id="reading-section-menu" className="reading-section-menu" data-side={placement.side} style={{ maxHeight: placement.height }} aria-label={t('解读章节', 'Overview sections')}>
      {sections.map(section => <a key={section.index} href={readingSectionUrl(location.href, paperId, readingId, section.index)} aria-current={current === section.index ? 'location' : undefined} style={{ paddingInlineStart: 12 + Math.min(3, Math.max(0, section.depth - minDepth)) * 14 }} onClick={event => { event.preventDefault(); setOpen(false); onNavigate(section.index); }}>{section.title || t('未命名章节', 'Untitled section')}</a>)}
    </nav>}
  </div>;
}
