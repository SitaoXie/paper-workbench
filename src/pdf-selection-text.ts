/** Reconstruct a PDF text selection using positioned text fragments.
 * PDF.js spans frequently omit the whitespace between lines / text runs.
 * Only spatial separation supplies separators; substrings are never replaced.
 */
export function selectedPdfText(range: Range, root: HTMLElement): string {
  const fragments: { text: string; bounds: DOMRect }[] = [];
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
    fragments.push({ text: content.slice(start, end), bounds });
  }
  let result = "";
  let previous: (typeof fragments)[number] | undefined;
  for (const fragment of fragments) {
    if (
      previous &&
      result &&
      !/\s$/.test(result) &&
      !/^\s/.test(fragment.text)
    ) {
      const a = previous.bounds,
        b = fragment.bounds;
      const lineBreak =
        Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) >
        Math.max(a.height, b.height) * 0.6;
      const gap =
        b.left - a.right > Math.max(0.75, Math.min(a.height, b.height) * 0.12);
      const cjkPair =
        /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(
          result,
        ) &&
        /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(
          fragment.text,
        );
      if ((lineBreak || gap) && !cjkPair) result += lineBreak ? "\n" : " ";
    }
    result += fragment.text;
    previous = fragment;
  }
  return (result || range.toString()).replace(/\s+/g, " ").trim();
}
