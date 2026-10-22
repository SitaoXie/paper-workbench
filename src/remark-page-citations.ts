import type { Nodes, Root } from "mdast";
import type { VFile } from "vfile";
import { proseCitations } from "../shared/prose-citations.mjs";

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
        const raw = start !== undefined && end !== undefined ? source.slice(start, end) : child.value;
        const matches = proseCitations(raw, child.value);
        let cursor = 0;
        for (const match of matches) {
          const sourceTarget = match.sourceTarget;
          if(sourceTarget){
            if(match.start>cursor)next.push({type:'text',value:child.value.slice(cursor,match.start)});
            next.push({type:'link',url:`#source=${sourceTarget}`,children:[{type:'text',value:match.label}]});
            cursor=match.end;continue;
          }
          if (match.start > cursor) next.push({ type: "text", value: child.value.slice(cursor, match.start) });
          match.pages!.forEach(({ page, lastPage }, index) => {
            if (index) next.push({ type: "text", value: ", " });
            next.push({ type: "link", url: `#page=${page}`, children: [{ type: "text", value: `p.${page}${lastPage ? `–${lastPage}` : ""}` }] });
          });
          cursor = match.end;
        }
        if (!cursor) next.push(child);
        else if (cursor < child.value.length) next.push({ type: "text", value: child.value.slice(cursor) });
      }
      parent.children = next as typeof parent.children;
    }
    visit(tree);
  };
}
