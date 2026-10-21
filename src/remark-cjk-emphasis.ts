import type { Nodes, Root, Text } from "mdast";
import type { VFile } from "vfile";

const han = /\p{Script=Han}/u;
const punctuation = /\p{P}/u;

/** CommonMark deliberately leaves **中文。**后文 and **487 个（12.7%）**使用
 * literal because punctuation touches the closing delimiter and CJK prose has
 * no intervening space. Recover only those unparsed, unescaped CJK text spans.
 * Code, math, links, existing emphasis, and source strings remain untouched. */
export default function remarkCjkEmphasis() {
  return (tree: Root, file: VFile) => {
    const source = String(file);
    function visit(parent: Nodes) {
      if (["code", "inlineCode", "math", "inlineMath", "link", "linkReference", "image", "imageReference", "strong", "emphasis", "html"].includes(parent.type)) return;
      if (!("children" in parent)) return;
      const result: Nodes[] = [];
      for (const child of parent.children) {
        if (child.type !== "text") { visit(child); result.push(child); continue; }
        const start = child.position?.start.offset, end = child.position?.end.offset;
        // Escaped delimiters/entities have different raw and parsed values.
        // Conservatively leave such nodes as CommonMark parsed them.
        if (start === undefined || end === undefined || source.slice(start, end) !== child.value) { result.push(child); continue; }
        const pattern = /\*\*([^*\n]+?)\*\*/g;
        let cursor = 0;
        for (const match of child.value.matchAll(pattern)) {
          const at = match.index!, content = match[1];
          const before = child.value[at - 1] || "", after = child.value[at + match[0].length] || "";
          const brokenBoundary = (han.test(before) && punctuation.test(content[0])) || (punctuation.test(content.at(-1)!) && han.test(after));
          if (!han.test(content) || content !== content.trim() || before === "*" || after === "*" || !brokenBoundary) continue;
          if (at > cursor) result.push({ type: "text", value: child.value.slice(cursor, at) });
          result.push({ type: "strong", children: [{ type: "text", value: content } satisfies Text] });
          cursor = at + match[0].length;
        }
        if (!cursor) result.push(child);
        else if (cursor < child.value.length) result.push({ type: "text", value: child.value.slice(cursor) });
      }
      // Each replacement keeps the original node's phrasing/block position.
      parent.children = result as typeof parent.children;
    }
    visit(tree);
  };
}
