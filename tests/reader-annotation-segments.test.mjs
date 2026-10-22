import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/reader-annotations.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { annotationSegments, annotationPageLabel } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("reader annotation helpers preserve every segment and expose legacy single-page sources without inferred grouping", () => {
  const rects = [{ x: .1, y: .2, width: .5, height: .03 }];
  const legacy = { page: 42, quote: "Legacy excerpt.", rects };
  assert.deepEqual(annotationSegments(legacy), [legacy]);
  assert.equal(annotationPageLabel(legacy), "p.42");
  const segments = [{ page: 42, quote: "First source." }, { page: 43, quote: "Continuation source.", rects }];
  const grouped = { ...legacy, segments };
  assert.equal(annotationSegments(grouped), segments, "Do not fabricate or duplicate first-page aliases");
  assert.equal(annotationSegments(grouped)[1].quote, "Continuation source.");
  assert.equal(annotationPageLabel(grouped), "p.42–43");
  assert.deepEqual(legacy, { page: 42, quote: "Legacy excerpt.", rects });
});

test("page ranges do not imply unselected gaps and formatting never sorts the stored anchors in place", () => {
  const segments = [{ page: 9 }, { page: 2 }, { page: 3 }, { page: 6 }, { page: 7 }, { page: 9 }];
  const snapshot = structuredClone(segments);
  assert.equal(annotationPageLabel({ page: 9, segments }), "p.2–3, 6–7, 9");
  assert.deepEqual(segments, snapshot);
  assert.equal(annotationPageLabel({ page: 2, segments: [{ page: 2 }, { page: 4 }] }), "p.2, 4");
  assert.deepEqual(annotationSegments({ page: 5 }), [{ page: 5 }]);
});
