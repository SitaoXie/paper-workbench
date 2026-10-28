import type { Settings } from './types';
import { t } from './i18n';

export type ReportInputMode = 'text-images' | 'page-images';
export type ReportVisualInput = {
  requestedMode: ReportInputMode; effectiveMode: string; pixelsProvided: boolean;
  imageCount: number; pages: number[]; batches: number; visionModel?: string;
  fallbackReason?: string; unavailable: {page:number;figureId?:string}[];
};
export function loadReportInputMode(): ReportInputMode {
  try { return localStorage.getItem('pw-report-input-mode') === 'page-images' ? 'page-images' : 'text-images'; }
  catch { return 'text-images'; }
}
export function saveReportInputMode(mode: ReportInputMode) {
  try { localStorage.setItem('pw-report-input-mode', mode); } catch { /* Optional browser preference. */ }
}
export function ReportInputOptions({settings,value,onChange,onConfigure,hasPdf,disabled}:{settings:Settings;value:ReportInputMode;onChange:(value:ReportInputMode)=>void;onConfigure:()=>void;hasPdf:boolean;disabled:boolean}) {
  const direct = settings.modelCapabilities?.[settings.model] === 'vision';
  const profile = settings.profiles?.find(item => item.id === settings.vision?.profileId);
  const secondary = settings.vision?.enabled && profile && profile.models.includes(settings.vision.model || '') && profile.modelCapabilities?.[settings.vision.model || ''] === 'vision' && (profile.modelConfigured ?? profile.apiKeyConfigured);
  return <div className="report-input-options">
    <label className="reading-focus-label">{t('摘要输入方式','Overview input mode')}
      <select aria-label={t('摘要输入方式','Overview input mode')} disabled={disabled} value={value} onChange={event=>{const mode=event.target.value as ReportInputMode;saveReportInputMode(mode);onChange(mode);}}>
        <option value="text-images">{t('文字层＋论文图表','Text layer + paper figures')}</option>
        <option value="page-images">{t('各页截图','Every page as an image')}</option>
      </select>
    </label>
    <p className="reading-format-hint">{value==='text-images'?t('发送原文文字与图表，按 PDF 页码和原论文图表编号对应；未裁切的图表使用所在页截图。','Send source text and figures labeled by PDF page and original Figure/Table number; uncropped figures use their source page image.'):t('按页序读取整篇 PDF 的截图，保留排版、公式和表格；长论文分批研读。','Read every PDF page in order as an image, preserving layout, equations and tables; long papers are read in batches.')}</p>
    <p className="reading-format-hint" role="status">{!hasPdf?t('未导入 PDF，本次使用已获取的文字。','No local PDF; this reading uses the available text.'):direct?t('当前模型直接看图；超出单次图像预算时先分批研读。','The current model reads images directly, using preliminary batches for larger inputs.'):secondary?t(`图像先由 ${settings.vision?.model} 读取，再交给当前模型撰写。`,`Images are read by ${settings.vision?.model}, then passed as visual notes to the writing model.`):<>{t('当前模型仅支持文字，未配置可用的图像理解模型，将使用纯文字层。','The current model is text-only and no visual reader is configured; only the text layer will be used.')} <button type="button" className="text-button" disabled={disabled} onClick={onConfigure}>{t('配置图像理解模型','Configure a visual reader')}</button></>}</p>
  </div>;
}
export function ReportInputRecord({value}:{value?:ReportVisualInput}) {
  if (!value) return null;
  return <p className="reading-format-hint">{value.imageCount
    ? t(`已读取 ${value.pages.length} 页中的 ${value.imageCount} 张图像${value.effectiveMode==='visual-notes'?`，由 ${value.visionModel} 分 ${value.batches} 批研读后用于撰写`:'，直接供摘要模型查看'}。`,`Read ${value.imageCount} images across ${value.pages.length} pages${value.effectiveMode==='visual-notes'?` in ${value.batches} preliminary batches with ${value.visionModel}`:', supplied directly to the overview model'}.`)
    : t('本版使用纯文字层，未读取图片。','This version used text only; no images were read.')}
    {!!value.unavailable?.length && t(` ${value.unavailable.length} 项图像未能读取。`,` ${value.unavailable.length} image inputs were unavailable.`)}
  </p>;
}
