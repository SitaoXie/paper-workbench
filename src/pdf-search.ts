import type { PDFDocumentProxy } from "pdfjs-dist";

type TextItem = { str: string; hasEOL?: boolean; width?: number; height?: number; transform?: number[] };
type TextRun = { itemIndex: number; start: number; end: number };
export type PdfIndexedPage = { page: number; text: string; starts: Uint32Array; ends: Uint32Array; runs: TextRun[] };
export type PdfSearchIndex = { pages: PdfIndexedPage[]; pageCount: number; indexed: number; failedPages: number[] };
export type PdfSearchRange = { itemIndex: number; start: number; end: number };
export type PdfSearchMatch = { key: string; page: number; index: number; total: number; query: string; ranges: PdfSearchRange[] };
export type PdfSearchRect = { x: number; y: number; width: number; height: number };

function isTextItem(item: unknown): item is TextItem {
  return Boolean(item && typeof item === "object" && "str" in item && typeof item.str === "string");
}
const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

function separator(previous: TextItem, current: TextItem): string {
  if (!previous.str || !current.str || /\s$/.test(previous.str) || /^\s/.test(current.str)) return "";
  const before = Array.from(previous.str).at(-1) || "";
  const after = Array.from(current.str)[0] || "";
  const a = previous.transform, b = current.transform;
  const height = Math.max(1, previous.height || Math.abs(a?.[3] || 0), current.height || Math.abs(b?.[3] || 0));
  const lineBreak = previous.hasEOL || Boolean(a && b && Math.abs(a[5] - b[5]) > height * .6);
  if (cjk.test(before) && cjk.test(after)) return "";
  if (lineBreak) return "\n";
  return a && b && b[4] - (a[4] + (previous.width || 0)) > height * .12 ? " " : "";
}

/** Case/ligature/whitespace normalization retains source UTF-16 offsets. */
function normalizeWithOffsets(raw: string) {
  const skipped = new Set<number>();
  for (const match of raw.matchAll(/[\p{L}][-\u2010\u2011]\s*\n\s*(?=\p{L})/gu)) {
    const start = match.index! + Array.from(match[0])[0].length;
    for (let i = start; i < match.index! + match[0].length; i++) skipped.add(i);
  }
  const text: string[] = [], starts: number[] = [], ends: number[] = [];
  let lastSpace = false;
  for (let i = 0; i < raw.length;) {
    const start = i;
    let group = String.fromCodePoint(raw.codePointAt(i)!); i += group.length;
    while (i < raw.length && /\p{M}/u.test(String.fromCodePoint(raw.codePointAt(i)!))) {
      const mark = String.fromCodePoint(raw.codePointAt(i)!); group += mark; i += mark.length;
    }
    if (skipped.has(start) || group === "\u00ad") continue;
    let normalized = group.normalize("NFKC").toLowerCase().replace(/[\u2010-\u2015]/g, "-");
    if (/^\s+$/u.test(normalized)) {
      let next = i; while (next < raw.length && /\s/.test(raw[next])) next++;
      if (cjk.test(Array.from(text.at(-1) || "").at(-1) || "") && cjk.test(String.fromCodePoint(raw.codePointAt(next) || 0))) continue;
      if (lastSpace) { if (ends.length) ends[ends.length - 1] = i; continue; }
      normalized = " "; lastSpace = true;
    } else lastSpace = false;
    text.push(normalized);
    for (let j = 0; j < normalized.length; j++) { starts.push(start); ends.push(i); }
  }
  return { text: text.join(""), starts: Uint32Array.from(starts), ends: Uint32Array.from(ends) };
}

export function indexPdfTextPage(items: readonly unknown[], page: number): PdfIndexedPage {
  const runs: TextRun[] = [];
  let raw = "", previous: TextItem | undefined;
  items.forEach((item, itemIndex) => {
    if (!isTextItem(item)) return;
    if (previous) raw += separator(previous, item);
    runs.push({ itemIndex, start: raw.length, end: raw.length + item.str.length });
    raw += item.str;
    if (item.str) previous = item;
    else if (item.hasEOL && previous) previous = { ...previous, hasEOL: true };
  });
  return { page, ...normalizeWithOffsets(raw), runs };
}

function aborted(signal?: AbortSignal) {
  if (signal?.aborted) { const error = new Error("PDF search indexing cancelled."); error.name = "AbortError"; throw error; }
}

/** Read every local PDF page, independently of which canvases are rendered. */
export async function buildPdfSearchIndex(document: Pick<PDFDocumentProxy, "numPages" | "getPage">, options: {
  signal?: AbortSignal;
  onProgress?: (index: PdfSearchIndex) => void;
} = {}): Promise<PdfSearchIndex> {
  const index: PdfSearchIndex = { pages: [], pageCount: document.numPages, indexed: 0, failedPages: [] };
  for (let page = 1; page <= document.numPages; page++) {
    aborted(options.signal);
    try {
      const source = await document.getPage(page); aborted(options.signal);
      const content = await source.getTextContent(); aborted(options.signal);
      index.pages.push(indexPdfTextPage(content.items, page));
    } catch (error) {
      aborted(options.signal);
      if ((error as Error)?.name === "AbortError") throw error;
      index.failedPages.push(page);
    }
    index.indexed = page;
    options.onProgress?.({ ...index, pages: [...index.pages], failedPages: [...index.failedPages] });
  }
  return index;
}

export function searchPdfText(index: PdfSearchIndex, query: string, limit = 5000): { matches: PdfSearchMatch[]; truncated: boolean } {
  const normalized = normalizeWithOffsets(query).text.trim();
  const matches: PdfSearchMatch[] = [];
  if (!normalized) return { matches, truncated: false };
  let truncated = false;
  outer: for (const page of index.pages) {
    let from = 0;
    while (from <= page.text.length) {
      const found = page.text.indexOf(normalized, from);
      if (found < 0) break;
      if (matches.length >= limit) { truncated = true; break outer; }
      const start = page.starts[found], end = page.ends[found + normalized.length - 1];
      const ranges = page.runs.filter(run => run.end > start && run.start < end).map(run => ({
        itemIndex: run.itemIndex, start: Math.max(start, run.start) - run.start, end: Math.min(end, run.end) - run.start,
      })).filter(range => range.end > range.start);
      matches.push({ key: `${page.page}:${found}:${normalized}`, page: page.page, index: matches.length, total: 0, query, ranges });
      from = found + Math.max(1, normalized.length);
    }
  }
  matches.forEach(match => { match.total = matches.length; });
  return { matches, truncated };
}

/** Call after TextLayer.render(); raw item indices include marked-content items. */
export function bindPdfTextLayerItems(textDivs: readonly HTMLElement[], items: readonly unknown[]): void {
  let textIndex = 0;
  items.forEach((item, itemIndex) => {
    if (!isTextItem(item)) return;
    const span = textDivs[textIndex++];
    if (span) span.dataset.pdfTextItemIndex = String(itemIndex);
  });
}

function textPosition(element: HTMLElement, offset: number): { node: Text; offset: number } | undefined {
  const walker = element.ownerDocument.createTreeWalker(element, 4 /* SHOW_TEXT */);
  let remaining = offset, last: Text | undefined;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text; last = text;
    if (remaining <= text.data.length) return { node: text, offset: remaining };
    remaining -= text.data.length;
  }
  return last ? { node: last, offset: last.data.length } : undefined;
}

/** Measure only: never replace text spans or modify the user's Selection. */
export function highlightPdfSearchMatch(container: HTMLElement, match: PdfSearchMatch): { rects: PdfSearchRect[]; firstRect?: DOMRect } {
  const bounds = container.getBoundingClientRect(), rects: PdfSearchRect[] = [];
  let firstRect: DOMRect | undefined;
  if (!bounds.width || !bounds.height) return { rects };
  const spans = new Map(Array.from(container.querySelectorAll<HTMLElement>("[data-pdf-text-item-index]")).map(span => [Number(span.dataset.pdfTextItemIndex), span]));
  for (const binding of match.ranges) {
    const span = spans.get(binding.itemIndex);
    if (!span) continue;
    const start = textPosition(span, binding.start), end = textPosition(span, binding.end);
    if (!start || !end) continue;
    const range = container.ownerDocument.createRange();
    range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset);
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width <= .1 || rect.height <= .1) continue;
      const left = Math.max(bounds.left, rect.left), right = Math.min(bounds.right, rect.right);
      const top = Math.max(bounds.top, rect.top), bottom = Math.min(bounds.bottom, rect.bottom);
      if (right <= left || bottom <= top) continue;
      firstRect ||= rect;
      rects.push({ x: (left - bounds.left) / bounds.width, y: (top - bounds.top) / bounds.height, width: (right - left) / bounds.width, height: (bottom - top) / bounds.height });
    }
  }
  return { rects, firstRect };
}
