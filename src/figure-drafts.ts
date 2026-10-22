import type {CropRect} from './figure-geometry';
export type FigureDraft = {key:string;figureId?:string;candidateKey?:string;page:number;caption:string;label:string;crop?:CropRect;method:'manual'|'pdfjs-candidate';reviewed:boolean;dirty:boolean;baseFiguresRevision?:string};
export type FigureDrafts = {selected?:string;drafts:Record<string,FigureDraft>};
const prefix='pw-figure-drafts:';
const memory=new Map<string,string>();
type SaveCompletion={submitted:FigureDraft;saved:FigureDraft};
const completions=new Map<string,Map<string,SaveCompletion>>();
const listeners=new Map<string,Set<(completion:SaveCompletion)=>void>>();
const pending=new Map<string,Set<string>>();
const activityListeners=new Map<string,Set<()=>void>>();
const storageKey=(paperId:string,revision:string)=>`${prefix}${paperId}:${revision}`;
let saveGeneration=0;
export const figureDraftSaveGeneration=()=>saveGeneration;
/** Tab-local drafts are bound to actual PDF bytes; they never enter model settings. */
export function readFigureDrafts(paperId:string,revision:string,resetReview=true):FigureDrafts {
  try {
    const key=storageKey(paperId,revision);
    let raw=memory.get(key);if(raw===undefined){try{raw=sessionStorage.getItem(key)||undefined;}catch{/* In-memory drafts remain available while this page is open. */}}
    if(raw&&raw.length>2_000_000)return {drafts:{}};const value=JSON.parse(raw||'null');
    if(!value||typeof value!=='object'||!value.drafts)return {drafts:{}};
    const drafts:Record<string,FigureDraft>={};
    for(const [key,raw] of Object.entries(value.drafts)) {
      const d=raw as FigureDraft;
      if(!d||d.key!==key||!Number.isInteger(d.page)||d.page<1||typeof d.caption!=='string'||typeof d.label!=='string')continue;
      if(d.crop&&(![d.crop.x,d.crop.y,d.crop.width,d.crop.height].every(Number.isFinite)||d.crop.x<0||d.crop.y<0||d.crop.width<=0||d.crop.height<=0||d.crop.x+d.crop.width>1.0001||d.crop.y+d.crop.height>1.0001))continue;
      drafts[key]={...d,caption:d.caption.slice(0,3000),label:d.label.slice(0,120),reviewed:resetReview?false:d.reviewed===true,method:d.method==='pdfjs-candidate'?'pdfjs-candidate':'manual'};
    }
    return {drafts,selected:typeof value.selected==='string'&&drafts[value.selected]?value.selected:undefined};
  }catch{return {drafts:{}};}
}
export function saveFigureDrafts(paperId:string,revision:string,state:FigureDrafts) {
  const key=storageKey(paperId,revision),value=JSON.stringify({selected:state.selected,drafts:Object.fromEntries(Object.entries(state.drafts).filter(([key,draft])=>draft.dirty||key===state.selected))});
  memory.set(key,value);
  try {sessionStorage.setItem(key,value);return true;}catch{return false;}
}

/** A completed request acknowledges only the submitted draft, never a newer edit. */
export function reconcileFigureDraftSave(current:FigureDrafts,submitted:FigureDraft,saved:FigureDraft):FigureDrafts {
  const live=current.drafts[submitted.key];
  if(!live||live.baseFiguresRevision!==submitted.baseFiguresRevision)return current;
  // A later completion may already own the destination; an older response cannot replace it.
  if(saved.key!==submitted.key&&current.drafts[saved.key])return current;
  const same=live.page===submitted.page&&live.caption===submitted.caption&&live.label===submitted.label&&live.method===submitted.method&&(['x','y','width','height'] as const).every(key=>live.crop?.[key]===submitted.crop?.[key]);
  const next=same?saved:{...live,key:saved.key,figureId:saved.figureId,baseFiguresRevision:saved.baseFiguresRevision,dirty:true,reviewed:false};
  const drafts={...current.drafts};delete drafts[submitted.key];drafts[next.key]=next;
  return {selected:current.selected===submitted.key?next.key:current.selected,drafts};
}

/** Reopened editors receive acknowledgements too, including during their first render. */
export function subscribeFigureDraftSaves(paperId:string,revision:string,listener:(completion:SaveCompletion)=>void) {
  const key=storageKey(paperId,revision),subscribers=listeners.get(key)||new Set();
  subscribers.add(listener);listeners.set(key,subscribers);
  for(const completion of completions.get(key)?.values()||[])listener(completion);
  return ()=>{subscribers.delete(listener);if(!subscribers.size)listeners.delete(key);};
}

export function completeFigureDraftSave(paperId:string,revision:string,submitted:FigureDraft,saved:FigureDraft) {
  saveGeneration++;
  const key=storageKey(paperId,revision),completion={submitted,saved};
  saveFigureDrafts(paperId,revision,reconcileFigureDraftSave(readFigureDrafts(paperId,revision,false),submitted,saved));
  const recent=completions.get(key)||new Map<string,SaveCompletion>();
  // Keep a bounded acknowledgement journal for the render-to-subscription window.
  recent.delete(submitted.key);recent.set(submitted.key,completion);
  if(recent.size>100)recent.delete(recent.keys().next().value!);
  completions.delete(key);completions.set(key,recent);
  if(completions.size>100)completions.delete(completions.keys().next().value!);
  for(const listener of listeners.get(key)||[])listener(completion);
}

export function isFigureDraftSaving(paperId:string,revision:string,draftKey:string) {
  return pending.get(storageKey(paperId,revision))?.has(draftKey)===true;
}
export function beginFigureDraftSave(paperId:string,revision:string,draftKey:string) {
  const key=storageKey(paperId,revision),requests=pending.get(key)||new Set<string>();
  if(requests.has(draftKey))return undefined;
  requests.add(draftKey);pending.set(key,requests);
  for(const listener of activityListeners.get(key)||[])listener();
  return ()=>{requests.delete(draftKey);if(!requests.size)pending.delete(key);for(const listener of activityListeners.get(key)||[])listener();};
}
export function subscribeFigureDraftActivity(paperId:string,revision:string,listener:()=>void) {
  const key=storageKey(paperId,revision),subscribers=activityListeners.get(key)||new Set();subscribers.add(listener);activityListeners.set(key,subscribers);listener();
  return ()=>{subscribers.delete(listener);if(!subscribers.size)activityListeners.delete(key);};
}
