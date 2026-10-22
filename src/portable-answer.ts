import { fromMarkdown } from 'mdast-util-from-markdown';
import { math } from 'micromark-extension-math';
import { mathFromMarkdown } from 'mdast-util-math';
import type { Nodes } from 'mdast';
import type { Figure, Paper } from './types';
import { readingFigureSlots } from './reading-figures';

/** Public provenance only: never export local server/file paths or URL credentials. */
export function publicSourceUrl(value: string | undefined): string | undefined {
  try {
    const url = new URL(value || '');
    const host = url.hostname.toLowerCase();
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
      !host.includes('.') || host.endsWith('.local') || host.endsWith('.localhost') ||
      host.endsWith('.internal') || host.endsWith('.test') || /^[\d.]+$/.test(host) || host.includes(':') ||
      [...url.searchParams.keys()].some(key => /token|api.?key|signature|credential|authorization|password|secret|session/i.test(key))) return;
    url.hash = '';
    return url.href.replace(/[<>"\s]/g, character => encodeURIComponent(character));
  } catch { return; }
}

export function portableAnswerMarkdown(content: string, paper: Pick<Paper, 'title' | 'url' | 'pdfUrl'> | undefined, language = 'en'): string {
  if (!paper) return content;
  const source = publicSourceUrl(paper.url), pdf = publicSourceUrl(paper.pdfUrl);
  const edits: {start:number;end:number;text:string}[] = [];
  const tree = fromMarkdown(content, {extensions:[math()], mdastExtensions:[mathFromMarkdown()]});
  const destination = (page: number) => pdf ? `${pdf}#page=${page}` : undefined;
  const definitions=new Map(tree.children.filter(node=>node.type==='definition').map(node=>[node.identifier,node]));
  const plainText=(node:Nodes):string=>'value' in node?node.value:'children' in node?node.children.map(plainText).join(''):'';
  function visit(node: Nodes) {
    const start=node.position?.start.offset, end=node.position?.end.offset;
    if (node.type === 'link' && /^#page=[1-9]\d{0,5}$/.test(node.url) && start !== undefined && end !== undefined) {
      const page=Number(node.url.slice(6)), raw=content.slice(start,end), target=destination(page);
      const label=plainText(node);
      const text=target ? raw.replace(/(\]\(\s*<?)#page=[1-9]\d{0,5}>?/, `$1${target}${raw.match(/\]\(\s*</) ? '>' : ''}`)
        : `${label || 'Source'} (p.${page})`;
      edits.push({start,end,text});return;
    }
    if(node.type==='definition' && /^#page=[1-9]\d{0,5}$/.test(node.url) && start!==undefined && end!==undefined){
      const target=destination(Number(node.url.slice(6)));
      edits.push({start,end,text:target?content.slice(start,end).replace(/(\]:\s*<?)#page=[1-9]\d{0,5}>?/,`$1${target}${content.slice(start,end).match(/\]:\s*</)?'>':''}`):''});return;
    }
    if(node.type==='linkReference' && start!==undefined && end!==undefined && !pdf){
      const definition=definitions.get(node.identifier);
      if(definition && /^#page=[1-9]\d{0,5}$/.test(definition.url))edits.push({start,end,text:`${plainText(node)} (p.${Number(definition.url.slice(6))})`});
      return;
    }
    if (['code','inlineCode','math','inlineMath','link','linkReference','image','imageReference','html'].includes(node.type)) return;
    if (node.type === 'text' && start !== undefined && end !== undefined && content.slice(start,end) === node.value) {
      const matches=node.value.matchAll(/\[((?:pp?\.?\s*\d)[^\]\n]{0,100}|第\s*\d{1,4}\s*页)\]/gi);
      for (const match of matches) {
        const parts=match[1].replace(/^第\s*(\d+)\s*页$/, 'p.$1').split(/\s*[,;，、]\s*/);
        if (parts.length>12) continue;
        const pages=parts.map(part=>/^(?:pp?\.?\s*)?(\d{1,4})(?:\s*[-–—]\s*(?:pp?\.?\s*)?(\d{1,4}))?$/i.exec(part));
        if(pages.some(page=>!page||Number(page[1])<1||(page[2]&&Number(page[2])<Number(page[1]))))continue;
        const text=pages.map(page=>{const label=`p.${Number(page![1])}${page![2]?`–${Number(page![2])}`:''}`,target=destination(Number(page![1]));return target?`[${label}](<${target}>)`:`[${label}]`;}).join(', ');
        edits.push({start:start+match.index!,end:start+match.index!+match[0].length,text});
      }
    }
    if('children' in node)for(const child of node.children)visit(child);
  }
  visit(tree);
  let result=content;
  for(const edit of edits.sort((a,b)=>b.start-a.start))result=result.slice(0,edit.start)+edit.text+result.slice(edit.end);
  const title=paper.title.replace(/[\r\n]/g,' ').replace(/[\\`*_[\]<>]/g,'\\$&');
  const english=language.startsWith('en');
  return `${result}\n\n---\n${english?'Paper':'论文'}: ${title}\n${source?`${english?'Source':'来源'}: <${source}>`:english?'Source: Local document; open the cited pages in the original file.':'来源：本地文档，请在原文件中核查所引页码。'}${pdf&&pdf!==source?`\nPDF: <${pdf}>`:''}\n${english?'Page references use one-based PDF page indexes.':'页码按 PDF 文件页序计数，从 1 开始。'}`;
}

/** Markdown can carry the figure's caption and source location without linking
 * to a private crop endpoint. A standalone HTML export embeds the actual crop. */
export function portableReadingMarkdown(content: string, paper: Pick<Paper, 'title' | 'url' | 'pdfUrl'>, language = 'en', figures: (Figure & { captionIsOriginal?: boolean })[] = []): string {
  const slots = readingFigureSlots(content);
  const english=language.startsWith('en');
  const escape=(value:string)=>value.replace(/[\r\n]+/g,' ').replace(/[\\`*_[\]<>]/g,'\\$&');
  const withCaptions=content.replace(/^:::figure[ \t]+([\w-]+)[ \t]*$/gm,(marker,id,offset)=>{
    if(!slots.some(slot=>slot.start===offset))return marker;
    const figure=figures.find(item=>item.id===id);
    if(!figure)return english?'*Source figure unavailable in this reading version.*':'*本解读版本中未找到对应原图。*';
    const caption=escape(figure.caption.trim()) || (english?'Source figure':'论文原图');
    const original=figure.captionIsOriginal ? (english?' · Original caption':' · 原文图注') : '';
    return `> ${caption}${original}\n>\n> ${english?'View the figure in the source PDF':'在原始 PDF 中查看此图'} [p.${figure.page}]`;
  });
  return portableAnswerMarkdown(withCaptions,paper,language);
}
