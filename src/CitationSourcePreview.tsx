import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {RenderTask} from 'pdfjs-dist';
import {acquire} from './PdfFigure';
import {citationExcerpt,citationLineBoxes,type CitationExcerpt} from './citation-preview';
import {t} from './i18n';
import './citation-preview.css';
export default function CitationSourcePreview({url,page,quote,anchor,onClose,onEnter,onLeave,onPage}:{url:string;page:number;quote?:string;anchor:HTMLButtonElement;onClose:()=>void;onEnter:()=>void;onLeave:()=>void;onPage:(page:number,quote?:string)=>void}) {
 const host=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null);
 const [excerpt,setExcerpt]=useState<CitationExcerpt>(),[error,setError]=useState(false),[ready,setReady]=useState(false);
 const [position,setPosition]=useState({left:12,top:12,width:420,maxHeight:420});
 useLayoutEffect(()=>{const place=()=>{const rect=anchor.getBoundingClientRect(),vp=window.visualViewport,left=vp?.offsetLeft||0,top=vp?.offsetTop||0,width=Math.min(640,(vp?.width||window.innerWidth)-24),height=vp?.height||window.innerHeight;const boxHeight=Math.min(host.current?.offsetHeight||310,height-24);setPosition({width,left:Math.max(left+12,Math.min(rect.right-width,left+(vp?.width||window.innerWidth)-width-12)),top:Math.max(top+12,rect.top-boxHeight-8>=top?rect.top-boxHeight-8:Math.min(rect.bottom+8,top+height-boxHeight-12)),maxHeight:height-24});};place();const observer=new ResizeObserver(place);if(host.current)observer.observe(host.current);return()=>observer.disconnect();},[anchor]);
 useEffect(()=>{
  let disposed=false,render:RenderTask|undefined;const shared=acquire(url);
  void(async()=>{const pdf=await shared.document;if(disposed)return;if(page<1||page>pdf.numPages)throw Error('page');const sheet=await pdf.getPage(page),content=await sheet.getTextContent();if(disposed)return;
    const source=citationExcerpt(content.items,page,quote);setExcerpt(source);
    const viewport=sheet.getViewport({scale:1}),boxes=citationLineBoxes(content.items,source.match,viewport);
    if(!boxes.length)return;
    const left=Math.max(0,Math.min(...boxes.map(b=>b.left))-16),top=Math.max(0,Math.min(...boxes.map(b=>b.top))-32),right=Math.min(viewport.width,Math.max(...boxes.map(b=>b.right))+16),bottom=Math.min(viewport.height,Math.max(...boxes.map(b=>b.bottom))+32);
    const width=right-left,height=bottom-top;if(width<=0||height<=0)return;const scale=Math.min(2,1000/width,Math.sqrt(2_000_000/(width*height))),node=canvas.current;if(!node)return;
    node.width=Math.ceil(width*scale);node.height=Math.ceil(height*scale);render=sheet.render({canvas:node,viewport:sheet.getViewport({scale}),transform:[1,0,0,1,-left*scale,-top*scale],background:'#fff'});await render.promise;if(disposed)return;
    const ctx=node.getContext('2d')!;ctx.globalCompositeOperation='multiply';ctx.fillStyle='rgba(255,220,60,.45)';for(const box of boxes)ctx.fillRect((box.left-left)*scale,(box.top-top)*scale,(box.right-box.left)*scale,(box.bottom-box.top)*scale);setReady(true);
  })().catch(()=>{if(!disposed)setError(true);});
  return()=>{disposed=true;render?.cancel();shared.release();};
 },[url,page,quote]);
 useEffect(()=>{const close=(event:Event)=>{if(event.target instanceof Node&&(host.current?.contains(event.target)||anchor.contains(event.target)))return;onClose();};const key=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose();};window.addEventListener('resize',close);document.addEventListener('scroll',close,true);document.addEventListener('pointerdown',close);document.addEventListener('keydown',key);return()=>{window.removeEventListener('resize',close);document.removeEventListener('scroll',close,true);document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',key);};},[anchor,onClose]);
 return createPortal(<aside ref={host} className="citation-source-preview" style={position} role="dialog" aria-label={t('引用原文预览','Citation source preview')} onMouseEnter={onEnter} onMouseLeave={onLeave} onFocus={onEnter} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))onLeave();}}>
  <header><strong>{t('原文','Source')} · p.{page}</strong><button onClick={onClose} aria-label={t('关闭预览','Close preview')}>×</button></header>
  {!excerpt&&!error&&<p role="status">{t('正在读取原文…','Loading source…')}</p>}
  {error&&<p role="status">{t('暂时无法预览，仍可打开源页。','Preview unavailable. You can still open the source page.')}</p>}
  {excerpt&&<><p className="citation-match-status">{excerpt.status==='matched'?t('已匹配原文 · 原图标出所在文字行','Source matched · original image highlights containing text lines'):excerpt.status==='ambiguous'?t('存在多处匹配，仅显示页首，未猜测位置。','Multiple matches; showing the page opening without guessing a location.'):excerpt.status==='missing'?t('未找到精确原文，仅显示页首。','No exact match; showing the page opening.'):t('页码引用 · 未指定段落','Page reference · no passage specified')}</p><p className="citation-source-text">{excerpt.status==='matched'?<mark>{excerpt.matchedText}</mark>:excerpt.text||t('此页无可提取文字。','No extractable text on this page.')}</p></>}
  <canvas ref={canvas} hidden={!ready} aria-label={t('引用所在原文区域','Original PDF region containing the citation')}/>
  <footer><button className="text-button" onClick={()=>{onClose();onPage(page,excerpt?.status==='matched'?quote:undefined);}}>{t('跳转并定位原文','Jump to source passage')} ↗</button></footer>
 </aside>,document.body);
}
