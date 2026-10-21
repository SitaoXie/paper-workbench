import { renderToStaticMarkup } from "react-dom/server";
import type { Figure, InteractiveBlock, InteractiveCitation, InteractiveData, Paper, ReadingVersion } from "./types";
import { cropPdfToPng } from "./pdf-crop";

export type InteractiveExportOptions = {
  paper: Paper;
  version: ReadingVersion;
  language?: string;
  interactive?: InteractiveData;
  figureImages?: Record<string, string>;
  signal?: AbortSignal;
};
const CSS = `
:root{color-scheme:light;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#29242b;background:#fff;font-synthesis:none}*{box-sizing:border-box}body{margin:0}a{color:#914158;text-underline-offset:3px}a:focus-visible,summary:focus-visible{outline:3px solid #914158;outline-offset:4px}main{max-width:900px;margin:auto;padding:52px 28px 72px}header{border-bottom:1px solid #ded8dc;padding-bottom:25px;margin-bottom:30px}h1{font-size:clamp(27px,4vw,40px);line-height:1.2;letter-spacing:-.02em;margin:0 0 18px;overflow-wrap:anywhere}h2,h3{line-height:1.5;margin:0 0 12px;font-size:20px}p{font-size:16px;line-height:1.85;white-space:pre-wrap;overflow-wrap:anywhere}.metadata{display:flex;flex-wrap:wrap;gap:9px 18px;color:#706570;font-size:13px;line-height:1.65}.focus{margin:15px 0 0;font-size:14px;color:#665965}.concept,.figure-block{padding:0 0 24px;margin:0 0 24px;border-bottom:1px solid #e8e3e6}summary{cursor:pointer;min-height:44px;padding:11px 0;line-height:1.5}.concept summary{font-size:20px;font-weight:650}.self-check{background:#faf7f9;border:1px solid #e4dce1;border-radius:12px;padding:22px;margin-bottom:24px}.self-check>small{color:#914158;font-size:12px}.self-check h2{margin:10px 0 2px}.self-check summary{color:#914158;font-size:14px}.explanation{font-size:14px;color:#6b6069}.citations{display:flex;gap:10px;flex-wrap:wrap;font-size:12px;color:#756974;margin-top:12px}.citations a,.citations span{min-height:36px;padding:8px 0;line-height:20px}figure{margin:0 0 14px}figure img{display:block;width:100%;height:auto;border:1px solid #eee7eb;border-radius:8px}figcaption{font-size:13px;color:#6b6069;margin-top:9px;line-height:1.7;overflow-wrap:anywhere}.missing{border:1px dashed #d9cbd2;border-radius:8px;padding:20px;font-size:14px;color:#6b6069}.source-note{font-size:12px;line-height:1.8;color:#7a6f78;border-top:1px solid #ded8dc;padding-top:20px;margin-top:34px}.canonical{margin-top:28px;color:#6b6069}.canonical pre{font:14px/1.85 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;background:#faf8f9;padding:18px;border-radius:8px}.source-list{display:flex;gap:16px;flex-wrap:wrap;margin-top:16px}header .source-list a{min-height:44px;display:inline-flex;align-items:center}.print-note,.print-only{display:none}@media(max-width:600px){main{padding:30px 20px 45px}.self-check{padding:17px}h2,h3,.concept summary{font-size:18px}p{font-size:15px}}@media print{main{max-width:none;padding:0}details>*{display:block!important}details{break-inside:avoid}.self-check{background:#fff}.print-note,.print-only{display:block!important}.concept>details,.self-check>details{display:none!important}a{color:inherit;text-decoration:none}figure{break-inside:avoid}.canonical pre{font-size:10px}}
`;
/** Public provenance links are optional. Credentials and local/private hosts never
 * enter an exported artifact. No URL is automatically fetched by the HTML. */
export function exportSourceUrl(input?: string): string | undefined {
  if (!input) return undefined;
  try {
    const url = new URL(input);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return undefined;
    const host = url.hostname.toLowerCase();
    if (!host.includes('.') || /(^localhost$|\.localhost$|\.local$|\.internal$|^127\.|^10\.|^192\.168\.|^169\.254\.|^0\.|^172\.(1[6-9]|2\d|3[01])\.|^\[)/.test(host)) return undefined;
    for (const key of [...url.searchParams.keys()]) if (/token|api.?key|secret|auth|signature|session|credential|password|disposable|^code$|^key$|^sig$/i.test(key)) url.searchParams.delete(key);
    url.hash = '';
    return url.href;
  } catch { return undefined; }
}
function safeImage(input?: string): string | undefined {
  return input && input.length <= 6_000_000 && /^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/]+={0,2}$/.test(input) ? input : undefined;
}
function sourceCitations(citations: InteractiveCitation[], sourceUrl: string | undefined, pdfUrl: string | undefined, chinese: boolean) {
  return <div className="citations">{citations.length ? citations.map((citation, index) => {
    const label = citation.page ? `${citation.label ? `${citation.label} · ` : ''}p.${citation.page}` : citation.label || (chinese ? '来源正文' : 'Source text');
    const href = pdfUrl && citation.page ? `${pdfUrl}#page=${citation.page}` : sourceUrl;
    return href ? <a key={index} href={href} target="_blank" rel="noopener noreferrer">{label}</a> : <span key={index}>{label}</span>;
  }) : <span>{chinese ? '来源正文' : 'Source text'}</span>}</div>;
}
function ExportBlock({ block, figures, images, sourceUrl, pdfUrl, chinese }: { block: InteractiveBlock; figures: Figure[]; images: Record<string, string>; sourceUrl?: string; pdfUrl?: string; chinese: boolean }) {
  const citations = sourceCitations(block.citations, sourceUrl, pdfUrl, chinese);
  if (block.type === 'concept') return <section className="concept"><details open><summary>{block.title}</summary><p>{block.text}</p>{citations}</details><div className="print-only"><h2>{block.title}</h2><p>{block.text}</p>{citations}</div></section>;
  if (block.type === 'question') return <section className="self-check"><small>{chinese ? '检验理解' : 'Check your understanding'}</small><h2>{block.question}</h2><details><summary>{chinese ? '查看参考答案与证据' : 'Reveal the answer and evidence'}</summary><p>{block.answer}</p>{block.explanation && <p className="explanation">{block.explanation}</p>}{citations}</details><div className="print-only"><p>{block.answer}</p>{block.explanation && <p className="explanation">{block.explanation}</p>}{citations}</div></section>;
  const figure = figures.find(item => item.id === block.figureId);
  const data = images[block.figureId];
  return <section className="figure-block">{figure && data ? <figure><img src={data} alt={figure.caption || (chinese ? `论文第 ${figure.page} 页原图` : `Source figure on page ${figure.page}`)} /><figcaption>{figure.caption} · p.{figure.page}</figcaption></figure> : <p className="missing">{chinese ? '原图未能嵌入此导出。请对照所列原文页核实，未以其他图片代替。' : 'The source figure could not be embedded. Check the cited source page; no substitute image has been used.'}</p>}<p>{block.explanation}</p>{citations}</section>;
}
/** Build a standalone document. Native details supply interactions without any
 * script, CDN, telemetry, server dependency, or model-authored executable code. */
export async function exportInteractiveHtml({ paper, version, language = version.language || 'en', interactive = version.interactive, figureImages = {}, signal }: InteractiveExportOptions): Promise<{ html: string; filename: string; warnings: string[] }> {
  if (!interactive || interactive.schemaVersion !== 1 || !Array.isArray(interactive.blocks)) throw new Error('This version has no supported interactive reading.');
  const chinese = language.startsWith('zh');
  const figures = version.figures || paper.figures || [];
  const usedIds = [...new Set(interactive.blocks.filter(block => block.type === 'figure').map(block => block.figureId))];
  const images: Record<string, string> = {};
  const warnings: string[] = [];
  const sourcePdf = paper.localPdfUrl || paper.pdfUrl;
  let imageBytes = 0;
  for (const id of usedIds) {
    signal?.throwIfAborted();
    const figure = figures.find(item => item.id === id);
    if (!figure?.crop) { warnings.push(`Missing verified figure crop: ${id}`); continue; }
    const provided = safeImage(figureImages[id]);
    if (provided) { images[id] = provided; imageBytes += provided.length; }
    else if (sourcePdf) {
      try {
        const crop = await cropPdfToPng(sourcePdf, figure.page, figure.crop, signal);
        images[id] = `data:${crop.mimeType};base64,${crop.data}`;
        imageBytes += images[id].length;
      } catch (error) {
        if (signal?.aborted) throw error;
        warnings.push(`Could not embed source figure: ${id}`);
      }
    } else warnings.push(`Source PDF unavailable for figure: ${id}`);
    if (imageBytes > 24_000_000) throw new Error(chinese ? '图像总大小超过导出上限，请减少本版本中的图表。' : 'Embedded figures exceed the export size limit. Use fewer figures in this version.');
  }
  const sourceUrl = exportSourceUrl(paper.url);
  const publicPdf = exportSourceUrl(paper.pdfUrl);
  const date = new Date(version.createdAt).toLocaleDateString(chinese ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const style = ({ quick: chinese ? '快速了解' : 'Quick read', deep: chinese ? '深入研读' : 'Deep read', critical: chinese ? '批判性阅读' : 'Critical read' })[version.style];
  const provenance = version.source?.agent || version.source?.model || (version.mode === 'extractive' ? (chinese ? '原文摘录' : 'Source excerpts') : (chinese ? '模型生成' : 'Model generated'));
  const title = `${paper.title} — ${chinese ? '交互解读' : 'Interactive reading'}`;
  const body = renderToStaticMarkup(<main><header><h1>{paper.title}</h1><div className="metadata"><span>{style}</span><span>{language}</span><span>{date}</span><span>{provenance}</span></div>{version.focus && <p className="focus">{chinese ? '本版关注点：' : 'Focus for this version: '}{version.focus}</p>}<div className="source-list">{sourceUrl && <a href={sourceUrl} target="_blank" rel="noopener noreferrer">{chinese ? '论文来源' : 'Paper source'}</a>}{publicPdf && <a href={publicPdf} target="_blank" rel="noopener noreferrer">{chinese ? '原始 PDF' : 'Source PDF'}</a>}{!sourceUrl && !publicPdf && <span>{chinese ? '来源：本地导入文件；页码指向原始 PDF。' : 'Source: locally imported file; page references identify the original PDF.'}</span>}</div></header><article>{interactive.blocks.map(block => <ExportBlock key={block.id} block={block} figures={figures} images={images} sourceUrl={sourceUrl} pdfUrl={publicPdf} chinese={chinese} />)}</article><details className="canonical"><summary>{chinese ? '完整解读文本（Markdown）' : 'Complete reading text (Markdown)'}</summary><pre>{version.markdown}</pre></details><footer className="source-note">{chinese ? '本文件可离线阅读。展开概念与参考答案无需模型或网络。AI 解读仍需对照原文证据；自测不代表独立验证。' : 'This file works offline. Expanding concepts and answers uses no model or network. Verify AI interpretations against the source; self-checks are not independent validation.'}<br />{chinese ? '解读版本：' : 'Reading version: '}{version.id}</footer></main>);
  const escapedTitle = title.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]!);
  const html = `<!doctype html>\n<html lang="${chinese ? 'zh-CN' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; font-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>${escapedTitle}</title><style>${CSS}</style></head><body>${body}</body></html>`;
  const filename = `${paper.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim().slice(0, 90) || 'paper'}-${version.style}-${language.replace(/[^a-zA-Z0-9-]/g, '')}.html`;
  return { html, filename, warnings };
}
