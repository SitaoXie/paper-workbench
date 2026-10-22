import {validPdfPosition,type PdfReadingPosition,type OverviewReadingPosition} from './reading-position';

export type WorkspaceView='discover'|'library'|'saved'|'research'|'paper';
export type WorkspaceHistory={
  version:1;view:WorkspaceView;entryId?:string;paperId?:string;source?:string;tab?:'summary'|'paper';
  overview?:OverviewReadingPosition;pdf?:PdfReadingPosition;language?:string;original?:boolean;
};
const KEY='paperWorkbench';
const CACHE_KEY='paper-workbench:history-positions-v1';
/** Browser history carries only navigation identity and geometry, never paper,
 * selection, question, note, provider or credential contents. */
export function readWorkspaceHistory(state:unknown):WorkspaceHistory|undefined {
  if(!state||typeof state!=='object')return;
  const entry=(state as Record<string,unknown>)[KEY] as WorkspaceHistory|undefined;
  if(!entry||entry.version!==1||!['discover','library','saved','research','paper'].includes(entry.view))return;
  if(entry.view==='paper'&&(!entry.paperId||!/^[A-Za-z0-9_-]{1,256}$/.test(entry.paperId)||!['summary','paper'].includes(entry.tab||'')))return;
  const result:WorkspaceHistory={version:1,view:entry.view};
  if(typeof entry.entryId==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(entry.entryId))result.entryId=entry.entryId;
  if(entry.view!=='paper')return result;
  result.paperId=entry.paperId;result.tab=entry.tab;
  if(typeof entry.source==='string'&&entry.source.length<100)result.source=entry.source;
  if(typeof entry.language==='string'&&/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(entry.language))result.language=entry.language;
  if(typeof entry.original==='boolean')result.original=entry.original;
  if(validPdfPosition(entry.pdf))result.pdf={page:entry.pdf.page,fraction:entry.pdf.fraction,left:entry.pdf.left,zoom:entry.pdf.zoom};
  const p=entry.overview;
  if(p&&typeof p.key==='string'&&p.key.length<100&&typeof p.language==='string'&&p.language.length<=30&&
     ['article','interactive'].includes(p.presentation)&&Number.isFinite(p.scrollY)&&p.scrollY>=0&&p.scrollY<=10_000_000&&
     (!p.versionId||/^[A-Za-z0-9_-]{1,256}$/.test(p.versionId))){
    result.overview={key:p.key,language:p.language,presentation:p.presentation,scrollY:p.scrollY,...(p.versionId?{versionId:p.versionId}:{}),...(typeof p.expanded==='boolean'?{expanded:p.expanded}:{})};
    const a=p.anchor;
    if(a&&Number.isInteger(a.index)&&a.index>=0&&a.index<=100_000&&typeof a.hash==='string'&&a.hash.length<100&&Number.isFinite(a.offset)&&Math.abs(a.offset)<=10_000_000)result.overview.anchor={index:a.index,hash:a.hash,offset:a.offset};
  }
  return result;
}
export function workspaceHistoryState(entry:WorkspaceHistory,state:unknown={}):Record<string,unknown> {
  const safe=readWorkspaceHistory({[KEY]:entry});
  if(!safe)throw new Error('Invalid workspace navigation.');
  return {...(state&&typeof state==='object'&&!Array.isArray(state)?state:{}),[KEY]:safe};
}
/** Per-tab history survives reloads, with the same prose-free validation as
 * history.state. Restricted storage falls back to the live in-memory map. */
export function loadWorkspaceHistoryPositions(storage?:Pick<Storage,'getItem'>):Map<string,WorkspaceHistory>{
  const result=new Map<string,WorkspaceHistory>();
  try{
    const raw=(storage||sessionStorage).getItem(CACHE_KEY);if(!raw||raw.length>300_000)return result;
    const entries=JSON.parse(raw);if(!Array.isArray(entries))return result;
    for(const candidate of entries.slice(-100)){const entry=readWorkspaceHistory({[KEY]:candidate});if(entry?.entryId)result.set(entry.entryId,entry);}
  }catch{/* Navigation remains available when storage is disabled. */}
  return result;
}
export function saveWorkspaceHistoryPositions(entries:Map<string,WorkspaceHistory>,storage?:Pick<Storage,'setItem'>):void{
  while(entries.size>100)entries.delete(entries.keys().next().value!);
  const safe=[...entries.values()].map(entry=>readWorkspaceHistory({[KEY]:entry})).filter(Boolean);
  try{const raw=JSON.stringify(safe);if(raw.length<=300_000)(storage||sessionStorage).setItem(CACHE_KEY,raw);}catch{/* Keep the current tab's live positions. */}
}
export function workspaceLocation(href:string):{view:WorkspaceView;paperId?:string;tab?:'summary'|'paper';page?:number}{
  const url=new URL(href),id=url.searchParams.get('paper');
  if(id&&/^[A-Za-z0-9_-]{1,256}$/.test(id)){
    const raw=url.searchParams.get('page')||'',page=/^[1-9]\d{0,4}$/.test(raw)?Number(raw):undefined;
    return {view:'paper',paperId:id,tab:page||url.searchParams.get('tab')==='paper'?'paper':'summary',...(page?{page}:{})};
  }
  const view=url.searchParams.get('view');
  return {view:view&&['library','saved','research'].includes(view)?view as WorkspaceView:'discover'};
}
export function workspaceUrl(href:string,target:{view:WorkspaceView;paperId?:string;tab?:'summary'|'paper';page?:number;hash?:string}):string {
  const url=new URL(href);url.search='';url.hash=target.hash||'';
  if(target.view==='paper'&&target.paperId){url.searchParams.set('paper',target.paperId);if(target.tab==='paper')url.searchParams.set('tab','paper');if(target.page&&Number.isInteger(target.page)&&target.page>0)url.searchParams.set('page',String(target.page));}
  else if(target.view!=='discover')url.searchParams.set('view',target.view);
  return url.href;
}
