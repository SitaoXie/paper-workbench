import { useLayoutEffect,useState,type RefObject } from 'react';
import { restoreTextAnchor,type InlineMemory } from './inline-memory';
import { t } from './i18n';
export default function InlineMarkers({root,entries,active,onOpen}:{root:RefObject<HTMLDivElement|null>;entries:InlineMemory[];active:boolean;onOpen:(entry:InlineMemory,range:Range)=>void}) {
  const [rects,setRects]=useState<{entry:InlineMemory;left:number;top:number;width:number}[]>([]);
  useLayoutEffect(()=>{
    if(!active||!root.current){setRects([]);return;}
    const host=root.current;let frame=0;
    const update=()=>{frame=0;const bounds=host.getBoundingClientRect();const result:{entry:InlineMemory;left:number;top:number;width:number}[]=[];
      for(const entry of entries.filter(m=>!m.hidden)){const range=restoreTextAnchor(host,entry.anchor);if(!range)continue;
        for(const rect of Array.from(range.getClientRects()))if(rect.width>1&&rect.height>1)result.push({entry,left:rect.left-bounds.left,top:rect.bottom-bounds.top,width:rect.width});}
      setRects(result.slice(0,1000));};
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};update();
    const observer=new ResizeObserver(schedule);observer.observe(host);document.addEventListener('scroll',schedule,true);window.addEventListener('resize',schedule);
    return()=>{cancelAnimationFrame(frame);observer.disconnect();document.removeEventListener('scroll',schedule,true);window.removeEventListener('resize',schedule);};
  },[root,entries,active]);
  return <div className="inline-memory-markers">{rects.map((rect,index)=><button key={`${rect.entry.id}-${index}`} style={{left:rect.left,top:rect.top,width:rect.width}} aria-label={rect.entry.kind==='translation'?t('查看已保存翻译','Review saved translation'):t('查看已保存解释','Review saved explanation')} onPointerDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();const range=root.current&&restoreTextAnchor(root.current,rect.entry.anchor);if(range)onOpen(rect.entry,range);}}/>)}</div>;
}
