import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Loader2, RefreshCw } from 'lucide-react';
import { api, type Activity } from './types';
import { getLocale, t } from './i18n';
import { activityMatchesSelectionTask, buildSelectionAgentTask, prepareSelectionAgentTask, type SelectionTaskBinding } from './selection-agent-task';
import './selection-agent.css';

/** Mount with a key derived from the selection binding. Late responses cannot
 * publish a different selection's answer after this bridge is unmounted. */
export default function AgentSelectionBridge({ binding, primary = false, onResult }: {
  binding: SelectionTaskBinding; primary?: boolean; onResult: (activity: Activity) => void;
}) {
  const [task] = useState(() => prepareSelectionAgentTask(binding, sessionStorage));
  const [expanded, setExpanded] = useState(primary), [manual, setManual] = useState(false);
  const [copied, setCopied] = useState(false), [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState('');
  const alive = useRef(true), pending = useRef(false);
  useEffect(()=>{if(primary)setExpanded(true);},[primary]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const taskText = buildSelectionAgentTask(task, location.origin, getLocale());
  async function copy() {
    setError('');
    try { await navigator.clipboard.writeText(taskText); if (alive.current) { setCopied(true); setStatus(t('将任务粘贴到已登录的 Codex 或 Claude。完成后在这里刷新结果。', 'Paste the task into your signed-in Codex or Claude session, then refresh here when it finishes.')); } }
    catch { if (alive.current) { setManual(true); setStatus(t('可在下方选择并复制完整任务。', 'Select and copy the complete task below.')); } }
  }
  async function refresh() {
    if (pending.current) return; pending.current = true; setBusy(true); setError(''); setStatus('');
    try {
      const data = await api<{ activities: Activity[] }>(`/papers/${encodeURIComponent(task.paperId)}/activities?agentTaskId=${encodeURIComponent(task.agentTaskId)}`);
      if (!alive.current) return;
      const matches = data.activities.filter(activity => activityMatchesSelectionTask(activity, task));
      if (matches.length === 1) { onResult(matches[0]); setStatus(t('已载入订阅助手结果，并保留在选文历史中。', 'Loaded the agent result. It is also saved in selection history.')); }
      else if (data.activities.length) setError(t('返回结果与这段选文、语言或版本不匹配，未应用。', 'The result does not match this selection, language or version and was not applied.'));
      else setStatus(t('此任务还没有结果。代理完成保存后可再刷新。', 'No result for this task yet. Refresh after your agent has saved it.'));
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : t('读取失败，请重试。', 'Could not load the result. Try again.')); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  return <div className="selection-agent-bridge">
    <button className="selection-agent-toggle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{t('使用 Codex / Claude 订阅助手', 'Use your Codex / Claude subscription')}</button>
    {expanded && <div className="selection-agent-content">
      <p>{t('用现有订阅处理这段选文，结果会显示在这里。', 'Use your existing subscription for this passage; its result appears here.')}</p>
      <div className="selection-agent-buttons"><button onClick={() => void copy()}>{copied ? <Check size={14}/> : <Copy size={14}/>} {copied ? t('已复制任务', 'Task copied') : t('复制选文任务', 'Copy selection task')}</button><button disabled={busy} onClick={() => void refresh()}>{busy ? <Loader2 size={14} className="spin"/> : <RefreshCw size={14}/>} {t('刷新外部结果', 'Refresh agent result')}</button></div>
      {status && <p role="status">{status}</p>}{error && <p role="alert">{error}</p>}
      <button className="selection-agent-manual" onClick={() => setManual(value => !value)}>{manual ? t('收起任务文本', 'Hide task text') : t('查看任务文本', 'Show task text')}</button>
      {manual && <textarea readOnly aria-label={t('订阅助手选文任务', 'Subscription selection task')} value={taskText} onFocus={event => event.currentTarget.select()}/>}
    </div>}
  </div>;
}
