import type {CropRect} from './figure-geometry';
export type FigureDraft = {key:string;figureId?:string;candidateKey?:string;page:number;caption:string;label:string;crop?:CropRect;method:'manual'|'pdfjs-candidate';reviewed:boolean;dirty:boolean;baseFiguresRevision?:string};
export type FigureDrafts = {selected?:string;drafts:Record<string,FigureDraft>};
const prefix='pw-figure-drafts:';
const memory=new Map<string,string>();
/** Tab-local drafts are bound to actual PDF bytes; they never enter model settings. */
export function readFigureDrafts(paperId:string,revision:string):FigureDrafts {
  try {
    const key=`${prefix}${paperId}:${revision}`;
    let raw=memory.get(key);if(raw===undefined){try{raw=sessionStorage.getItem(key)||undefined;}catch{/* In-memory drafts remain available while this page is open. */}}
    if(raw&&raw.length>2_000_000)return {drafts:{}};const value=JSON.parse(raw||'null');
    if(!value||typeof value!=='object'||!value.drafts)return {drafts:{}};
    const drafts:Record<string,FigureDraft>={};
    for(const [key,raw] of Object.entries(value.drafts)) {
      const d=raw as FigureDraft;
      if(!d||d.key!==key||!Number.isInteger(d.page)||d.page<1||typeof d.caption!=='string'||typeof d.label!=='string')continue;
      if(d.crop&&(![d.crop.x,d.crop.y,d.crop.width,d.crop.height].every(Number.isFinite)||d.crop.x<0||d.crop.y<0||d.crop.width<=0||d.crop.height<=0||d.crop.x+d.crop.width>1.0001||d.crop.y+d.crop.height>1.0001))continue;
      drafts[key]={...d,caption:d.caption.slice(0,3000),label:d.label.slice(0,120),reviewed:false,method:d.method==='pdfjs-candidate'?'pdfjs-candidate':'manual'};
    }
    return {drafts,selected:typeof value.selected==='string'&&drafts[value.selected]?value.selected:undefined};
  }catch{return {drafts:{}};}
}
export function saveFigureDrafts(paperId:string,revision:string,state:FigureDrafts) {
  const key=`${prefix}${paperId}:${revision}`,value=JSON.stringify({selected:state.selected,drafts:Object.fromEntries(Object.entries(state.drafts).filter(([key,draft])=>draft.dirty||key===state.selected))});
  memory.set(key,value);
  try {sessionStorage.setItem(key,value);return true;}catch{return false;}
}
