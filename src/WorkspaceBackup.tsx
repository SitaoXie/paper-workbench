import { useEffect, useRef, useState } from 'react';
import { Download, Upload, X, CheckCircle2, ArchiveRestore, ShieldCheck } from 'lucide-react';
import { api } from './types';
import { apiUrl } from './workspace-mode';
import { useLocale } from './i18n';
import './workspace-backup.css';

type Summary = {createdAt:string;papers:number;pdfs:number;readings:number;notes:number;conversations:number;messages:number;folders:number;images:number;bytes:number};
type Preview = {token:string;summary:Summary;expiresInSeconds:number};
export default function WorkspaceBackup({onClose,onRestored}:{onClose:()=>void;onRestored:()=>void|Promise<void>}) {
 const {t,locale}=useLocale();
 const dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLInputElement>(null);
 const [busy,setBusy]=useState<'export'|'preview'|'restore'|null>(null);
 const [preview,setPreview]=useState<Preview|null>(null),[confirmed,setConfirmed]=useState(false),[complete,setComplete]=useState<Summary|null>(null),[error,setError]=useState('');
 useEffect(()=>{dialog.current?.showModal();},[]);
 useEffect(()=>{
  const target=dialog.current?.querySelector(error?'.workspace-backup-error':'.workspace-backup-preview');
  if(target){const frame=requestAnimationFrame(()=>target.scrollIntoView({block:'nearest',behavior:'smooth'}));return()=>cancelAnimationFrame(frame);}
 },[preview,complete,error]);
 async function exportLibrary(){
  setBusy('export');setError('');
  try {const response=await fetch(apiUrl('/workspace/backup'));if(!response.ok){const data=await response.json();throw new Error(data.error||t('备份失败','Backup failed'));}
   const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`paper-workbench-${new Date().toISOString().slice(0,10)}.paperwork`;link.click();setTimeout(()=>URL.revokeObjectURL(url),30_000);
  }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(null);}
 }
 async function selectFile(file?:File){
  if(!file)return;setPreview(null);setComplete(null);setConfirmed(false);setError('');
  if(file.size>100*1024*1024){setError(t('请选择不超过 100 MiB 的备份；大文库请使用升级指南中的停机备份。','Choose a backup up to 100 MiB. For larger libraries, use the offline backup in the upgrade guide.'));return;}
  setBusy('preview');try{const body=new FormData();body.append('file',file);setPreview(await api<Preview>('/workspace/restore/preview',{method:'POST',body}));}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(null);if(input.current)input.current.value='';}
 }
 async function restore(){
  if(!preview||!confirmed)return;setBusy('restore');setError('');
  try{const result=await api<Summary>('/workspace/restore',{method:'POST',body:JSON.stringify({token:preview.token,confirm:true})});setComplete(result);setPreview(null);await onRestored();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(null);}
 }
 const counts=preview?.summary||complete;
 return <dialog ref={dialog} className="workspace-backup" aria-labelledby="workspace-backup-title" onCancel={e=>{e.preventDefault();if(!busy)onClose();}}>
  <header><div><span className="workspace-backup-eyebrow">{t('你的资料，随时带走','YOUR LIBRARY, PORTABLE')}</span><h2 id="workspace-backup-title">{t('备份与恢复','Backup & restore')}</h2></div><button className="icon-button" aria-label={t('关闭','Close')} disabled={!!busy} onClick={onClose}><X size={20}/></button></header>
  <p className="workspace-backup-intro">{t('保存论文原文、阅读解读、笔记和对话，在另一台设备继续阅读。','Keep your PDFs, readings, notes and conversations together, ready for another device.')}</p>
  <div className="workspace-backup-options">
   <section><Download size={22}/><h3>{t('导出文库','Export library')}</h3><p>{t('一份 .paperwork 文件，包含 PDF、解读版本与译文、高亮、手写笔记、文件夹、聊天及图片附件。','One .paperwork file with PDFs, reading versions and translations, highlights, handwritten notes, folders, chats and image attachments.')}</p><button className="soft-button" disabled={!!busy} onClick={()=>void exportLibrary()}><Download size={16}/>{t('下载备份','Download backup')}</button></section>
   <section><ArchiveRestore size={22}/><h3>{t('恢复为副本','Restore copies')}</h3><p>{t('先检查备份，再确认导入。现有文库不覆盖；每次恢复都会新增一套副本。','Inspect the backup before importing. Your existing library stays intact; each restore adds a new set of copies.')}</p><button className="soft-button" disabled={!!busy} onClick={()=>input.current?.click()}><Upload size={16}/>{t('选择备份文件','Choose backup')}</button><input ref={input} type="file" hidden accept=".paperwork,application/gzip" onChange={e=>void selectFile(e.target.files?.[0])}/></section>
  </div>
  <p className="workspace-backup-privacy"><ShieldCheck size={18}/><span>{t('不包含模型连接、密钥、API 用量、.env 或机器路径。备份含论文和私人笔记，请妥善保存。','Model connections, keys, API usage, .env and machine paths are excluded. Backups contain papers and private notes; keep them private.')}</span></p>
  {busy&&<div className="workspace-backup-progress" role="status"><progress aria-label={t('正在处理备份','Processing backup')}/><span>{busy==='export'?t('正在整理资料并生成备份…','Collecting files and preparing your backup…'):busy==='preview'?t('正在校验文件与关联记录…','Checking files and linked records…'):t('正在写入副本并保存文库，请勿关闭页面…','Writing copies and saving your library. Keep this page open…')}</span></div>}
  {error&&<p className="workspace-backup-error" role="alert">{error}</p>}
  {counts&&<section className="workspace-backup-preview" aria-live="polite"><h3>{complete?<><CheckCircle2 size={19}/>{t('恢复完成','Restore complete')}</>:t('备份预览','Backup preview')}</h3><p>{t('备份时间：','Created: ')}{new Date(counts.createdAt).toLocaleString(locale==='zh'?'zh-CN':'en-US')}</p><dl>{[[t('论文','Papers'),counts.papers],[t('PDF','PDFs'),counts.pdfs],[t('解读版本','Readings'),counts.readings],[t('笔记','Notes'),counts.notes],[t('对话','Chats'),counts.conversations],[t('文件夹','Folders'),counts.folders]].map(([name,value])=><div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
   {preview&&<><label className="workspace-backup-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={!!busy}/><span>{t('确认新增副本，保留现有文库和模型设置。重复恢复会生成重复论文。','Add copies and keep my existing library and model settings. Repeating a restore creates duplicate papers.')}</span></label><button className="primary-button" disabled={!confirmed||!!busy} onClick={()=>void restore()}>{t('确认恢复','Confirm restore')}</button></>}
  </section>}
  <footer><small>{t('最大上传 100 MiB；附件总量 75 MiB。更大文库及整机迁移参见 docs/UPGRADING.md。','Upload limit: 100 MiB; total attachments: 75 MiB. For larger libraries and full migration, see docs/UPGRADING.md.')}</small><button className="soft-button" disabled={!!busy} onClick={onClose}>{t('完成','Done')}</button></footer>
 </dialog>;
}
