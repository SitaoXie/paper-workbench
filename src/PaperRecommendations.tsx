import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, RefreshCw, Settings2, Sparkles } from 'lucide-react';
import { api, type Paper, type Settings } from './types';
import { useLocale } from './i18n';
import { loadPaperRecommendations, paperRecommendationIdentity, consumeRecommendationRefresh, type PaperRecommendation } from './paper-recommendations';
import './paper-recommendations.css';

export default function PaperRecommendations({ paper, settings, language, hasConversation, disabled, onQuestion, onConfigure }: {
  paper: Paper; settings: Settings; language: string; hasConversation: boolean; disabled: boolean;
  onQuestion: (question: string) => void; onConfigure: () => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(!hasConversation);
  const [result, setResult] = useState<PaperRecommendation | null>(null);
  const [error, setError] = useState<{ identity: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState({ sequence: 0, identity: '', refresh: false });
  const consumedAttempt = useRef(0);
  const enabled = settings.recommendations?.enabled === true;
  const resultLanguage = language.startsWith('zh') ? 'zh-CN' : 'en';
  const identity = paperRecommendationIdentity(paper, resultLanguage, settings);
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  const resultIdentity = useRef('');
  useEffect(() => { if (hasConversation) setOpen(false); }, [hasConversation]);
  useEffect(() => {
    const request = new AbortController();
    const refresh = consumeRecommendationRefresh(attempt, identity, consumedAttempt);
    setError(null);
    if (resultIdentity.current !== identity) setResult(null);
    if (!enabled) { setBusy(false); return () => request.abort(); }
    setBusy(true);
    loadPaperRecommendations(api, { paperId: paper.id, language: resultLanguage, enabled, refresh, signal: request.signal })
      .then(response => {
        if (request.signal.aborted || currentIdentity.current !== identity) return;
        resultIdentity.current = identity;
        setResult(response.enabled ? response.recommendation : null);
      }).catch(reason => {
        if (!request.signal.aborted && currentIdentity.current === identity) setError({ identity, message: reason.message });
      }).finally(() => {
        if (!request.signal.aborted && currentIdentity.current === identity) setBusy(false);
      });
    return () => request.abort();
  }, [identity, attempt]);
  if (!enabled) return null;
  const visible = resultIdentity.current === identity ? result : null;
  const visibleError = error?.identity === identity ? error.message : '';
  const angle = (value: string) => ({ understanding: t('理解核心', 'Understand'), method: t('拆解方法', 'Method'), evidence: t('核对证据', 'Evidence'), limitations: t('检视边界', 'Limitations'), extension: t('进一步探索', 'Explore further') })[value] || '';
  return <section className="paper-recommendations" aria-label={t('探索这篇论文', 'Explore this paper')}>
    <div className="recommendations-heading">
      <button type="button" className="recommendations-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <Sparkles size={15}/><span>{t('探索这篇论文', 'Explore this paper')}</span>
        {visible && <small>{visible.questions.length}</small>}<ChevronDown size={14} className={open ? 'expanded' : ''}/>
      </button>
      <button type="button" className="icon-button" onClick={onConfigure} title={t('推荐问题设置', 'Question recommendation settings')} aria-label={t('推荐问题设置', 'Question recommendation settings')}><Settings2 size={14}/></button>
    </div>
    {open && <div className="recommendations-body">
      <p className="recommendations-help">{t('根据原文生成；点击填入草稿，修改后再发送。', 'Grounded in source text. Choose a question to edit before sending.')}</p>
      {busy && <p className="recommendations-status" role="status"><Loader2 size={13} className="spin"/>{t('正在寻找值得追问的问题…', 'Finding questions to explore…')}</p>}
      {visible && <ol className="recommendations-questions">{visible.questions.map(item => <li key={item.id}><button type="button" disabled={disabled} onClick={() => onQuestion(item.question)}>{angle(item.angle) && <small>{angle(item.angle)}</small>}{item.question}</button></li>)}</ol>}
      {visibleError && <p className="recommendations-error" role="alert">{t('推荐问题暂时不可用：', 'Question recommendations are unavailable: ')}{visibleError}</p>}
      <div className="recommendations-footer"><span>{visible?.source.model || settings.recommendations?.model}</span><button type="button" className="text-button" disabled={busy} onClick={() => setAttempt(value => ({ sequence: value.sequence + 1, identity, refresh: !!visible }))}><RefreshCw size={12}/>{visibleError ? t('重试', 'Retry') : t('换一组', 'New questions')}</button></div>
      <p className="recommendations-cost">{t('生成会使用推荐模型 API，计入 API 用量。可在设置中关闭。', 'Generation uses the recommendation model API and is tracked in API usage. Disable it in settings.')}</p>
    </div>}
  </section>;
}
