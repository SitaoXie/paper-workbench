import { createHash } from 'node:crypto';
import { visualEvidenceContext } from './vision.mjs';

const pages = new WeakMap(), texts = new WeakMap();
const digest = value => createHash('sha256').update(value).digest('hex');
/** Source-only identity shared by public paper metadata and the paid-call cache.
 * Cache page digests against their actual strings: in-place extraction updates
 * remain detectable without rehashing unchanged long pages on every poll. */
export function recommendationSourceRevision(paper) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify([paper.title, paper.authors, paper.url, paper.abstract,
    paper.metadataOnly, paper.extractionTruncated, paper.contentHash, paper.pdfRevision]));
  if (paper.pages?.length) {
    for (const page of paper.pages) {
      let entry = pages.get(page);
      if (!entry || entry.number !== page.number || entry.text !== page.text) {
        entry = { number:page.number, text:page.text, hash:digest(JSON.stringify([page.number,page.text])) };
        pages.set(page, entry);
      }
      hash.update(entry.hash);
    }
  } else if (!paper.metadataOnly) {
    let entry = texts.get(paper);
    if (!entry || entry.text !== paper.text) {
      entry = { text:paper.text, hash:digest(paper.text || '') }; texts.set(paper, entry);
    }
    hash.update(entry.hash);
  }
  // Included, eligible visual observations really do enter model context.
  hash.update(visualEvidenceContext(paper));
  return hash.digest('hex');
}
