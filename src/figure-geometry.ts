/** PDF coordinates are normalized against the rotated, displayed source page. */
export type CropRect = {x:number;y:number;width:number;height:number};
export type FigureTextBox = CropRect & {text:string};
export type GraphicRegion = CropRect & {kind:'image'|'form'};
export type FigureComplexity = {forms?:number;clips?:number;paths?:number;unsupportedClip?:boolean};
export type FigureCandidate = {
  key:string; page:number; label:string; caption:string; kind:'figure'|'table';
  captionBounds:CropRect; crop?:CropRect;
  warning:'review'|'complex-vectors'|'no-region'|'large-region';
};
const right=(r:CropRect)=>r.x+r.width, bottom=(r:CropRect)=>r.y+r.height;
export function boundedCrop(rect:CropRect):CropRect|undefined {
  if (![rect.x,rect.y,rect.width,rect.height].every(Number.isFinite) || rect.width<=0 || rect.height<=0) return;
  const x=Math.max(0,rect.x),y=Math.max(0,rect.y),x2=Math.min(1,right(rect)),y2=Math.min(1,bottom(rect));
  if(x2-x<.002||y2-y<.002)return;
  return {x,y,width:x2-x,height:y2-y};
}
export function unionCrops(rects:CropRect[]):CropRect|undefined {
  if(!rects.length)return;
  const x=Math.min(...rects.map(r=>r.x)),y=Math.min(...rects.map(r=>r.y));
  return boundedCrop({x,y,width:Math.max(...rects.map(right))-x,height:Math.max(...rects.map(bottom))-y});
}
const overlap=(a:CropRect,b:CropRect)=>Math.max(0,Math.min(right(a),right(b))-Math.max(a.x,b.x));
const verticalOverlap=(a:CropRect,b:CropRect)=>Math.max(0,Math.min(bottom(a),bottom(b))-Math.max(a.y,b.y));

/** Keep distant columns separate even when their baselines are identical. */
export function figureTextLines(boxes:FigureTextBox[]):FigureTextBox[] {
  const lines:FigureTextBox[]=[];
  for(const box of [...boxes].filter(b=>b.text.trim()&&boundedCrop(b)).sort((a,b)=>a.y-b.y||a.x-b.x)) {
    const line=lines.find(line=>Math.abs(line.y-box.y)<Math.min(line.height,box.height)*.45 && box.x>=line.x && box.x-right(line)<Math.max(.018,line.height*1.8));
    if(!line){lines.push({...box,text:box.text.trim()});continue;}
    const rect=unionCrops([line,box])!;
    const separator=/[\p{Script=Han}]$/u.test(line.text)&&/^[\p{Script=Han}]/u.test(box.text)?'':' ';
    Object.assign(line,rect,{text:line.text+separator+box.text.trim()});
  }
  return lines.sort((a,b)=>a.y-b.y||a.x-b.x);
}

function captionStart(text:string) {
  // Punctuation distinguishes a caption from body prose such as "Fig. 7 shows".
  const match=/^((?:Figure|Fig\.|Table|图|表)\s*(?:\d+[a-z]?|[IVX]+))\s*[:.：．]\s*(.*)$/iu.exec(text);
  if(match)return {label:match[1],kind:/^(?:Table|表)/i.test(match[1])?'table' as const:'figure' as const};
  const table=/^(TABLE\s+(?:\d+|[IVX]+))$/.exec(text);
  if(table)return {label:table[1],kind:'table' as const};
}

/** A line beginning with a figure reference can continue body prose. A nearby
 * preceding line in the same column and font is stronger evidence than its dot. */
function continuesParagraph(line:FigureTextBox,lines:FigureTextBox[]) {
  return lines.some(previous=>previous!==line&&previous.y<line.y&&
    line.y-bottom(previous)>=-.002&&line.y-bottom(previous)<.009&&
    previous.height>=line.height*.85&&previous.height<=line.height*1.18&&
    overlap(previous,line)>Math.min(previous.width,line.width)*.8&&
    Math.abs(previous.x-line.x)<.04&&previous.text.length>25&&
    !/[.!?:。！？：]$/.test(previous.text.trim())&&!captionStart(previous.text));
}

/** Candidates are intentionally unconfirmed. Ambiguous layouts have no crop;
 * their caption still offers a useful entry point for manual source review. */
export function proposeFigureCandidates(page:number,text:FigureTextBox[],graphics:GraphicRegion[],complexity:FigureComplexity={}):FigureCandidate[] {
  const lines=figureTextLines(text), candidates:FigureCandidate[]=[];
  const complex=graphics.length>100||(complexity.forms||0)>100||(complexity.clips||0)>40||(complexity.paths||0)>800||complexity.unsupportedClip;
  for(const [index,line] of lines.entries()) {
    const start=captionStart(line.text);if(!start||continuesParagraph(line,lines))continue;
    const captionLines=[line];let previous=line;
    // Ignore other-column lines rather than treating their equal baselines as
    // the end of this caption. Only then apply spacing/paragraph boundaries.
    const column=lines.slice(index+1).filter(next=>Math.abs(next.x-line.x)<.03&&overlap(next,line)>Math.min(next.width,line.width)*.6);
    for(const next of column) {
      if(captionLines.length>=8||next.y-bottom(previous)>.012||next.y<previous.y+previous.height*.5)break;
      if(captionStart(next.text)||next.height>line.height*1.3||next.height<line.height*.75||previous.width<line.width*.76)break;
      captionLines.push(next);previous=next;
    }
    const captionBounds=unionCrops(captionLines)!, caption=captionLines.map(l=>l.text).join(' ').slice(0,2000);
    const candidate:FigureCandidate={key:`p${page}-${index}`,page,label:start.label,kind:start.kind,caption,captionBounds,warning:'no-region'};
    // Table captions may be above OR below the table. Without a table layout
    // detector, a nearby chart must not be silently offered as its body.
    if(start.kind==='table'){candidates.push(candidate);continue;}
    if(complex){candidate.warning='complex-vectors';candidates.push(candidate);continue;}
    const regions=graphics.filter(box=>boundedCrop(box)&&box.width>.025&&box.height>.025&&box.width*box.height>.0015);
    const nearby=regions.filter(box=>overlap(box,line)>Math.min(box.width,line.width)*.25&&
      bottom(box)<=line.y+.006&&line.y-bottom(box)<.14&&
      !lines.some(other=>other!==line&&captionStart(other.text)&&other.y>bottom(box)&&bottom(other)<line.y&&overlap(other,box)>Math.min(other.width,box.width)*.5));
    if(!nearby.length){candidates.push(candidate);continue;}
    const seed=nearby.reduce((best,box)=>Math.abs(bottom(box)-line.y)<Math.abs(bottom(best)-line.y)?box:best);
    // Unequal-height side-by-side panels often have different bottom edges.
    // Their substantial vertical overlap binds them to the same caption.
    const group=nearby.filter(box=>verticalOverlap(box,seed)>=Math.min(box.height,seed.height)*.45);
    let bounds=unionCrops(group)!;
    // Image placements can omit titles painted as PDF text. Include only short
    // nearby labels; a body paragraph must not become part of a figure proposal.
    const labels=lines.filter(label=>label.text.length<=90&&!captionStart(label.text)&&
      !candidates.some(other=>verticalOverlap(label,other.captionBounds)>label.height*.5&&overlap(label,other.captionBounds)>label.width*.5)&&
      overlap(label,bounds)>Math.min(label.width,bounds.width)*.5 &&
      label.y<bottom(bounds)&&bottom(label)>=bounds.y-.035 && label.width<=bounds.width*1.12 &&
      (label.y>=bounds.y || bottom(label)<=bounds.y+.008));
    if(labels.length)bounds=unionCrops([bounds,...labels])!;
    const top=Math.max(0,bounds.y-.005),left=Math.max(0,bounds.x-.006);
    const lower=Math.min(1,bottom(bounds)+.005,line.y-.002);
    const crop=boundedCrop({x:left,y:top,width:Math.min(1,right(bounds)+.006)-left,height:lower-top});
    if(crop&&crop.width*crop.height<.85){candidate.crop=crop;candidate.warning='review';}
    else candidate.warning='large-region';
    candidates.push(candidate);
  }
  return candidates.slice(0,40);
}
