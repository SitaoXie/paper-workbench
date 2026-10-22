import { fromMarkdown } from 'mdast-util-from-markdown';
import { math } from 'micromark-extension-math';
import { mathFromMarkdown } from 'mdast-util-math';
import type { Nodes } from 'mdast';

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
