import {useRef,type PointerEvent,type ReactNode} from 'react';
import type {CropRect} from './figure-geometry';
import {useLocale} from './i18n';
type Drag={id:number;mode:string;x:number;y:number;crop?:CropRect};
const clamp=(n:number,min=0,max=1)=>Math.min(max,Math.max(min,n));
export default function FigureCropEditor({crop,onChange,children,disabled=false,editing=false}:{crop?:CropRect;onChange:(crop:CropRect)=>void;children:ReactNode;disabled?:boolean;editing?:boolean}) {
  const {t}=useLocale(),host=useRef<HTMLDivElement>(null),drag=useRef<Drag|undefined>(undefined);
  const point=(event:PointerEvent)=>{const rect=host.current!.getBoundingClientRect();return {x:clamp((event.clientX-rect.left)/rect.width),y:clamp((event.clientY-rect.top)/rect.height)};};
  function start(event:PointerEvent) {
    if(disabled||!editing||event.button!==0)return;
    const target=event.target as HTMLElement,mode=target.dataset.handle|| (target.closest('.figure-crop-rect')?'move':'draw');
    const p=point(event);drag.current={id:event.pointerId,mode,...p,crop};event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();
  }
  function move(event:PointerEvent) {
    const d=drag.current;if(!d||d.id!==event.pointerId)return;const p=point(event),old=d.crop;
    let x=Math.min(p.x,d.x),y=Math.min(p.y,d.y),right=Math.max(p.x,d.x),bottom=Math.max(p.y,d.y);
    if(old&&d.mode==='move'){x=clamp(old.x+p.x-d.x,0,1-old.width);y=clamp(old.y+p.y-d.y,0,1-old.height);right=x+old.width;bottom=y+old.height;}
    else if(old&&d.mode!=='draw'){
      x=d.mode.includes('w')?Math.min(p.x,old.x+old.width-.005):old.x;
      y=d.mode.includes('n')?Math.min(p.y,old.y+old.height-.005):old.y;
      right=d.mode.includes('e')?Math.max(p.x,old.x+.005):old.x+old.width;
      bottom=d.mode.includes('s')?Math.max(p.y,old.y+.005):old.y+old.height;
    }
    if(right-x>=.005&&bottom-y>=.005)onChange({x,y,width:right-x,height:bottom-y});
  }
  return <div ref={host} className={`figure-crop-editor ${disabled?'is-disabled':''} ${editing?'is-editing':''}`} onPointerDown={start} onPointerMove={move} onPointerUp={()=>{drag.current=undefined;}} onPointerCancel={()=>{drag.current=undefined;}} aria-label={editing?t('在原始页面上拖动选择图表区域','Drag on the source page to select a figure'):t('原始页面预览，可上下滚动','Source page preview; scroll to inspect')}>
    {children}
    {crop&&<div className="figure-crop-rect" style={{left:`${crop.x*100}%`,top:`${crop.y*100}%`,width:`${crop.width*100}%`,height:`${crop.height*100}%`}}><span className="figure-crop-label">{t('待核对裁切','Crop to review')}</span>{['nw','ne','sw','se'].map(handle=><span className={`figure-crop-handle ${handle}`} data-handle={handle} key={handle}/>)}</div>}
  </div>;
}
