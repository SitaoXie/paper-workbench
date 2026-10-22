import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowUpRight,Loader2,X} from 'lucide-react';
import type {PDFDocumentProxy,RenderTask} from 'pdfjs-dist';
import {resolvePdfDestination} from './pdf-destination';
import {readPdfReferenceExcerpt,type PdfReferenceExcerpt} from './pdf-reference-excerpt';
import './pdf-reference-preview.css';
export type PdfReferenceRequest={anchor:HTMLAnchorElement;destination:unknown;label:string;pinned:boolean};

/** A deterministic source preview. No metadata fetch, model or generated prose. */
export default function PdfReferencePreview({document:pdf,request,language,paperColors,onClose,onNavigate,onPointerEnter,onPointerLeave}:{document:PDFDocumentProxy;request:PdfReferenceRequest;language:string;paperColors:"theme"|"original";onClose:()=>void;onNavigate:(page:number,point?:{x?:number;y?:number})=>void;onPointerEnter:()=>void;onPointerLeave:()=>void}){
 const english=language.startsWith('en'),t=(zh:string,en:string)=>english?en:zh;
 const host=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),jump=useRef<HTMLButtonElement>(null);
 const [destination,setDestination]=useState<{page:number;x?:number;y?:number}>(),[excerpt,setExcerpt]=useState<PdfReferenceExcerpt>(),[busy,setBusy]=useState(true),[error,setError]=useState('');
 const [position,setPosition]=useState({left:12,top:72,width:400,maxHeight:500});
 useLayoutEffect(()=>{
  const place=()=>{
   const anchor=request.anchor.getBoundingClientRect(),viewport=window.visualViewport;
   const reader=request.anchor.closest('.pdf-canvas-viewport')?.getBoundingClientRect();
   const viewportLeft=viewport?.offsetLeft||0,viewportTop=viewport?.offsetTop||0;
   const leftEdge=Math.max(viewportLeft+12,(reader?.left||viewportLeft)+8);
   const topEdge=Math.max(viewportTop+12,(reader?.top||viewportTop)+8);
   const rightEdge=Math.min(viewportLeft+(viewport?.width||window.innerWidth)-12,(reader?.right||window.innerWidth)-8);
   const bottomEdge=Math.min(viewportTop+(viewport?.height||window.innerHeight)-12,(reader?.bottom||window.innerHeight)-8);
   const width=Math.min(430,Math.max(160,rightEdge-leftEdge)),maxHeight=Math.max(120,bottomEdge-topEdge);
   const height=Math.min(host.current?.offsetHeight||300,maxHeight);
   const below=anchor.bottom+8,top=below+height<=bottomEdge?below:Math.max(topEdge,anchor.top-height-8);
   const left=Math.max(leftEdge,Math.min(anchor.left,rightEdge-width));
   setPosition(current=>current.left===left&&current.top===top&&current.width===width&&current.maxHeight===maxHeight?current:{left,top,width,maxHeight});
  };
  place();const observer=new ResizeObserver(place);if(host.current)observer.observe(host.current);return()=>observer.disconnect();
 },[request,busy,error]);
 useEffect(()=>{
  let disposed=false,render:RenderTask|undefined;const controller=new AbortController();setBusy(true);setError('');setDestination(undefined);setExcerpt(undefined);
  void(async()=>{
   const target=await resolvePdfDestination(pdf,request.destination);if(disposed)return;if(!target)throw new Error('missing');setDestination(target);
   const page=await pdf.getPage(target.page),viewport=page.getViewport({scale:1});if(disposed)return;
   const regionHeight=Math.min(viewport.height,180),regionTop=Math.max(0,Math.min((target.y||0)*viewport.height-16,viewport.height-regionHeight));
   let source:PdfReferenceExcerpt;
   try{source=await readPdfReferenceExcerpt(page,target,request.label,{signal:controller.signal,maxChars:900});}
   catch(reason){if(controller.signal.aborted)throw reason;source={text:'',crop:{x:0,y:regionTop/viewport.height,width:1,height:regionHeight/viewport.height},uncertain:true};}
   if(disposed)return;
   const cropLeft=source.crop.x*viewport.width,cropTop=source.crop.y*viewport.height,cropWidth=source.crop.width*viewport.width,cropHeight=source.crop.height*viewport.height;
   const node=canvas.current;if(!node)return;
   const displayWidth=Math.max(120,Math.min(406,(window.visualViewport?.width||window.innerWidth)-48)),scale=Math.min(3,displayWidth*2/cropWidth,Math.sqrt(4_000_000/(cropWidth*cropHeight)));
   node.width=Math.max(1,Math.round(cropWidth*scale));node.height=Math.max(1,Math.round(cropHeight*scale));
   render=page.render({canvas:node,viewport:page.getViewport({scale}),transform:[1,0,0,1,-cropLeft*scale,-cropTop*scale],background:'#fff'});await render.promise;if(disposed)return;node.dataset.rendered='true';
   setExcerpt(source);setBusy(false);
  })().catch(reason=>{if(!disposed){setBusy(false);setError(reason instanceof Error&&reason.message==='missing'?t('此引用没有可定位的目标，请在论文中搜索原文。','This reference has no usable destination. Search the paper text.'):t('暂时无法预览该引用，可跳到原文查看。','This reference could not be previewed. Open its source location.'));}});
  return()=>{disposed=true;controller.abort();render?.cancel();};
 },[pdf,request.destination,request.label,language]);
 useEffect(()=>{
  const close=(event:Event)=>{if(event.target instanceof Node&&(host.current?.contains(event.target)||request.anchor.contains(event.target)))return;onClose();};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();onClose();request.anchor.focus({preventScroll:true});}};
  window.document.addEventListener('pointerdown',close);window.document.addEventListener('scroll',close,true);window.document.addEventListener('keydown',escape);window.addEventListener('resize',close);
  return()=>{window.document.removeEventListener('pointerdown',close);window.document.removeEventListener('scroll',close,true);window.document.removeEventListener('keydown',escape);window.removeEventListener('resize',close);};
 },[onClose,request.anchor]);
 useEffect(()=>{if(request.pinned&&!busy)jump.current?.focus({preventScroll:true});},[request.pinned,busy]);
 const open=()=>{if(destination){onClose();onNavigate(destination.page,destination);}};
 return createPortal(<div ref={host} className="pdf-reference-preview" data-paper-colors={paperColors} style={position} role="dialog" aria-modal="false" aria-label={t('论文引用原文预览','Paper reference source preview')} onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>
  <header><span>{request.label}{destination?` · p.${destination.page}`:''}</span><button type="button" className="icon-button" aria-label={t('关闭引用预览','Close reference preview')} onClick={()=>{onClose();request.anchor.focus({preventScroll:true});}}><X size={15}/></button></header>
  {busy&&<p className="pdf-reference-loading" role="status"><Loader2 size={15} className="spin"/>{t('正在读取原文…','Loading source…')}</p>}
  {error&&<p role="status">{error}</p>}
  {excerpt?.text&&<div className="pdf-reference-excerpt"><small>{excerpt.uncertain?t('目标附近原文','Text near the destination'):t('引用原文','Reference text')}</small><p>{excerpt.text}</p></div>}
  <details className="pdf-reference-image" open={!excerpt?.text} hidden={!!error||busy}><summary>{t('查看 PDF 原图','View original PDF crop')}</summary><canvas ref={canvas} aria-label={t('引用目标附近的原 PDF 区域','Original PDF region around the reference destination')}/></details>
  <footer><small>{t('原文附近区域 · 无 AI 改写','Source region · No AI rewriting')}</small><button ref={jump} type="button" className="text-button" disabled={!destination} onClick={open}>{t('跳转到原文','Open source location')}<ArrowUpRight size={14}/></button></footer>
 </div>,window.document.body);
}
