import * as pdfText from '../shared/pdf-text.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const context = { exports: {}, require:name=>name==='../shared/pdf-text.mjs'?pdfText:undefined };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL("../src/pdf-search.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, context);
const { indexPdfTextPage, buildPdfSearchIndex, searchPdfText, bindPdfTextLayerItems } = context.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const makeIndex = pages => ({ pages, pageCount: pages.length, indexed: pages.length, failedPages: [] });
const item = (str, x = 0, y = 100, extra = {}) => ({ str, width: str.length * 5, height: 10, transform: [10, 0, 0, 10, x, y], ...extra });

test("PDF find indexes every page including a distant page without any rendered canvas", async () => {
  const requested = [], progress = [];
  const index = await buildPdfSearchIndex({ numPages: 3, getPage: async page => {
    requested.push(page); return { getTextContent: async () => ({ items: [item(page === 3 ? "Distant independent replication result" : "Earlier method text")] }) };
  } }, { onProgress: snapshot => progress.push(snapshot.indexed) });
  assert.deepEqual(requested, [1, 2, 3]); assert.deepEqual(progress, [1, 2, 3]);
  const found = searchPdfText(index, "independent replication");
  assert.equal(found.matches.length, 1); assert.equal(found.matches[0].page, 3);
  assert.equal(found.matches[0].index, 0); assert.equal(found.matches[0].total, 1);
  assert.deepEqual(plain(found.matches[0].ranges), [{ itemIndex: 0, start: 8, end: 31 }]);
});

test("find joins contiguous spans, wrapped hyphens and normalized whitespace with original item offsets", () => {
  const index = makeIndex([indexPdfTextPage([
    { type: "beginMarkedContent" }, item("retri", 0), item("eval", 25),
    item("evi-", 0, 80, { hasEOL: true }), item("dence", 0, 60),
    item("   controlled\t trials", 30, 60),
  ], 1)]);
  assert.equal(searchPdfText(index, "retrieval").matches.length, 1);
  assert.deepEqual(plain(searchPdfText(index, "retrieval").matches[0].ranges), [{ itemIndex: 1, start: 0, end: 5 }, { itemIndex: 2, start: 0, end: 4 }]);
  assert.deepEqual(plain(searchPdfText(index, "evidence").matches[0].ranges), [{ itemIndex: 3, start: 0, end: 4 }, { itemIndex: 4, start: 0, end: 5 }]);
  assert.equal(searchPdfText(index, "controlled   trials").matches.length, 1);
  const spans = [{ dataset: {} }, { dataset: {} }, { dataset: {} }, { dataset: {} }, { dataset: {} }];
  bindPdfTextLayerItems(spans, [{ type: "beginMarkedContent" }, ...Array.from({ length: 5 }, () => ({ str: "text" }))]);
  assert.deepEqual(spans.map(span => span.dataset.pdfTextItemIndex), ["1", "2", "3", "4", "5"]);
});

test("short English and Chinese queries work without minimum length and typography keeps UTF-16 bindings", () => {
  const page = indexPdfTextPage([item("AI ﬁnd e\u0301 𝒜 中文"), item("查找", 120, 80)], 2);
  const index = makeIndex([page]);
  assert.equal(searchPdfText(index, "AI").matches.length, 1);
  assert.equal(searchPdfText(index, "中").matches.length, 1);
  assert.equal(searchPdfText(index, "中文查找").matches.length, 1);
  assert.deepEqual(plain(searchPdfText(index, "find").matches[0].ranges), [{ itemIndex: 0, start: 3, end: 6 }]);
  assert.deepEqual(plain(searchPdfText(index, "é").matches[0].ranges), [{ itemIndex: 0, start: 7, end: 9 }]);
  assert.equal(searchPdfText(index, "ＡＩ").matches.length, 1);
  assert.equal(searchPdfText(makeIndex([indexPdfTextPage([item("中 文 搜 索")], 1)]), "中文搜索").matches.length, 1);
});

test("query changes, empty queries and result caps never retain a previous match", () => {
  const index = makeIndex([indexPdfTextPage([item("a alpha beta a")], 1)]);
  assert.equal(searchPdfText(index, "alpha").matches.length, 1);
  assert.equal(searchPdfText(index, "beta").matches[0].query, "beta");
  assert.equal(searchPdfText(index, "does not exist").matches.length, 0);
  assert.equal(searchPdfText(index, "  ").matches.length, 0);
  const bounded = searchPdfText(index, "a", 2);
  assert.equal(bounded.matches.length, 2); assert.equal(bounded.truncated, true);
});

test("cancellation stops a stale document before text extraction or progress and a new document gets an independent index", async () => {
  const abort = new AbortController(); let release, textReads = 0, progress = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const first = buildPdfSearchIndex({ numPages: 3, getPage: async () => {
    await gate; return { getTextContent: async () => { textReads++; return { items: [item("stale document")] }; } };
  } }, { signal: abort.signal, onProgress: () => progress++ });
  abort.abort(); release();
  await assert.rejects(first, error => error.name === "AbortError");
  assert.equal(textReads, 0); assert.equal(progress, 0);
  const current = await buildPdfSearchIndex({ numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: [item("fresh source")] }) }) });
  assert.equal(searchPdfText(current, "stale").matches.length, 0);
  assert.equal(searchPdfText(current, "fresh").matches.length, 1);
});

test("an unreadable page is reported while later pages remain searchable", async () => {
  const index = await buildPdfSearchIndex({ numPages: 3, getPage: async page => {
    if (page === 2) throw new Error("Text unavailable");
    return { getTextContent: async () => ({ items: page === 3 ? [item("Later accessible evidence")] : [] }) };
  } });
  assert.deepEqual(plain(index.failedPages), [2]); assert.equal(index.indexed, 3);
  assert.equal(searchPdfText(index, "accessible").matches[0].page, 3);
});
