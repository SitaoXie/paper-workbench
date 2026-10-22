import test from "node:test";
import assert from "node:assert/strict";
import { selectionPageBinding } from "../server/source-selection.mjs";

const paper = { filePath: "fixture.pdf", pages: Array.from({ length: 25 }, (_, index) => ({ number: index + 1 })) };
test("PDF range metadata derives the first-page alias without changing caller input or legacy shape", () => {
  const input = { pages: [2, 3, 5] };
  const bound = selectionPageBinding(input, paper);
  assert.deepEqual(bound, { page: 2, pages: [2, 3, 5] });
  assert.notEqual(bound.pages, input.pages);
  assert.deepEqual(selectionPageBinding({ page: 2 }, paper), { page: 2 });
  assert.deepEqual(selectionPageBinding({}, paper), {});
  assert.deepEqual(selectionPageBinding({}, paper, { defaultPage: 1 }), { page: 1 });
  assert.deepEqual(selectionPageBinding({ page: 2, pages: [2, 3] }, paper), { page: 2, pages: [2, 3] });
});
test("PDF ranges reject ambiguous aliases, duplicates, ordering, unavailable pages and non-PDF sources", () => {
  for (const input of [{ pages: [] }, { pages: null }, { pages: [0] }, { pages: [26] }, { pages: [1, 1] }, { pages: [3, 2] }, { pages: [1, "2"] }, { pages: Array.from({ length: 21 }, (_, index) => index + 1) }, { page: 1, pages: [2, 3] }, { page: null }, { page: null, pages: [2] }])
    assert.throws(() => selectionPageBinding(input, paper));
  assert.equal(selectionPageBinding({ pages: Array.from({ length: 20 }, (_, index) => index + 1) }, paper).pages.length, 20);
  assert.throws(() => selectionPageBinding({ pages: [1] }, {}), /locally imported PDF/);
  assert.deepEqual(selectionPageBinding({ page: 1 }, {}), { page: 1 });
});
