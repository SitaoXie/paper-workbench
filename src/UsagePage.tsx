import { useEffect, useState } from 'react';
import { BarChart3, RefreshCw, Settings2, Database } from 'lucide-react';
import { api, type Settings } from './types';
import { useLocale } from './i18n';
import './usage.css';

import type {Field,Summary,Model,Usage} from './usage-types';
import UsageDashboard from './UsageDashboard';

export default function UsagePage({settings,onConfigure}:{settings:Settings;onConfigure:()=>void}) {
  const { t, locale } = useLocale();
  const [days, setDays] = useState('30'), [model, setModel] = useState(''), [offset, setOffset] = useState(0), [revision, setRevision] = useState(0);
  const [models, setModels] = useState<Model[]>([]);
  const [data, setData] = useState<Usage>(), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const profiles=settings.profiles || [];
  const active=profiles.find(profile=>profile.id===settings.activeProfileId);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const number = (value: number | null) => value === null ? '—' : value.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en');
  const date = (value: string) => new Date(value).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en', { timeZone });
  const operation = (value: string) => ({
    reading: t('阅读解读', 'Reading'), question: t('问答', 'Questions'), translation: t('翻译', 'Translation'),
    'passage-translation': t('选文翻译', 'Passage translation'), 'passage-explanation': t('选文解释', 'Passage explanation'),
    vision: t('图像理解', 'Vision'), recommendations: t('推荐问题', 'Suggested questions'), 'connection-test': t('连接测试', 'Connection test'), other: t('其他', 'Other'),
  })[value] || value;
  const stage = (value?: string) => value ? ({draft:t('初稿','Draft'),review:t('审查','Review'),edit:t('编辑','Edit'),interactive:t('交互版','Interactive'),captions:t('图注','Captions'),'question-starters':t('探索问题','Question starters')})[value] || value : '';
  const status = (value: string) => value === 'success' ? t('成功', 'Success') : value === 'incomplete' ? t('输出截断', 'Truncated') : t('失败', 'Failed');
  const value = (group: Summary, field: Field) => group.requests && !group.reported[field] ? t('未返回', 'Unreported')
    : `${group.reported[field] < group.requests && group.totals[field] !== null ? '≥ ' : ''}${number(group.totals[field])}`;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    const query = new URLSearchParams({ days, timeZone, offset: String(offset), ...(model ? { model } : {}) });
    api<Usage>(`/usage?${query}`, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) { setData(result); setModels(result.models); }
    }).catch(reason => { if (!controller.signal.aborted) { setError(reason.message); setData(undefined); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [days, model, offset, timeZone, revision]);
  return <section className="usage-page" aria-label={t('API 用量', 'API usage')}>
    <header className="page-header"><div className="breadcrumb"><BarChart3 size={17}/>{t('API 用量', 'API usage')}</div>
      <div className="usage-header-actions"><button className="soft-button" onClick={onConfigure}><Settings2 size={15}/>{t('配置模型','Configure models')}</button><button className="soft-button" onClick={() => setRevision(value => value + 1)} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''}/>{t('刷新', 'Refresh')}</button></div></header>
    <div className="usage-content">
      <div className="usage-heading"><div><span className="usage-eyebrow">PAPER WORKBENCH</span><h1>{t('用量看板', 'Usage dashboard')}</h1>
        <p>{t('查看工作台 API 请求实际返回的用量。Codex / Claude 订阅会话不计入。', 'Usage returned by API calls made through this workbench. Codex / Claude subscription sessions are excluded.')}</p></div>
        <div className="usage-filters"><label>{t('时间范围', 'Period')}<select value={days} onChange={event => { setDays(event.target.value); setOffset(0); }}>
          <option value="7">{t('最近 7 天', 'Last 7 days')}</option><option value="30">{t('最近 30 天', 'Last 30 days')}</option><option value="90">{t('最近 90 天', 'Last 90 days')}</option><option value="all">{t('全部时间', 'All time')}</option></select></label>
          <label>{t('模型', 'Model')}<select value={model} onChange={event => { setModel(event.target.value); setOffset(0); }}><option value="">{t('全部模型', 'All models')}</option>
            {models.map(item => <option key={item.key} value={item.key}>{item.profileName || item.provider} · {item.model}</option>)}</select></label></div></div>
      <section className="usage-configuration usage-configuration-compact" aria-label={t('模型配置概览','Model configuration overview')}>
        <Database size={20}/><div className="usage-configuration-current"><span>{t('当前工作区模型','Current workspace model')}</span><strong>{settings.model || t('未选择模型','No model selected')}</strong><small>{active?.name || settings.provider} · {settings.modelConfigured?t('已配置','Configured'):t('待配置','Setup needed')}</small></div>
        <div className="usage-configuration-counts"><b>{profiles.length}</b> {t('个连接','connections')}<span>·</span><b>{profiles.reduce((sum,p)=>sum+p.models.length,0)}</b> {t('个模型','models')}</div>
        <button className="soft-button" onClick={onConfigure}>{t('管理连接与模型','Manage connections & models')}</button>
        <p className="usage-config-footnote">{t('配置保存在本机服务端，重启后保留。停用的连接与模型可在配置中恢复；助手侧栏的模型、风格、联网和 PDF 阅读方式自动保存。','Configuration is saved on the local server across restarts. Disabled connections and models can be restored in settings. Assistant model, style, Web search and PDF mode changes save automatically.')}</p>
      </section>
      {error && <p className="error-banner" role="alert">{error}</p>}
      {loading && <p role="status">{t('正在读取用量…', 'Loading usage…')}</p>}
      {!loading && data && <>
        {(data.storage.readError || data.storage.unreadableRecords > 0 || data.storage.unsavedRecords > 0) && <p className="usage-warning" role="alert">{t('部分用量记录无法读取或保存，当前统计可能不完整。请检查本地数据目录的可用空间和权限。', 'Some usage records could not be read or saved. Totals may be incomplete; check local data-directory space and permissions.')}</p>}
        <UsageDashboard data={data} timeZone={timeZone}/>
        <p className="usage-note usage-data-note">{t('≥ 表示已知部分；占比仅按已知 Token 计算。未返回用量不代表零消耗，缓存和推理不重复计入总量。','≥ indicates a known subtotal. Shares use reported tokens only. Unreported usage is not zero; cache and reasoning tokens are not counted twice.')}</p>
        {!data.requests ? <div className="usage-empty"><BarChart3 size={32}/><h2>{t('这个范围内还没有 API 调用', 'No API calls in this range')}</h2><p>{t('使用已配置的模型生成、问答或翻译后，用量会记录在这里。不会为查看统计调用模型。', 'Generate a reading, ask a question, or translate with a configured model to start tracking. Viewing this page never calls a model.')}</p></div> : <>
          <details className="usage-panel usage-detail"><summary>{t('模型用量明细', 'Model usage details')}</summary><div className="usage-table-scroll" tabIndex={0} role="region" aria-label={t('模型用量表', 'Model usage table')}><table><thead><tr><th>{t('模型 / 连接', 'Model / connection')}</th><th>{t('调用', 'Calls')}</th><th>{t('输入', 'Input')}</th><th>{t('输出', 'Output')}</th><th>{t('总 Token', 'Total tokens')}</th></tr></thead><tbody>{data.byModel.map(group => <tr key={group.key}><td><strong>{group.model}</strong><small>{group.profileName || group.provider}</small></td><td>{number(group.requests)}</td><td>{value(group,'inputTokens')}</td><td>{value(group,'outputTokens')}</td><td>{value(group,'totalTokens')}</td></tr>)}</tbody></table></div></details>
          <details className="usage-panel usage-detail"><summary>{t('调用明细', 'Call history')}</summary><p className="usage-note">{t('每轮生成、审查和重试分别计数；有已知用量的失败请求也计入总量。', 'Each generation, review round and retry is counted separately. Failed calls with reported usage also contribute to totals.')}</p><div className="usage-table-scroll" tabIndex={0} role="region" aria-label={t('调用明细表', 'Call history table')}><table><thead><tr><th>{t('时间 / 用途', 'Time / activity')}</th><th>{t('模型', 'Model')}</th><th>{t('状态', 'Status')}</th><th>{t('输入', 'Input')}</th><th>{t('输出', 'Output')}</th><th>{t('总 Token', 'Total tokens')}</th></tr></thead><tbody>{data.recent.map(entry => <tr key={entry.id}><td><time dateTime={entry.startedAt}>{date(entry.startedAt)}</time><small>{operation(entry.operation)}{entry.stage ? ` · ${stage(entry.stage)}` : ''}</small></td><td>{entry.model}<small>{entry.profileName || entry.provider}</small></td><td><span className={`usage-status ${entry.status}`}>{status(entry.status)}</span></td><td>{number(entry.inputTokens)}</td><td>{number(entry.outputTokens)}</td><td>{number(entry.totalTokens)}</td></tr>)}</tbody></table></div>
            <div className="usage-pagination"><button className="soft-button" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0,value-50))}>{t('上一页','Previous')}</button><span>{number(data.offset+1)}–{number(data.offset+data.recent.length)} / {number(data.requests)}</span><button className="soft-button" disabled={!data.hasMore} onClick={() => setOffset(value => value+50)}>{t('下一页','Next')}</button></div></details>
        </>}
        <p className="usage-note usage-footer">{t('记录起始', 'Tracking since')}: {date(data.trackingSince)} · {t('更新于', 'Updated')}: {date(data.generatedAt)}<br/>{t('只记录启用后的工作台 API 请求，不回填旧用量。超时或连接中断时可能无法收到计数。本地原文检索与订阅代理导入不消耗工作台 API，不计入。', 'Tracks workbench API calls after activation; earlier usage is not backfilled. Timeouts or disconnections may prevent usage reporting. Local extraction and subscription-agent imports do not call the workbench model API and are excluded.')}</p>
      </>}
    </div>
  </section>;
}
