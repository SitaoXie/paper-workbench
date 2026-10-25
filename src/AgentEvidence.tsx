export type AgentEvidenceData = {
  version: number; webEnabled: boolean; modelCalls: number; limitReached: boolean;
  initialSources?: { paperId: string; title: string; coverage: string; characters: number }[];
  steps: { tool: string; ok: boolean; query?: string; error?: string; provider?: string;
    references: { paperId?: string; title?: string; page?: number | null; url?: string; start?: number; end?: number; complete?: boolean }[] }[];
};

export default function AgentEvidence({ evidence, chinese, onPage, paperId }: {
  evidence?: AgentEvidenceData; chinese: boolean; onPage?: (page: number) => void; paperId?: string;
}) {
  if (!evidence || evidence.version !== 1 || !Array.isArray(evidence.steps)) return null;
  const names: Record<string, string> = chinese
    ? { search_papers: '检索论文', read_pages: '读取原文页', search_web: '搜索网页', read_webpage: '读取网页' }
    : { search_papers: 'Search papers', read_pages: 'Read pages', search_web: 'Search web', read_webpage: 'Read webpage' };
  return <details className="agent-evidence">
    <summary>{chinese ? '检索与来源' : 'Retrieval & sources'} · {evidence.steps.length} {chinese ? '步' : 'steps'}</summary>
    <p>{evidence.webEnabled ? (chinese ? '允许联网' : 'Web enabled') : (chinese ? '未开启联网' : 'Web disabled')} · {evidence.modelCalls} {chinese ? '次模型调用' : 'model calls'}</p>
    {!!evidence.initialSources?.length && <p>{chinese ? '初始资料：' : 'Initial sources: '}{evidence.initialSources.map(source => `${source.title} (${source.coverage === 'full-text-extracted' ? (chinese ? '已提取全文' : 'extracted full text') : source.coverage === 'abstract-only' ? (chinese ? '仅摘要' : 'abstract only') : (chinese ? '原文片段' : 'source excerpts')})`).join(' · ')}</p>}
    {!evidence.steps.length && <p>{chinese ? '依据初始提供的资料回答，未调用检索工具。' : 'Answered from initial context; no retrieval tools were called.'}</p>}
    {evidence.limitReached && <p>{chinese ? '已达到检索预算；回答可能仍有证据缺口。' : 'Retrieval budget reached; evidence gaps may remain.'}</p>}
    <ol>{evidence.steps.map((step, i) => <li key={i}>
      <strong>{names[step.tool] || step.tool}</strong>{step.provider && <span> · {step.provider}</span>}{step.query && <span> · {step.query}</span>}
      {!step.ok && <p role="note">{chinese ? '未获取证据' : 'No evidence retrieved'}: {step.error}</p>}
      {step.references.map((ref, j) => {
        const label = `${ref.title || ''}${ref.page ? ` · p.${ref.page}` : ''}`;
        const url = ref.url && /^https?:\/\//i.test(ref.url) ? ref.url : undefined;
        return <div key={j}>{url ? <a href={url} target="_blank" rel="noreferrer">{label || url}</a>
          : ref.page && ref.paperId === paperId && onPage ? <button type="button" onClick={() => onPage(ref.page!)}>{label}</button>
          : ref.paperId ? <a href={`/${chinese ? 'zh' : 'en'}/?paper=${encodeURIComponent(ref.paperId)}${ref.page ? `#page=${ref.page}` : ''}`}>{label}</a> : <span>{label}</span>}
          {ref.complete === false && <small> · {chinese ? '部分原文' : 'excerpt'}</small>}
        </div>;
      })}
    </li>)}</ol>
  </details>;
}
