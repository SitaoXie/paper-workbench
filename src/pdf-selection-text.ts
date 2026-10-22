type PositionedFragment = { text: string; bounds: Pick<DOMRect, "top" | "bottom" | "left" | "right" | "height"> };

function positionedText(fragments: PositionedFragment[]): string {
  let result = "";
  let previous: PositionedFragment | undefined;
  for (const fragment of fragments) {
    if (previous && result) {
      const a = previous.bounds, b = fragment.bounds;
      const lineBreak = Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) > Math.max(a.height, b.height) * 0.6;
      const gap = b.left - a.right > Math.max(0.75, Math.min(a.height, b.height) * 0.12);
      const cjkPair = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(result.trimEnd()) && /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(fragment.text.trimStart());
      if (lineBreak && !cjkPair && !/\n$/.test(result)) result += "\n";
      else if (gap && !cjkPair && !/\s$/.test(result) && !/^\s/.test(fragment.text)) result += " ";
    }
    result += fragment.text;
    previous = fragment;
  }
  return result;
}

/** Restore only explicit discretionary hyphens or page-evidenced wrapped words.
 * A contiguous hyphenated spelling on that page vetoes ordinary-hyphen repair.
 * No dictionary, other page, generated text or case-normalized output is used.
 */
export function repairPdfSelectionText(raw: string, originalPageText: string): string {
  const spelling = (value: string) => value.toLowerCase().replace(/[\u2010\u2011]/g, "-");
  const pageWords = new Set((originalPageText.match(/[\p{L}\p{M}\p{N}_]+(?:[-\u2010\u2011][\p{L}\p{M}\p{N}_]+)*/gu) || []).map(spelling));
  const explicit = raw.replace(/\u00ad[ \t]*\n[ \t]*/g, "").replace(/\u00ad/g, "");
  return explicit.replace(/(?<![\p{L}\p{M}\p{N}_\-\u2010\u2011])([\p{L}\p{M}]{2,})[-\u2010][ \t]*\n[ \t]*([\p{L}\p{M}]{2,})(?![\p{L}\p{M}\p{N}_\-\u2010\u2011])/gu, (match, left: string, right: string) => {
    if (!/^[\p{Script=Latin}\p{M}]+$/u.test(left + right)) return match;
    return pageWords.has(spelling(left + right)) && !pageWords.has(spelling(`${left}-${right}`)) ? left + right : match;
  });
}

// A rendered text layer has fixed content/positions. A zoom render replaces it;
// WeakMap entries disappear with the page and never enter browser storage.
const pageEvidence = new WeakMap<Element, { content: string; text: string }>();
function completePageText(layer: Element): string {
  const content = layer.textContent || "";
  const cached = pageEvidence.get(layer);
  if (cached?.content === content) return cached.text;
  const fragments: PositionedFragment[] = [];
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (!node.textContent) continue;
    const range = document.createRange(); range.selectNodeContents(node);
    const bounds = range.getBoundingClientRect();
    if (bounds.width || bounds.height) fragments.push({ text: node.textContent, bounds });
  }
  const text = positionedText(fragments);
  pageEvidence.set(layer, { content, text });
  return text;
}

/** Reconstruct whitespace from PDF fragment positions, retaining uncertain
 * line-ending hyphens. Dehyphenation evidence is scoped to each source page.
 */
export function selectedPdfText(range: Range, root: HTMLElement): string {
  const fragments: (PositionedFragment & { layer: Element })[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.parentElement?.closest(".pdf-text-layer") &&
        node.textContent &&
        range.intersectsNode(node)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const content = node.textContent || "";
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : content.length;
    if (end <= start) continue;
    const selected = document.createRange();
    selected.setStart(node, start);
    selected.setEnd(node, end);
    const bounds = selected.getBoundingClientRect();
    if (!bounds.width && !bounds.height) continue;
    const layer = node.parentElement!.closest(".pdf-text-layer")!;
    fragments.push({ text: content.slice(start, end), bounds, layer });
  }
  const groups: { layer: Element; fragments: PositionedFragment[] }[] = [];
  for (const fragment of fragments) {
    if (groups.at(-1)?.layer !== fragment.layer) groups.push({ layer: fragment.layer, fragments: [] });
    groups.at(-1)!.fragments.push(fragment);
  }
  const result = groups.map(group => repairPdfSelectionText(positionedText(group.fragments), completePageText(group.layer))).join("\n");
  return (result || range.toString()).replace(/\s+/g, " ").trim();
}
