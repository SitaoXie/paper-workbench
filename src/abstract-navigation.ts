import type {Paper} from './types';
export type AbstractSourceView={text:string;original:boolean;language?:string;matched:boolean};
const compact=(text:string)=>text.normalize('NFKC').replace(/[\s\u200b\u00ad]+/gu,'');
/** Match only saved source text. Never translate a quote while navigating to evidence. */
export function resolveAbstractSource(paper:Paper,quote?:string,preferredLanguage?:string):AbstractSourceView {
  const source=paper.abstract||paper.text?.slice(0,1800)||'';
  const target=compact(quote||'');
  if(!target||compact(source).includes(target))return {text:source,original:true,matched:true};
  const translations=Object.entries(paper.translations||{}).sort(([a],[b])=>Number(b===preferredLanguage)-Number(a===preferredLanguage));
  for(const [language,entry] of translations){const text=entry.abstract?.markdown;if(text&&!entry.abstract?.stale&&compact(text).includes(target))return {text,language,original:false,matched:true};}
  return {text:source,original:true,matched:false};
}
