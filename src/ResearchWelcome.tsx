import { ArrowUpRight, BookOpen, FlaskConical, Layers3, Sparkles } from 'lucide-react';
import { useLocale } from './i18n';

/** Suggestions prepare an editable question; choosing one never starts a paid call. */
export default function ResearchWelcome({ hasPapers, disabled, onQuestion, onImport }: {
  hasPapers: boolean; disabled: boolean; onQuestion: (question: string) => void; onImport: () => void;
}) {
  const { t } = useLocale();
  const suggestions = [
    { icon: BookOpen, title: t('梳理研究方向', 'Map the research'), question: t('请根据文库中的论文，梳理主要研究方向，并注明每个结论对应的论文。', 'Map the main research directions in my library and cite the papers supporting each finding.') },
    { icon: Layers3, title: t('比较方法与证据', 'Compare approaches'), question: t('比较文库中相关论文的方法、实验设置和结论，说明哪些结果可以直接比较，哪些不可以。', 'Compare related papers in my library: their methods, experimental settings and findings. Explain which results are directly comparable and which are not.') },
    { icon: FlaskConical, title: t('发现值得追问的问题', 'Find open questions'), question: t('基于文库中论文的证据，找出值得进一步研究的问题。区分作者提出的局限与你的推测。', 'Identify open research questions grounded in the papers in my library. Distinguish limitations stated by the authors from your own hypotheses.') },
  ];
  return <div className="research-welcome">
    <span className="research-symbol" aria-hidden="true"><Sparkles size={24} strokeWidth={1.5}/></span>
    <h1>{t('从论文，到新的思路', 'Find your next research question')}</h1>
    <p>{hasPapers
      ? t('围绕文库中的论文，比较方法、追问证据，整理你的研究思路。', 'Explore your library, compare methods, and follow the evidence.')
      : t('先导入一篇论文，再从一个具体问题开始。', 'Import a paper, then start with a question.')}</p>
    {hasPapers ? <div className="research-suggestions" aria-label={t('问题灵感', 'Question starters')}>
      {suggestions.map(({ icon: Icon, title, question }) => <button type="button" key={title} disabled={disabled} onClick={() => onQuestion(question)} title={question}>
        <Icon size={17}/><span>{title}</span><ArrowUpRight size={14}/>
      </button>)}
    </div> : <button type="button" className="soft-button research-import" disabled={disabled} onClick={onImport}><BookOpen size={16}/>{t('导入第一篇论文', 'Import your first paper')}</button>}
  </div>;
}
