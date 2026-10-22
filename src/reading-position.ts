import type { Paper } from './types';

/** Geometry only: no paper prose, prompts, credentials, or model output. */
export type PdfReadingPosition = { page: number; fraction: number; left: number; zoom: number | null };
export type OverviewReadingContext = { key: string; versionId?: string; language: string; presentation: 'article' | 'interactive' };
export type OverviewReadingPosition = OverviewReadingContext & {
  scrollY: number;
  expanded?: boolean;
  anchor?: { index: number; hash: string; offset: number };
};
export type PaperReadingPosition = {
  source: string;
  tab: 'summary' | 'paper';
  pdf?: PdfReadingPosition;
  overviews: OverviewReadingPosition[];
  updatedAt: number;
};
const storageKey = 'pw-reading-positions-v1';
const maxPapers = 100, maxContexts = 8, maxCharacters = 300_000;
let positions: Record<string, PaperReadingPosition> | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let revision = Date.now();
const removedPapers = new Set<string>();
export function positionHash(value: string): string {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < value.length; i++) { a = Math.imul(a ^ value.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ value.charCodeAt(i); }
  return `${value.length.toString(36)}-${(a >>> 0).toString(36)}-${(b >>> 0).toString(36)}`;
}
export function pdfDocumentKey(paper: Pick<Paper, 'localPdfUrl' | 'pdfUrl' | 'createdAt' | 'pageCount'>): string {
  return positionHash(JSON.stringify([paper.localPdfUrl || paper.pdfUrl || '', paper.pageCount || 0, paper.createdAt]));
}
export function validPdfPosition(value: unknown): value is PdfReadingPosition {
  if (!value || typeof value !== 'object') return false;
  const p = value as PdfReadingPosition;
  return Number.isInteger(p.page) && p.page > 0 && p.page <= 100_000 && Number.isFinite(p.fraction) && p.fraction >= -1 && p.fraction <= 2 &&
    Number.isFinite(p.left) && p.left >= 0 && p.left <= 100_000 && (p.zoom === null || (Number.isFinite(p.zoom) && p.zoom >= .25 && p.zoom <= 3));
}
function validOverview(value: unknown): value is OverviewReadingPosition {
  if (!value || typeof value !== 'object') return false;
  const p = value as OverviewReadingPosition;
  return typeof p.key === 'string' && p.key.length < 100 && typeof p.language === 'string' && p.language.length <= 30 &&
    (p.versionId === undefined || (typeof p.versionId === 'string' && p.versionId.length <= 200)) && ['article','interactive'].includes(p.presentation) &&
    Number.isFinite(p.scrollY) && p.scrollY >= 0 && p.scrollY <= 10_000_000 && (p.expanded === undefined || typeof p.expanded === 'boolean') &&
    (!p.anchor || (Number.isInteger(p.anchor.index) && p.anchor.index >= 0 && p.anchor.index <= 100_000 && typeof p.anchor.hash === 'string' && p.anchor.hash.length < 100 && Number.isFinite(p.anchor.offset) && Math.abs(p.anchor.offset) <= 10_000_000));
}
function all() {
  if (positions) return positions;
  positions = Object.create(null) as Record<string, PaperReadingPosition>;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw || raw.length > maxCharacters) return positions;
    const data = JSON.parse(raw);
    for (const [id, value] of Object.entries(data)) {
      const entry = value as PaperReadingPosition;
      if (id.length > 200 || !entry || typeof entry.source !== 'string' || entry.source.length > 100 || !['summary','paper'].includes(entry.tab) || !Number.isFinite(entry.updatedAt)) continue;
      positions[id] = { source: entry.source, tab: entry.tab, pdf: validPdfPosition(entry.pdf) ? entry.pdf : undefined, overviews: Array.isArray(entry.overviews) ? entry.overviews.filter(validOverview).slice(0, maxContexts) : [], updatedAt: entry.updatedAt };
      revision = Math.max(revision, entry.updatedAt);
    }
  } catch { /* Invalid or unavailable storage must not interrupt reading. */ }
  return positions;
}
export function flushReadingPositions() {
  if (timer) clearTimeout(timer);
  timer = undefined;
  const data = all();
  let size = 2;
  Object.entries(data).sort((a,b)=>b[1].updatedAt-a[1].updatedAt).forEach(([id, entry], index)=>{
    size += JSON.stringify(entry).length + id.length + 5;
    if (index >= maxPapers || size > maxCharacters) delete data[id];
  });
  try { localStorage.setItem(storageKey, JSON.stringify(data)); } catch { /* Keep the in-memory position when storage is restricted. */ }
}
function changed() {
  if (!timer) timer = setTimeout(flushReadingPositions, 300);
}
export function readReadingPosition(paperId: string, source: string): PaperReadingPosition | undefined {
  if (removedPapers.has(paperId)) return undefined;
  const entry = all()[paperId];
  return entry?.source === source ? entry : undefined;
}
function entryFor(paperId: string, source: string) {
  const entry = readReadingPosition(paperId, source) || { source, tab: 'summary' as const, overviews: [], updatedAt: 0 };
  entry.updatedAt = ++revision;
  all()[paperId] = entry;
  return entry;
}
export function saveReadingTab(paperId: string, source: string, tab: 'summary' | 'paper') {
  if (removedPapers.has(paperId)) return;
  entryFor(paperId, source).tab = tab; changed();
}
export function savePdfPosition(paperId: string, source: string, position: PdfReadingPosition) {
  if (removedPapers.has(paperId) || !validPdfPosition(position)) return;
  entryFor(paperId, source).pdf = { ...position }; changed();
}
export function saveOverviewPosition(paperId: string, source: string, position: OverviewReadingPosition) {
  if (removedPapers.has(paperId) || !validOverview(position)) return;
  const entry = entryFor(paperId, source);
  entry.overviews = [{ ...position }, ...entry.overviews.filter(previous=>previous.key !== position.key)].slice(0, maxContexts);
  changed();
}
export function removeReadingPosition(paperId: string) {
  // A reader unmount may emit its final snapshot after the user deletes it.
  removedPapers.add(paperId);
  if (removedPapers.size > maxPapers) removedPapers.delete(removedPapers.values().next().value!);
  delete all()[paperId]; changed();
}
