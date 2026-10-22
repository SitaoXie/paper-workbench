import { selectedPdfText } from './pdf-selection-text';

type Endpoint = { page: number; offset: number; source: string };
export type PdfSelectionAnchor = { start: Endpoint; end: Endpoint; text: string };

function endpoint(node: Node, offset: number): Endpoint | undefined {
  const element = node instanceof Element ? node : node.parentElement;
  const layer = element?.closest<HTMLElement>('.pdf-text-layer');
  const page = Number(layer?.closest<HTMLElement>('[data-pdf-page]')?.dataset.pdfPage);
  if (!layer || !page) return;
  const before = document.createRange();
  before.selectNodeContents(layer); before.setEnd(node, offset);
  return { page, offset: before.toString().length, source: layer.textContent || '' };
}
/** Text-layer character offsets survive PDF.js recycling/zoom; source strings
 * prevent silently applying those offsets to a replaced document or layer. */
export function capturePdfSelectionAnchor(range: Range, host: HTMLElement): PdfSelectionAnchor | undefined {
  if (!host.contains(range.startContainer) || !host.contains(range.endContainer)) return;
  const start = endpoint(range.startContainer, range.startOffset), end = endpoint(range.endContainer, range.endOffset);
  if (!start || !end) return;
  return { start, end, text: selectedPdfText(range, host) };
}
function resolve(layer: HTMLElement, offset: number): {node: Text; offset: number} | undefined {
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  let node: Node | null, consumed = 0;
  while ((node = walker.nextNode())) {
    const length = node.textContent?.length || 0;
    if (length && offset <= consumed + length) return { node: node as Text, offset: offset - consumed };
    consumed += length;
  }
}
export function restorePdfSelectionAnchor(anchor: PdfSelectionAnchor, host: HTMLElement): { status: 'ready'; range: Range } | { status: 'waiting' | 'changed' } {
  const first = host.querySelector<HTMLElement>(`[data-pdf-page="${anchor.start.page}"] .pdf-text-layer[data-rendered="true"]`);
  const last = host.querySelector<HTMLElement>(`[data-pdf-page="${anchor.end.page}"] .pdf-text-layer[data-rendered="true"]`);
  if (!first || !last) return { status: 'waiting' };
  for (let page = anchor.start.page; page <= anchor.end.page; page++) {
    if (!host.querySelector(`[data-pdf-page="${page}"] .pdf-text-layer[data-rendered="true"]`)) return { status: 'waiting' };
  }
  if (first.textContent !== anchor.start.source || last.textContent !== anchor.end.source) return { status: 'changed' };
  const start = resolve(first, anchor.start.offset), end = resolve(last, anchor.end.offset);
  if (!start || !end) return { status: 'changed' };
  const range = document.createRange(); range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset);
  if (range.collapsed || selectedPdfText(range, host) !== anchor.text) return { status: 'changed' };
  return { status: 'ready', range };
}
