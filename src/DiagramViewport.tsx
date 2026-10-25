import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {t} from './i18n';

export type DiagramSize = {width:number; height:number};
export function diagramSize(svg:string):DiagramSize {
  const root=new DOMParser().parseFromString(svg,'image/svg+xml').documentElement;
  const box=(root.getAttribute('viewBox')||'').trim().split(/[\s,]+/).map(Number);
  if(box.length===4&&box.every(Number.isFinite)&&box[2]>0&&box[3]>0)return {width:box[2],height:box[3]};
  const width=Number.parseFloat(root.getAttribute('width')||''),height=Number.parseFloat(root.getAttribute('height')||'');
  return {width:Number.isFinite(width)&&width>0?width:640,height:Number.isFinite(height)&&height>0?height:300};
}
export const clampDiagramScale = (scale:number) => Math.max(.1, Math.min(4, scale));
export function diagramLayout(size:DiagramSize, availableWidth:number, scale:number) {
  const width=Math.max(1, size.width*scale), height=Math.max(1, size.height*scale);
  return {width, height, viewportHeight:Math.min(420, Math.ceil(height)+ (width>availableWidth ? 20 : 0))};
}
export function zoomedScroll(scroll:number, anchor:number, before:number, after:number) {
  return Math.max(0, (scroll+anchor)*after/before-anchor);
}

/** A sandboxed diagram inside a native scroll surface. Scaling changes the SVG,
 * not just the frame; no scripts or interaction permissions enter the iframe. */
export default function DiagramViewport({svg,size}:{svg:string;size:DiagramSize}) {
  const viewport=useRef<HTMLDivElement>(null);
  const [scale,setScale]=useState(1),[fit,setFit]=useState(false),[width,setWidth]=useState(640);
  const pending=useRef<{left:number;top:number}>(undefined);
  const drag=useRef<{id:number;x:number;y:number;left:number;top:number}>(undefined);
  const layout=diagramLayout(size,width,scale);
  useLayoutEffect(()=>{
    const element=viewport.current;if(!element)return;
    const measure=()=>setWidth(Math.max(1,element.clientWidth));
    measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();
  },[]);
  useLayoutEffect(()=>{if(fit)setScale(clampDiagramScale(width/size.width));},[fit,width,size.width]);
  useLayoutEffect(()=>{
    if(pending.current&&viewport.current){viewport.current.scrollLeft=pending.current.left;viewport.current.scrollTop=pending.current.top;pending.current=undefined;}
  },[scale]);
  const zoom=(next:number,x?:number,y?:number)=>{
    const element=viewport.current;next=clampDiagramScale(next);setFit(false);
    if(element)pending.current={left:zoomedScroll(element.scrollLeft,x??element.clientWidth/2,scale,next),top:zoomedScroll(element.scrollTop,y??element.clientHeight/2,scale,next)};
    setScale(next);
  };
  // A non-passive listener consumes only zoom gestures or horizontal-only scroll.
  // Normal vertical scrolling can still move the enclosing conversation.
  useEffect(()=>{
    const element=viewport.current;if(!element)return;
    const wheel=(event:WheelEvent)=>{
      if(event.ctrlKey||event.metaKey){event.preventDefault();const rect=element.getBoundingClientRect();zoom(scale*Math.exp(-event.deltaY*.008),event.clientX-rect.left,event.clientY-rect.top);}
      else if(!event.deltaX&&element.scrollWidth>element.clientWidth&&(event.shiftKey||element.scrollHeight<=element.clientHeight+1)){
        const next=Math.max(0,Math.min(element.scrollWidth-element.clientWidth,element.scrollLeft+event.deltaY));
        if(next!==element.scrollLeft){event.preventDefault();element.scrollLeft=next;}
      }
    };
    element.addEventListener('wheel',wheel,{passive:false});return()=>element.removeEventListener('wheel',wheel);
  },[scale]);
  const doc=useMemo(()=>`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none';"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}body>svg{display:block;width:100%!important;height:100%!important;max-width:none!important}</style>${svg}`,[svg]);
  return <div className="diagram-viewer">
    <div className="diagram-toolbar" role="group" aria-label={t('图形缩放','Diagram zoom')}>
      <button type="button" aria-label={t('缩小图形','Zoom out')} disabled={scale<=.1} onClick={()=>zoom(scale/1.25)}>−</button>
      <output aria-live="polite">{Math.round(scale*100)}%</output>
      <button type="button" aria-label={t('放大图形','Zoom in')} disabled={scale>=4} onClick={()=>zoom(scale*1.25)}>+</button>
      <button type="button" aria-pressed={fit} onClick={()=>{pending.current={left:0,top:0};setFit(true);setScale(clampDiagramScale(width/size.width));if(viewport.current){viewport.current.scrollLeft=0;viewport.current.scrollTop=0;}}}>{t('适应宽度','Fit width')}</button>
      <button type="button" onClick={()=>{pending.current={left:0,top:0};setFit(false);setScale(1);if(viewport.current){viewport.current.scrollLeft=0;viewport.current.scrollTop=0;}}}>1:1</button>
    </div>
    <div ref={viewport} className="diagram-viewport" style={{height:layout.viewportHeight}} tabIndex={0} role="region" aria-label={t('图形，可拖动或滚动；加减键缩放','Diagram; drag or scroll to pan, plus/minus keys to zoom')}
      onKeyDown={event=>{if(event.key==='+'||event.key==='='){event.preventDefault();zoom(scale*1.25);}else if(event.key==='-'){event.preventDefault();zoom(scale/1.25);}}}
      onPointerDown={event=>{if(event.pointerType==='touch'||event.button!==0)return;const node=event.currentTarget;drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,left:node.scrollLeft,top:node.scrollTop};node.setPointerCapture(event.pointerId);node.classList.add('is-dragging');}}
      onPointerMove={event=>{const current=drag.current;if(!current||current.id!==event.pointerId)return;event.currentTarget.scrollLeft=current.left+current.x-event.clientX;event.currentTarget.scrollTop=current.top+current.y-event.clientY;}}
      onPointerUp={event=>{drag.current=undefined;event.currentTarget.classList.remove('is-dragging');if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}
      onLostPointerCapture={event=>{drag.current=undefined;event.currentTarget.classList.remove('is-dragging');}}>
      <iframe title={t('解释示意图','Explanatory diagram')} tabIndex={-1} sandbox="" srcDoc={doc} style={{width:layout.width,height:layout.height}}/>
    </div>
    <small className="diagram-hint">{t('拖动或滚动查看 · Ctrl / ⌘ + 滚轮缩放','Drag or scroll to pan · Ctrl / ⌘ + wheel to zoom')}</small>
  </div>;
}
