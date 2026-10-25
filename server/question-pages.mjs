export const INITIAL_PAGE_QUOTA = 15;
export const QUESTION_TOOL_CHARACTER_BUDGET = 300000;
export function extractedPageCount(paper) {
  return Math.max(paper.pageCount || 0, ...(paper.pages || []).map(page => Number.isInteger(page.number) ? page.number : 0), 0);
}
/** Stable source prefix: whole pages in order for short PDFs, metadata only otherwise. */
export function questionPageContext(paper, { wholePages = true, header = '' } = {}) {
  if (!paper.pages?.length || paper.metadataOnly) return null;
  const pages = [...paper.pages].sort((a,b)=>a.number-b.number), pageCount = extractedPageCount(paper);
  const complete = wholePages && pageCount <= INITIAL_PAGE_QUOTA;
  const missing = Array.from({length:pageCount},(_,i)=>i+1).filter(n=>!pages.some(p=>p.number===n));
  const prefix = header ? `PAPER_ID: ${paper.id}\n${header}` : `PAPER_ID: ${paper.id}\nTITLE: ${paper.title}\nAUTHORS: ${(paper.authors || []).join(', ')}\nURL: ${paper.url || 'Local PDF'}\n`;
  const notice = `\n[Source: extracted PDF text, not page images. ${pageCount} PDF pages; ${pages.length} extracted page records.${paper.extractionTruncated ? ' Extraction is incomplete; available text is not the complete original PDF.' : ''}${missing.length ? ` Missing extracted pages: ${missing.join(', ')}.` : ''}]`;
  const text = complete
    ? `${prefix}\n${pages.map(page=>`[p.${page.number}]\n${page.text || ''}${!page.text?.trim() ? '\n[No extractable text on this page; image contents are unavailable.]' : ''}`).join('\n\n')}${notice}\n[Every available page above is supplied in full in PDF order, without per-page excerpts. Original images, equations lost in extraction and unreadable text are not implied to be available.]`
    : `PAPER_ID: ${paper.id}\nTITLE: ${paper.title}\nAUTHORS: ${(paper.authors || []).join(', ')}\n[Abstract${(paper.abstract||'').length > 3200 ? ' excerpt' : ''}]\n${(paper.abstract||'').slice(0,3200)}${notice}\n[Brief initial context only: full pages are NOT loaded. Use read_pages with this paper ID and requested page numbers for complete page text; search_papers can locate relevant pages. Do not infer absence from this brief.]`;
  return {text,contextCharacters:text.length,sourceCharacters:pages.reduce((n,p)=>n+(p.text?.length||0),0),coverage:complete&&!paper.extractionTruncated&&!missing.length?'full-text-extracted':complete?'partial-extracted-pages':'brief-page-index',pageCount,initialPages:complete?pages.map(p=>p.number):[],wholePages:complete};
}
