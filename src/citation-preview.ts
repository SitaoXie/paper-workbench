import {indexPdfTextPage,searchPdfText,type PdfSearchMatch} from './pdf-search';
export type CitationExcerpt={status:'matched'|'missing'|'ambiguous'|'page';text:string;matchedText?:string;match?:PdfSearchMatch};
/** A model-supplied quote becomes a highlight only after one deterministic page match. */
export function citationExcerpt(items:readonly unknown[],page:number,quote?:string):CitationExcerpt {
  const entries=items.map((item,index)=>({index,...(item as {str?:string;hasEOL?:boolean})})).filter(item=>typeof item.str==='string');
  const index=indexPdfTextPage(items,page);
  if(!quote)return {status:'page',text:entries.map(e=>e.str).join(' ').slice(0,900)};
  const {matches}=searchPdfText({pages:[index],pageCount:1,indexed:1,failedPages:[]},quote,2);
  if(matches.length!==1)return {status:matches.length?'ambiguous':'missing',text:entries.map(e=>e.str).join(' ').slice(0,900)};
  const match=matches[0],first=match.ranges[0],last=match.ranges.at(-1)!;
  const start=entries.findIndex(e=>e.index===first.itemIndex),end=entries.findIndex(e=>e.index===last.itemIndex);
  const matchedText=entries.slice(start,end+1).map(e=>e.str!.slice(e.index===first.itemIndex?first.start:0,e.index===last.itemIndex?last.end:undefined)).join(' ');
  return {status:'matched',text:entries.slice(Math.max(0,start-2),end+3).map(e=>e.str).join(' ').slice(0,1600),matchedText,match};
}

/** Original text-run boxes in rotated viewport coordinates (whole containing lines). */
export function citationLineBoxes(items:readonly unknown[],match:PdfSearchMatch|undefined,viewport:{transform:number[];width:number;height:number}) {
  const [a,b,c,d,e,f]=viewport.transform,scale=Math.hypot(a,b);
  return (match?.ranges||[]).flatMap(range=>{
    const item=items[range.itemIndex] as {str?:string;width?:number;transform?:number[]};
    if(typeof item?.str!=='string'||typeof item.width!=='number'||!item.transform?.every(Number.isFinite)||item.transform.length!==6)return [];
    const [ia,ib,ic,id,ie,iff]=item.transform,dx0=a*ia+c*ib,dy0=b*ia+d*ib,length=Math.hypot(dx0,dy0);if(!length)return [];
    const x=a*ie+c*iff+e,y=b*ie+d*iff+f,dx=dx0/length*item.width*scale,dy=dy0/length*item.width*scale,hx=a*ic+c*id,hy=b*ic+d*id;
    const xs=[x,x+dx,x+hx,x+dx+hx],ys=[y,y+dy,y+hy,y+dy+hy];
    const box={left:Math.max(0,Math.min(...xs)),right:Math.min(viewport.width,Math.max(...xs)),top:Math.max(0,Math.min(...ys)),bottom:Math.min(viewport.height,Math.max(...ys))};
    return box.right>box.left&&box.bottom>box.top?[box]:[];
  });
}
