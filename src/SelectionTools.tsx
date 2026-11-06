import {isDemoWorkspace} from './workspace-mode';
import InlineMarkers from "./InlineMarkers";
import { captureTextAnchor,inlineMemoryKey,readInlineMemory,saveInlineMemory,type InlineMemory } from "./inline-memory";
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpLeft, BookOpen, Copy, Languages, Loader2, MessageSquare, Minus, RefreshCw, X } from 'lucide-react';
import { api } from './types';
import { t, getLocale } from './i18n';
import { selectionErrorMessage } from './selection-errors';
import Mark from './Markdown';
import AgentSelectionBridge from './AgentSelectionBridge';
import { selectionBindingKey } from './selection-agent-task';
import { readSelectionExecution, saveSelectionExecution, type SelectionExecution } from './selection-execution';
import { rangeToReadingText } from './selection-text';
import './selection-tools.css';

type Selection = { text: string; tooLong?: boolean; top: number; left: number };
type SavedRange = { range: Range; start: Node; startOffset: number; end: Node; endOffset: number; text: string };
type ReadingBounds = { top: number; bottom: number; left: number; right: number };
const rangeElement = (node: Node) => node instanceof Element ? node : node.parentElement;
function savedRangeIsCurrent(saved: SavedRange | undefined, host: HTMLElement | null) {
  if (!saved || !host || !saved.start.isConnected || !saved.end.isConnected || !host.contains(saved.start) || !host.contains(saved.end)) return false;
  const range = saved.range;
  if (range.startContainer !== saved.start || range.startOffset !== saved.startOffset || range.endContainer !== saved.end || range.endOffset !== saved.endOffset || range.collapsed) return false;
  return rangeToReadingText(range, host)?.text === saved.text;
}
function readingBounds(host: HTMLElement, saved?: SavedRange): ReadingBounds {
  const viewport = window.visualViewport;
  const bounds = { top: viewport?.offsetTop || 0, left: viewport?.offsetLeft || 0,
    bottom: (viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight), right: (viewport?.offsetLeft || 0) + (viewport?.width || window.innerWidth) };
  const toolbar = host.closest('.paper-workspace')?.querySelector('.paper-toolbar')?.getBoundingClientRect();
  if (toolbar && toolbar.bottom > bounds.top && toolbar.top < bounds.bottom) bounds.top = Math.max(bounds.top, toolbar.bottom + 6);
  const sectionNav = host.closest('.reading-overview')?.querySelector('.reading-section-nav')?.getBoundingClientRect();
  if (sectionNav && sectionNav.top <= bounds.top + 10 && sectionNav.bottom > bounds.top) bounds.top = sectionNav.bottom + 4;
  let element = saved ? rangeElement(saved.range.commonAncestorContainer) : host;
  for (; element && element !== document.body && element !== document.documentElement; element = element.parentElement) {
    const style = getComputedStyle(element), rect = element.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { bounds.top = Math.max(bounds.top, rect.top); bounds.bottom = Math.min(bounds.bottom, rect.bottom); }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { bounds.left = Math.max(bounds.left, rect.left); bounds.right = Math.min(bounds.right, rect.right); }
  }
  return bounds;
}
const visibleFragment = (range: Range, bounds: ReadingBounds) => Array.from(range.getClientRects()).find(rect =>
  rect.width > 0 && rect.height > 0 && rect.bottom > bounds.top && rect.top < bounds.bottom && rect.right > bounds.left && rect.left < bounds.right);
function popupPosition(rect: DOMRect) {
  const width = Math.min(380, window.innerWidth - 24);
  return { left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: Math.max(12, Math.min(rect.bottom + 10, window.innerHeight - 300)) };
}
export default function SelectionTools({ children, paperId, readingId, scope, language, model, modelReady = true, onAsk, sourceLabel, active = true }: {
  children: ReactNode; paperId: string; readingId?: string; scope: 'reading' | 'abstract'; language: string;
  model?: string; modelReady?: boolean; active?: boolean; sourceLabel?: string;
  onAsk: (text: string, label: string, question?: string, source?: {sourceScope:'reading'|'abstract';readingId?:string}) => Promise<boolean>;
}) {
  active = active && !isDemoWorkspace();
  const host = useRef<HTMLDivElement>(null);
  const memoryKey=inlineMemoryKey(paperId,scope,readingId,language);
  const [memory,setMemory]=useState<{key:string;entries:InlineMemory[]}>(()=>({key:memoryKey,entries:readInlineMemory(memoryKey)}));
  const entries=memory.key===memoryKey?memory.entries:[];
  const [memoryId,setMemoryId]=useState<string>();
  const [memoryError,setMemoryError]=useState(false);
  useEffect(()=>{setMemory({key:memoryKey,entries:readInlineMemory(memoryKey)});setMemoryId(undefined);setMemoryError(false);},[memoryKey]);
  function updateMemory(next:InlineMemory[]) {setMemory({key:memoryKey,entries:next});setMemoryError(!saveInlineMemory(memoryKey,next));}
  function remember(text:string,nextKind:'translation'|'explanation',model?:string) {
    if(!host.current||!savedRange.current||!selection)return;
    const anchor=captureTextAnchor(host.current,savedRange.current.range);if(!anchor)return;
    const existing=entries.find(m=>JSON.stringify(m.anchor)===JSON.stringify(anchor)&&m.kind===nextKind&&m.language===outputLanguage);
    const entry:InlineMemory={id:existing?.id||crypto.randomUUID(),anchor,text:selection.text,result:text,kind:nextKind,language:outputLanguage,model};
    updateMemory([...entries.filter(m=>m.id!==entry.id),entry]);setMemoryId(entry.id);
  }
  function reopen(entry:InlineMemory,range:Range) {
    request.current++;setBusy(false);setAsking(false);setError('');setQuestion('');setAssisted(false);setFolded(false);setLocationUnavailable(false);
    savedRange.current={range,start:range.startContainer,startOffset:range.startOffset,end:range.endContainer,endOffset:range.endOffset,text:entry.text};
    selectionKey.current=`${entry.text.length}:${entry.text.slice(0,12000)}`;
    setSelection({text:entry.text,...popupPosition(range.getBoundingClientRect())});setResult(entry.result);setKind(entry.kind);setOutputLanguage(entry.language);setResultModel(entry.model||'');setMemoryId(entry.id);
  }
  const popup = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLDivElement>(null), questionInput = useRef<HTMLInputElement>(null);
  const savedRange = useRef<SavedRange | undefined>(undefined);
  const restoring = useRef(false), restoreFrame = useRef(0);
  const [folded,setFolded] = useState(false), [locationUnavailable,setLocationUnavailable] = useState(false);
  const [chipPosition,setChipPosition] = useState({ top: 74, left: 12 });
  const selectionKey = useRef('');
  const [selection,setSelection] = useState<Selection>();
  const [question,setQuestion] = useState('');
  const [kind,setKind] = useState<'translation'|'explanation'>('explanation');
  const [asking,setAsking] = useState(false), [askFailed,setAskFailed] = useState(false);
  const askingRef = useRef(false);
  const [outputLanguage,setOutputLanguage] = useState(language);
  const [resultModel,setResultModel] = useState('');
  const [assisted,setAssisted] = useState(false);
  const [execution,setExecution] = useState<SelectionExecution>(readSelectionExecution);
  const useAgent = !modelReady || execution === 'agent';
  const [result,setResult] = useState(''), [error,setError] = useState(''), [busy,setBusy] = useState(false), [copied,setCopied] = useState(false);
  const preserveDraft = useRef(false);
  preserveDraft.current = !!question.trim() || assisted || busy || !!result || !!error || asking;
  const request = useRef(0), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const label = sourceLabel || (scope === 'reading' ? t('解读选文 · AI生成内容', 'Overview selection · AI-generated text') : t('原始摘要选文', 'Original abstract selection'));
  function dismiss() { setMemoryId(undefined); request.current++; selectionKey.current=''; savedRange.current=undefined; cancelAnimationFrame(restoreFrame.current); restoring.current=false; setFolded(false); setLocationUnavailable(false); setSelection(undefined); setQuestion(''); setResult(''); setResultModel(''); setError(''); setBusy(false); setAssisted(false); setAsking(false); setAskFailed(false); askingRef.current=false; }
  function updateChipPosition() {
    if (!host.current) return;
    const hostRect = host.current.getBoundingClientRect();
    // Use the visible sticky stack: chapter titles may wrap or change height.
    const bounds = readingBounds(host.current);
    const top = Math.max(12, Math.min(bounds.top + 6, bounds.bottom - 60));
    const left = Math.max(12, Math.min(hostRect.left, window.innerWidth - Math.min(300, window.innerWidth - 24) - 12));
    setChipPosition(old => old.top === top && old.left === left ? old : { top, left });
  }
  function minimize() {
    restoring.current=false;updateChipPosition();setFolded(true);
    cancelAnimationFrame(restoreFrame.current);
    restoreFrame.current=requestAnimationFrame(()=>chip.current?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true}));
  }
  function restoreDraft() {
    const saved=savedRange.current, root=host.current;
    const valid=savedRangeIsCurrent(saved,root);
    restoring.current=true;setLocationUnavailable(!valid);setFolded(false);
    cancelAnimationFrame(restoreFrame.current);
    if (valid && saved && root) {
      // Scroll the actual first selected fragment, not its paragraph's beginning.
      // Nested code/table scrollers are adjusted before the document viewport.
      let element=rangeElement(saved.start);
      for(;element && element!==document.body && element!==document.documentElement;element=element.parentElement){
        const style=getComputedStyle(element), rect=element.getBoundingClientRect();
        const first=Array.from(saved.range.getClientRects()).find(value=>value.width>0&&value.height>0);
        if(!first)break;
        if(/(auto|scroll)/.test(style.overflowY)&&element.scrollHeight>element.clientHeight)element.scrollTop+=first.top-rect.top-Math.min(80,rect.height/3);
        if(/(auto|scroll)/.test(style.overflowX)&&element.scrollWidth>element.clientWidth)element.scrollLeft+=Math.max(0,first.right-rect.right+12)+Math.min(0,first.left-rect.left-12);
      }
      const first=Array.from(saved.range.getClientRects()).find(value=>value.width>0&&value.height>0);
      if(first){const bounds=readingBounds(root,saved);window.scrollBy({top:first.top-bounds.top-Math.min(100,Math.max(24,(bounds.bottom-bounds.top)/4)),behavior:'instant'});}
      const bounds=readingBounds(root,saved), fragment=visibleFragment(saved.range,bounds);
      if(fragment)setSelection(old=>old?{...old,...popupPosition(fragment)}:old);
    } else {
      setSelection(old=>old?{...old,top:chipPosition.top,left:chipPosition.left}:old);
    }
    restoreFrame.current=requestAnimationFrame(()=>{
      if(savedRange.current!==saved)return;
      if(!askingRef.current)questionInput.current?.focus({preventScroll:true});else popup.current?.focus({preventScroll:true});
      // Focus can change the browser's document selection. Restore it after
      // focusing the question, while keeping the input's own caret intact.
      if(valid && saved && savedRangeIsCurrent(saved,host.current)) {const current=window.getSelection();current?.removeAllRanges();current?.addRange(saved.range.cloneRange());}
      restoreFrame.current=requestAnimationFrame(()=>{restoring.current=false;});
    });
  }
  async function ask() {
    if (!selection || selection.tooLong || askingRef.current) return;
    const token = ++request.current;
    askingRef.current = true; setAsking(true); setAskFailed(false); setError(''); setBusy(false);
    try {
      const accepted = await onAsk(selection.text,label,question.trim() || undefined,{sourceScope:scope,readingId});
      if (token !== request.current) return;
      if (accepted) { dismiss(); window.getSelection()?.removeAllRanges(); }
      else { setAskFailed(true); setError(t('未能创建提问会话，问题已保留，请重试。','Could not create a question session. Your question is preserved; try again.')); }
    } catch (reason) {
      if (token === request.current) { setAskFailed(true); setError(reason instanceof Error ? reason.message : t('创建会话失败，请重试。','Could not create a session. Try again.')); }
    } finally {
      if (token === request.current) { askingRef.current=false; setAsking(false); }
    }
  }
  useEffect(() => {
    if (!active) { dismiss(); return; }
    const capture = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (askingRef.current || restoring.current || popup.current?.contains(document.activeElement)) return;
        const selected = window.getSelection();
        if (selected?.rangeCount !== 1 || selected.isCollapsed) return;
        const range = selected.getRangeAt(0);
        if (!host.current) return;
        const selectedHost=rangeElement(range.commonAncestorContainer)?.closest<HTMLElement>('.selection-source');
        if(selectedHost && selectedHost!==host.current && (rangeToReadingText(range,selectedHost)?.text.trim().length || 0)>=2){dismiss();return;}
        const extracted = rangeToReadingText(range, host.current);
        if (!extracted || extracted.text.trim().length < 2) return;
        const text = extracted.text;
        const key=`${text.length}:${text.slice(0,12000)}`;
        const saved=savedRange.current;
        if (selectionKey.current===key && saved && range.startContainer===saved.start && range.startOffset===saved.startOffset && range.endContainer===saved.end && range.endOffset===saved.endOffset) return;
        selectionKey.current=key;
        savedRange.current={range:range.cloneRange(),start:range.startContainer,startOffset:range.startOffset,end:range.endContainer,endOffset:range.endOffset,text};
        const rect = range.getBoundingClientRect();
        request.current++; setMemoryId(undefined); setAssisted(false); setAskFailed(false); setQuestion(''); setResult(''); setResultModel(''); setError(''); setBusy(false);
        setFolded(false);setLocationUnavailable(false);setSelection({text: text.slice(0,12000),tooLong:text.length>12000,...popupPosition(rect)});
      },120);
    };
    const outside = (event: PointerEvent) => {
      const target=event.target as Node;
      if(popup.current?.contains(target) || chip.current?.contains(target))return;
      // Working with the assistant, notebook or source is not a discard action.
      // A fresh nonempty Range below replaces this one; an ordinary click folds
      // meaningful work, while an untouched selection menu may simply close.
      if(preserveDraft.current){updateChipPosition();setFolded(true);}
      else if(!host.current?.contains(target) || selectionKey.current) dismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if(event.key!=='Escape')return;
      if(!preserveDraft.current){dismiss();return;}
      if(popup.current?.contains(document.activeElement))minimize();
      else {updateChipPosition();setFolded(true);}
    };
    document.addEventListener('selectionchange',capture);
    document.addEventListener('pointerdown',outside);
    document.addEventListener('keydown',escape);
    return () => { request.current++; clearTimeout(timer.current); cancelAnimationFrame(restoreFrame.current); document.removeEventListener('selectionchange',capture); document.removeEventListener('pointerdown',outside); document.removeEventListener('keydown',escape); };
  },[paperId,readingId,language,active]);
  useEffect(()=>{
    if(!active || !selection)return;
    let frame=0;
    const update=()=>{
      frame=0;if(restoring.current || !host.current)return;
      updateChipPosition();
      const saved=savedRange.current;
      if(!savedRangeIsCurrent(saved,host.current) || !saved || !visibleFragment(saved.range,readingBounds(host.current,saved))) {
        setFolded(true);
      }
      // Returning the source to view never reopens a draft without user intent.
    };
    const schedule=(event:Event)=>{if(event.target instanceof Node && (popup.current?.contains(event.target)||chip.current?.contains(event.target)))return;if(!frame)frame=requestAnimationFrame(update);};
    document.addEventListener('scroll',schedule,true);window.addEventListener('resize',schedule);
    window.visualViewport?.addEventListener('resize',schedule);window.visualViewport?.addEventListener('scroll',schedule);
    const observer=new ResizeObserver(()=>{if(!frame)frame=requestAnimationFrame(update);});
    for(const element of [host.current,host.current?.closest('.paper-workspace')?.querySelector('.paper-toolbar'),host.current?.closest('.reading-overview')?.querySelector('.reading-section-nav')])if(element)observer.observe(element);
    return()=>{cancelAnimationFrame(frame);observer.disconnect();document.removeEventListener('scroll',schedule,true);window.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('scroll',schedule);};
  },[active,selection?.text,paperId,readingId,language]);
  useEffect(()=>{ dismiss(); },[paperId,readingId,language]);
  useEffect(()=>{ setOutputLanguage(language); },[language]);
  useEffect(() => {
    if (!active) return;
    const copy = (event: ClipboardEvent) => {
      if (event.defaultPrevented || !event.clipboardData || !host.current) return;
      const target = event.target instanceof Element ? event.target : null;
      const editable = 'input,textarea,select,[contenteditable]:not([contenteditable="false"])';
      if (target?.closest(editable) || document.activeElement?.closest(editable)) return;
      const selected = window.getSelection();
      if (selected?.rangeCount !== 1 || selected.isCollapsed) return;
      const extracted = rangeToReadingText(selected.getRangeAt(0), host.current);
      if (!extracted?.hasMath || !extracted.text) return;
      try {
        event.clipboardData.setData('text/plain', extracted.text);
        event.preventDefault();
      } catch { /* Preserve native copy if clipboard writing fails. */ }
    };
    // A native drag does not necessarily move focus from the previous toolbar
    // button, so its copy event may never bubble through the reading surface.
    document.addEventListener('copy', copy, true);
    return () => document.removeEventListener('copy', copy, true);
  }, [active]);
  async function assist(nextKind: 'translation'|'explanation') {
    if (!selection || selection.tooLong || busy || askingRef.current) return;
    const token=++request.current;
    setAskFailed(false); setAssisted(true); setKind(nextKind); setBusy(!useAgent); setError(''); setResult(''); setResultModel('');
    setSelection(old => old ? {...old,top:Math.max(12,Math.min(old.top,window.innerHeight-430))} : old);
    if (useAgent) return;
    try {
      const response=await api<{result:{text:string,source?:{model?:string}}}>(`/papers/${paperId}/assist`,{method:'POST',body:JSON.stringify({sourceScope:scope,readingId,text:selection.text,kind:nextKind,language:outputLanguage})});
      if(token===request.current) { setResult(response.result.text); setResultModel(response.result.source?.model || ''); remember(response.result.text,nextKind,response.result.source?.model); }
    } catch(e) { if(token===request.current) setError(selectionErrorMessage(e, getLocale())); }
    finally { if(token===request.current) setBusy(false); }
  }
  async function copy() { try { await navigator.clipboard.writeText(result || selection?.text || ''); setCopied(true); setTimeout(()=>setCopied(false),1500); } catch { setError(t('无法访问剪贴板，请直接选择文本复制。','Clipboard unavailable. Select and copy the text directly.')); } }
  const draftStatus=asking?t('正在创建会话','Creating session'):busy?t('处理中','Processing'):error?t('处理未完成','Needs attention'):result?t('结果已保留','Result preserved'):question?t('问题已保留','Question preserved'):t('选文已保留','Selection preserved');
  return <><div className="selection-source" ref={host}>{children}<InlineMarkers root={host} entries={entries} active={active} onOpen={reopen}/>{active && selection && createPortal(<>
    {folded && <div className="selection-draft-chip" ref={chip} role="region" aria-label={t('选文草稿','Selection draft')} style={chipPosition}>
      <button className="selection-draft-restore" onClick={restoreDraft} aria-label={t('返回选文草稿','Return to selected draft')}><ArrowUpLeft size={17}/><span><strong>{t('返回选文草稿','Return to selected draft')}</strong><small role="status">{draftStatus}</small></span></button>
      <button className="icon-button" aria-label={t('丢弃选文草稿','Discard selection draft')} onClick={dismiss}><X size={16}/></button>
    </div>}
    <div className="overview-selection" ref={popup} hidden={folded} tabIndex={-1} role="dialog" aria-label={t('选文操作','Selection actions')} style={{top:selection.top,left:selection.left,maxHeight:`min(430px, calc(100dvh - ${selection.top+12}px))`}}>
      <header><span>{label}</span><div className="overview-selection-window-actions"><button className="icon-button" aria-label={t('收起选文草稿','Minimize selection draft')} onClick={minimize}><Minus size={16}/></button><button className="icon-button" aria-label={t('关闭选文操作','Close selection actions')} title={t('关闭并丢弃草稿','Close and discard draft')} onClick={dismiss}><X size={16}/></button></div></header>
      {locationUnavailable && <p className="selection-location-notice" role="status">{t('原选文位置已变化，无法精确返回。草稿已保留；需要定位时请重新选择原文。','The source location has changed and cannot be restored precisely. Your draft is preserved; select the source again to relocate it.')}</p>}
      <blockquote>{selection.text}</blockquote>
      <div className="overview-selection-options">
        <label>{t('结果语言','Result language')}<select aria-label={t('选文结果语言','Selection result language')} value={outputLanguage.startsWith('en')?'en':'zh-CN'} disabled={busy || asking} onChange={event=>{setOutputLanguage(event.target.value);setResult('');setError('');setResultModel('');}}><option value="zh-CN">中文</option><option value="en">English</option></select></label>
        {(resultModel || (!useAgent && model)) && <span title={resultModel || model}>{resultModel || model}</span>}
      </div>
      <label className="selection-execution">{t('处理方式','Process with')}<select aria-label={t('选文处理方式','Selection processing method')} value={useAgent?'agent':'api'} disabled={busy || asking} onChange={event=>{const value=event.target.value as SelectionExecution;setExecution(value);saveSelectionExecution(value);}}><option value="api" disabled={!modelReady}>{t('模型 API','Model API')}</option><option value="agent">Codex / Claude</option></select></label>
      <input ref={questionInput} className="overview-selection-question" aria-label={t('针对摘要选文的问题','Question about the overview selection')} placeholder={t('针对选文写个问题…','Ask about this passage…')} value={question} disabled={asking} maxLength={4000} onChange={event=>setQuestion(event.target.value)} onKeyDown={event=>{if(event.key==='Enter' && !event.nativeEvent.isComposing) {event.preventDefault();ask();}}}/>
      <div className="overview-selection-actions">
        <button onClick={()=>void assist('translation')} disabled={selection.tooLong || busy || asking}><Languages size={15}/>{t('翻译','Translate')}</button>
        <button onClick={()=>void assist('explanation')} disabled={selection.tooLong || busy || asking}><BookOpen size={15}/>{t('解释','Explain')}</button>
        <button onClick={()=>void ask()} disabled={selection.tooLong || asking}><MessageSquare size={15}/>{t('提问','Ask')}</button>
      </div>
      {selection.tooLong && <p role="alert" className="reading-inline-error">{t('选文过长，请缩短至 12,000 字以内后再操作。','This selection is too long. Select at most 12,000 characters before continuing.')}</p>}
      {asking && <p className="selection-pending" role="status"><Loader2 size={15} className="spin"/>{t("正在创建提问会话…","Creating a question session…")}</p>}
      {busy && <p className="selection-pending" role="status"><Loader2 size={15} className="spin"/>{t('正在阅读选文…','Reading the selection…')}</p>}
      {error && <div role="alert" className="reading-inline-error"><span>{error}</span>{!selection.tooLong && <button onClick={()=>void (askFailed ? ask() : assist(kind))} disabled={busy || asking}><RefreshCw size={14}/>{t('重试','Retry')}</button>}</div>}
      {memoryError && <p role="alert">{t('浏览器存储已满，标记仅在本次打开期间保留；结果仍可在历史中查看。','Browser storage is full. This marker lasts for this visit; the result remains in history.')}</p>}
      {memoryId && <button className="text-button" onClick={()=>{updateMemory(entries.map(m=>m.id===memoryId?{...m,hidden:true}:m));dismiss();}}>{t('隐藏标记','Hide marker')}</button>}
      {result && <><div className="overview-selection-result prose"><Mark>{result}</Mark></div><button className="text-button" onClick={()=>void copy()}><Copy size={14}/>{copied?t('已复制','Copied'):t('复制结果','Copy result')}</button></>}
      {assisted && <AgentSelectionBridge key={selectionBindingKey({paperId,sourceScope:scope,readingId,text:selection.text,kind,language:outputLanguage})}
        binding={{paperId,sourceScope:scope,readingId,text:selection.text,kind,language:outputLanguage}} primary={useAgent}
        onResult={activity=>{request.current++;setBusy(false);setError('');setResult(activity.result!.text);remember(activity.result!.text,kind,activity.source?.model || activity.source?.agent);setResultModel(activity.source?.model || activity.source?.agent || t('订阅助手','Subscription agent'));}}/>}
    </div></>, document.body)}</div>{active && entries.some(m=>m.hidden) && <button className="inline-memory-restore" onClick={()=>updateMemory(entries.map(m=>({...m,hidden:false})))}>{t("恢复隐藏标记","Restore hidden markers")}</button>}</>;
}
