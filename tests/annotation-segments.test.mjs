import test from "node:test";
import assert from "node:assert/strict";
import { validateAnnotation, annotationSegments, annotationMarkdown } from "../server/annotations.mjs";

const paper = { id: "segments-paper", title: "Source-bound notes", filePath: "pdfs/fixture.pdf", url: "https://example.com/paper", pdfUrl: "https://example.com/paper.pdf", pages: Array.from({ length: 25 }, (_, index) => ({ number: index + 1 })) };
const rect = { x: .1, y: .2, width: .4, height: .03 };
const segments = [{ page: 2, quote: "The first source passage.", rects: [rect] }, { page: 3, quote: "Its continuation on the next page.", rects: [{ ...rect, y: .1 }] }];

test("one logical annotation shares its comment, tags and color across source segments with a faithful first-page alias", () => {
  const annotation = validateAnnotation({ kind: "note", segments, body: "One shared comment.", tags: ["method"], color: "green" }, paper);
  assert.equal(annotation.page, 2); assert.equal(annotation.quote, segments[0].quote); assert.deepEqual(annotation.rects, segments[0].rects);
  assert.deepEqual(annotation.segments, segments); assert.equal(annotation.body, "One shared comment.");
  const snapshot = structuredClone(annotation);
  const edited = validateAnnotation({ body: "Edited once for both pages.", tags: ["reviewed"], color: "purple" }, paper, annotation);
  assert.equal(edited.id, annotation.id); assert.equal(edited.createdAt, annotation.createdAt);
  assert.deepEqual(edited.segments, segments); assert.equal(edited.body, "Edited once for both pages.");
  assert.deepEqual(annotation, snapshot, "Validation must not mutate the previous record");
  for (const patch of [{ page: 2 }, { quote: segments[0].quote }, { rects: segments[0].rects }, { segments: null }, { segments: undefined }])
    assert.throws(() => validateAnnotation(patch, paper, annotation));
  const relocated = [{ page: 3, quote: "An explicitly replaced source passage." }, { page: 4, rects: [rect] }];
  assert.deepEqual(validateAnnotation({ segments: relocated }, paper, annotation).segments, relocated);
});

test("segment arrays validate page ownership, unique order, allowed fields and every geometry before accepting any part", () => {
  const invalid = [
    [], null, [{ page: 99, quote: "Missing page." }], [{ page: 0, rects: [rect] }],
    [{ page: 2, quote: "A" }, { page: 2, quote: "B" }], [...segments].reverse(),
    [{ page: 2 }], [{ page: 2, quote: " ", rects: [] }],
    [{ page: 2, quote: "A", body: "A conflicting segment comment" }],
    [{ page: 2, quote: "A", paperId: "other-paper" }],
    [{ page: 2, rects: [{ ...rect, x: .9 }] }],
    [{ page: 2, rects: [{ ...rect, width: NaN }] }],
    [{ page: 2, quote: "<script>source instructions</script>" }],
    [Object.assign(Object.create({ page: 2 }), { quote: "Inherited anchors are not accepted." })],
  ];
  for (const value of invalid) assert.throws(() => validateAnnotation({ kind: "highlight", segments: value }, paper));
  assert.throws(() => validateAnnotation({ kind: "highlight", segments }, { ...paper, filePath: undefined }), /locally imported PDF/);
  assert.throws(() => validateAnnotation({ kind: "ink", segments }, paper), /single-page/);
  assert.throws(() => validateAnnotation({ kind: "highlight", segments, page: 1 }, paper), /first annotation segment/);
  assert.throws(() => validateAnnotation({ kind: "highlight", segments, quote: "A combined quote from both pages." }, paper), /first annotation segment/);
  assert.throws(() => validateAnnotation({ kind: "highlight", segments, rects: [{ ...rect, y: .7 }] }, paper), /first annotation segment/);
  assert.deepEqual(validateAnnotation({ kind: "highlight", segments, ...segments[0] }, paper).segments, segments);
});

test("the 20-page, 12000-character and 300-rectangle limits apply to the complete logical annotation", () => {
  const exact = Array.from({ length: 20 }, (_, index) => ({ page: index + 1, quote: "q".repeat(600), rects: Array.from({ length: 15 }, () => ({ ...rect })) }));
  const accepted = validateAnnotation({ kind: "highlight", segments: exact }, paper);
  assert.equal(accepted.segments.length, 20);
  assert.throws(() => validateAnnotation({ kind: "highlight", segments: [...exact, { page: 21, quote: "extra" }] }, paper), /20 page anchors/);
  assert.throws(() => validateAnnotation({ kind: "highlight", segments: [{ page: 1, quote: "a".repeat(6001) }, { page: 2, quote: "b".repeat(6000) }] }, paper), /across all segments/);
  assert.throws(() => validateAnnotation({ kind: "highlight", segments: [{ page: 1, rects: Array(150).fill(rect) }, { page: 2, rects: Array(151).fill(rect) }] }, paper), /across all segments/);
  const scan = validateAnnotation({ kind: "highlight", segments: [{ page: 1, rects: [rect] }, { page: 2, rects: [rect] }] }, paper);
  assert.equal(scan.quote, undefined); assert.equal(scan.segments.length, 2);
});

test("legacy single-page and previously split records remain separate and keep their existing schema", () => {
  const first = validateAnnotation({ kind: "highlight", page: 2, quote: "First old highlight", body: "Old shared text" }, paper);
  const second = validateAnnotation({ kind: "highlight", page: 3, quote: "Second old highlight", body: "Old shared text" }, paper);
  assert.notEqual(first.id, second.id); assert.equal(first.segments, undefined); assert.equal(second.segments, undefined);
  assert.deepEqual(annotationSegments(first), [{ page: 2, quote: "First old highlight" }]);
  const updated = validateAnnotation({ body: "Only the explicitly edited old annotation changes." }, paper, first);
  assert.equal(updated.segments, undefined); assert.equal(second.body, "Old shared text");
  const one = validateAnnotation({ kind: "highlight", segments: [{ page: 2, quote: "Single segment" }] }, paper);
  assert.deepEqual(validateAnnotation({ page: 3, quote: "Flat legacy edit" }, paper, one).segments, [{ page: 3, quote: "Flat legacy edit" }]);
});

test("Markdown exports one logical note with all page-linked excerpts and only one shared comment and tag list", () => {
  const annotation = validateAnnotation({ kind: "note", segments, body: "SHARED_COMMENT_ONCE", tags: ["SHARED_TAG_ONCE"] }, paper);
  const output = annotationMarkdown(paper, [annotation]);
  assert.equal((output.match(/^## note/gm) || []).length, 1);
  assert.match(output, /2 page segments/);
  assert.ok(output.includes("[p.2](<https://example.com/paper.pdf#page=2>)"));
  assert.ok(output.includes("[p.3](<https://example.com/paper.pdf#page=3>)"));
  for (const segment of segments) assert.ok(output.includes(segment.quote));
  assert.equal((output.match(/SHARED_COMMENT_ONCE/g) || []).length, 1);
  assert.equal((output.match(/SHARED_TAG_ONCE/g) || []).length, 1);
  assert.ok(!output.includes(paper.filePath));
});
