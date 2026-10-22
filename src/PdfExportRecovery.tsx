import {useEffect,useRef,useState} from 'react';
import {Loader2,X} from 'lucide-react';
import {api} from './types';
import {t} from './i18n';

type SourceStatus={pdfRevision:string;bindingStatus:'original'|'user-accepted'|'unbound'|'changed';boundPdfRevision?:string};
function sourceError(reason:unknown) {
 const record=reason as {code?:string;message?:string};
 const messages:Record<string,string>={
  pdf_source_missing:t('没有可核对的本地 PDF。笔记仍可导出为 Markdown 或 JSON。','No local PDF is available to review. Export notes as Markdown or JSON.'),
  pdf_source_unavailable:t('当前 PDF 无法读取，请检查文件后重试。','The current PDF is unavailable. Check the file and try again.'),
  pdf_source_changed:t('核对期间 PDF 已变化，没有保存接受记录。请重新检查文件。','The PDF changed during review. No acceptance was saved. Check the file again.'),
  pdf_source_binding_changed:t('另一操作已更新来源状态，请重新检查文件。','Another operation changed the source status. Check the file again.'),
  pdf_source_already_bound:t('来源已有记录，请重新检查后继续导出。','The source is already recorded. Check it again to continue exporting.'),
  pdf_source_binding_invalid:t('旧来源记录无法使用。请保留笔记并重新导入原 PDF。','The old source record cannot be used. Preserve your notes and reimport the original PDF.'),
  pdf_source_acceptance_invalid:t('请重新检查当前文件并确认后再导出。','Check the current file and confirm again before exporting.'),
 };
 return (record.code&&messages[record.code])||record.message||t('来源核对失败，请重试。','Source review failed. Try again.');
}
/** Explicit acceptance of a legacy source for export, never an assertion that
 * old annotations or the original import have been independently verified. */
export default function PdfExportRecovery({paperId,onViewSource,onAccepted,onClose}:{paperId:string;onViewSource?:()=>void;onAccepted:()=>void;onClose:()=>void}){
 const [source,setSource]=useState<SourceStatus>(),[accepted,setAccepted]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const controller=useRef<AbortController | undefined>(undefined);
 useEffect(()=>{
  const control=new AbortController();controller.current=control;setSource(undefined);setAccepted(false);setError('');
  void api<SourceStatus>(`/papers/${encodeURIComponent(paperId)}/annotations/pdf-source`,{signal:control.signal}).then(result=>{if(!control.signal.aborted)setSource(result);}).catch(reason=>{if(!control.signal.aborted)setError(sourceError(reason));});
  return()=>control.abort();
 },[paperId,retry]);
 async function confirm(){
  if(!source || busy || source.bindingStatus==='changed' || (source.bindingStatus==='unbound'&&!accepted))return;
  setBusy(true);setError('');
  try{
   if(source.bindingStatus==='unbound')await api(`/papers/${encodeURIComponent(paperId)}/annotations/pdf-source`,{method:'POST',signal:controller.current?.signal,body:JSON.stringify({expectedPdfRevision:source.pdfRevision,acceptCurrentSource:true})});
   if(!controller.current?.signal.aborted)onAccepted();
  }catch(reason){if(!controller.current?.signal.aborted){setError(sourceError(reason));setAccepted(false);}}
  finally{if(!controller.current?.signal.aborted)setBusy(false);}
 }
 return <section className="pdf-export-recovery" aria-label={t('核对批注导出来源','Review annotated export source')}>
  <header><strong>{t('核对旧记录的 PDF','Review this legacy PDF')}</strong><button type="button" className="icon-button" aria-label={t('关闭来源核对','Close source review')} onClick={onClose}><X size={15}/></button></header>
  <p>{t('这条旧记录没有保留最初导入文件的指纹。请核对当前 PDF 和批注位置，再选择是否用当前文件导出。原笔记不会被修改。','This legacy record has no fingerprint of the original imported file. Review the current PDF and annotation locations before exporting against this file. Your notes will not be changed.')}</p>
  {onViewSource&&<button type="button" className="text-button" onClick={onViewSource}>{t('查看当前 PDF','View current PDF')}</button>}
  {!source&&!error&&<p role="status"><Loader2 className="spin" size={14}/>{t('正在检查当前文件…','Checking the current file…')}</p>}
  {source?.bindingStatus==='changed'?<p role="alert">{t('文件与已记录来源不同，无法重新绑定。请恢复原文件或另行导入；仍可导出 Markdown 或 JSON 笔记。','The file differs from its recorded source and cannot be rebound here. Restore the source or import it separately; Markdown and JSON notes remain available.')}</p>:source&&<>
   {source.bindingStatus==='unbound'?<label><input type="checkbox" checked={accepted} disabled={busy} onChange={event=>setAccepted(event.target.checked)}/><span>{t('我已核对，接受使用当前 PDF 导出这些批注。这不代表系统验证了历史批注。','I reviewed the current PDF and accept it for exporting these annotations. This does not mean the app verified historical annotations.')}</span></label>:<p>{t('来源已有记录，可以继续导出。','The source is already recorded. You can continue exporting.')}</p>}
   <button type="button" className="soft-button" disabled={busy||(source.bindingStatus==='unbound'&&!accepted)} onClick={()=>void confirm()}>{busy?<Loader2 size={14} className="spin"/>:null}{t('确认并导出','Confirm and export')}</button>
  </>}
  {error&&<><p role="alert">{error}</p><button type="button" className="text-button" disabled={busy} onClick={()=>setRetry(value=>value+1)}>{t('重新检查文件','Check file again')}</button></>}
 </section>;
}
