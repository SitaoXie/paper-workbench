import { fromMarkdown } from 'mdast-util-from-markdown';
import { math } from 'micromark-extension-math';
import { mathFromMarkdown } from 'mdast-util-math';
import type { Nodes } from 'mdast';

export const READING_SECTION_EVENT = 'paper-workbench:reading-section-navigation';
export type ReadingSection = { index: number; depth: number; title: string; offset: number };
export type ReadingSectionLocation = { readingId: string; section: number };
/** Top-level headings only: quoted examples and fenced code are not sections. */
export function readingSections(markdown: string): ReadingSection[] {
  const root = fromMarkdown(markdown, { extensions: [math()], mdastExtensions: [mathFromMarkdown()] });
  const text = (node: Nodes): string => 'children' in node ? node.children.map(text).join('') : 'value' in node ? String(node.value) : 'alt' in node ? node.alt || '' : '';
  return root.children.filter(node => node.type === 'heading').map((node, index) => ({ index: index + 1, depth: node.depth, title: text(node).replace(/\s+/g, ' ').trim(), offset: node.position?.start.offset ?? -1 }));
}
export function compatibleSectionStructure(first: ReadingSection[], second: ReadingSection[]) {
  return first.length > 0 && first.length === second.length && first.every((section, index) => section.depth === second[index].depth);
}
export function readingSectionId(readingId: string, index: number) {
  return `reading-${encodeURIComponent(readingId)}-section-${index}`;
}
export function parseReadingSectionLocation(href: string, paperId?: string): ReadingSectionLocation | undefined {
  try {
    const url = new URL(href);
    if (paperId && url.searchParams.get('paper') !== paperId) return;
    if (url.hash.length > 800) return;
    const values = new URLSearchParams(url.hash.slice(1));
    if (values.getAll('reading').length !== 1 || values.getAll('section').length !== 1) return;
    const readingId = values.get('reading') || '', section = values.get('section') || '';
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(readingId) || !/^(?:0|[1-9]\d{0,4})$/.test(section)) return;
    return { readingId, section: Number(section) };
  } catch { return; }
}
/** Construct a runtime link. No endpoint or paper text is persisted by this feature. */
export function readingSectionUrl(href: string, paperId: string, readingId: string, section: number) {
  const url = new URL(href);
  url.search = new URLSearchParams({ paper: paperId }).toString();
  url.hash = new URLSearchParams({ reading: readingId, section: String(section) }).toString();
  return url.href;
}
