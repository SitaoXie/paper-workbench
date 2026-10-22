import { useEffect, useState } from 'react';
import { Check, Copy, GitBranch, Pencil, RotateCcw } from 'lucide-react';
import type { Message, Paper } from './types';
import { portableAnswerMarkdown } from './portable-answer';
import { useLocale } from './i18n';
import './message-actions.css';

export default function MessageActions({ message, question, paper, busy, onBranch }: {
  message: Message;
  question?: Message;
  paper?: Paper;
  busy: boolean;
  onBranch: (message: Message, action: 'edit' | 'retry') => void;
}) {
  const { t, locale } = useLocale();
  const [copied, setCopied] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  const source = message.role === 'user' ? message : question;
  return <div className="message-actions">
    <button type="button" className="message-action" aria-label={message.role === 'user' ? t('复制问题', 'Copy question') : t('复制回答', 'Copy answer')}
      onClick={async () => {
        try { await navigator.clipboard.writeText(message.role === 'assistant' ? portableAnswerMarkdown(message.content, paper, locale) : message.content); setCopied(true); setError(''); }
        catch { setError(t('复制失败，请选中文字复制。', 'Could not copy. Select the text to copy it.')); }
      }}>
      {copied ? <Check size={13}/> : <Copy size={13}/>}
      <span>{copied ? t('已复制', 'Copied') : t('复制', 'Copy')}</span>
    </button>
    {source?.id && <>
      {message.role === 'user' && <button type="button" className="message-action" disabled={busy}
        title={t('保留原对话，在新分支中编辑这个问题', 'Keep this conversation and edit the question in a new branch')}
        aria-label={t('编辑问题并另开对话', 'Edit question in a new conversation')} onClick={() => onBranch(source, 'edit')}>
        <Pencil size={13}/><span>{t('编辑', 'Edit')}</span>
      </button>}
      <button type="button" className="message-action" disabled={busy}
        title={t('用当前模型重新回答，原回答保留在原对话中', 'Answer with the current model; keep this answer in its original conversation')}
        aria-label={t('在新对话中重新回答', 'Answer again in a new conversation')} onClick={() => onBranch(source, 'retry')}>
        <RotateCcw size={13}/><span>{t('重新回答', 'Answer again')}</span><GitBranch size={11}/>
      </button>
    </>}
    <span className="message-action-status" role="status">{error}</span>
  </div>;
}
