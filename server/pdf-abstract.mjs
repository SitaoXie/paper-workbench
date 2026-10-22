// This is section extraction, not summarization. Ambiguous layouts and missing
// boundaries deliberately return null so callers can label their excerpt honestly.
const startHeading = /^(?:abstract|摘\s*要)(?:\s*[:：—–]\s*(.*))?\s*$/iu;
const endHeading = /^(?:(?:\d+(?:\.\d+)*|[IVX]+)[.)、]?\s+)?(?:introduction|引\s*言|绪\s*论)\s*[:：]?\s*$|^(?:\d+(?:\.\d+)*|[IVX]+)[.)、]?\s+(?:background|overview|preliminaries)\s*[:：]?\s*$|^(?:key\s*words?|index\s+terms|关\s*键\s*[词字])(?:\s*[:：—–-]\s*.*|\s*)$/iu;
const sectionNumber = /^(?:\d+(?:\.\d+)*|[IVX]+)[.)、]?$/iu;
const suspicious = /^(?:figure|fig\.|table)\s*\d|^(?:contents|references|bibliography)\s*$|equal contribution|corresponding author|correspondence to|arxiv:|copyright|©|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/imu;

function linesOf(text) {
  const lines = [];
  for (const match of text.matchAll(/[^\n]*(?:\n|$)/g)) {
    if (!match[0]) continue;
    const raw = match[0].replace(/\n$/, "");
    lines.push({ text: raw.trim(), start: match.index, end: match.index + raw.length });
  }
  return lines;
}

function ambiguousLayout(page, start, end, boundaryEnd) {
  const spans = (page.spans || []).filter(span => span.end > start && span.start < end && span.geometry && /\p{L}/u.test(span.text));
  if (!spans.length) return false; // Legacy extracted text has no geometry to check.
  let columnResets = 0;
  for (let index = 1; index < spans.length; index++) {
    const prior = spans[index - 1], current = spans[index];
    const a = prior.geometry, b = current.geometry;
    const size = Math.max(a.size, b.size);
    if (Math.abs(a.uy) > .1 || Math.abs(b.uy) > .1 || a.ux < .9 || b.ux < .9) return true;
    // Alternating left/right text on the same baseline is not a reliable prose
    // sequence. Do not merge the two columns or guess their reading order.
    if (Math.abs(a.y - b.y) < Math.max(2, size * .3) && Number.isFinite(prior.width) &&
      b.x - a.x - Math.abs(prior.width) > Math.max(24, size * 2.5)) return true;
    if (b.y > a.y + size * 2 && Math.abs(b.x - a.x) > size * 6 && ++columnResets > 1) return true;
  }
  const boundary = (page.spans || []).find(span => span.start < boundaryEnd && span.end > end && span.geometry && /\p{L}/u.test(span.text));
  if (boundary) {
    const left = Math.min(...spans.map(span => span.geometry.x));
    const size = boundary.geometry.size;
    if (boundary.geometry.x > left + size * 8) {
      // A section heading in the right column followed by more left-column
      // prose is a common interleaved extraction. Even a sentence-ending prefix
      // is not evidence that the full abstract ended there.
      const following = (page.spans || []).filter(span => span.start >= boundaryEnd && span.geometry && /\p{L}/u.test(span.text)).slice(0, 40);
      if (following.some(span => span.geometry.x < boundary.geometry.x - size * 8 && span.geometry.y >= Math.min(...spans.map(item => item.geometry.y)) - size * 4)) return true;
    }
  }
  return false;
}

export function extractPdfAbstract(pages) {
  // Require both boundaries on one of the first three pages. Spanning page
  // breaks could swallow running headers/footers, so that case stays an excerpt.
  for (const page of (pages || []).slice(0, 3)) {
    if (typeof page.text !== "string") continue;
    const lines = linesOf(page.text.slice(0, 50000));
    for (let index = 0; index < lines.length; index++) {
      const heading = lines[index].text.match(startHeading);
      if (!heading) continue;
      let boundary = -1;
      for (let next = index + 1; next < lines.length; next++) {
        if (startHeading.test(lines[next].text)) break;
        if (endHeading.test(lines[next].text)) { boundary = next; break; }
        if (lines[next].start - lines[index].end > 10000) break;
      }
      if (boundary < 0) continue;
      const start = heading[1]?.trim()
        ? lines[index].start + page.text.slice(lines[index].start, lines[index].end).indexOf(heading[1])
        : lines[index].end;
      // PDF extraction sometimes puts the section number on its own line.
      const endLine = boundary > index + 1 && sectionNumber.test(lines[boundary - 1].text) ? boundary - 1 : boundary;
      const end = lines[endLine].start;
      const raw = page.text.slice(start, end).trim();
      const text = raw.replace(/\s+/g, " ").trim();
      const letters = (text.match(/\p{L}/gu) || []).length;
      const han = (text.match(/\p{Script=Han}/gu) || []).length;
      const words = (text.match(/\p{L}[\p{L}'’'-]*/gu) || []).length;
      if (text.length > 8000 || (han >= 35 ? letters < 45 : letters < 80 || words < 16) ||
        !/[.!?。！？][\])”’"']?$/.test(text) || suspicious.test(raw) ||
        raw.split("\n").some(line => /^\s*\d{1,4}\s*$/.test(line)) ||
        ambiguousLayout(page, start, end, lines[boundary].end)) continue;
      return { text, page: page.number, start, end };
    }
  }
  return null;
}
