export type TextAnchor = { start:number; end:number; quote:string; before:string; after:string };
export type InlineMemory = { id:string; anchor:TextAnchor; text:string; result:string; kind:'translation'|'explanation'; language:string; model?:string; hidden?:boolean };
export const inlineMemoryKey = (paper:string,scope:string,reading:string|undefined,language:string) => `pw-inline-memory:${JSON.stringify([paper,scope,reading||'',language])}`;
export function captureTextAnchor(root:HTMLElement,range:Range):TextAnchor|undefined {
  if(!root.contains(range.startContainer)||!root.contains(range.endContainer))return;
  const prefix=range.cloneRange();prefix.selectNodeContents(root);prefix.setEnd(range.startContainer,range.startOffset);
  const start=prefix.toString().length, quote=range.toString(), end=start+quote.length, text=root.textContent||'';
  if(!quote || quote.length>24000)return;
  return {start,end,quote,before:text.slice(Math.max(0,start-40),start),after:text.slice(end,end+40)};
}
export function resolveTextAnchor(text:string,anchor:TextAnchor):{start:number;end:number}|undefined {
  const matches=(start:number)=>text.slice(start,start+anchor.quote.length)===anchor.quote && (!anchor.before || text.slice(Math.max(0,start-anchor.before.length),start)===anchor.before) && (!anchor.after || text.slice(start+anchor.quote.length,start+anchor.quote.length+anchor.after.length)===anchor.after);
  if(matches(anchor.start))return {start:anchor.start,end:anchor.start+anchor.quote.length};
  let start=text.indexOf(anchor.quote), found=-1;
  while(start>=0){if(matches(start)){if(found>=0)return;found=start;}start=text.indexOf(anchor.quote,start+1);}
  if(found>=0)return {start:found,end:found+anchor.quote.length};
}
export function restoreTextAnchor(root:HTMLElement,anchor:TextAnchor):Range|undefined {
  const location=resolveTextAnchor(root.textContent||'',anchor);if(!location)return;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node:Node|null,offset=0;const range=document.createRange();let started=false;
  while((node=walker.nextNode())){const length=node.textContent?.length||0;
    if(!started&&location.start<offset+length){range.setStart(node,location.start-offset);started=true;}
    if(started&&location.end<=offset+length){range.setEnd(node,location.end-offset);return range;}
    offset+=length;
  }
}
export function readInlineMemory(key:string):InlineMemory[] {
  try {const raw=localStorage.getItem(key);if(!raw || raw.length>3_000_000)return [];const data=JSON.parse(raw);if(!Array.isArray(data))return [];
    return data.filter(m=>m && typeof m.id==='string' && typeof m.text==='string' && typeof m.result==='string' && typeof m.language==='string' && ['translation','explanation'].includes(m.kind) && m.anchor && typeof m.anchor.quote==='string' && m.anchor.quote.length>0 && typeof m.anchor.before==='string' && typeof m.anchor.after==='string' && Number.isInteger(m.anchor.start)&&m.anchor.start>=0).slice(-50);
  }catch{return [];}
}
export function saveInlineMemory(key:string,entries:InlineMemory[]) { try {localStorage.setItem(key,JSON.stringify(entries.slice(-50)));return true;}catch{return false;} }
