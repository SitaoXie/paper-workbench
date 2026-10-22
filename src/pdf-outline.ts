import type { PDFDocumentProxy } from 'pdfjs-dist';
import { resolvePdfDestination } from './pdf-destination';
export type PdfOutlineNode = {
  id: string;
  title: string;
  depth: number;
  children: PdfOutlineNode[];
  initiallyExpanded: boolean;
  target?: { page: number; x?: number; y?: number };
  pageLabel?: string;
  external: boolean;
};
export type PdfOutlineData = { nodes: PdfOutlineNode[]; flat: PdfOutlineNode[]; truncated: boolean };
const cache = new WeakMap<PDFDocumentProxy, Promise<PdfOutlineData>>();
/** Read only embedded PDF structure; never infer a heading from page content. */
export function loadPdfOutline(document: PDFDocumentProxy, retry = false): Promise<PdfOutlineData> {
  if (retry) cache.delete(document);
  const existing = cache.get(document);
  if (existing) return existing;
  const pending = (async () => {
    const [outline, labels] = await Promise.all([document.getOutline(), document.getPageLabels().catch(() => null)]);
    const flat: PdfOutlineNode[] = [], destinations: unknown[] = [];
    let truncated = false;
    const walk = (items: unknown, prefix = '', depth = 0): PdfOutlineNode[] => {
      if (!Array.isArray(items)) return [];
      const output: PdfOutlineNode[] = [];
      for (let index = 0; index < items.length; index++) {
        if (flat.length >= 2000 || depth > 30) { truncated = true; break; }
        const item = items[index];
        if (!item || typeof item !== 'object') continue;
        const node: PdfOutlineNode = { id: prefix + index, title: typeof item.title === 'string' ? item.title.trim() : '', depth, children: [], initiallyExpanded: typeof item.count === 'number' && item.count > 0, external: !!(item.url || item.unsafeUrl) };
        flat.push(node); destinations.push(item.dest);
        node.children = walk(item.items, node.id + '.', depth + 1);
        output.push(node);
      }
      return output;
    };
    const nodes = walk(outline);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(6, flat.length) }, async () => {
      while (cursor < flat.length) {
        const index = cursor++, node = flat[index], destination = destinations[index];
        if (destination === undefined || destination === null) continue;
        try {
          node.target = await resolvePdfDestination(document, destination);
          if (node.target) node.pageLabel = labels?.[node.target.page - 1];
        } catch { /* Keep this authored entry visible without inventing a target. */ }
      }
    }));
    return { nodes, flat, truncated };
  })();
  cache.set(document, pending);
  void pending.catch(() => { if (cache.get(document) === pending) cache.delete(document); });
  return pending;
}
/** Page-only tracking cannot distinguish two headings on one page. Prefer the
 * authored parent on that page unless the reader explicitly selected a child. */
export function currentOutlineNode(data: PdfOutlineData, currentPage: number, selectedId?: string): PdfOutlineNode | undefined {
  const selected = data.flat.find(node => node.id === selectedId && node.target?.page === currentPage);
  if (selected) return selected;
  let best: PdfOutlineNode | undefined;
  for (const node of data.flat) {
    if (node.target && node.target.page <= currentPage && (!best?.target || node.target.page > best.target.page)) best = node;
  }
  return best;
}
