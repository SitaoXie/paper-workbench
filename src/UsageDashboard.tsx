import {useState} from 'react';
import {Activity, ArrowDownLeft, ArrowUpRight, CheckCircle2, Database, Layers, Zap} from 'lucide-react';
import {useLocale} from './i18n';
import type {Field,Summary,Usage} from './usage-types';
import './usage-dashboard.css';

const palette=['var(--usage-teal)','var(--usage-blue)','var(--usage-purple)','var(--usage-amber)','var(--usage-pink)','var(--usage-muted)'];
const empty:Summary={requests:0,failed:0,unknownUsage:0,totals:{totalTokens:0,inputTokens:0,outputTokens:0,cachedInputTokens:0,cacheWriteTokens:0,reasoningTokens:0},reported:{totalTokens:0,inputTokens:0,outputTokens:0,cachedInputTokens:0,cacheWriteTokens:0,reasoningTokens:0}};
// Date keys are calendar dates already resolved in the API's requested timezone.
export function calendarTrend(data:Usage){
  const end=new Date(`${data.to}T00:00:00Z`);
  if(!Number.isFinite(end.getTime()))return data.daily.slice(-30);
  const start=new Date(end);start.setUTCDate(start.getUTCDate()-29);
  const first=data.from || data.daily[0]?.key || data.to;
  if(first>start.toISOString().slice(0,10))start.setTime(new Date(`${first}T00:00:00Z`).getTime());
  const rows=[];const indexed=new Map(data.daily.map(row=>[row.key,row]));
  for(const day=new Date(start);day<=end;day.setUTCDate(day.getUTCDate()+1)){
    const key=day.toISOString().slice(0,10);rows.push(indexed.get(key)||{...empty,key});
  }
  return rows;
}
export default function UsageDashboard({data,timeZone}:{data:Usage;timeZone:string}){
  const {t,locale}=useLocale();
  const [hovered,setHovered]=useState<string|null>(null),[rankBy,setRankBy]=useState<'model'|'profile'>('model');
  const [metric,setMetric]=useState<'tokens'|'calls'>('tokens'),[dayKey,setDayKey]=useState<string|null>(null);
  const [allRanks,setAllRanks]=useState(false);
  const number=(value:number|null)=>value===null?'—':value.toLocaleString(locale==='zh'?'zh-CN':'en');
  const compact=(value:number|null)=>value===null?'—':new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(value);
  const display=(group:Summary,field:Field,short=false)=>group.requests&&!group.reported[field]?t('未返回','Unreported'):`${group.reported[field]<group.requests?'≥ ':''}${(short?compact:number)(group.totals[field])}`;
  const total=data.totals.totalTokens || 0;
  const rankedModels=[...data.byModel].sort((a,b)=>(b.totals.totalTokens||0)-(a.totals.totalTokens||0));
  const groups=rankedModels.slice(0,4).map((group,index)=>({key:group.key,label:group.model,description:group.profileName||group.provider,value:group.totals.totalTokens||0,color:palette[index]}));
  const rest=rankedModels.slice(4).reduce((sum,group)=>sum+(group.totals.totalTokens||0),0);
  if(rest>0)groups.push({key:'other',label:t('其他模型','Other models'),description:`${rankedModels.length-4} ${t('个模型','models')}`,value:rest,color:palette[4]});
  const selected=groups.find(group=>group.key===hovered);
  let arcOffset=0;
  const trend=calendarTrend(data),maxDay=Math.max(1,...trend.map(day=>metric==='tokens'?day.totals.totalTokens||0:day.requests));
  const chosenDay=trend.find(day=>day.key===dayKey) || trend.at(-1);
  const rankGroups=rankBy==='model'?rankedModels.map(group=>({...group,label:group.model,description:group.profileName||group.provider})): (data.byProfile || []).map(group=>({...group,label:group.profileName||group.provider,description:group.provider}));
  const visibleRanks=allRanks?rankGroups:rankGroups.slice(0,5);
  const cache=data.cache,cacheRate=cache?.rate??null;
  const coverage=data.requests?data.reported.totalTokens/data.requests:0;
  const operationLabel=(value:string)=>({reading:t('阅读解读','Readings'),question:t('问答','Questions'),translation:t('翻译','Translation'),'passage-translation':t('选文翻译','Passage translation'),'passage-explanation':t('选文解释','Passage explanation'),vision:t('图像理解','Vision'),recommendations:t('推荐问题','Suggestions'),'connection-test':t('连接测试','Connection tests'),other:t('其他','Other')})[value]||value;
  const activityMax=Math.max(1,...data.byOperation.map(group=>group.requests));
  return <div className="usage-dashboard">
    <div className="usage-kpis">
      <article><span><ArrowDownLeft size={16}/>{t('输入 Token','Input tokens')}</span><strong title={display(data,'inputTokens')}>{display(data,'inputTokens',true)}</strong><small>{data.reported.inputTokens}/{data.requests} {t('次有计数','calls reported')}</small></article>
      <article><span><ArrowUpRight size={16}/>{t('输出 Token','Output tokens')}</span><strong title={display(data,'outputTokens')}>{display(data,'outputTokens',true)}</strong><small>{t('其中推理','Reasoning')}: {display(data,'reasoningTokens',true)}</small></article>
      <article><span><Zap size={16}/>{t('API 调用','API calls')}</span><strong>{number(data.requests)}</strong><small>{number(data.failed)} {t('次失败或截断','failed or truncated')}</small></article>
      <article><span><CheckCircle2 size={16}/>{t('用量返回率','Usage coverage')}</span><strong>{data.requests?`${(coverage*100).toFixed(1)}%`:'—'}</strong><small>{number(data.unknownUsage)} {t('次总量未知','calls with unknown total')}</small></article>
    </div>
    <div className="usage-dashboard-grid">
      <section className="usage-visual-card usage-distribution">
        <header><h2><Layers size={17}/>{t('Token 消耗分布','Token distribution')}</h2><span className="usage-badge">{t('已知用量','Reported usage')}</span></header>
        <div className="usage-distribution-body">
          <div className="usage-distribution-copy"><span className="usage-overline">{t('总消耗量','TOTAL CONSUMPTION')}</span><div className="usage-hero-value" title={display(data,'totalTokens')}>{display(data,'totalTokens',true)}<small>tokens</small></div><p className="usage-precise-total">{display(data,'totalTokens')} tokens · {data.reported.totalTokens}/{data.requests} {t('次有计数','calls reported')}</p>
            <ul className="usage-donut-legend">{groups.map(group=><li key={group.key}><button onMouseEnter={()=>setHovered(group.key)} onMouseLeave={()=>setHovered(null)} onFocus={()=>setHovered(group.key)} onBlur={()=>setHovered(null)} aria-label={`${group.label} · ${group.description}: ${number(group.value)} tokens`}><i style={{background:group.color}}/><span title={`${group.label} · ${group.description}`}>{group.label}<small>{group.description}</small></span><b>{compact(group.value)}</b><em>{total?`${(group.value/total*100).toFixed(1)}%`:'—'}</em></button></li>)}</ul>
          </div>
          <div className="usage-donut" role="img" aria-label={t('各模型占已知 Token 的比例，详见旁边图例。','Model shares of reported tokens; see the adjacent legend.')}>
            <svg viewBox="0 0 240 240" aria-hidden="true"><circle className="usage-ring-track" cx="120" cy="120" r="96" fill="none" strokeWidth="20"/>{total>0&&groups.map(group=>{const fraction=group.value/total*100,offset=arcOffset;arcOffset+=fraction;return <circle key={group.key} cx="120" cy="120" r="96" fill="none" stroke={group.color} strokeWidth={selected?.key===group.key?24:20} pathLength="100" strokeDasharray={`${Math.max(0,fraction-0.7)} 100`} strokeDashoffset={-offset} transform="rotate(-90 120 120)" opacity={!selected||selected.key===group.key?1:.35}/>;})}</svg>
            <div className="usage-donut-center"><span>{selected?t('当前模型','MODEL'):t('已知 Token','REPORTED TOKENS')}</span><strong>{selected?compact(selected.value):display(data,'totalTokens',true)}</strong><small>{selected?.label || `${rankedModels.length} ${t('个模型','models')}`}</small></div>
          </div>
        </div>
      </section>
      <section className="usage-visual-card usage-ranking">
        <header><h2>{t('消耗排行','Usage ranking')}</h2><div className="usage-chart-toggle" role="group" aria-label={t('排行维度','Ranking dimension')}><button aria-pressed={rankBy==='model'} onClick={()=>{setRankBy('model');setAllRanks(false);}}>{t('模型','Models')}</button><button aria-pressed={rankBy==='profile'} onClick={()=>{setRankBy('profile');setAllRanks(false);}}>{t('连接','Connections')}</button></div></header>
        <ol className="usage-rank-list">{visibleRanks.map((group,index)=><li key={group.key}><div><span className="usage-rank-number">{index+1}</span><strong title={group.label}>{group.label}</strong><b>{display(group,'totalTokens',true)}</b></div><span className="usage-rank-track" aria-hidden="true"><span style={{width:`${total?(group.totals.totalTokens||0)/total*100:0}%`,background:palette[index%palette.length]}}/></span><footer><span title={group.description}>{group.description}</span><span>{number(group.requests)} {t('次','calls')} · {total?`${((group.totals.totalTokens||0)/total*100).toFixed(1)}%`:'—'}</span></footer></li>)}</ol>
        {rankGroups.length>5&&<button className="usage-rank-expand" onClick={()=>setAllRanks(!allRanks)}>{allRanks?t('收起','Show less'):t(`查看全部 ${rankGroups.length} 项`,`Show all ${rankGroups.length}`)}</button>}
        <p className="usage-chart-caption">{t('占比基于已知 Token，不含未返回的消耗。','Shares cover reported tokens, excluding unknown usage.')}</p>
      </section>
      <section className="usage-visual-card usage-trend">
        <header><h2><Activity size={17}/>{t('用量趋势','Usage trend')}</h2><div className="usage-chart-toggle" role="group" aria-label={t('图表指标','Chart metric')}><button aria-pressed={metric==='tokens'} onClick={()=>setMetric('tokens')}>Token</button><button aria-pressed={metric==='calls'} onClick={()=>setMetric('calls')}>{t('调用','Calls')}</button></div></header>
        <div className="usage-trend-readout" aria-live="polite"><span>{chosenDay?.key || '—'}</span><strong>{chosenDay?(metric==='tokens'?display(chosenDay,'totalTokens'):number(chosenDay.requests)):'—'} <small>{metric==='tokens'?'tokens':t('次调用','calls')}</small></strong></div>
        <div className="usage-trend-chart"><div className="usage-trend-grid" aria-hidden="true"><span>{compact(maxDay)}</span><span>{compact(maxDay/2)}</span><span>0</span></div><div className="usage-trend-bars">{trend.map(day=>{const amount=metric==='tokens'?day.totals.totalTokens||0:day.requests;return <button key={day.key} aria-label={`${day.key}: ${metric==='tokens'?display(day,'totalTokens')+' tokens':number(day.requests)+' '+t('次调用','calls')}`} className={chosenDay?.key===day.key?'is-selected':''} onMouseEnter={()=>setDayKey(day.key)} onFocus={()=>setDayKey(day.key)} onClick={()=>setDayKey(day.key)}><span className="usage-trend-bar" style={{height:`${Math.max(amount?2:0,amount/maxDay*100)}%`}}/><i className={day.unknownUsage?'has-unknown':''}/></button>;})}</div></div>
        <div className="usage-trend-axis"><time>{trend[0]?.key}</time><span>{timeZone}</span><time>{trend.at(-1)?.key}</time></div>
        <p className="usage-chart-caption">{t('展示筛选范围内最近 30 个自然日；圆点表示当日有未返回的用量。','Shows up to 30 calendar days in the selected period. Dots mark days with unreported usage.')}</p>
      </section>
      <section className="usage-visual-card usage-cache">
        <header><h2><Database size={17}/>{t('缓存复用','Cache reuse')}</h2><span className="usage-badge">{t('同口径样本','MATCHED SAMPLE')}</span></header>
        <div className="usage-cache-body"><div className="usage-cache-gauge"><svg viewBox="0 0 220 135" aria-hidden="true"><path d="M 25 110 A 85 85 0 0 1 195 110" pathLength="100" fill="none" strokeWidth="14" className="usage-ring-track"/><path d="M 25 110 A 85 85 0 0 1 195 110" pathLength="100" fill="none" strokeWidth="14" stroke="var(--usage-teal)" strokeDasharray={`${(cacheRate??0)*100} 100`}/></svg><div><strong>{cacheRate===null?'—':`${(cacheRate*100).toFixed(1)}%`}</strong><span>{t('样本输入复用率','Sample input reuse')}</span></div></div>
          <div className="usage-cache-values"><span>{t('已知缓存读取','Known cache reads')}<b>{display(data,'cachedInputTokens',true)}</b></span><span>{t('缓存写入','Cache writes')}<b>{display(data,'cacheWriteTokens',true)}</b></span></div></div>
        <p className="usage-chart-caption">{cache?.requests? t(`${cache.requests}/${data.requests} 次同时返回输入与缓存读取；比例仅使用这些请求的计数。`,`${cache.requests}/${data.requests} calls reported both input and cache reads. The ratio uses only those calls.`):t('暂无同时返回输入与缓存读取的样本。','No calls reported both input and cache reads.')}</p>
      </section>
      <section className="usage-visual-card usage-activity"><header><h2>{t('请求用在了哪里','Where calls went')}</h2><span className="usage-badge">{t('按调用次数','BY CALLS')}</span></header><ul>{[...data.byOperation].sort((a,b)=>b.requests-a.requests).map(group=><li key={group.key}><span>{operationLabel(group.key)}</span><span className="usage-rank-track" aria-hidden="true"><span style={{width:`${group.requests/activityMax*100}%`}}/></span><b>{number(group.requests)}</b><small>{display(group,'totalTokens',true)} tokens</small></li>)}</ul></section>
    </div>
  </div>;
}
