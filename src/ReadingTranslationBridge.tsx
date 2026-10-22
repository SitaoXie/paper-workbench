import {useEffect,useRef,useState} from 'react';
import {Check,Code2,Copy,Loader2,RefreshCw,X} from 'lucide-react';
import {useLocale} from './i18n';

/** A fixed, manually executed subscription handoff. This panel never starts inference. */
export default function ReadingTranslationBridge({task,target,ready,onRefresh,onClose}:{
  task:string;target:string;ready:boolean;onRefresh:()=>Promise<void>;onClose:()=>void;
}){
  const {t}=useLocale();
  const [copied,setCopied]=useState(false),[refreshing,setRefreshing]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
  const current=useRef(task),mounted=useRef(true);current.current=task;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{setCopied(false);setNotice('');setError('');},[task]);
  async function copy(){
    const captured=task;
    try{await navigator.clipboard.writeText(captured);if(mounted.current&&current.current===captured){setCopied(true);setError('');}}
    catch{if(mounted.current&&current.current===captured)setError(t('剪贴板不可用，请展开固定任务手动复制。','Clipboard unavailable. Expand the fixed task and copy it manually.'));}
  }
  async function refresh(){
    const captured=task;setRefreshing(true);setError('');setNotice('');
    try{await onRefresh();if(mounted.current&&current.current===captured)setNotice(t('已检查本地结果；代理尚未写回时，可稍后再刷新。','Checked local results. Refresh again if your agent has not saved its result yet.'));}
    catch(reason){if(mounted.current&&current.current===captured)setError(reason instanceof Error?reason.message:String(reason));}
    finally{if(mounted.current&&current.current===captured)setRefreshing(false);}
  }
  return <section className="reading-translation-bridge" aria-label={t('订阅翻译任务','Subscription translation task')}>
    <header><strong><Code2 size={16}/>{t('用 Codex / Claude 翻译','Translate with Codex / Claude')}</strong><button type="button" className="icon-button" aria-label={t('关闭订阅翻译任务','Close subscription translation task')} onClick={onClose}><X size={16}/></button></header>
    <p>{target}</p>
    <p className="muted-label">{t('在已登录的代理会话中粘贴任务。译文写回同一版本，原文和现有版本保留。','Paste the task into your signed-in agent session. Its translation returns to this version; originals and existing versions stay available.')}</p>
    <div className="reading-translation-bridge-actions">
      <button type="button" className="soft-button" onClick={()=>void copy()}>{copied?<Check size={14}/>:<Copy size={14}/>} {copied?t('已复制任务','Task copied'):t('复制翻译任务','Copy translation task')}</button>
      <button type="button" className="text-button" disabled={refreshing} onClick={()=>void refresh()}>{refreshing?<Loader2 size={14} className="spin"/>:<RefreshCw size={14}/>} {t('刷新译文','Refresh translation')}</button>
    </div>
    <details><summary>{t('查看固定任务','View fixed task')}</summary><textarea readOnly rows={5} value={task} aria-label={t('固定版本翻译任务','Fixed-version translation task')}/></details>
    {ready?<p className="reading-translation-ready" role="status"><Check size={14}/>{t('此版本的目标语言内容已可用，请核对译文与原文。','The requested content is available for this version. Compare it with the original.')}</p>:notice&&<p role="status">{notice}</p>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
