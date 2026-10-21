import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Copy, Languages, Loader2, MessageSquare, RefreshCw, X } from 'lucide-react';
import { api } from './types';
import { t } from './i18n';
import Mark from './Markdown';
import './selection-tools.css';

type Selection = { text: string; top: number; left: number };
export default function SelectionTools({ children, paperId, readingId, scope, language, model, onAsk }: {
  children: ReactNode; paperId: string; readingId?: string; scope: 'reading' | 'abstract'; language: string;
  model?: string;
  onAsk: (text: string, label: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [selection,setSelection] = useState<Selection>();
  const [kind,setKind] = useState<'translation'|'explanation'>('explanation');
  const [outputLanguage,setOutputLanguage] = useState(language);
  const [resultModel,setResultModel] = useState('');
  const [result,setResult] = useState(''), [error,setError] = useState(''), [busy,setBusy] = useState(false), [copied,setCopied] = useState(false);
  const request = useRef(0), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const label = scope === 'reading' ? t('解读选文 · AI生成内容', 'Overview selection · AI-generated text') : t('原始摘要选文', 'Original abstract selection');
  function dismiss() { request.current++; setSelection(undefined); setResult(''); setResultModel(''); setError(''); setBusy(false); }
  useEffect(() => {
    const capture = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const selected = window.getSelection();
        if (!selected?.rangeCount || selected.isCollapsed) return;
        const range = selected.getRangeAt(0);
        if (!host.current?.contains(range.commonAncestorContainer)) return;
        const text = selected.toString().trim();
        if (text.length < 2) return;
        const rect = range.getBoundingClientRect(), width = Math.min(380, window.innerWidth - 24);
        request.current++; setResult(''); setResultModel(''); setError(text.length > 12000 ? t('选文过长，请缩短至12,000字以内。','Selection is too long. Select fewer than 12,000 characters.') : ''); setBusy(false);
        setSelection({text: text.slice(0,12000),left:Math.max(12,Math.min(rect.left,window.innerWidth-width-12)),top:Math.max(12,Math.min(rect.bottom+10,window.innerHeight-300))});
      },120);
    };
    const outside = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node) && !host.current?.contains(event.target as Node)) dismiss(); };
    const escape = (event: KeyboardEvent) => { if(event.key==='Escape') dismiss(); };
    document.addEventListener('selectionchange',capture);
    document.addEventListener('pointerdown',outside);
    document.addEventListener('keydown',escape);
    return () => { request.current++; clearTimeout(timer.current); document.removeEventListener('selectionchange',capture); document.removeEventListener('pointerdown',outside); document.removeEventListener('keydown',escape); };
  },[paperId,readingId,language]);
  useEffect(()=>{ dismiss(); },[paperId,readingId,language]);
  useEffect(()=>{ setOutputLanguage(language); },[language]);
  async function assist(nextKind: 'translation'|'explanation') {
    if (!selection || busy) return;
    const token=++request.current;
    setKind(nextKind); setBusy(true); setError(''); setResult(''); setResultModel('');
    setSelection(old => old ? {...old,top:Math.max(12,Math.min(old.top,window.innerHeight-430))} : old);
    try {
      const response=await api<{result:{text:string,source?:{model?:string}}}>(`/papers/${paperId}/assist`,{method:'POST',body:JSON.stringify({sourceScope:scope,readingId,text:selection.text,kind:nextKind,language:outputLanguage})});
      if(token===request.current) { setResult(response.result.text); setResultModel(response.result.source?.model || ''); }
    } catch(e) { if(token===request.current) setError((e as Error).message); }
    finally { if(token===request.current) setBusy(false); }
  }
  async function copy() { try { await navigator.clipboard.writeText(result || selection?.text || ''); setCopied(true); setTimeout(()=>setCopied(false),1500); } catch { setError(t('无法访问剪贴板，请直接选择文本复制。','Clipboard unavailable. Select and copy the text directly.')); } }
  return <div className="selection-source" ref={host}>{children}{selection && createPortal(
    <div className="overview-selection" ref={popup} role="dialog" aria-label={t('选文操作','Selection actions')} style={{top:selection.top,left:selection.left,maxHeight:`min(430px, calc(100dvh - ${selection.top+12}px))`}}>
      <header><span>{label}</span><button className="icon-button" aria-label={t('关闭选文操作','Close selection actions')} onClick={dismiss}><X size={16}/></button></header>
      <blockquote>{selection.text}</blockquote>
      <div className="overview-selection-options">
        <label>{t('结果语言','Result language')}<select aria-label={t('选文结果语言','Selection result language')} value={outputLanguage.startsWith('en')?'en':'zh-CN'} disabled={busy} onChange={event=>{setOutputLanguage(event.target.value);setResult('');setError('');setResultModel('');}}><option value="zh-CN">中文</option><option value="en">English</option></select></label>
        {(resultModel || model) && <span title={resultModel || model}>{resultModel || model}</span>}
      </div>
      <div className="overview-selection-actions">
        <button onClick={()=>void assist('translation')} disabled={busy}><Languages size={15}/>{t('翻译','Translate')}</button>
        <button onClick={()=>void assist('explanation')} disabled={busy}><BookOpen size={15}/>{t('解释','Explain')}</button>
        <button onClick={()=>{ onAsk(selection.text,label); dismiss(); window.getSelection()?.removeAllRanges(); }}><MessageSquare size={15}/>{t('提问','Ask')}</button>
      </div>
      {busy && <p className="selection-pending" role="status"><Loader2 size={15} className="spin"/>{t('正在阅读选文…','Reading the selection…')}</p>}
      {error && <div role="alert" className="reading-inline-error"><span>{error}</span><button onClick={()=>void assist(kind)} disabled={busy}><RefreshCw size={14}/>{t('重试','Retry')}</button></div>}
      {result && <><div className="overview-selection-result prose"><Mark>{result}</Mark></div><button className="text-button" onClick={()=>void copy()}><Copy size={14}/>{copied?t('已复制','Copied'):t('复制结果','Copy result')}</button></>}
    </div>, document.body)}</div>;
}
