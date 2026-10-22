import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Copy, Languages, Loader2, MessageSquare, RefreshCw, X } from 'lucide-react';
import { api } from './types';
import { t, getLocale } from './i18n';
import { selectionErrorMessage } from './selection-errors';
import Mark from './Markdown';
import AgentSelectionBridge from './AgentSelectionBridge';
import { selectionBindingKey } from './selection-agent-task';
import { readSelectionExecution, saveSelectionExecution, type SelectionExecution } from './selection-execution';
import './selection-tools.css';

type Selection = { text: string; tooLong?: boolean; top: number; left: number };
export default function SelectionTools({ children, paperId, readingId, scope, language, model, modelReady = true, onAsk, sourceLabel, active = true }: {
  children: ReactNode; paperId: string; readingId?: string; scope: 'reading' | 'abstract'; language: string;
  model?: string; modelReady?: boolean; active?: boolean; sourceLabel?: string;
  onAsk: (text: string, label: string, question?: string, source?: {sourceScope:'reading'|'abstract';readingId?:string}) => Promise<boolean>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
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
  const request = useRef(0), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const label = sourceLabel || (scope === 'reading' ? t('解读选文 · AI生成内容', 'Overview selection · AI-generated text') : t('原始摘要选文', 'Original abstract selection'));
  function dismiss() { request.current++; selectionKey.current=''; setSelection(undefined); setQuestion(''); setResult(''); setResultModel(''); setError(''); setBusy(false); setAssisted(false); setAsking(false); setAskFailed(false); askingRef.current=false; }
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
        if (askingRef.current || popup.current?.contains(document.activeElement)) return;
        const selected = window.getSelection();
        if (!selected?.rangeCount || selected.isCollapsed) return;
        const range = selected.getRangeAt(0);
        if (!host.current?.contains(range.commonAncestorContainer)) return;
        const text = selected.toString().trim();
        if (text.length < 2) return;
        const key=`${text.length}:${text.slice(0,12000)}`;
        if (selectionKey.current===key) return;
        selectionKey.current=key;
        const rect = range.getBoundingClientRect(), width = Math.min(380, window.innerWidth - 24);
        request.current++; setAssisted(false); setAskFailed(false); setQuestion(''); setResult(''); setResultModel(''); setError(''); setBusy(false);
        setSelection({text: text.slice(0,12000),tooLong:text.length>12000,left:Math.max(12,Math.min(rect.left,window.innerWidth-width-12)),top:Math.max(12,Math.min(rect.bottom+10,window.innerHeight-300))});
      },120);
    };
    const outside = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node) && !host.current?.contains(event.target as Node)) dismiss(); };
    const escape = (event: KeyboardEvent) => { if(event.key==='Escape') dismiss(); };
    document.addEventListener('selectionchange',capture);
    document.addEventListener('pointerdown',outside);
    document.addEventListener('keydown',escape);
    return () => { request.current++; clearTimeout(timer.current); document.removeEventListener('selectionchange',capture); document.removeEventListener('pointerdown',outside); document.removeEventListener('keydown',escape); };
  },[paperId,readingId,language,active]);
  useEffect(()=>{ dismiss(); },[paperId,readingId,language]);
  useEffect(()=>{ setOutputLanguage(language); },[language]);
  async function assist(nextKind: 'translation'|'explanation') {
    if (!selection || selection.tooLong || busy || askingRef.current) return;
    const token=++request.current;
    setAskFailed(false); setAssisted(true); setKind(nextKind); setBusy(!useAgent); setError(''); setResult(''); setResultModel('');
    setSelection(old => old ? {...old,top:Math.max(12,Math.min(old.top,window.innerHeight-430))} : old);
    if (useAgent) return;
    try {
      const response=await api<{result:{text:string,source?:{model?:string}}}>(`/papers/${paperId}/assist`,{method:'POST',body:JSON.stringify({sourceScope:scope,readingId,text:selection.text,kind:nextKind,language:outputLanguage})});
      if(token===request.current) { setResult(response.result.text); setResultModel(response.result.source?.model || ''); }
    } catch(e) { if(token===request.current) setError(selectionErrorMessage(e, getLocale())); }
    finally { if(token===request.current) setBusy(false); }
  }
  async function copy() { try { await navigator.clipboard.writeText(result || selection?.text || ''); setCopied(true); setTimeout(()=>setCopied(false),1500); } catch { setError(t('无法访问剪贴板，请直接选择文本复制。','Clipboard unavailable. Select and copy the text directly.')); } }
  return <div className="selection-source" ref={host}>{children}{active && selection && createPortal(
    <div className="overview-selection" ref={popup} role="dialog" aria-label={t('选文操作','Selection actions')} style={{top:selection.top,left:selection.left,maxHeight:`min(430px, calc(100dvh - ${selection.top+12}px))`}}>
      <header><span>{label}</span><button className="icon-button" aria-label={t('关闭选文操作','Close selection actions')} onClick={dismiss}><X size={16}/></button></header>
      <blockquote>{selection.text}</blockquote>
      <div className="overview-selection-options">
        <label>{t('结果语言','Result language')}<select aria-label={t('选文结果语言','Selection result language')} value={outputLanguage.startsWith('en')?'en':'zh-CN'} disabled={busy || asking} onChange={event=>{setOutputLanguage(event.target.value);setResult('');setError('');setResultModel('');}}><option value="zh-CN">中文</option><option value="en">English</option></select></label>
        {(resultModel || (!useAgent && model)) && <span title={resultModel || model}>{resultModel || model}</span>}
      </div>
      <label className="selection-execution">{t('处理方式','Process with')}<select aria-label={t('选文处理方式','Selection processing method')} value={useAgent?'agent':'api'} disabled={busy || asking} onChange={event=>{const value=event.target.value as SelectionExecution;setExecution(value);saveSelectionExecution(value);}}><option value="api" disabled={!modelReady}>{t('模型 API','Model API')}</option><option value="agent">Codex / Claude</option></select></label>
      <input className="overview-selection-question" aria-label={t('针对摘要选文的问题','Question about the overview selection')} placeholder={t('针对选文写个问题…','Ask about this passage…')} value={question} disabled={asking} maxLength={4000} onChange={event=>setQuestion(event.target.value)} onKeyDown={event=>{if(event.key==='Enter' && !event.nativeEvent.isComposing) {event.preventDefault();ask();}}}/>
      <div className="overview-selection-actions">
        <button onClick={()=>void assist('translation')} disabled={selection.tooLong || busy || asking}><Languages size={15}/>{t('翻译','Translate')}</button>
        <button onClick={()=>void assist('explanation')} disabled={selection.tooLong || busy || asking}><BookOpen size={15}/>{t('解释','Explain')}</button>
        <button onClick={()=>void ask()} disabled={selection.tooLong || asking}><MessageSquare size={15}/>{t('提问','Ask')}</button>
      </div>
      {selection.tooLong && <p role="alert" className="reading-inline-error">{t('选文过长，请缩短至 12,000 字以内后再操作。','This selection is too long. Select at most 12,000 characters before continuing.')}</p>}
      {asking && <p className="selection-pending" role="status"><Loader2 size={15} className="spin"/>{t("正在创建提问会话…","Creating a question session…")}</p>}
      {busy && <p className="selection-pending" role="status"><Loader2 size={15} className="spin"/>{t('正在阅读选文…','Reading the selection…')}</p>}
      {error && <div role="alert" className="reading-inline-error"><span>{error}</span>{!selection.tooLong && <button onClick={()=>void (askFailed ? ask() : assist(kind))} disabled={busy || asking}><RefreshCw size={14}/>{t('重试','Retry')}</button>}</div>}
      {result && <><div className="overview-selection-result prose"><Mark>{result}</Mark></div><button className="text-button" onClick={()=>void copy()}><Copy size={14}/>{copied?t('已复制','Copied'):t('复制结果','Copy result')}</button></>}
      {assisted && <AgentSelectionBridge key={selectionBindingKey({paperId,sourceScope:scope,readingId,text:selection.text,kind,language:outputLanguage})}
        binding={{paperId,sourceScope:scope,readingId,text:selection.text,kind,language:outputLanguage}} primary={useAgent}
        onResult={activity=>{request.current++;setBusy(false);setError('');setResult(activity.result!.text);setResultModel(activity.source?.model || activity.source?.agent || t('订阅助手','Subscription agent'));}}/>}
    </div>, document.body)}</div>;
}
