type Bounds = Pick<DOMRect, 'left'|'top'|'right'|'bottom'|'width'|'height'>;

function overlaps(a:Bounds,b:Bounds) {
  return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
}

/** Read only characters physically under a PDF link, rather than naming every
 * link after its containing text run. DOM ranges respect rotation and textScaleX.
 * This never changes the user's selection or infers a title from a destination. */
export function pdfLinkText(layer:HTMLElement,rect:Bounds):string {
  const fragments:string[]=[];
  const walker=document.createTreeWalker(layer,NodeFilter.SHOW_TEXT);
  let node:Node|null;
  let examined=0;
  while((node=walker.nextNode())) {
    const value=node.textContent || '';
    if(!value.trim())continue;
    const range=document.createRange();range.selectNodeContents(node);
    if(!overlaps(range.getBoundingClientRect(),rect))continue;
    let selected='';
    for(let offset=0;offset<value.length && examined<12000;) {
      const char=String.fromCodePoint(value.codePointAt(offset)!);
      range.setStart(node,offset);range.setEnd(node,offset+char.length);offset+=char.length;examined++;
      const box=range.getBoundingClientRect();
      const overlapX=Math.max(0,Math.min(box.right,rect.right)-Math.max(box.left,rect.left));
      const overlapY=Math.max(0,Math.min(box.bottom,rect.bottom)-Math.max(box.top,rect.top));
      // Annotation rectangles often include small producer padding; require the
      // majority of the glyph instead of borrowing a neighbouring bracket/word.
      if(box.width>0 && box.height>0 && overlapX>=box.width*.5 && overlapY>=box.height*.35)selected+=char;
    }
    if(selected)fragments.push(selected);
    if(fragments.join('').length>=160 || examined>=12000)break;
  }
  return fragments.join(' ').replace(/\s+/g,' ').trim().slice(0,160).replace(/^\[\s*|\s*\]$/g, '');
}

export function pdfLinkLabel(text:string,page:number,index:number,english:boolean):string {
  return text
    ? english ? `Paper reference “${text}” · from page ${page}` : `论文引用“${text}” · 来源第 ${page} 页`
    : english ? `Paper reference ${index+1} · from page ${page}` : `论文引用 ${index+1} · 来源第 ${page} 页`;
}
