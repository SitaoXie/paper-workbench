import {useEffect,useRef,useState} from 'react';
import {api,type Paper,type Settings} from './types';
import {useLocale} from './i18n';
import {InteractiveGenerationConfirm} from './ReadingGenerationFeedback';
import './metadata-repair.css';
type Field='authors'|'institutions'|'abstract';
type Proposal={proposalId:string;paperId:string;metadata:{authors:string[];institutions:string[];abstract?:string};warnings:string[];evidence:{inputMode?:string;modelCalls:number};before:{authors:string[];institutions:string[];abstract:string;abstractIsExcerpt:boolean}};
type Result={paper:Paper;proposal?:Proposal;error?:string;fields:Field[];changeId?:string};
export function MetadataRepair({papers,settings,onUpdated,onClose}:{papers:Paper[];settings:Settings;onUpdated:(paper:Paper)=>void;onClose:()=>void}){
 const {t}=useLocale();const [phase,setPhase]=useState<'confirm'|'extract'|'review'>('confirm'),[results,setResults]=useState<Result[]>([]),[progress,setProgress]=useState(0),[busy,setBusy]=useState(false);
 const abort=useRef(new AbortController()),dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>()=>abort.current.abort(),[]);
 useEffect(()=>{if(phase!=='confirm'){dialog.current?.showModal();}},[phase]);
 async function extract(selection:{profileId:string;model:string;modelReasoning?:Settings['modelReasoning']}){
  setPhase('extract');const next:Result[]=[];
  for(const paper of papers){if(abort.current.signal.aborted)break;setProgress(next.length+1);
   try{const proposal=await api<Proposal>(`/papers/${paper.id}/metadata/extract`,{method:'POST',signal:abort.current.signal,body:JSON.stringify(selection)});const fields:Field[]=[];
    if(proposal.metadata.authors.length&&!proposal.before.authors.length)fields.push('authors');
    if(proposal.metadata.institutions.length&&!proposal.before.institutions.length)fields.push('institutions');
    if(proposal.metadata.abstract&&(!proposal.before.abstract||proposal.before.abstractIsExcerpt))fields.push('abstract');
    next.push({paper,proposal,fields});
   }catch(error){if(abort.current.signal.aborted)return true;next.push({paper,error:(error as Error).message,fields:[]});}
   setResults([...next]);
  }
  if(!abort.current.signal.aborted)setPhase('review');return true;
 }
 async function apply(){setBusy(true);const next=[...results];for(let i=0;i<next.length;i++){const row=next[i];if(!row.proposal||!row.fields.length||row.changeId)continue;try{const response=await api<{paper:Paper;changeId:string}>(`/papers/${row.paper.id}/metadata/apply`,{method:'POST',body:JSON.stringify({proposalId:row.proposal.proposalId,fields:row.fields})});onUpdated(response.paper);next[i]={...row,changeId:response.changeId,error:undefined};}catch(error){next[i]={...row,error:(error as Error).message};}setResults([...next]);}setBusy(false);}
 async function undo(index:number){setBusy(true);const row=results[index];try{const response=await api<{paper:Paper}>(`/papers/${row.paper.id}/metadata/undo`,{method:'POST',body:JSON.stringify({changeId:row.changeId})});onUpdated(response.paper);setResults(old=>old.map((r,i)=>i===index?{...r,changeId:undefined,proposal:undefined,fields:[],error:undefined}:r));}catch(error){setResults(old=>old.map((r,i)=>i===index?{...r,error:(error as Error).message}:r));}setBusy(false);}
 function close(){abort.current.abort();onClose();}
 if(phase==='confirm')return <InteractiveGenerationConfirm settings={settings} kind="metadata" paperCount={papers.length} onCancel={close} onConfirm={extract}/>;
 return <dialog ref={dialog} className="metadata-repair" aria-label={t('核对论文信息','Review paper metadata')} onCancel={e=>{e.preventDefault();if(!busy)close();}}>
  <header><div><h2>{t('核对论文信息','Review paper metadata')}</h2><p>{t('作者、机构与论文原始摘要','Authors, affiliations and the original abstract')}</p></div><button className="soft-button" disabled={busy} onClick={close}>{phase==='extract'?t('停止','Stop'):t('关闭','Close')}</button></header>
  {phase==='extract'&&<div role="status" className="metadata-extraction-status">{t(`正在读取首页 · ${progress} / ${papers.length}`,`Reading front pages · ${progress} / ${papers.length}`)}<progress max={papers.length} value={results.length}/></div>}
  <div className="metadata-candidates">{results.map((row,index)=><article key={row.paper.id}><h3>{row.paper.title}</h3><a className="metadata-source-link" href={`${t('/zh/','/en/')}?paper=${encodeURIComponent(row.paper.id)}&tab=paper&page=1`} target="_blank" rel="noopener noreferrer">{t('对照论文首页 ↗','Compare with the front page ↗')}</a>{row.error&&<p role="alert">{row.error}</p>}{row.changeId?<div className="metadata-saved">{t('已保存 · 保留原信息以便撤销','Saved · previous metadata retained')}<button className="text-button" disabled={busy} onClick={()=>void undo(index)}>{t('撤销本次修改','Undo this repair')}</button></div>:row.proposal&&<>
   {(['authors','institutions','abstract'] as Field[]).map(field=>{const value=row.proposal!.metadata[field],available=Array.isArray(value)?value.length>0:!!value;return <section key={field}><label><input type="checkbox" disabled={!available||busy||phase!=='review'} checked={row.fields.includes(field)} onChange={e=>setResults(old=>old.map((r,i)=>i===index?{...r,fields:e.target.checked?[...r.fields,field]:r.fields.filter(f=>f!==field)}:r))}/><b>{({authors:t('作者','Authors'),institutions:t('研究机构','Affiliations'),abstract:t('原始摘要','Original abstract')})[field]}</b>{available&&<small>{(row.proposal!.before[field]?.length||0)>0?t('替换已有内容','Replaces existing content'):t('补全缺失内容','Fills missing content')}</small>}</label>{available?field==='abstract'?<details><summary>{t('展开核对原文摘要','Review the original abstract')}</summary><p className="metadata-abstract">{value}</p></details>:<p>{(value as string[]).join(' · ')}</p>:<p className="metadata-empty">{t('未取得可核对的结果','No source-supported result')}</p>}</section>;})}
   {!!row.proposal.warnings.length&&<p className="metadata-empty">{t('部分模型候选未通过校验，已采用可直接提取的原文或略去。请对照首页核对。','Some model candidates failed checks and were replaced with directly extracted source text or omitted. Please compare with the front page.')}</p>}
  </>}</article>)}</div>
  {phase==='review'&&<footer><span>{t('仅保存勾选项，已有阅读解读保持不变。','Only checked fields are saved; existing readings are preserved.')}</span><button className="primary-button" disabled={busy||!results.some(r=>r.proposal&&!r.changeId&&r.fields.length)} onClick={()=>void apply()}>{busy?t('正在保存…','Saving…'):t('应用勾选项','Apply selected fields')}</button></footer>}
 </dialog>;
}
