// Local lexical retrieval selects verbatim source ranges; it does not infer
// evidence, execute source instructions, or claim semantic-search coverage.
function terms(text) {
  const normalized = String(text || "").normalize("NFKC").toLowerCase().replace(/(?<=\d),(?=\d)/g, "");
  const stop = new Set(["the", "and", "for", "from", "with", "that", "this", "what", "which", "does", "have", "only", "paper", "page", "about", "please", "explain"]);
  const result = new Set((normalized.match(/[\p{L}\p{N}]+(?:[.@_-][\p{L}\p{N}]+)*/gu) || []).filter(word => word.length > 1 && !stop.has(word)));
  const researchTerms = [
    [/统计|显著/, ["statistical", "statistics", "significance", "p-value"]], [/置信|上界/, ["confidence", "bound"]],
    [/采样|抽样/, ["sample", "sampled", "sampling", "draws"]], [/覆盖/, ["coverage", "pass"]],
    [/限制|局限/, ["limitation", "limitations", "caveat"]], [/遗忘/, ["forgetting"]], [/迁移/, ["transfer"]],
    [/算力|计算量/, ["compute", "computation"]], [/方法/, ["method", "approach"]], [/复现/, ["reproducibility", "replication"]],
  ];
  for (const [pattern, expansions] of researchTerms) if (pattern.test(normalized)) for (const word of expansions) result.add(word);
  return [...result].slice(0, 100);
}
function chunks(page) {
  const result = [];
  let start = 0;
  while (start < page.text.length) {
    let end = Math.min(start + 1400, page.text.length);
    if (end < page.text.length) {
      const matches = [...page.text.slice(start + 500, end).matchAll(/[.!?。！？]\s+/g)];
      if (matches.length) {
        end = start + 500 + matches.at(-1).index + matches.at(-1)[0].length;
      } else {
        const space = page.text.lastIndexOf(" ", end);
        if (space > start + 500) end = space + 1;
      }
    }
    result.push({ page: page.number, start, end, text: page.text.slice(start, end) });
    start = end;
  }
  return result;
}

export function searchPaperChunks(paper, query, limit = 6) {
  const words = terms(query);
  const pages = paper.pages?.length ? paper.pages : [{ number: null, text: paper.text || paper.abstract || '' }];
  const candidates = pages.filter(page => typeof page.text === 'string').flatMap(chunks);
  for (const chunk of candidates) {
    const text = chunk.text.normalize('NFKC').toLowerCase();
    chunk.score = words.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0);
  }
  return candidates.filter(chunk => chunk.score > 0).sort((a, b) => b.score - a.score || (a.page || 0) - (b.page || 0) || a.start - b.start).slice(0, limit);
}

export function selectQuestionContext(paper, { question, metadata, budget, header, full, includeOverview = false }) {
  if (full.text.length <= budget || !paper.pages?.length || paper.metadataOnly) return null;
  const pages = paper.pages.filter(page => typeof page.text === "string" && page.text.trim());
  const pageScope = metadata?.sourceScope === undefined || metadata.sourceScope === "pdf";
  const requestedNumbers = !pageScope ? [] : Array.isArray(metadata?.pages) ? metadata.pages.slice(0, 20) : Number.isInteger(metadata?.page) ? [metadata.page] : [];
  const requestedPages = [...new Set(requestedNumbers)].map(number => pages.find(page => page.number === number)).filter(Boolean);
  const query = terms(`${question}\n${typeof metadata?.quote === "string" ? metadata.quote : ""}`);
  const candidates = pages.flatMap(chunks).map(chunk => ({ ...chunk, normalized: chunk.text.normalize("NFKC").toLowerCase().replace(/(?<=\d),(?=\d)/g, "") }));
  const frequencies = query.map(word => candidates.filter(chunk => chunk.normalized.includes(word)).length);
  for (const chunk of candidates) chunk.score = query.reduce((score, word, index) => score + (chunk.normalized.includes(word) ? Math.log((candidates.length + 1) / (frequencies[index] + 1)) + 1 : 0), 0);
  const ordered = [...candidates].sort((a, b) => b.score - a.score || a.page - b.page || a.start - b.start);
  const suffix = "\n[Context truncated: selected question-relevant source excerpts only; omitted passages are unavailable.]";
  const headerLimit = Math.min(6000, Math.floor(budget * .22));
  let text = header.length <= headerLimit ? header : header.slice(0, Math.max(0, headerLimit - 37)) + "\n[Metadata/visual context truncated.]";
  if (includeOverview) {
    // Focused reports retain broad orientation without allowing page prefixes
    // to crowd out definitions/results at the end of a page. The overview is
    // explicitly partial; repeated text in a later complete chunk is harmless.
    const intro = "\n\n[Broad source overview: short page prefixes only, not complete evidence.]";
    const markers = pages.map(page => `\n[p.${page.number}] `);
    const overviewBudget = Math.max(0, Math.min(Math.floor(budget * .2), budget - text.length - suffix.length - 500));
    const prefixLength = Math.min(240, Math.floor((overviewBudget - intro.length - markers.join("").length) / pages.length));
    if (prefixLength > 0) text += intro + pages.map((page, index) => markers[index] + page.text.slice(0, prefixLength)).join("");
  }
  const selected = [];
  function add(chunk, completePage = false) {
    if (selected.some(other => other.page === chunk.page && other.start < chunk.end && other.end > chunk.start)) return false;
    const block = `\n\n[p.${chunk.page}]\n${completePage ? "" : "[Verbatim page excerpt; surrounding text may be omitted.]\n"}${chunk.text}`;
    if (text.length + block.length + suffix.length > budget) return false;
    text += block; selected.push(chunk); return true;
  }
  // A validated selected page takes precedence over broad library coverage. If
  // it cannot fit, its best matching complete chunks precede other pages.
  if (requestedPages.length > 1) {
    const complete = requestedPages.map(page => ({ page: page.number, start: 0, end: page.text.length, text: page.text }));
    const remaining = budget - text.length - suffix.length;
    const completeLength = complete.reduce((sum, chunk) => sum + `\n\n[p.${chunk.page}]\n`.length + chunk.text.length, 0);
    if (completeLength <= remaining) for (const chunk of complete) add(chunk, true);
    else {
      // Allocate a fair first excerpt to every selected page before adding
      // more context. One dense first page cannot silently consume the range.
      let available = remaining;
      for (let index = 0; index < requestedPages.length; index++) {
        const page = requestedPages[index], allowance = Math.floor(available / (requestedPages.length - index));
        const best = ordered.find(chunk => chunk.page === page.number);
        if (!best) continue;
        const overhead = `\n\n[p.${page.number}]\n[Verbatim page excerpt; surrounding text may be omitted.]\n`.length;
        const limit = Math.max(1, allowance - overhead);
        let offset = 0;
        if (best.text.length > limit) {
          const meaningful = query.map((word, termIndex) => ({ at: best.normalized.indexOf(word), frequency: frequencies[termIndex] })).filter(match => match.at >= 0).sort((a, b) => a.frequency - b.frequency || a.at - b.at)[0];
          // Indices in normalized text can differ from source text. They only
          // choose a window; the returned passage always slices original text.
          offset = Math.min(best.text.length - limit, Math.max(0, (meaningful?.at || 0) - Math.floor(limit / 3)));
        }
        const excerpt = { ...best, start: best.start + offset, end: best.start + offset + Math.min(limit, best.text.length - offset), text: best.text.slice(offset, offset + limit) };
        const before = text.length;
        add(excerpt, excerpt.start === 0 && excerpt.text.length === page.text.length);
        available -= text.length - before;
      }
      for (const chunk of ordered.filter(chunk => requestedNumbers.includes(chunk.page))) add(chunk);
    }
  } else if (requestedPages.length === 1) {
    const requestedPage = requestedPages[0];
    if (!add({ page: requestedPage.number, start: 0, end: requestedPage.text.length, text: requestedPage.text }, true))
      for (const chunk of ordered.filter(chunk => chunk.page === requestedPage.number)) add(chunk);
  }
  for (const chunk of ordered) if (chunk.score > 0) add(chunk);
  // Keep some broad context when space remains; never substitute a guessed
  // continuation or silently relabel an excerpt as the complete page.
  for (const page of pages) add({ page: page.number, start: 0, end: Math.min(page.text.length, 450), text: page.text.slice(0, 450) }, page.text.length <= 450);
  return {
    text: text + suffix,
    contextCharacters: text.length + suffix.length,
    sourceCharacters: full.sourceCharacters,
    coverage: "source-excerpts",
  };
}
