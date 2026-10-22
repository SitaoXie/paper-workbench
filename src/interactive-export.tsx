import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import remarkCjkEmphasis from "./remark-cjk-emphasis";
import { readingFigureSlots } from "./reading-figures";
import { portableAnswerMarkdown, publicSourceUrl } from "./portable-answer";
import { displayCitationLabel } from "./citation-label";
import { renderToStaticMarkup } from "react-dom/server";
import type { Figure, InteractiveBlock, InteractiveCitation, InteractiveData, Paper, ReadingVersion } from "./types";
import { cropPdfToPng } from "./pdf-crop";
import { figureCaption, type FigureCaptionPresentation } from "./figure-captions";

export type InteractiveExportOptions = FigureCaptionPresentation & {
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
    const label = citation.page ? `${citation.label ? `${displayCitationLabel(citation.label, chinese ? 'zh' : 'en')} · ` : ''}p.${citation.page}` : displayCitationLabel(citation.label, chinese ? 'zh' : 'en') || (chinese ? '来源正文' : 'Source text');
    const href = pdfUrl && citation.page ? `${pdfUrl}#page=${citation.page}` : sourceUrl;
    return href ? <a key={index} href={href} target="_blank" rel="noopener noreferrer">{label}</a> : <span key={index}>{label}</span>;
  }) : <span>{chinese ? '来源正文' : 'Source text'}</span>}</div>;
}
function ExportBlock({ block, figures, images, sourceUrl, pdfUrl, chinese, figureCaptions, captionLanguage }: { block: InteractiveBlock; figures: Figure[]; images: Record<string, string>; sourceUrl?: string; pdfUrl?: string; chinese: boolean } & FigureCaptionPresentation) {
  const citations = sourceCitations(block.citations, sourceUrl, pdfUrl, chinese);
  if (block.type === 'concept') return <section className="concept"><details open><summary>{block.title}</summary><p>{block.text}</p>{citations}</details><div className="print-only"><h2>{block.title}</h2><p>{block.text}</p>{citations}</div></section>;
  if (block.type === 'question') return <section className="self-check"><small>{chinese ? '检验理解' : 'Check your understanding'}</small><h2>{block.question}</h2><details><summary>{chinese ? '查看参考答案与证据' : 'Reveal the answer and evidence'}</summary><p>{block.answer}</p>{block.explanation && <p className="explanation">{block.explanation}</p>}{citations}</details><div className="print-only"><p>{block.answer}</p>{block.explanation && <p className="explanation">{block.explanation}</p>}{citations}</div></section>;
  const figure = figures.find(item => item.id === block.figureId);
  const data = images[block.figureId];
  const caption = figure ? figureCaption(figure, { figureCaptions, captionLanguage }) : undefined;
  return <section className="figure-block">{figure && data ? <figure><img src={data} alt={caption?.caption || (chinese ? `论文第 ${figure.page} 页原图` : `Source figure on page ${figure.page}`)} /><figcaption lang={caption?.captionLanguage}>{caption?.caption}{caption?.captionIsOriginal && <small> · {chinese ? '原文图注' : 'Original caption'}</small>} · p.{figure.page}</figcaption></figure> : <p className="missing">{chinese ? '原图未能嵌入此导出。请对照所列原文页核实，未以其他图片代替。' : 'The source figure could not be embedded. Check the cited source page; no substitute image has been used.'}</p>}<p>{block.explanation}</p>{citations}</section>;
}
async function figureAssets({paper, figures, usedIds, figureImages = {}, signal, chinese}: {paper: Paper; figures: Figure[]; usedIds: string[]; figureImages?: Record<string,string>; signal?: AbortSignal; chinese: boolean}) {
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
  return {images,warnings};
}

/** The article export uses the same fixed version and source crops as the live
 * reading. MathML renders equations offline without a font or script request. */
export async function exportArticleHtml({paper, version, language=version.language || 'en', figureImages, figureCaptions, captionLanguage, signal}: InteractiveExportOptions) {
  const chinese=language.startsWith('zh'), figures=version.figures || paper.figures || [];
  const sourceSlots=readingFigureSlots(version.markdown);
  const {images,warnings}=await figureAssets({paper,figures,usedIds:[...new Set(sourceSlots.map(slot=>slot.id))],figureImages,signal,chinese});
  // A directive may sit directly next to prose. Give it its own paragraph,
  // without changing code examples or splitting reference definitions.
  let markdown=version.markdown;
  for(const slot of [...sourceSlots].reverse()) markdown=markdown.slice(0,slot.start)+`\n\n:::figure ${slot.id}\n\n`+markdown.slice(slot.end);
  markdown=portableAnswerMarkdown(markdown,paper,language);
  const slots=readingFigureSlots(markdown), publicPdf=publicSourceUrl(paper.pdfUrl);
  const body=renderToStaticMarkup(<main><header><h1>{paper.title}</h1><div className="metadata"><span>{language}</span><span>{version.source?.agent || version.source?.model || (chinese?'阅读解读':'Reading overview')}</span><span>{new Date(version.createdAt).toLocaleDateString(chinese?'zh-CN':'en-US')}</span></div>{version.focus&&<p className="focus">{chinese?'本版关注点：':'Focus for this version: '}{version.focus}</p>}</header><article className="export-article"><ReactMarkdown remarkPlugins={[remarkGfm,remarkMath,remarkCjkEmphasis]} rehypePlugins={[[rehypeKatex,{output:'mathml',throwOnError:false,strict:'ignore'}]]} components={{
    p:({node,children})=>{
      const slot=slots.find(item=>item.start===node?.position?.start.offset);
      if(!slot)return <p>{children}</p>;
      const figure=figures.find(item=>item.id===slot.id);
      if(!figure||!images[slot.id])return <p className="missing">{chinese?'原图未能嵌入；请对照原文核实。':'The source crop could not be embedded; check the original.'}{figure&&` p.${figure.page}`}</p>;
      const caption=figureCaption(figure,{figureCaptions,captionLanguage});
      return <figure><img src={images[slot.id]} alt={caption.caption}/><figcaption lang={caption.captionLanguage}>{caption.caption}{caption.captionIsOriginal&&` · ${chinese?'原文图注':'Original caption'}`} · {publicPdf?<a href={`${publicPdf}#page=${figure.page}`} target="_blank" rel="noopener noreferrer">p.{figure.page}</a>:`p.${figure.page}`}</figcaption></figure>;
    },
    a:({href,children,title})=>{
      const target=href?.startsWith('#user-content-')?href:publicSourceUrl(href);
      // Keep valid public PDF fragments after URL credential/host validation.
      const pageFragment=href?.match(/#page=[1-9]\d{0,5}$/)?.[0];
      return target?<a href={target+(pageFragment||'')} title={title} rel="noopener noreferrer">{children}</a>:<span>{children}</span>;
    },
    img:({alt})=><span>{alt || (chinese?'外部图片未嵌入':'External image not embedded')}</span>,
    table:({children})=><div className="table-scroll"><table>{children}</table></div>,
  }}>{markdown}</ReactMarkdown></article><footer className="source-note">{chinese?'本文件可离线阅读；图表是原始 PDF 的裁切，图内文字保持原样。请对照原文核查 AI 解读。':'This file works offline. Figures are original PDF crops; labels inside them remain unchanged. Verify AI interpretations against the source.'}<br/>{chinese?'解读版本：':'Reading version: '}{version.id}</footer></main>);
  const title=paper.title.replace(/[&<>"']/g,value=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[value]!));
  const articleCss='.export-article h2{margin:30px 0 12px;font-size:24px}.export-article h3{margin:24px 0 10px}.export-article li,.export-article blockquote{line-height:1.85}.export-article blockquote{border-left:3px solid #ddd;padding-left:18px;margin-left:0;color:#685e66}.export-article figure{margin:24px 0}.export-article figure img{max-height:85vh;object-fit:contain}.export-article pre{overflow:auto;padding:16px;background:#faf8f9;line-height:1.7;border-radius:8px}.export-article code{font-size:.9em}.table-scroll{max-width:100%;overflow:auto}.export-article table{border-collapse:collapse;width:100%;line-height:1.7}.export-article th,.export-article td{text-align:left;padding:9px 12px;border-bottom:1px solid #ded8dc}.export-article math[display="block"]{display:block;overflow:auto;max-width:100%;margin:22px 0}.export-article .katex-mathml{position:static!important;clip:auto!important;width:auto!important;height:auto!important}';
  const html=`<!doctype html>\n<html lang="${chinese?'zh-CN':'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; font-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>${title}</title><style>${CSS}${articleCss}</style></head><body>${body}</body></html>`;
  const filename=`${paper.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-').trim().slice(0,90)||'paper'}-${version.style}-${language.replace(/[^a-zA-Z0-9-]/g,'')}-article.html`;
  return {html,filename,warnings};
}

/** Build a standalone document. Native details supply interactions without any
 * script, CDN, telemetry, server dependency, or model-authored executable code. */
export async function exportInteractiveHtml({ paper, version, language = version.language || 'en', interactive = version.interactive, figureImages = {}, figureCaptions, captionLanguage, signal }: InteractiveExportOptions): Promise<{ html: string; filename: string; warnings: string[] }> {
  if (!interactive || interactive.schemaVersion !== 1 || !Array.isArray(interactive.blocks)) throw new Error('This version has no supported interactive reading.');
  const chinese = language.startsWith('zh');
  const captionPresentation = { figureCaptions, captionLanguage };
  const figures = version.figures || paper.figures || [];
  const usedIds = [...new Set(interactive.blocks.filter(block => block.type === 'figure').map(block => block.figureId))];
  const {images, warnings} = await figureAssets({paper, figures, usedIds, figureImages, signal, chinese});
  const sourceUrl = exportSourceUrl(paper.url);
  const publicPdf = exportSourceUrl(paper.pdfUrl);
  const date = new Date(version.createdAt).toLocaleDateString(chinese ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const style = ({ quick: chinese ? '快速了解' : 'Quick read', deep: chinese ? '深入研读' : 'Deep read', critical: chinese ? '批判性阅读' : 'Critical read' })[version.style];
  const provenance = version.source?.agent || version.source?.model || (version.mode === 'extractive' ? (chinese ? '原文摘录' : 'Source excerpts') : (chinese ? '模型生成' : 'Model generated'));
  const title = `${paper.title} — ${chinese ? '交互解读' : 'Interactive reading'}`;
  const body = renderToStaticMarkup(<main><header><h1>{paper.title}</h1><div className="metadata"><span>{style}</span><span>{language}</span><span>{date}</span><span>{provenance}</span></div>{version.focus && <p className="focus">{chinese ? '本版关注点：' : 'Focus for this version: '}{version.focus}</p>}<div className="source-list">{sourceUrl && <a href={sourceUrl} target="_blank" rel="noopener noreferrer">{chinese ? '论文来源' : 'Paper source'}</a>}{publicPdf && <a href={publicPdf} target="_blank" rel="noopener noreferrer">{chinese ? '原始 PDF' : 'Source PDF'}</a>}{!sourceUrl && !publicPdf && <span>{chinese ? '来源：本地导入文件；页码指向原始 PDF。' : 'Source: locally imported file; page references identify the original PDF.'}</span>}</div></header><article>{interactive.blocks.map(block => <ExportBlock key={block.id} block={block} figures={figures} images={images} sourceUrl={sourceUrl} pdfUrl={publicPdf} chinese={chinese} {...captionPresentation} />)}</article><details className="canonical"><summary>{chinese ? '完整解读文本（Markdown）' : 'Complete reading text (Markdown)'}</summary><pre>{version.markdown}</pre></details><footer className="source-note">{chinese ? '本文件可离线阅读。展开概念与参考答案无需模型或网络。AI 解读仍需对照原文证据；自测不代表独立验证。' : 'This file works offline. Expanding concepts and answers uses no model or network. Verify AI interpretations against the source; self-checks are not independent validation.'}<br />{chinese ? '解读版本：' : 'Reading version: '}{version.id}</footer></main>);
  const escapedTitle = title.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]!);
  const html = `<!doctype html>\n<html lang="${chinese ? 'zh-CN' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; font-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>${escapedTitle}</title><style>${CSS}</style></head><body>${body}</body></html>`;
  const filename = `${paper.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim().slice(0, 90) || 'paper'}-${version.style}-${language.replace(/[^a-zA-Z0-9-]/g, '')}.html`;
  return { html, filename, warnings };
}
