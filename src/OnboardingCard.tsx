import { ArrowRight, BookOpen, Check, Code2, FolderOpen, Play, SlidersHorizontal, X } from 'lucide-react';
import { useLocale } from './i18n';
import './onboarding.css';

const ONBOARDING_KEY = 'paper-workbench:onboarding:v1';
let dismissedInMemory = false;

/** Optional browser preference only; blocked storage must never prevent reading. */
export function onboardingDismissed(): boolean {
  if (dismissedInMemory) return true;
  try { return typeof window !== 'undefined' && window.localStorage.getItem(ONBOARDING_KEY) === 'dismissed'; }
  catch { return false; }
}
export function dismissOnboarding(): void {
  dismissedInMemory = true;
  try { window.localStorage.setItem(ONBOARDING_KEY, 'dismissed'); } catch { /* Still dismiss for this page. */ }
}
export function reopenOnboarding(): void {
  dismissedInMemory = false;
  try { window.localStorage.removeItem(ONBOARDING_KEY); } catch { /* Explicit Help action still opens the guide. */ }
}

/** A nonblocking start card. Opening it never calls a model or changes the library. */
export default function OnboardingCard({ onDemo, onImport, onConfigure, onDismiss }: {
  onDemo: () => void;
  onImport: () => void;
  onConfigure: () => void;
  onDismiss?: () => void;
}) {
  const { t } = useLocale();
  return <section className="onboarding-card" aria-labelledby="onboarding-title">
    <div className="onboarding-heading">
      <div>
        <span className="onboarding-eyebrow">{t('开始你的阅读工作区', 'YOUR READING WORKSPACE')}</span>
        <h1 id="onboarding-title">{t('先读懂一篇，再开始下一篇。', 'Make your next paper make sense.')}</h1>
        <p>{t('把原文、解读和笔记放在一起。先体验一篇示例，或直接带来你的论文。', 'Keep the paper, explanations, and notes together. Explore a sample, or bring a paper of your own.')}</p>
      </div>
      {onDismiss && <button className="icon-button onboarding-dismiss" aria-label={t('暂时关闭入门指南', 'Dismiss getting started')} onClick={() => { dismissOnboarding(); onDismiss(); }}><X size={18}/></button>}
    </div>
    <div className="onboarding-paths">
      <button type="button" className="onboarding-path onboarding-demo" onClick={onDemo}>
        <span className="onboarding-path-icon"><Play size={21}/></span>
        <span className="onboarding-path-copy"><strong>{t('先体验示例', 'Explore the sample')}</strong><span>{t('看看解读、图表与来源跳转如何配合。', 'See readings, figures, and source links work together.')}</span><small><Check size={13}/>{t('无需 API · 不调用模型', 'No API key · No model calls')}</small></span>
        <ArrowRight size={18} className="onboarding-path-arrow"/>
      </button>
      <button type="button" className="onboarding-path" onClick={onImport}>
        <span className="onboarding-path-icon"><FolderOpen size={21}/></span>
        <span className="onboarding-path-copy"><strong>{t('导入自己的论文', 'Import your paper')}</strong><span>{t('上传 PDF 或粘贴论文链接，开始阅读和记笔记。', 'Upload a PDF or paste a paper link to read and annotate.')}</span><small>{t('基础阅读与笔记无需模型', 'Reading and notes work without a model')}</small></span>
        <ArrowRight size={18} className="onboarding-path-arrow"/>
      </button>
    </div>
    <div className="onboarding-ai">
      <div><SlidersHorizontal size={18}/><div><h2>{t('准备好使用 AI 时', 'When you want AI help')}</h2><p>{t('连接自己的 API，可在阅读器内生成解读和提问。也可以复制任务到已有的 Codex / Claude 会话，再把结果保存回来。', 'Connect your own API for readings and questions in the reader. Or copy a task into your existing Codex / Claude session and save the results back here.')}</p></div></div>
      <button type="button" className="soft-button" onClick={onConfigure}>{t('设置模型连接', 'Set up a model')}<ArrowRight size={14}/></button>
    </div>
    <ol className="onboarding-steps" aria-label={t('阅读流程', 'Reading workflow')}>
      <li><BookOpen size={16}/><span>{t('读原文', 'Read the paper')}</span></li>
      <li><Code2 size={16}/><span>{t('核对解读与引用', 'Check explanations and citations')}</span></li>
      <li><Check size={16}/><span>{t('保存值得记住的内容', 'Keep useful notes')}</span></li>
    </ol>
    <p className="onboarding-footnote">{t('文库保存在本机；使用远程模型时，所选内容会发送到你配置的服务。可以随时从「使用指南」重新打开这里。', 'Your library stays on this machine. Remote AI features send selected content to your configured provider. Reopen this guide anytime from Getting started.')}</p>
  </section>;
}
