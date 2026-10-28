import { useEffect, useId, useRef, useState } from 'react';
import { api } from './types';
import { t } from './i18n';

type Progress = { running: boolean; stage?: string; completed?: number; total?: number; batch?: number };
export function ReadingGenerationProgress({paperId}:{paperId:string}) {
  const container=useRef<HTMLDivElement>(null);
  const [progress,setProgress]=useState<Progress>({running:true,stage:'preparing'});
  const [seconds,setSeconds]=useState(0);
  const [unavailable,setUnavailable]=useState(false);
  useEffect(()=>{
    container.current?.scrollIntoView?.({block:'center',behavior:'smooth'});
    let stopped=false,timer:ReturnType<typeof setTimeout>;
    const started=Date.now();
    const elapsed=setInterval(()=>setSeconds(Math.floor((Date.now()-started)/1000)),1000);
    async function poll(){
      try{
        const next=await api<Progress>(`/papers/${encodeURIComponent(paperId)}/report/progress`);
        if(!stopped){if(next.running)setProgress(next);setUnavailable(false);}
      }catch{if(!stopped)setUnavailable(true);}
      finally{if(!stopped)timer=setTimeout(poll,1000);}
    }
    void poll();
    return ()=>{stopped=true;clearTimeout(timer);clearInterval(elapsed);};
  },[paperId]);
  const labels:Record<string,string>={
    preparing:t('正在准备论文与生成设置','Preparing the paper and generation settings'),
    images:t(`正在准备图像 ${progress.completed||0} / ${progress.total||0}`,`Preparing images ${progress.completed||0} / ${progress.total||0}`),
    vision:t(`图像理解模型正在研读 · 第 ${progress.batch||1} 次请求`,`Visual reader is analyzing images · request ${progress.batch||1}`),
    draft:t('正在生成解读初稿','Writing the overview draft'),
    review:t('正在复核证据与讲解','Reviewing evidence and explanations'),
    edit:t('正在完善最终解读','Editing the final overview'),
    interactive:t('正在生成互动导读','Creating the interactive reading'),
    saving:t('正在保存新版本','Saving the new version'),
  };
  const label=labels[progress.stage||'preparing']||labels.preparing;
  return <div ref={container} className="reading-generation-progress" aria-busy="true">
    <div className="reading-progress-heading"><span role="status">{label}</span><span aria-live="off">{t(`已用时 ${seconds} 秒`,`${seconds}s elapsed`)}</span></div>
    <div className="reading-progress-track" role="progressbar" aria-label={label}><span/></div>
    <p>{unavailable?t('暂时无法获取进度，仍在等待生成结果。','Progress is temporarily unavailable; still waiting for the generation result.'):t('正在等待模型处理，完成后会自动显示。','Waiting for the model; the result will appear automatically.')}</p>
  </div>;
}

export function InteractiveGenerationConfirm({model,onCancel,onConfirm}:{model:string;onCancel:()=>void;onConfirm:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const title=useId(),description=useId();
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    dialog.current?.showModal();
    return ()=>previous?.focus();
  },[]);
  return <dialog className="reading-generation-confirm" ref={dialog} aria-labelledby={title} aria-describedby={description} onCancel={event=>{event.preventDefault();onCancel();}}>
    <h3 id={title}>{t('生成互动导读？','Generate an interactive reading?')}</h3>
    <div id={description}>
      <p>{t('将调用当前模型 API，消耗 token，并可能产生费用。','This calls the current model API, consumes tokens and may incur charges.')}</p>
      <p className="reading-confirm-model">{model}</p>
      <p>{t('根据当前解读生成概念卡、图表解读与自测题，保留原版。格式校验失败时可能额外调用一次模型修复。','Creates concept cards, figure explanations and self-checks from this reading, preserving the original. Invalid output may require one additional model call for format repair.')}</p>
    </div>
    <div className="reading-confirm-actions">
      <button className="soft-button" autoFocus onClick={onCancel}>{t('取消','Cancel')}</button>
      <button className="primary-button" onClick={onConfirm}>{t('确认调用模型','Confirm model call')}</button>
    </div>
  </dialog>;
}
