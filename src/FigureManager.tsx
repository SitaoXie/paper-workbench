import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {getDocument,GlobalWorkerOptions,type PDFDocumentProxy,type RenderTask} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {ChevronLeft,ChevronRight,Check,Crop,Loader2,ScanSearch,X} from 'lucide-react';
import {api,type Figure,type Paper} from './types';
import {useLocale} from './i18n';
import {ApiRequestError} from './selection-errors';
import {inspectFigureCandidates} from './figure-candidates';
import type {CropRect,FigureCandidate} from './figure-geometry';
import {readFigureDrafts,saveFigureDrafts,type FigureDraft,type FigureDrafts} from './figure-drafts';
import FigureCropEditor from './FigureCropEditor';
import './figure-manager.css';
GlobalWorkerOptions.workerSrc=workerUrl;
type ManagedFigure=Figure&{label?:string;source?:{reviewed?:boolean;method?:string};largeCrop?:boolean};
type Collection={figures:ManagedFigure[];pdfRevision:string;figuresRevision:string};
const manual=(page:number):FigureDraft=>({key:`manual-${page}`,page,caption:'',label:'',method:'manual',reviewed:false,dirty:false});
const empty:FigureDrafts={drafts:{}};
export default function FigureManager({paper,initialPage=1,onClose,onSaved}:{paper:Paper;initialPage?:number;onClose:()=>void;onSaved:(paper:Paper)=>void}) {
  const {t}=useLocale(),dialog=useRef<HTMLDivElement>(null),close=useRef<HTMLButtonElement>(null),stage=useRef<HTMLDivElement>(null),canvasHost=useRef<HTMLDivElement>(null),preview=useRef<HTMLCanvasElement>(null);
  const [collection,setCollection]=useState<Collection>(),[pdf,setPdf]=useState<PDFDocumentProxy>(),[state,setState]=useState<FigureDrafts>(empty),[candidates,setCandidates]=useState<FigureCandidate[]>([]);
  const stateRef=useRef(state);stateRef.current=state;
  const [width,setWidth]=useState(700),[ratio,setRatio]=useState(1.414),[rendered,setRendered]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState(''),[saving,setSaving]=useState(false),[notice,setNotice]=useState('');
  const [sourceNavigation,setSourceNavigation]=useState(0),sourceNavigationPending=useRef(true);
  const [editing,setEditing]=useState(false),[draftStored,setDraftStored]=useState(true);
  const [scan,setScan]=useState<{page:number;total:number}>(),[scanned,setScanned]=useState<Set<number>>(new Set()),[pageInput,setPageInput]=useState(String(initialPage)),[conflict,setConflict]=useState(false);
  const scanController=useRef<AbortController|undefined>(undefined),mounted=useRef(true),saveLock=useRef(false);
  const selected=state.selected?state.drafts[state.selected]:undefined, draft=selected||manual(initialPage),page=draft.page;
  const sourceUrl=paper.localPdfUrl||'';
  const revisionConflict=conflict||!!(draft.dirty&&draft.baseFiguresRevision&&collection&&draft.baseFiguresRevision!==collection.figuresRevision);
  const savedDraft=(figure:ManagedFigure,revision:string):FigureDraft=>({key:`figure-${figure.id}`,figureId:figure.id,page:figure.page,label:figure.label||'',caption:figure.caption,crop:figure.crop,method:'manual',reviewed:false,dirty:false,baseFiguresRevision:revision});
  function update(patch:Partial<FigureDraft>) {setNotice('');setState(old=>{const key=old.selected||draft.key;return {selected:key,drafts:{...old.drafts,[key]:{...(old.drafts[key]||draft),...patch,baseFiguresRevision:patch.baseFiguresRevision||(old.drafts[key]||draft).baseFiguresRevision||collection?.figuresRevision,dirty:true,reviewed:patch.reviewed??false}}};});}
  function select(next:FigureDraft) {if(saveLock.current)return;sourceNavigationPending.current=true;setSourceNavigation(value=>value+1);setError('');setNotice('');setState(old=>({selected:next.key,drafts:{...old.drafts,[next.key]:old.drafts[next.key]?.dirty?old.drafts[next.key]:{...next,baseFiguresRevision:collection?.figuresRevision}}}));}
  function go(number:number) {if(!pdf)return;const next=Math.min(pdf.numPages,Math.max(1,Math.trunc(number)||1));if(next!==page)select(manual(next));}
  useEffect(()=>{setPageInput(String(page));},[page]);
  useEffect(()=>{
    mounted.current=true;const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;document.body.style.overflow='hidden';close.current?.focus();
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if((event.target as HTMLElement).dataset.figurePageEditor){setPageInput(String(stateRef.current.drafts[stateRef.current.selected||'']?.page||initialPage));return;}onClose();}if(event.key==='Tab'){const focusable=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')||[]).filter(el=>el.getClientRects().length);const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}};
    document.addEventListener('keydown',key,true);
    return()=>{mounted.current=false;scanController.current?.abort();document.body.style.overflow=overflow;document.removeEventListener('keydown',key,true);previous?.focus();};
  },[]);
  useEffect(()=>{
    let disposed=false;let task:ReturnType<typeof getDocument>|undefined;
    (async()=>{try{
      const response=await api<Collection>(`/papers/${paper.id}/figures`);if(disposed)return;
      setCollection(response);const saved=readFigureDrafts(paper.id,response.pdfRevision);const first=manual(initialPage);
      for(const [key,d] of Object.entries(saved.drafts)){if(d.figureId&&!d.dirty){const current=response.figures.find(f=>f.id===d.figureId);if(current)saved.drafts[key]=savedDraft(current,response.figuresRevision);else delete saved.drafts[key];}}
      setState(saved.selected&&saved.drafts[saved.selected]?saved:{selected:first.key,drafts:{...saved.drafts,[first.key]:{...(saved.drafts[first.key]||first),baseFiguresRevision:response.figuresRevision}}});
      const url=new URL(sourceUrl,location.href);url.searchParams.set('revision',response.pdfRevision);
      task=getDocument({url:url.toString(),withCredentials:false,useSystemFonts:true});const document=await task.promise;if(!disposed){setPdf(document);setLoading(false);}
    }catch(reason){if(!disposed){setError(reason instanceof Error?reason.message:t('无法打开图表核对','Could not open figure review'));setLoading(false);}}})();
    return()=>{disposed=true;void task?.destroy().catch(()=>{});};
  },[paper.id,sourceUrl]);
  useEffect(()=>{if(collection)setDraftStored(saveFigureDrafts(paper.id,collection.pdfRevision,state));},[state,collection?.pdfRevision,paper.id]);
  useEffect(()=>{const element=stage.current;if(!element)return;const observer=new ResizeObserver(()=>setWidth(Math.max(160,Math.min(1100,element.clientWidth-32))));observer.observe(element);return()=>observer.disconnect();},[pdf]);
  useEffect(()=>{
    if(!pdf)return;let disposed=false,task:RenderTask|undefined;setRendered(0);
    (async()=>{try{const source=await pdf.getPage(page);if(disposed)return;const natural=source.getViewport({scale:1}),viewport=source.getViewport({scale:width/natural.width});const density=Math.min(devicePixelRatio||1,2,Math.sqrt(7_000_000/(viewport.width*viewport.height)));const canvas=document.createElement('canvas');canvas.width=Math.round(viewport.width*density);canvas.height=Math.round(viewport.height*density);canvas.style.width='100%';canvas.style.height='auto';canvas.dataset.sourcePage=String(page);canvas.setAttribute('role','img');canvas.setAttribute('aria-label',t(`原始 PDF 第 ${page} 页`,`Original PDF page ${page}`));
      canvasHost.current?.replaceChildren(canvas);setRatio(viewport.height/viewport.width);task=source.render({canvas,viewport,transform:[density,0,0,density,0,0],background:'#ffffff'});await task.promise;if(!disposed)setRendered(value=>value+1);
    }catch(reason){if(!disposed&&!(reason instanceof Error&&reason.name==='RenderingCancelledException'))setError(t('此页渲染失败，请换页后重试。','This page could not render. Switch pages and retry.'));}})();
    return()=>{disposed=true;task?.cancel();};
  },[pdf,page,width]);
  useEffect(()=>{const source=canvasHost.current?.querySelector('canvas'),target=preview.current,crop=draft.crop;if(!source||!target||!crop||!rendered)return;const w=Math.max(1,Math.round(source.width*crop.width)),h=Math.max(1,Math.round(source.height*crop.height));const scale=Math.min(1,600/w);target.width=Math.max(1,Math.round(w*scale));target.height=Math.max(1,Math.round(h*scale));target.getContext('2d')?.drawImage(source,source.width*crop.x,source.height*crop.y,w,h,0,0,target.width,target.height);},[draft.crop,rendered]);
  useEffect(()=>{
    const container=stage.current,canvas=canvasHost.current?.querySelector('canvas');
    if(!sourceNavigationPending.current||!rendered||!container||canvas?.dataset.sourcePage!==String(page))return;
    const crop=draft.crop;
    container.scrollTo({top:crop?Math.max(0,crop.y*canvas.getBoundingClientRect().height-20):0,left:0,behavior:'instant'});
    sourceNavigationPending.current=false;
  },[sourceNavigation,rendered,page,state.selected]);
  async function scanPages(all:boolean) {
    if(!pdf||scan)return;const controller=new AbortController();scanController.current=controller;setError('');setNotice('');
    const pages=all?Array.from({length:pdf.numPages},(_,i)=>i+1):[page];
    try{for(let index=0;index<pages.length;index++){if(controller.signal.aborted)break;setScan({page:pages[index],total:pdf.numPages});const source=await pdf.getPage(pages[index]);const result=await inspectFigureCandidates(source,controller.signal);if(controller.signal.aborted||!mounted.current)break;setCandidates(old=>[...old.filter(item=>item.page!==pages[index]),...result.candidates].sort((a,b)=>a.page-b.page));setScanned(old=>new Set([...old,pages[index]]));}
      if(mounted.current&&!controller.signal.aborted)setNotice(t('候选识别完成。请逐个核对边界和图注，未找到的图表可以手动框选。','Candidate scan finished. Review each crop and caption; manually select any figures the scan missed.'));
    }catch(reason){if(mounted.current&&!controller.signal.aborted)setError(t('候选识别未完成，已找到的结果仍可使用，也可以手动框选。','The scan did not finish. Existing candidates remain available, and you can draw a crop manually.'));}
    finally{if(mounted.current)setScan(undefined);}
  }
  function fromCandidate(candidate:FigureCandidate) {const label=(text:string)=>/^(?:figure|fig\.|table|图|表)\s*([\da-z]+)/i.exec(text)?.[0].toLowerCase().replace(/figure|fig\./,'fig').replace(/\s/g,'');const matches=collection?.figures.filter(f=>f.page===candidate.page&&label(f.label||f.caption)===label(candidate.label))||[];const figureId=matches.length===1?matches[0].id:undefined;select({key:figureId?`figure-${figureId}`:`candidate-${candidate.key}`,figureId,candidateKey:candidate.key,page:candidate.page,label:candidate.label,caption:candidate.caption,crop:candidate.crop,method:candidate.crop?'pdfjs-candidate':'manual',reviewed:false,dirty:false});}
  function editFigure(figure:ManagedFigure) {select(savedDraft(figure,collection!.figuresRevision));}
  async function save() {
    if(saveLock.current||!collection||!draft.crop||!draft.reviewed||!draft.caption.trim()||!rendered||revisionConflict)return;
    const submitted={...draft},base=collection;saveLock.current=true;setSaving(true);setError('');setNotice('');
    try{const result=await api<Collection&{paper:Paper;figure:ManagedFigure}>(`/papers/${paper.id}/figures${draft.figureId?`/${encodeURIComponent(draft.figureId)}`:''}`,{method:draft.figureId?'PATCH':'POST',body:JSON.stringify({pdfRevision:base.pdfRevision,expectedFiguresRevision:draft.baseFiguresRevision||base.figuresRevision,figure:{page:draft.page,crop:draft.crop,caption:draft.caption.trim(),label:draft.label.trim()},source:{method:draft.method,reviewed:true}})});
      const next:FigureDraft={...submitted,key:`figure-${result.figure.id}`,figureId:result.figure.id,dirty:false,reviewed:false,baseFiguresRevision:result.figuresRevision};const finish=(old:FigureDrafts)=>{const drafts={...old.drafts};delete drafts[submitted.key];return {selected:next.key,drafts:{...drafts,[next.key]:next}};};saveFigureDrafts(paper.id,base.pdfRevision,finish(stateRef.current));onSaved(result.paper);if(!mounted.current)return;setCollection(result);setConflict(false);setState(finish);setNotice(t('已保存。后续生成的解读可使用此图；已有版本保持原来的图片。','Saved. Future readings can use this figure; existing versions retain their original images.'));
    }catch(reason){if(mounted.current){setError(reason instanceof Error?reason.message:t('保存失败，草稿已保留。','Save failed. Your draft is preserved.'));if(reason instanceof ApiRequestError&&reason.status===409){setConflict(true);update({reviewed:false});}}}
    finally{saveLock.current=false;if(mounted.current)setSaving(false);}
  }
  async function refreshConflict() {try{const next=await api<Collection>(`/papers/${paper.id}/figures`);if(!mounted.current)return;if(next.pdfRevision!==collection?.pdfRevision){setError(t('原 PDF 已变更。请关闭并重新打开核对工具；旧草稿仍绑定旧文件。','The source PDF changed. Close and reopen this tool; old drafts remain bound to the old file.'));return;}setCollection(next);setConflict(false);update({reviewed:false,baseFiguresRevision:next.figuresRevision});setError('');setNotice(t('已加载最新图表。请重新核对当前草稿后保存。','Loaded the latest figures. Review this draft again before saving.'));}catch(reason){if(mounted.current)setError((reason as Error).message);}}
  function coordinate(key:keyof CropRect,value:number) {if(!Number.isFinite(value))return;const crop={...(draft.crop||{x:.1,y:.1,width:.8,height:.4}),[key]:Math.max(key==='width'||key==='height'?.5:0,Math.min(100,value))/100};crop.width=Math.min(crop.width,1-crop.x);crop.height=Math.min(crop.height,1-crop.y);if(crop.width>=.005&&crop.height>=.005)update({crop,method:'manual'});}
  const warning=candidates.find(c=>c.key===draft.candidateKey)?.warning;
  return createPortal(<div className="figure-manager-backdrop"><div className="figure-manager" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="figure-manager-title">
    <header className="figure-manager-header"><div><h2 id="figure-manager-title">{t('核对论文图表','Review paper figures')}</h2><span>{t('从原 PDF 裁切，为新解读准备图文素材','Crop the source PDF for future illustrated readings')}</span></div><button ref={close} className="icon-button" aria-label={t('关闭图表核对','Close figure review')} onClick={onClose}><X size={20}/></button></header>
    {loading?<div className="figure-manager-loading" role="status"><Loader2 className="spin"/>{t('正在打开原 PDF…','Opening the source PDF…')}</div>:<>
    <div className="figure-manager-toolbar"><div className="figure-manager-pages"><button className="icon-button" aria-label={t('上一页','Previous page')} disabled={saving||page<=1||!pdf} onClick={()=>go(page-1)}><ChevronLeft size={17}/></button><label>{t('页码','Page')}<input aria-label={t('图表原文页码','Figure source page')} data-figure-page-editor="true" inputMode="numeric" value={pageInput} disabled={saving||!pdf} onChange={e=>setPageInput(e.target.value)} onBlur={()=>{go(Number(pageInput));setPageInput(String(Math.max(1,Math.min(pdf?.numPages||1,Number(pageInput)||1))));}} onKeyDown={e=>{if(e.key==='Enter')go(Number(pageInput));if(e.key==='Escape'){e.stopPropagation();setPageInput(String(page));}}}/><span>/ {pdf?.numPages||'—'}</span></label><button className="icon-button" aria-label={t('下一页','Next page')} disabled={saving||!pdf||page>=pdf.numPages} onClick={()=>go(page+1)}><ChevronRight size={17}/></button></div><button className="text-button" onClick={()=>setEditing(true)} disabled={saving||!pdf}><Crop size={15}/>{t('手动框选','Manual crop')}</button><button className="text-button" onClick={()=>{select({...manual(page),key:`manual-${crypto.randomUUID()}`});setEditing(true);}} disabled={saving||!pdf}>{t('新建裁切','New crop')}</button><button className="text-button" aria-pressed={editing} onClick={()=>setEditing(value=>!value)} disabled={saving||!pdf}>{editing?t('框选模式 · 切换查看','Crop mode · Switch to view'):t('查看模式 · 调整裁切','View mode · Adjust crop')}</button><button className="text-button" onClick={()=>void scanPages(false)} disabled={!!scan||!pdf}><ScanSearch size={15}/>{t('识别本页','Scan page')}</button><button className="text-button" onClick={()=>void scanPages(true)} disabled={!!scan||!pdf}>{t('识别全文','Scan document')}</button>{scan&&<span className="figure-scan-status" role="status"><Loader2 size={14} className="spin"/>{scan.page}/{scan.total}<button onClick={()=>scanController.current?.abort()}>{t('停止','Stop')}</button></span>}</div>
    <div className="figure-manager-body"><div className="figure-source-scroll" ref={stage}><div className="figure-source-page" style={{width,minHeight:width*ratio}}><FigureCropEditor crop={draft.crop} editing={editing} disabled={saving||!rendered} onChange={crop=>update({crop,method:'manual'})}><div ref={canvasHost}/></FigureCropEditor></div></div>
    <aside className="figure-manager-panel"><div className="figure-manager-fields">
      <label>{t('图表候选','Figure candidates')}<select aria-label={t('选择图表候选','Choose a figure candidate')} value={draft.candidateKey&&candidates.some(c=>c.key===draft.candidateKey)?`candidate-${draft.candidateKey}`:''} disabled={saving} onChange={e=>{const found=candidates.find(c=>`candidate-${c.key}`===e.target.value);if(found)fromCandidate(found);}}><option value="">{candidates.length?t(`共 ${candidates.length} 个待核对候选`,` ${candidates.length} candidates to review`):t('先识别，或直接在左侧框选','Scan or draw on the source page')}</option>{candidates.map(c=><option key={c.key} value={`candidate-${c.key}`}>{t(`第 ${c.page} 页`,`p.${c.page}`)} · {c.label}{!c.crop?t(' · 手动框选',' · manual crop'):''}</option>)}</select></label>
      {scanned.has(page)&&!candidates.some(c=>c.page===page)&&<p className="figure-review-hint">{t('本页没有识别到可靠候选；这不表示没有图表。可直接在原文上框选。','No reliable candidate was recognized on this page. Figures may still be present; draw a crop on the source.')}</p>}
      {(warning&&warning!=='review')&&<p className="figure-review-hint">{t('此图表的布局需要人工核对，请框选完整区域，包含坐标轴、图例与所有子图。','This layout needs manual review. Include axes, legends and every panel in your crop.')}</p>}
      <label>{t('编号（可选）','Label (optional)')}<input aria-label={t('图表编号','Figure label')} value={draft.label} maxLength={120} disabled={saving} placeholder="Figure 1" onChange={e=>update({label:e.target.value})}/></label>
      <label>{t('原文图注','Source caption')}<textarea aria-label={t('原文图注','Source caption')} value={draft.caption} maxLength={3000} disabled={saving} placeholder={t('按原文补充图注；生成中英文解读时会单独翻译','Add the original caption; reading translations handle its language separately')} onChange={e=>update({caption:e.target.value})}/></label>
      <fieldset disabled={saving}><legend>{t('裁切范围（页面百分比）','Crop bounds (page %)')}</legend><div className="figure-crop-coordinates">{(['x','y','width','height'] as const).map((key,i)=><label key={key}>{[t('左','Left'),t('上','Top'),t('宽','Width'),t('高','Height')][i]}<input aria-label={[t('裁切左侧百分比','Crop left percent'),t('裁切上侧百分比','Crop top percent'),t('裁切宽度百分比','Crop width percent'),t('裁切高度百分比','Crop height percent')][i]} type="number" min="0" max="100" step="0.1" value={draft.crop?Number((draft.crop[key]*100).toFixed(1)):''} onChange={e=>coordinate(key,e.target.valueAsNumber)}/></label>)}</div></fieldset>
      {draft.crop&&<figure className="figure-crop-preview"><canvas ref={preview} aria-label={t('裁切预览','Crop preview')} role="img"/><figcaption>{t('裁切预览 · 原始颜色','Crop preview · original colors')}</figcaption></figure>}
      {draft.crop&&draft.crop.width*draft.crop.height>=.9&&<p className="figure-review-hint">{t('当前裁切接近整页，请确认这确实是完整图表，而不是正文页面。','This crop is nearly a full page. Confirm it is a complete figure, not a page of body text.')}</p>}
      <details className="figure-existing"><summary>{t(`已保存图表 (${collection?.figures.length||0})`,`Saved figures (${collection?.figures.length||0})`)}</summary>{collection?.figures.map(f=><button key={f.id} disabled={saving} onClick={()=>editFigure(f)}><span>{f.label||f.id}</span><small>{t(`第 ${f.page} 页`,`p.${f.page}`)} · {f.source?.reviewed?t('已核对','Reviewed'):t('待核对','Needs review')}</small></button>)}</details>
      {Object.values(state.drafts).filter(d=>d.dirty&&d.key!==draft.key).length>0&&<details className="figure-existing"><summary>{t('未保存草稿','Unsaved drafts')}</summary>{Object.values(state.drafts).filter(d=>d.dirty&&d.key!==draft.key).map(d=><button key={d.key} disabled={saving} onClick={()=>select(d)}>{d.label||t('未命名图表','Untitled figure')} · {t(`第 ${d.page} 页`,`p.${d.page}`)}</button>)}</details>}
    </div><footer className="figure-manager-save"><label className="figure-reviewed"><input type="checkbox" checked={draft.reviewed} disabled={saving||!draft.crop||!rendered||revisionConflict} onChange={e=>update({reviewed:e.target.checked})}/>{t('已核对完整边界与原文图注','I checked the full crop and source caption')}</label><button className="primary-button" disabled={saving||!draft.reviewed||!draft.crop||!draft.caption.trim()||!rendered||revisionConflict} onClick={()=>void save()}>{saving?<Loader2 className="spin" size={16}/>:<Check size={16}/>} {draft.figureId?t('保存修改','Save changes'):t('保存图表','Save figure')}</button><small>{draftStored?t('草稿仅保存在此标签页；关掉工具可继续阅读。','Drafts stay in this browser tab. Close this tool to resume reading.'):t('浏览器未能持久保存草稿。本页内关闭再打开可恢复，但刷新或关闭标签页会丢失编辑。','Browser draft storage is unavailable. Reopening this tool recovers the draft, but reloading or closing the tab loses edits.')}</small></footer></aside></div></>}
    {(error||notice||revisionConflict)&&<div className={`figure-manager-feedback ${error?'is-error':''}`} role={error?'alert':'status'}>{error||(revisionConflict?t('图表集合已变更。草稿已保留，请加载最新图表后重新核对。','The figure collection changed. Your draft is preserved; load the latest figures and review it again.'):notice)}{revisionConflict&&<button onClick={()=>void refreshConflict()}>{t('加载最新图表','Load latest figures')}</button>}</div>}
  </div></div>,document.body);
}
