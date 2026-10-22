import type { Nodes, Root } from "mdast";
import type { VFile } from "vfile";

/** Recognize common model-written page references in prose only. A reference is
 * evidence navigation, never a replacement inside code, math or existing links. */
export default function remarkPageCitations() {
  return (tree: Root, file: VFile) => {
    const source = String(file);
    function visit(parent: Nodes) {
      if (["code", "inlineCode", "math", "inlineMath", "link", "linkReference", "image", "imageReference", "html"].includes(parent.type) || !("children" in parent)) return;
      const next: Nodes[] = [];
      for (const child of parent.children) {
        if (child.type !== "text") { visit(child); next.push(child); continue; }
        const start = child.position?.start.offset, end = child.position?.end.offset;
        // An escaped bracket is literal text. Do not reinterpret escaped nodes.
        if (start !== undefined && end !== undefined && source.slice(start, end) !== child.value) { next.push(child); continue; }
        const matches = child.value.matchAll(/\[((?:pp?\.?\s*\d)[^\]\n]{0,100}|第\s*\d{1,4}\s*页)\]/gi);
        let cursor = 0;
        for (const match of matches) {
          const parts = match[1].replace(/^第\s*(\d+)\s*页$/, 'p.$1').split(/\s*[,;，、]\s*/);
          if (parts.length > 12) continue;
          const pages = parts.map(part => /^(?:pp?\.?\s*)?(\d{1,4})(?:\s*[-–—]\s*(?:pp?\.?\s*)?(\d{1,4}))?$/i.exec(part));
          if (pages.some(page => !page || Number(page[1]) < 1 || (page[2] && Number(page[2]) < Number(page[1])))) continue;
          if (match.index! > cursor) next.push({ type: "text", value: child.value.slice(cursor, match.index!) });
          pages.forEach((page, index) => {
            if (index) next.push({ type: "text", value: ", " });
            next.push({ type: "link", url: `#page=${Number(page![1])}`, children: [{ type: "text", value: `p.${Number(page![1])}${page![2] ? `–${Number(page![2])}` : ""}` }] });
          });
          cursor = match.index! + match[0].length;
        }
        if (!cursor) next.push(child);
        else if (cursor < child.value.length) next.push({ type: "text", value: child.value.slice(cursor) });
      }
      parent.children = next as typeof parent.children;
    }
    visit(tree);
  };
}
