import type {PDFPageProxy} from 'pdfjs-dist';

type Content = Awaited<ReturnType<PDFPageProxy['getTextContent']>>;
type Viewport = ReturnType<PDFPageProxy['getViewport']>;
export type PdfReferencePoint = {x?:number;y?:number};
export type PdfReferenceExcerpt = {
  text:string;
  /** Fractions of the rotated visible viewport, from its top-left corner. */
  crop:{x:number;y:number;width:number;height:number};
  /** False means a nearby entry label matched geometrically, not claim verification. */
  uncertain:boolean;
  matchedLabel?:string;
};
type Box = {text:string;left:number;right:number;top:number;bottom:number;baseline:number;height:number};
type Line = Box & {count:number};
type Column = {left:number;right:number;count:number};
const clamp = (value:number,min=0,max=1) => Math.max(min,Math.min(max,value));
const finite = (value:unknown):value is number => typeof value==='number'&&Number.isFinite(value);
const median = (values:number[]) => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]||.012;
const distance = (x:number,span:{left:number;right:number}) => Math.max(span.left-x,0,x-span.right);
const entryNumber = (text:string) => text.match(/^\s*(?:\[(\d{1,4})\]|(\d{1,4})[.)])(?:\s|$)/)?.slice(1).find(Boolean);
const labelNumber = (label:string) => label.trim().match(/^(?:\[(\d{1,4})\]|(\d{1,4})[.)]?)$/)?.slice(1).find(Boolean);

function boxesFrom(content:Pick<Content,'items'>,viewport:Viewport):Box[] {
  const [a,b,c,d,e,f]=viewport.transform,scale=Math.hypot(a,b),boxes:Box[]=[];
  for(const item of content.items){
    if(!('str' in item)||!item.str.trim()||!finite(item.width)||item.width<0||!item.transform.every(finite))continue;
    const [ia,ib,ic,id,ie,iff]=item.transform;
    const mx=a*ia+c*ib,my=b*ia+d*ib,hx=a*ic+c*id,hy=b*ic+d*id;
    const length=Math.hypot(mx,my);
    // Vertical/rotated text needs a region preview. Do not pretend sorting its
    // viewport y coordinates reconstructs a horizontal reading order.
    if(!length||Math.abs(my)>Math.abs(mx)*.2||mx<0)continue;
    const x=a*ie+c*iff+e,y=b*ie+d*iff+f;
    const dx=mx/length*item.width*scale,dy=my/length*item.width*scale;
    const xs=[x,x+dx,x+hx,x+dx+hx],ys=[y,y+dy,y+hy,y+dy+hy];
    const box={text:item.str,left:Math.min(...xs)/viewport.width,right:Math.max(...xs)/viewport.width,
      top:Math.min(...ys)/viewport.height,bottom:Math.max(...ys)/viewport.height,baseline:y/viewport.height,height:Math.hypot(hx,hy)/viewport.height};
    if(box.right>0&&box.left<1&&box.bottom>0&&box.top<1&&box.height>0)boxes.push(box);
  }
  return boxes;
}

function linesFrom(boxes:Box[],viewport:Viewport):Line[] {
  const fontHeight=median(boxes.map(item=>item.height)),rows:Box[][]=[];
  for(const box of [...boxes].sort((a,b)=>a.baseline-b.baseline||a.left-b.left)){
    const row=rows.at(-1);
    if(row&&Math.abs(row[0].baseline-box.baseline)<=fontHeight*.35)row.push(box);
    else rows.push([box]);
  }
  const lines:Line[]=[];
  for(const row of rows){
    let parts:Box[]=[];
    const flush=()=>{
      if(!parts.length)return;
      let text='';
      for(let index=0;index<parts.length;index++){
        const item=parts[index],previous=parts[index-1];
        const gap=previous?(item.left-previous.right)*viewport.width:0;
        const em=item.height*viewport.height;
        const cjk=previous&&/[\u3400-\u9fff]$/.test(previous.text)&&/^[\u3400-\u9fff]/.test(item.text);
        const space=previous&&gap>em*.15&&!(cjk&&gap<em*.6)&&!/[\s]$/.test(previous.text)&&!/^\s|^[,.;:!?)]/.test(item.text);
        text+=(space?' ':'')+item.text;
      }
      lines.push({...parts[0],text:text.trim(),left:Math.min(...parts.map(p=>p.left)),right:Math.max(...parts.map(p=>p.right)),
        top:Math.min(...parts.map(p=>p.top)),bottom:Math.max(...parts.map(p=>p.bottom)),height:median(parts.map(p=>p.height)),count:parts.length});
      parts=[];
    };
    for(const box of row.sort((a,b)=>a.left-b.left)){
      const previous=parts.at(-1);
      if(previous&&(box.left-previous.right)*viewport.width>Math.max(10,fontHeight*viewport.height*1.65))flush();
      parts.push(box);
    }
    flush();
  }
  return lines.sort((a,b)=>a.top-b.top||a.left-b.left);
}

function columnsNear(lines:Line[],y:number,viewport:Viewport):Column[] {
  // Full-width headings are not a bridge between two body columns. If all
  // nearby text is full width, the caller instead uses a full-width region.
  const radius=Math.min(.25,180/viewport.height),parts=lines.filter(line=>line.bottom>=y-radius&&line.top<=y+radius&&line.right-line.left<=.64);
  const columns:Column[]=[];
  for(const line of [...parts].sort((a,b)=>a.left-b.left)){
    const previous=columns.at(-1),gap=Math.max(.006,4/viewport.width);
    if(previous&&line.left<=previous.right+gap){previous.right=Math.max(previous.right,line.right);previous.count++;}
    else columns.push({left:line.left,right:line.right,count:1});
  }
  return columns.filter(column=>column.right-column.left>=.16&&column.count>=2);
}

function sourceCrop(viewport:Viewport,point:PdfReferencePoint,column?:Column,range?:{top:number;bottom:number}) {
  const maxWidth=Math.min(1,720/viewport.width),maxHeight=Math.min(1,260/viewport.height);
  let left=column?column.left-6/viewport.width:0,right=column?column.right+6/viewport.width:1;
  const focusX=finite(point.x)?clamp(point.x):(left+right)/2;
  if(right-left>maxWidth){left=clamp(focusX-maxWidth*.15,0,1-maxWidth);right=left+maxWidth;}
  left=clamp(left);right=clamp(right,left+Math.min(.001,1/viewport.width));
  const height=range?Math.min(maxHeight,Math.max(20/viewport.height,range.bottom-range.top+8/viewport.height)):Math.min(maxHeight,180/viewport.height);
  const top=clamp(range?range.top-4/viewport.height:(finite(point.y)?point.y:0)-16/viewport.height,0,1-height);
  return{x:left,y:top,width:right-left,height};
}

/** Local geometry only: a label can disambiguate a nearby entry in the selected
 * column, but it never searches the whole page to override a PDF destination. */
export function extractPdfReferenceExcerpt(content:Pick<Content,'items'>,viewport:Viewport,point:PdfReferencePoint,label:string,options:{maxChars?:number}={}):PdfReferenceExcerpt {
  if(!finite(viewport.width)||!finite(viewport.height)||viewport.width<=0||viewport.height<=0)
    return{text:'',crop:{x:0,y:0,width:1,height:1},uncertain:true};
  const fallback={text:'',crop:sourceCrop(viewport,point),uncertain:true};
  if(!Array.isArray(content.items)||content.items.length>50000||!finite(point.y))return fallback;
  const lines=linesFrom(boxesFrom(content,viewport),viewport);
  if(!lines.length)return fallback;
  const y=clamp(point.y),columns=columnsNear(lines,y,viewport),x=finite(point.x)?clamp(point.x):undefined;
  // A short spanning heading or marginal item can bridge otherwise separate
  // body columns. Such a merged lane is not reliable column evidence.
  if(columns.some(column=>column.right-column.left>.68))return fallback;
  const nearby=x===undefined?[]:columns.filter(column=>distance(x,column)<=Math.max(.008,6/viewport.width));
  let column=nearby.length===1?nearby[0]:undefined;
  if(columns.length>1&&!column)return fallback;
  if(!column&&columns.length===1&&(x===undefined||distance(x,columns[0])<=.025))column=columns[0];
  const candidates=column?lines.filter(line=>line.left>=column.left-.008&&line.right<=column.right+.008):lines;
  const wanted=labelNumber(label),fontHeight=median(candidates.map(line=>line.height));
  const nearestDistance=Math.min(...candidates.map(line=>Math.abs(line.top-y)));
  const matches=column&&wanted?candidates.filter(line=>entryNumber(line.text)===wanted&&
    (x===undefined||distance(x,line)<=Math.max(.008,6/viewport.width))&&
    Math.abs(line.top-y)<=Math.min(Math.max(24/viewport.height,fontHeight*3),nearestDistance+Math.max(4/viewport.height,fontHeight*.8))):[];
  const exact=matches.length===1?matches[0]:undefined;
  // Without an identified column, avoid joining separate row fragments into a
  // fictitious paragraph. The image remains useful when text order is unclear.
  if(!column){
    const rows=[...candidates].sort((a,b)=>a.baseline-b.baseline||a.left-b.left);
    if(rows.some((line,index)=>index>0&&Math.abs(line.baseline-rows[index-1].baseline)<fontHeight*.35&&
      (line.right<rows[index-1].left-.02||rows[index-1].right<line.left-.02)))return fallback;
  }
  const anchor=exact||[...candidates].sort((a,b)=>Math.abs(a.top-y)-Math.abs(b.top-y)||a.top-b.top)[0];
  if(!anchor||Math.abs(anchor.top-y)>Math.max(.06,48/viewport.height))return{...fallback,crop:sourceCrop(viewport,point,column)};
  const start=candidates.indexOf(anchor),selected:Line[]=[];let geometryTruncated=false;
  for(let index=start;index<candidates.length;index++){
    const line=candidates[index],previous=selected.at(-1);
    if(previous&&(entryNumber(line.text)||line.top-previous.bottom>Math.max(fontHeight*1.3,8/viewport.height)))break;
    if(line.bottom-anchor.top>240/viewport.height){geometryTruncated=true;break;}
    selected.push(line);
  }
  const joined=selected.map(line=>line.text).join('\n'),maxChars=finite(options.maxChars)?clamp(Math.floor(options.maxChars),100,6000):1800;
  const text=joined.length>maxChars||geometryTruncated?joined.slice(0,maxChars-1)+'…':joined;
  return{text,crop:sourceCrop(viewport,point,column,{top:anchor.top,bottom:selected.at(-1)?.bottom||anchor.bottom}),
    uncertain:!exact||joined.length>maxChars||geometryTruncated,...(exact?{matchedLabel:`[${wanted}]`}:{})};
}

export async function readPdfReferenceExcerpt(page:PDFPageProxy,point:PdfReferencePoint,label:string,options:{signal?:AbortSignal;maxChars?:number}={}):Promise<PdfReferenceExcerpt> {
  const check=()=>{if(options.signal?.aborted)throw new DOMException('Reference preview cancelled','AbortError');};
  check();const content=await page.getTextContent();check();
  return extractPdfReferenceExcerpt(content,page.getViewport({scale:1}),point,label,options);
}
