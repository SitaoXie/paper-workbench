import type { PDFDocumentProxy } from 'pdfjs-dist';

/** Resolve a paper's internal XYZ/Fit destinations to its rendered coordinates.
 * PDF points use a bottom-left origin; viewport conversion also handles rotation. */
export async function resolvePdfDestination(document: PDFDocumentProxy, value: unknown): Promise<{page:number;x?:number;y?:number} | undefined> {
  const destination: unknown = typeof value === 'string' ? await document.getDestination(value) : value;
  if (!Array.isArray(destination) || !destination.length) return;
  const pageIndex = typeof destination[0] === 'number' ? destination[0] : await document.getPageIndex(destination[0]);
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= document.numPages) return;
  const result: {page:number;x?:number;y?:number} = {page:pageIndex+1};
  const page = await document.getPage(result.page);
  const viewport = page.getViewport({scale:1});
  const kind = destination[1]?.name;
  const number = (item:unknown):item is number => typeof item === 'number' && Number.isFinite(item);
  const left = kind === 'XYZ' || kind === 'FitV' || kind === 'FitBV' || kind === 'FitR' ? destination[2] : undefined;
  const top = kind === 'XYZ' ? destination[3] : kind === 'FitH' || kind === 'FitBH' ? destination[2] : kind === 'FitR' ? destination[5] : undefined;
  if (number(left) || number(top)) {
    const [x,y] = viewport.convertToViewportPoint(number(left) ? left : page.view[0], number(top) ? top : page.view[3]);
    // For rotated pages the top/left axes swap, so retain both converted axes.
    if (number(left) || viewport.rotation % 180 !== 0) result.x = Math.max(0,Math.min(1,x/viewport.width));
    if (number(top) || viewport.rotation % 180 !== 0) result.y = Math.max(0,Math.min(1,y/viewport.height));
  }
  return result;
}
