import { fromMarkdown } from 'mdast-util-from-markdown';
import { math } from 'micromark-extension-math';
import { mathFromMarkdown } from 'mdast-util-math';
import type { Nodes } from 'mdast';

/** Labels come from saved source metadata, never the figure's UUID or its array position. */
export function sourceFigureLabel(figure: {label?: string; caption?: string; page: number}, language: string): string {
  const english = language.startsWith('en');
  const explicit = figure.label?.trim();
  const text = explicit || figure.caption?.trim() || '';
  const prefix = /^(figure|fig\.?|table|图|表)\s*/i.exec(text);
  const number = prefix && /^((?:[A-Za-z]\.?)?\d+(?:\.\d+)*(?:[A-Za-z])?|[IVXLCDM]+)(?=$|[\s.:：、()[\]\-—])/.exec(text.slice(prefix[0].length));
  const label = prefix && number
    ? `${/^(?:table|表)$/i.test(prefix[1]) ? (english ? 'Table' : '表') : (english ? 'Figure' : '图')} ${number[1]}`
    : explicit || (english ? 'Source figure' : '图表');
  return `${label} · p.${figure.page}`;
}

/** Figure directives are prose, never examples inside code, math or raw HTML. */
export function readingFigureSlots(markdown: string): { id: string; start: number; end: number }[] {
  if (!/^:::figure[ \t]+[\w-]+[ \t]*$/m.test(markdown)) return [];
  const tree = fromMarkdown(markdown, {extensions:[math()], mdastExtensions:[mathFromMarkdown()]});
  const protectedSpans: {start:number;end:number}[] = [];
  function visit(node: Nodes) {
    if (['code','inlineCode','math','inlineMath','html'].includes(node.type)) {
      if (node.position) protectedSpans.push({start:node.position.start.offset!,end:node.position.end.offset!});
    } else if ('children' in node) node.children.forEach(visit);
  }
  visit(tree);
  return [...markdown.matchAll(/^:::figure[ \t]+([\w-]+)[ \t]*$/gm)]
    .filter(match=>!protectedSpans.some(span=>match.index!>=span.start&&match.index!<span.end))
    .map(match=>({id:match[1],start:match.index!,end:match.index!+match[0].length}));
}
