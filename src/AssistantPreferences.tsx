import {useState,useRef,useLayoutEffect} from 'react';
import {createPortal} from 'react-dom';
import {Palette, Plus, Trash2} from 'lucide-react';
import {BUILTIN_ASSISTANT_STYLES,DEFAULT_ASSISTANT_PREFERENCES,assistantStyle,type AssistantPreferences as Preferences} from '../shared/assistant-prompts.mjs';
import type {Settings} from './types';
import {api} from './types';
import './assistant-preferences.css';

export default function AssistantPreferences({settings,onChange,chinese,disabled=false,apiMode=true}:{settings:Settings;onChange:(s:Settings)=>void;chinese:boolean;disabled?:boolean;apiMode?:boolean}) {
  const anchor=useRef<HTMLButtonElement>(null),panel=useRef<HTMLElement>(null);
  const [position,setPosition]=useState({left:16,bottom:100,maxHeight:500});
  const [open,setOpen]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const [draft,setDraft]=useState<{id:string;name:string;prompt:string}|null>(null);
  const preferences=settings.assistant||DEFAULT_ASSISTANT_PREFERENCES,active=assistantStyle(preferences);
  const t=(zh:string,en:string)=>chinese?zh:en;
  async function save(value:Preferences){
    setSaving(true);setError('');
    try{onChange(await api<Settings>('/settings',{method:'PUT',body:JSON.stringify({assistant:value})}));setDraft(null);}catch(e){setError((e as Error).message);}finally{setSaving(false);}
  }
  useLayoutEffect(()=>{
    if(!open)return;
    const place=()=>{const r=anchor.current?.getBoundingClientRect();if(r)setPosition({left:Math.max(16,Math.min(r.right-370,window.innerWidth-386)),bottom:Math.max(16,window.innerHeight-r.top+10),maxHeight:Math.max(120,Math.min(660,r.top-26))});};
    const outside=(e:PointerEvent)=>{if(!panel.current?.contains(e.target as Node)&&!anchor.current?.contains(e.target as Node))setOpen(false);};
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);anchor.current?.focus();}};
    place();window.addEventListener('resize',place);document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return()=>{window.removeEventListener('resize',place);document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[open]);
  const busy=disabled||saving;
  return <div className="assistant-preferences">
    <button ref={anchor} type="button" className="agent-web-toggle" disabled={disabled} aria-expanded={open} aria-label={t('回答风格与提示词','Answer styles and prompts')} onClick={()=>setOpen(!open)}><Palette size={14}/><span>{chinese?active.name:active.nameEn||active.name}</span></button>
    {open&&createPortal(<section ref={panel} style={position} className="assistant-preferences-panel" aria-label={t('助手提示词','Assistant prompts')}>
      <header><strong>{t('风格与提示词','Styles & prompts')}</strong><button type="button" onClick={()=>setOpen(false)} aria-label={t('关闭风格设置','Close style settings')}>×</button></header>
      <label>{t('回答风格','Answer style')}<select disabled={busy||!!draft} value={preferences.styleId} onChange={e=>void save({...preferences,styleId:e.target.value})}>
        {[...BUILTIN_ASSISTANT_STYLES,...preferences.customStyles].map(s=><option key={s.id} value={s.id}>{chinese?s.name:s.nameEn||s.name}</option>)}
      </select></label>
      {draft?<>
        <label>{t('风格名称','Style name')}<input value={draft.name} maxLength={80} disabled={busy} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
        <label>{t('风格提示词','Style prompt')}<textarea value={draft.prompt} maxLength={12000} disabled={busy} onChange={e=>setDraft({...draft,prompt:e.target.value})}/></label>
        <div className="assistant-prompt-actions"><button type="button" disabled={busy||!draft.name.trim()||!draft.prompt.trim()} onClick={()=>void save({...preferences,styleId:draft.id,customStyles:[...preferences.customStyles.filter(s=>s.id!==draft.id),draft]})}>{t('保存风格','Save style')}</button><button type="button" disabled={busy} onClick={()=>setDraft(null)}>{t('取消','Cancel')}</button></div>
      </>:<>
        <label>{t('提示词','Prompt')} · {BUILTIN_ASSISTANT_STYLES.some(s=>s.id===active.id)?t('内置 · 只读','Built-in · read only'):t('自定义','Custom')}<textarea readOnly value={active.prompt} aria-label={t('当前风格提示词','Current style prompt')}/></label>
        <div className="assistant-prompt-actions"><button type="button" disabled={busy||preferences.customStyles.length>=30} onClick={()=>setDraft({id:`custom-${crypto.randomUUID()}`,name:'',prompt:active.prompt})}><Plus size={14}/>{t('新建风格','New style')}</button>
          {active.id.startsWith('custom-')&&<><button type="button" disabled={busy} onClick={()=>setDraft({...active})}>{t('编辑','Edit')}</button><button type="button" disabled={busy} aria-label={t('删除风格','Delete style')} onClick={()=>void save({...preferences,styleId:'balanced',customStyles:preferences.customStyles.filter(s=>s.id!==active.id)})}><Trash2 size={14}/></button></>}
        </div>
      </>}
      <label>{t('PDF 输入方式','PDF input mode')}<select value={preferences.pdfMode} disabled={busy||!apiMode||!!draft} onChange={e=>void save({...preferences,pdfMode:e.target.value as Preferences['pdfMode']})}><option value="text">{t('文字层 · 可按需看图','Text layer · images on demand')}</option><option value="images">{t('逐页图像 · 需要视觉模型','Page images · vision model required')}</option></select></label>
      <p>{!apiMode?t('订阅任务会带上风格提示；PDF 输入模式用于模型 API。','Subscription tasks include the style prompt; PDF input mode applies to model APIs.'):t('15 页以内按页序发送；更长论文先给简要资料，由助手按需读页。图像模式发送完整页图，文字模式保留原文文本。','Up to 15 pages are sent in order. Longer papers start with a brief; the assistant reads pages on demand. Image mode sends full-page rasters; text mode sends extracted text.')}</p>
      {apiMode&&preferences.pdfMode==='images'&&settings.modelCapabilities?.[settings.model]!=='vision'&&<p role="alert">{t('请切换到支持视觉的模型后提问。','Choose a vision-capable model before asking.')}</p>}
      {error&&<p role="alert">{error}</p>}
    </section>,document.body)}
  </div>;
}
