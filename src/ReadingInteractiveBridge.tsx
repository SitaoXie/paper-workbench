import {useEffect,useRef,useState} from 'react';
import {Check,Code2,Copy,Loader2,RefreshCw,X,ArrowUpRight} from 'lucide-react';
import {useLocale} from './i18n';

/** Subscription results remain separate until the reader explicitly opens the new version. */
export default function ReadingInteractiveBridge({task,target,resultReady,opening,stale,onRefresh,onOpen,onClose,onNewTask}:{
  task:string;target:string;resultReady:boolean;opening:boolean;stale:boolean;
  onRefresh:()=>Promise<void>;onOpen:()=>void;onClose:()=>void;onNewTask:()=>void;
}){
  const {t}=useLocale();
  const [copied,setCopied]=useState(false),[refreshing,setRefreshing]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
  const current=useRef(task),mounted=useRef(true);current.current=task;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  async function copy(){const captured=task;try{await navigator.clipboard.writeText(captured);if(mounted.current&&current.current===captured){setCopied(true);setError('');}}catch{if(mounted.current&&current.current===captured)setError(t('剪贴板不可用，请展开任务手动复制。','Clipboard unavailable. Expand the task and copy it manually.'));}}
  async function refresh(){
    const captured=task;setRefreshing(true);setNotice('');setError('');
    try{await onRefresh();if(mounted.current&&current.current===captured)setNotice(t('已检查本地结果；代理尚未保存时，可稍后再次刷新。','Checked local results. Refresh again if your agent has not saved yet.'));}
    catch(reason){if(mounted.current&&current.current===captured)setError(reason instanceof Error?reason.message:String(reason));}
    finally{if(mounted.current&&current.current===captured)setRefreshing(false);}
  }
  return <section className="reading-interactive-bridge" aria-label={t('订阅互动任务','Subscription interactive task')}>
    <header><strong><Code2 size={16}/>{t('用 Codex / Claude 制作互动版','Create an interactive version with Codex / Claude')}</strong><button type="button" className="icon-button" aria-label={t('关闭订阅互动任务','Close subscription interactive task')} onClick={onClose}><X size={16}/></button></header>
    <p>{target}</p><p className="muted-label">{t('在已登录的代理会话中粘贴任务。沿用原版语言、正文和图表，另存互动版；不会自动切换当前阅读。','Paste the task into your signed-in agent session. It preserves the original language, article and figures in a separate interactive version, without switching your current reading.')}</p>
    <div className="reading-interactive-bridge-actions">
      <button type="button" className="soft-button" onClick={()=>void copy()}>{copied?<Check size={14}/>:<Copy size={14}/>} {copied?t('已复制任务','Task copied'):t('复制互动任务','Copy interactive task')}</button>
      <button type="button" className="text-button" disabled={refreshing} onClick={()=>void refresh()}>{refreshing?<Loader2 size={14} className="spin"/>:<RefreshCw size={14}/>} {t('刷新互动结果','Refresh interactive result')}</button>
      {resultReady&&!stale&&<button type="button" className="soft-button" disabled={opening} onClick={onOpen}><ArrowUpRight size={14}/>{t('打开互动版','Open interactive version')}</button>}
    </div>
    <details><summary>{t('查看固定任务','View fixed task')}</summary><textarea readOnly rows={5} value={task} aria-label={t('固定版本互动任务','Fixed-version interactive task')}/></details>
    {stale?<div className="reading-interactive-stale" role="status"><p>{t('此任务的原版来源已变化。重新核对后可创建新任务，旧结果会保留。','This task’s original source has changed. Review it before creating a new task; existing results remain available.')}</p><button type="button" className="text-button" onClick={onNewTask}>{t('核对并创建新任务','Review and create a new task')}</button></div>:resultReady?<p className="reading-interactive-ready" role="status"><Check size={14}/>{t('互动版已保存，当前阅读保持不变。','The interactive version is saved. Your current reading is unchanged.')}</p>:notice&&<p role="status">{notice}</p>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
