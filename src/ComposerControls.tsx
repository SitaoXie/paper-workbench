import {useState,useRef,useLayoutEffect,useEffect} from 'react';
import {createPortal} from 'react-dom';
import {Plus,ImagePlus,FileUp,ChevronDown,Check,Code2,Search,Settings2,BrainCircuit,Loader2} from 'lucide-react';
import {api,type Settings} from './types';
import {useLocale} from './i18n';
import {selectWorkspaceModel,useModelSelection,writeWorkspaceSettings} from './model-selection';
import {reasoningControl} from '../shared/model-reasoning.mjs';
import './composer-controls.css';
function useComposerPopover(open:boolean,close:()=>void,width:number){
 const anchor=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null);
 const [position,setPosition]=useState({left:16,bottom:80,width,maxHeight:500});
 useLayoutEffect(()=>{
  if(!open)return;
  const place=()=>{const r=anchor.current?.getBoundingClientRect();if(r){const w=Math.min(width,window.innerWidth-24);setPosition({left:Math.max(12,Math.min(r.left,window.innerWidth-w-12)),bottom:Math.max(12,window.innerHeight-r.top+8),width:w,maxHeight:Math.max(120,r.top-20)});}};
  const outside=(event:PointerEvent)=>{if(!panel.current?.contains(event.target as Node)&&!anchor.current?.contains(event.target as Node))close();};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){close();anchor.current?.focus();}};
  place();window.addEventListener('resize',place);document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
  return()=>{window.removeEventListener('resize',place);document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
 },[open,width]);
 return {anchor,panel,position};
}
export function ComposerAttachments({disabled,onImage,onPdf}:{disabled:boolean;onImage:()=>void;onPdf:()=>void}){
 const {t}=useLocale();const [open,setOpen]=useState(false);const {anchor,panel,position}=useComposerPopover(open,()=>setOpen(false),260);
 return <><button ref={anchor} type="button" className="icon-button composer-attach" aria-label={t('添加附件','Add attachment')} aria-expanded={open} aria-haspopup="dialog" disabled={disabled} onClick={()=>setOpen(!open)}><Plus size={19}/></button>
 {open&&createPortal(<div ref={panel} style={position} className="composer-popover composer-attachments" role="dialog" aria-label={t('添加附件','Add attachment')}><button type="button" disabled={disabled} onClick={()=>{setOpen(false);onImage();}}><ImagePlus size={18}/><span>{t('图片或截图','Image or screenshot')}<small>{t('也可直接粘贴到输入框','You can also paste into the composer')}</small></span></button><button type="button" disabled={disabled} onClick={()=>{setOpen(false);onPdf();}}><FileUp size={18}/><span>{t('导入 PDF 论文','Import a PDF paper')}<small>{t('加入文库并打开论文','Add to the library and open the paper')}</small></span></button></div>,document.body)}</>;
}
export function ReasoningControl({settings,onSettings,disabled,persist=true}:{settings:Settings;onSettings:(s:Settings)=>void;disabled:boolean;persist?:boolean}){
 const {t}=useLocale();const active=settings.profiles?.find(p=>p.id===settings.activeProfileId)||settings;
 const control=reasoningControl({...active,model:settings.model});
 const [draft,setDraft]=useState(control?.value||'default'),[error,setError]=useState('');const committing=useRef(false);
 const identity=JSON.stringify([settings.activeProfileId,settings.model,control]);
 useEffect(()=>{setDraft(control?.value||'default');setError('');},[identity]);
 const label=(level:string)=>control?.offValues?.includes(level)?t('关闭','Off'):({none:t('关闭','Off'),default:t('默认','Default'),minimal:t('最少','Minimal'),low:t('低','Low'),medium:t('中','Medium'),high:t('高','High'),xhigh:t('很高','Extra high'),max:t('最高','Maximum'),off:t('关闭','Off'),on:t('开启','On')})[level]||level;
 async function save(value:string){
  if(!control||value===control.value||disabled||committing.current)return;
  committing.current=true;setError('');let ok=false;
  try{
   if(!persist){
    const model=control.kind==='variants'?control.models![value]:settings.model;
    const config=active.modelReasoning?.[settings.model]||{protocol:control.protocol!,levels:control.levels.filter(level=>level!=='default'),value:'default'};
    const profile={...active,model,...(control.kind!=='variants'?{modelReasoning:{...active.modelReasoning,[model]:{...config,value}}}:{})};
    onSettings({...settings,...profile,profiles:settings.profiles?.map(p=>p.id===settings.activeProfileId?{...p,model:profile.model,modelReasoning:profile.modelReasoning}:p)});ok=true;
   }
   else if(control.kind==='variants')ok=await selectWorkspaceModel(settings.activeProfileId||'default',control.models![value],onSettings);
   else {const config=active.modelReasoning?.[settings.model]||{protocol:control.protocol!,levels:control.levels.filter(level=>level!=='default'),value:'default'};const result=await writeWorkspaceSettings(()=>api<Settings>('/settings',{method:'PUT',body:JSON.stringify({modelReasoning:{...active.modelReasoning,[settings.model]:{...config,value}}})}),onSettings);ok=result.ok;if(!result.ok&&result.error)setError(result.error);}
   if(!ok){setDraft(control.value);setError(t('思考设置未保存，请重试。','Reasoning setting was not saved. Try again.'));}
  }finally{committing.current=false;}
 }
 if(!control)return <section className="composer-reasoning is-unconfirmed" title={t('尚未确认此接口的思考等级。可在模型菜单中管理参数。','Reasoning levels are unverified for this endpoint. Configure them in the model menu.')}><header><span><BrainCircuit size={15}/>{t('思考强度','Reasoning effort')}</span><b>{t('未确认','Unverified')}</b></header><input type="range" disabled aria-label={t('思考等级未确认','Reasoning levels unverified')} min={0} max={1} value={0}/></section>;
 return <section className="composer-reasoning" aria-label={t('思考强度','Reasoning effort')}><header><span><BrainCircuit size={15}/>{t('思考强度','Reasoning effort')}</span><b>{label(draft)}</b></header>
  <input type="range" aria-label={t('思考强度','Reasoning effort')} aria-valuetext={label(draft)} min={0} max={control.levels.length-1} step={1} value={Math.max(0,control.levels.indexOf(draft))} disabled={disabled} onChange={event=>setDraft(control.levels[Number(event.target.value)])} onPointerUp={event=>void save(control.levels[Number(event.currentTarget.value)])} onKeyUp={event=>void save(control.levels[Number(event.currentTarget.value)])} onBlur={event=>void save(control.levels[Number(event.currentTarget.value)])}/><div className="composer-reasoning-scale">{control.levels.map(level=><button type="button" disabled={disabled} aria-pressed={draft===level} title={label(level)} key={level} onClick={()=>{setDraft(level);void save(level);}}>{label(level)}</button>)}</div>

  {error&&<p role="alert">{error}</p>}
 </section>;
}
export function AssistantModelMenu({settings,onSettings,mode,onMode,allowAgent,disabled,onConfigure}:{settings:Settings;onSettings:(s:Settings)=>void;mode:'api'|'agent';onMode:(mode:'api'|'agent')=>void;allowAgent:boolean;disabled:boolean;onConfigure:()=>void}){
 const {t}=useLocale();const [open,setOpen]=useState(false),[query,setQuery]=useState('');const {pending,error}=useModelSelection();
 const {anchor,panel,position}=useComposerPopover(open,()=>setOpen(false),460);
 const profiles=settings.profiles||[];const busy=disabled||pending;
 const active=profiles.find(profile=>profile.id===settings.activeProfileId)||settings;
 const control=reasoningControl({...active,model:settings.model});
 const text=mode==='agent'?'Codex / Claude':settings.model||t('选择模型','Choose a model');
 const listed=profiles.map(profile=>({...profile,models:profile.models.filter(model=>`${model} ${profile.name}`.toLowerCase().includes(query.toLowerCase()))})).filter(profile=>profile.models.length);
 async function choose(profileId:string,model:string){
  const result=await writeWorkspaceSettings(()=>api<Settings>('/settings',{method:'PUT',body:JSON.stringify({activeProfileId:profileId,model,assistant:{answerMode:'api'}})}),onSettings);
  if(result.ok){onMode('api');setQuery('');setOpen(false);}
 }
 async function chooseAgent(){
  const result=await writeWorkspaceSettings(()=>api<Settings>('/settings',{method:'PUT',body:JSON.stringify({assistant:{answerMode:'agent'}})}),onSettings);
  if(result.ok){onMode('agent');setOpen(false);}
 }
 return <div className={`composer-model-controls ${mode==='agent'?'is-subscription':''}`}><div className="composer-model-menu"><button ref={anchor} type="button" className="composer-model-trigger" title={text} aria-label={t('选择模型或订阅助手','Choose model or subscription assistant')} aria-expanded={open} aria-haspopup="dialog" disabled={disabled} onClick={()=>setOpen(!open)}>{pending?<Loader2 size={14} className="spin"/>:mode==='agent'?<Code2 size={14}/>:<BrainCircuit size={14}/>}<span>{text}</span><ChevronDown size={13}/></button>
 {open&&createPortal(<div ref={panel} style={position} className="composer-popover composer-model-panel" role="dialog" aria-label={t('模型与订阅助手','Models and subscription assistant')}>
  <header><strong>{t('选择回答方式','Choose how to answer')}</strong><button type="button" onClick={()=>setOpen(false)} aria-label={t('关闭模型菜单','Close model menu')}>×</button></header>
  {allowAgent&&<button className="composer-subscription-choice" type="button" disabled={busy} onClick={()=>void chooseAgent()}><Code2 size={17}/><span>Codex / Claude<small>{t('复制到订阅代理完成，不调用模型 API','Copy a task to your subscription agent; no model API call')}</small></span>{mode==='agent'&&<Check size={16}/>}</button>}
  {mode==='api'&&<p className="composer-capability-info">{control? <>{t('可选档位：','Available levels: ')}{control.levels.join(' / ')}<small>{control.source==='documented'?<a href={control.sourceUrl} target="_blank" rel="noreferrer">{t('服务商文档 · 2026-10-29 核对','Provider documentation · checked 2026-10-29')}</a>:control.source==='variants'?t('来自本连接已配置的模型变体；网关可覆盖实际思考预算。','From saved model variants; the gateway may override their thinking budgets.'):t('来自当前模型的手动配置。','From your configuration for this model.')}</small></>:t('此接口的等级尚未确认；可在管理模型中按服务商文档配置。','Levels are unverified for this endpoint; configure them from provider documentation in Manage models.')}</p>}
  <label className="composer-model-search"><Search size={14}/><input aria-label={t('搜索已配置模型','Search configured models')} placeholder={t('搜索模型或连接…','Search models or connections…')} value={query} onChange={event=>setQuery(event.target.value)}/></label>
  <div className="composer-model-options">{listed.map(profile=><section key={profile.id}><h3>{profile.name}</h3>{profile.models.map(model=><button type="button" key={model} disabled={busy||!profile.modelConfigured} className={mode==='api'&&profile.id===settings.activeProfileId&&model===settings.model?'is-selected':''} onClick={()=>void choose(profile.id,model)}><span>{model}</span>{mode==='api'&&profile.id===settings.activeProfileId&&model===settings.model&&<Check size={14}/>}</button>)}</section>)}{!listed.length&&<p>{t('没有匹配的模型。','No matching models.')}</p>}</div>
  {error&&<p role="alert">{error}</p>}
  <button className="composer-model-manage" type="button" disabled={pending} onClick={()=>{setOpen(false);onConfigure();}}><Settings2 size={15}/>{t('管理模型与思考参数','Manage models & reasoning')}</button>
 </div>,document.body)}
 </div>{mode==='api'&&<ReasoningControl settings={settings} onSettings={onSettings} disabled={busy}/>}</div>;
}
