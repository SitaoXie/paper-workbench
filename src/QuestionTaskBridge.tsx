import {useEffect,useState} from 'react';
import {Check,Copy,Loader2,RefreshCw,X} from 'lucide-react';
import {useLocale} from './i18n';

export type PreparedQuestionTask={task:string;question:string;paperId:string;conversationId:string;copied:boolean;clipboardError?:boolean};
export default function QuestionTaskBridge({binding,onClose,onRefresh}:{binding:PreparedQuestionTask;onClose:()=>void;onRefresh:()=>Promise<void>}){
  const {t}=useLocale();
  const [expanded,setExpanded]=useState(!!binding.clipboardError),[copied,setCopied]=useState(binding.copied),[refreshing,setRefreshing]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState(binding.clipboardError?t('剪贴板不可用，可在下方手动复制。','Clipboard unavailable. Copy the task manually below.'):'');
  useEffect(()=>{setCopied(binding.copied);if(binding.clipboardError){setExpanded(true);setError(t('剪贴板不可用，可在下方手动复制。','Clipboard unavailable. Copy the task manually below.'));}},[binding.copied,binding.clipboardError]);
  async function copy(){try{await navigator.clipboard.writeText(binding.task);setCopied(true);setError('');}catch{setExpanded(true);setError(t('剪贴板不可用，可在下方手动复制。','Clipboard unavailable. Copy the task manually below.'));}}
  async function refresh(){setRefreshing(true);setNotice('');setError('');try{await onRefresh();setNotice(t('已检查此会话；代理保存后，回答会显示在上方。','Checked this conversation. Saved agent answers appear above.'));}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setRefreshing(false);}}
  return <section className="question-task-bridge" aria-label={t('订阅问答任务','Subscription question task')}>
    <header><strong>{t('订阅任务已准备','Subscription task ready')}</strong><button type="button" className="icon-button" aria-label={t('关闭订阅问答任务','Close subscription question task')} onClick={onClose}><X size={14}/></button></header>
    <p>{t('粘贴到已登录的 Codex / Claude 会话中执行。应用尚未提交此问题。','Paste into your signed-in Codex / Claude session. The app has not submitted this question.')}</p>
    <div className="question-task-actions"><button type="button" className="text-button" onClick={()=>void copy()}>{copied?<Check size={13}/>:<Copy size={13}/>} {copied?t('已复制任务','Task copied'):t('复制任务','Copy task')}</button><button type="button" className="text-button" disabled={refreshing} onClick={()=>void refresh()}>{refreshing?<Loader2 size={13} className="spin"/>:<RefreshCw size={13}/>} {t('刷新回答','Refresh answer')}</button><button type="button" className="text-button" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?t('收起任务文本','Hide task text'):t('显示任务文本','Show task text')}</button></div>
    {expanded&&<div><small className="question-task-question">{binding.question}</small><textarea rows={4} readOnly value={binding.task} aria-label={t('订阅问答任务文本','Subscription question task text')}/></div>}
    {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
  </section>;
}
