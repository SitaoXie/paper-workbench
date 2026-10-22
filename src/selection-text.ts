export type ReadingSelectionText = { text: string; hasMath: boolean };

const ignored = 'script,style,noscript,template,svg,input,textarea,select,[hidden],[inert],[aria-hidden="true"],.sr-only,.visually-hidden,.reading-heading-link,[data-selection-ignore]';
const blocks = new Set(['ADDRESS','ARTICLE','ASIDE','BLOCKQUOTE','DETAILS','DIV','DL','DT','DD','FIGURE','FIGCAPTION','FOOTER','FORM','H1','H2','H3','H4','H5','H6','HEADER','HR','MAIN','NAV','OL','P','PRE','SECTION','SUMMARY','TABLE','UL']);

/** Keep structural breaks separate from literal code/TeX whitespace. */
class TextWriter {
  private value = '';
  private pendingBreak = 0;
  private literalTail = false;
  line(count = 2) { this.pendingBreak = Math.max(this.pendingBreak, count); }
  append(value: string, literal = false) {
    if (!value) return;
    if (!literal) value = value.replace(/[\t\n\r\f ]+/g, ' ');
    if (this.pendingBreak) {
      if (!this.literalTail) this.value = this.value.replace(/ +$/, '');
      if (this.value) {
        const trailing = this.value.match(/\n*$/)![0].length;
        this.value += '\n'.repeat(Math.max(0, this.pendingBreak - trailing));
        if (!literal) value = value.replace(/^ +/, '');
      }
      this.pendingBreak = 0;
    } else if (!literal && !this.literalTail && this.value.endsWith(' ')) value = value.replace(/^ +/, '');
    this.value += value;
    this.literalTail = literal;
  }
  finish() { return this.value; }
}

/**
 * Serialize one range contained in a reading surface, without changing either
 * the live selection or the DOM. Each intersected KaTeX formula is atomic: its
 * original annotation is included once, even when only a visual glyph is selected.
 * Non-math text remains clipped to the exact range. No length limit is applied:
 * callers must validate the final `text.length`, never a truncated preview.
 */
export function rangeToReadingText(range: Range, root: Element): ReadingSelectionText | undefined {
  if (range.collapsed || !root.contains(range.startContainer) || !root.contains(range.endContainer)) return;
  const selected = range.cloneRange();
  const view = root.ownerDocument.defaultView;
  let hasMath = false;
  const intersects = (node: Node) => {
    try { return selected.intersectsNode(node); } catch { return false; }
  };
  function walk(node: Node, writer: TextWriter, literal = false, mathFallback = false) {
    if (!intersects(node)) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const start = selected.startContainer === node ? selected.startOffset : 0;
      const end = selected.endContainer === node ? selected.endOffset : node.textContent?.length || 0;
      writer.append((node.textContent || '').slice(start, end), literal);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    if (element.matches(ignored) && !(mathFallback && element.classList.contains('katex-html'))) return;
    const style = view?.getComputedStyle(element);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse' || style?.userSelect === 'none') return;
    // Process the outer math node before its aria-hidden visual branch or its
    // visually clipped MathML branch can enter ordinary text serialization.
    if (element.classList.contains('katex')) {
      const annotation = element.querySelector('annotation[encoding="application/x-tex"]');
      if (annotation) {
        const display = !!element.closest('.katex-display');
        const tex = annotation.textContent || '';
        if (display) writer.line();
        writer.append(display ? `$$\n${tex}\n$$` : `$${tex}$`, true);
        if (display) writer.line();
        hasMath = true;
        return;
      }
      // A nonstandard renderer may omit the source annotation. Keep only its
      // selected visual branch rather than inventing TeX or duplicating MathML.
      const visual = element.querySelector('.katex-html');
      if (visual) { hasMath = true; walk(visual, writer, literal, true); return; }
    }
    const tag = element.tagName;
    const preformatted = literal || tag === 'PRE' || tag === 'CODE' || !!style?.whiteSpace.match(/^(pre|break-spaces)/);
    if (tag === 'BR') { writer.append('\n', true); return; }
    if (tag === 'TR') {
      const cells = [...element.children].filter(cell => ['TD','TH'].includes(cell.tagName) && intersects(cell));
      const values = cells.map(cell => { const content = new TextWriter(); walk(cell, content, preformatted); return content.finish(); });
      if (values.length) { writer.line(1); writer.append(values.join('\t'), true); writer.line(1); }
      return;
    }
    const block = blocks.has(tag), listItem = tag === 'LI';
    if (block || listItem) writer.line(listItem ? 1 : 2);
    const children = tag === 'DETAILS' && !element.hasAttribute('open')
      ? [...element.children].filter(child => child.tagName === 'SUMMARY').slice(0, 1)
      : [...element.childNodes];
    for (const child of children) walk(child, writer, preformatted, mathFallback);
    if (block || listItem) writer.line(listItem ? 1 : 2);
  }
  const writer = new TextWriter();
  walk(root, writer);
  return { text: writer.finish(), hasMath };
}
