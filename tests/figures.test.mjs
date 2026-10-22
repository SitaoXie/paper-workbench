import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { currentFigures, figuresRevision, getFigureCollection, prepareFigureChange, bindPdfRevision } from "../server/figures.mjs";
import { currentVisualEvidence, visualEvidenceMatches } from "../server/vision.mjs";
import { materializeReadingVersions, readingState } from "../server/reading.mjs";
import { outlinePdf } from "./fixtures/outline-pdf.mjs";

const crop = { x: .1, y: .12, width: .7, height: .35 };
const sourceRevision = "a".repeat(64);
const paper = () => ({ id: "figure-paper", filePath: "pdfs/source.pdf", pages: [{ number: 1, text: "Figure 1: A caption next to a real source diagram." }, { number: 2, text: "Second source page." }], figures: [] });
const input = (source, figure = { page: 1, crop, caption: "Figure 1: Controlled evidence." }, extra = {}) => ({ pdfRevision: sourceRevision, expectedFiguresRevision: figuresRevision(source), figure, source: { method: "pdfjs-candidate", reviewed: true }, ...extra });
const change = (source, body = input(source), options = {}) => prepareFigureChange(source, body, { pdfRevision: sourceRevision, ...options });
const apply = (source, plan) => { materializeReadingVersions(source); source.figures = plan.figures; };

async function directoryFixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "pw-figure-module-"));
  await mkdir(path.join(directory, "pdfs"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("GET collection hashes actual PDF bytes, stays read-only and exposes no private paths or pixels", async t => {
  const directory = await directoryFixture(t), source = paper(), bytes = outlinePdf();
  await writeFile(path.join(directory, source.filePath), bytes);
  const before = structuredClone(source);
  const collection = await getFigureCollection(source, directory);
  assert.deepEqual(source, before);
  assert.deepEqual(Object.keys(collection).sort(), ["figures", "figuresRevision", "pdfRevision"]);
  assert.equal(collection.pdfRevision, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(collection.figuresRevision, figuresRevision(source));
  assert.equal(JSON.stringify(collection).includes(directory), false);
  assert.equal(JSON.stringify(collection).includes(source.filePath), false);
  assert.deepEqual(await getFigureCollection(source, directory), collection);
  await writeFile(path.join(directory, source.filePath), outlinePdf({ title: "Different source bytes" }));
  const changed = await getFigureCollection(source, directory);
  assert.notEqual(changed.pdfRevision, collection.pdfRevision);
  assert.equal(changed.figuresRevision, collection.figuresRevision);
  assert.throws(() => prepareFigureChange(source, { ...input(source), pdfRevision: collection.pdfRevision }, { pdfRevision: changed.pdfRevision }), error => error.status === 409);
});

test("missing, oversized, non-PDF and out-of-directory sources return sanitized failures", async t => {
  const directory = await directoryFixture(t), source = paper();
  await assert.rejects(getFigureCollection(source, directory), error => error.status === 409 && !error.message.includes(directory));
  await assert.rejects(getFigureCollection({ ...source, filePath: undefined }, directory), /locally imported PDF/);
  await writeFile(path.join(directory, source.filePath), "not a PDF");
  await assert.rejects(getFigureCollection(source, directory), /stored PDF is unavailable/);
  const outside = await mkdtemp(path.join(tmpdir(), "pw-figure-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(path.join(outside, "private.pdf"), outlinePdf());
  await symlink(path.join(outside, "private.pdf"), path.join(directory, "pdfs/link.pdf"));
  for (const filePath of [path.join(outside, "private.pdf"), path.relative(directory, path.join(outside, "private.pdf")), "pdfs/link.pdf"])
    await assert.rejects(getFigureCollection({ ...source, filePath }, directory), error => error.status === 409 && !error.message.includes(outside));
  await writeFile(path.join(directory, source.filePath), Buffer.alloc(25 * 1024 * 1024 + 1));
  await assert.rejects(getFigureCollection(source, directory), /stored PDF is unavailable/);
});

test("a confirmed candidate is an isolated single-item merge with user-review provenance, not an automatic verified observation", () => {
  const source = paper(), before = structuredClone(source);
  const first = change(source);
  assert.deepEqual(source, before, "Preparing a change cannot mutate the paper before legacy snapshots are materialized");
  assert.equal(first.figure.kind, "figure-crop"); assert.equal(first.figure.largeCrop, false);
  assert.deepEqual(first.figure.crop, crop);
  assert.equal(first.figure.source.kind, "user"); assert.equal(first.figure.source.method, "pdfjs-candidate");
  assert.equal(first.figure.source.reviewed, true); assert.equal(first.figure.source.pdfRevision, sourceRevision);
  assert.equal(first.figure.source.verified, undefined); assert.equal(first.figure.source.pixelsProvided, undefined);
  assert.equal(first.figure.history, undefined);
  apply(source, first);
  const second = change(source, input(source, { page: 2, crop: { ...crop, y: .2 }, caption: "Figure 2: A separate result.", label: "Fig. 2" }));
  assert.notEqual(second.figure.id, first.figure.id); assert.deepEqual(second.figures[0], first.figure);
  assert.equal(second.figures.length, 2); assert.equal(second.figure.label, "Fig. 2");
  assert.notEqual(second.figuresRevision, first.figuresRevision);
  second.figures[0].caption = "Mutating a change plan cannot modify a saved record";
  assert.equal(source.figures[0].caption, first.figure.caption);
});

test("PATCH keeps figure identity, unrelated figures and source-bound reading translations immutable; history is flat and bounded", () => {
  const source = paper(); apply(source, change(source)); apply(source, change(source));
  source.summary = { markdown: "Old reading :::figure " + source.figures[0].id, language: "en", createdAt: "2026-01-01T00:00:00Z" };
  source.translations = { "zh-CN": { summary: { markdown: "旧解读", language: "zh-CN", sourceUpdatedAt: source.summary.createdAt, figureCaptions: { [source.figures[0].id]: "原始图注译文" } } } };
  const legacy = structuredClone(readingState(source));
  const id = source.figures[0].id, original = structuredClone(source.figures[0]), other = structuredClone(source.figures[1]);
  for (let index = 0; index < 24; index++) {
    const edited = change(source, input(source, { caption: `Edited caption ${index}.`, ...(index === 0 ? { page: 2, crop: { ...crop, x: .2 }, label: "Reviewed figure" } : {}) }), { figureId: id, now: `2026-02-${String(index + 1).padStart(2, "0")}T00:00:00Z` });
    assert.equal(edited.figure.id, id); assert.equal(edited.figure.createdAt, original.createdAt);
    apply(source, edited);
  }
  assert.deepEqual(readingState(source), legacy, "Legacy versions must be materialized before assigning the first edited collection");
  assert.deepEqual(source.figures[1], other);
  assert.equal(source.figures[0].page, 2); assert.deepEqual(source.figures[0].crop, { ...crop, x: .2 });
  assert.equal(source.figures[0].label, "Reviewed figure");
  assert.equal(source.figures[0].history.length, 20);
  assert.equal(source.figures[0].history[0].caption, "Edited caption 3.");
  assert.equal(source.figures[0].history.at(-1).caption, "Edited caption 22.");
  assert.ok(source.figures[0].history.every(item => item.history === undefined && item.id === undefined && item.replacedAt));
  const clearedLabel = change(source, input(source, { label: "" }), { figureId: id });
  assert.equal(clearedLabel.figure.label, undefined);
  assert.equal(clearedLabel.figure.caption, "Edited caption 23.");
});

test("old collection revisions, different PDFs and cross-paper figure identifiers cannot overwrite a current crop", () => {
  const source = paper(), staleBody = input(source), first = change(source, staleBody);
  apply(source, first);
  for (const body of [staleBody, { ...input(source), pdfRevision: "b".repeat(64) }, { ...input(source), expectedFiguresRevision: figuresRevision({ ...source, id: "another-paper" }) }])
    assert.throws(() => change(source, body), error => error.status === 409);
  const latest = structuredClone(source);
  assert.throws(() => change(source, input(source, { caption: "Overwrite unrelated figure" }), { figureId: "missing-in-this-paper" }), error => error.status === 404);
  assert.deepEqual(source, latest);
  // Competing writes share an old token. The route assigns synchronously before
  // awaiting disk persistence; the second write must re-read the live revision.
  const shared = input(source), one = change(source, shared); apply(source, one);
  assert.throws(() => change(source, shared), error => error.status === 409);
});

test("only bounded, explicitly reviewed crop fields can be persisted", () => {
  const source = paper();
  const valid = input(source);
  for (const body of [
    { ...valid, source: { method: "pdfjs-candidate", reviewed: false } },
    { ...valid, source: { method: "pdfjs-candidate" } },
    { ...valid, source: { method: "automatic", reviewed: true } },
    { ...valid, source: { ...valid.source, verified: true } },
    { ...valid, source: { ...valid.source, image: "not stored" } },
    { ...valid, image: { data: "not stored" } },
    { ...valid, url: "https://example.com/figure.png" },
    { ...valid, paperId: "different-paper" },
    { ...valid, expectedFiguresRevision: "missing" },
    { ...valid, pdfRevision: null },
    { ...valid, figure: {} },
    ...["id", "source", "history", "largeCrop", "url", "image", "__proto__"].map(key => ({ ...valid, figure: { ...valid.figure, [key]: "untrusted" } })),
    ...[0, 3, 1.5, "1"].map(page => ({ ...valid, figure: { ...valid.figure, page } })),
    ...[undefined, null, {}, { ...crop, width: 0 }, { ...crop, x: -1 }, { ...crop, height: NaN }, { ...crop, x: .9 }, { ...crop, extra: 1 }].map(crop => ({ ...valid, figure: { ...valid.figure, crop } })),
    ...["", " ", "x".repeat(3001), "<script>run me</script>", "![remote](https://example.com/image.png)"].map(caption => ({ ...valid, figure: { ...valid.figure, caption } })),
    { ...valid, figure: { ...valid.figure, label: "x".repeat(121) } },
    { ...valid, figure: Object.assign(Object.create({ page: 1 }), { crop, caption: "Inherited page" }) },
  ]) assert.throws(() => change(source, body), error => error.status === 400, JSON.stringify(body));
  assert.deepEqual(source, paper());
});

test("nearly full-page geometry requires explicit manual review and remains labeled large, not a silent extracted figure", () => {
  const source = paper(), figure = { page: 1, crop: { x: 0, y: 0, width: 1, height: .95 }, caption: "A source figure occupying nearly the entire page." };
  assert.throws(() => change(source, input(source, figure)), /explicitly confirm a manual crop/);
  const accepted = change(source, input(source, figure, { source: { method: "manual", reviewed: true } }));
  assert.equal(accepted.figure.largeCrop, true); assert.equal(accepted.figure.kind, "figure-crop");
  assert.equal(accepted.figure.source.method, "manual"); assert.equal(accepted.figure.source.reviewed, true);
  apply(source, accepted);
  assert.throws(() => change(source, input(source, { caption: "A caption edit still requires review of this large crop." }), { figureId: accepted.figure.id }), /manual crop/);
});

test("30 references is the insertion limit; an existing crop remains editable and legacy previews require a real crop before promotion", () => {
  const source = paper();
  for (let index = 0; index < 30; index++) apply(source, change(source));
  assert.equal(source.figures.length, 30);
  assert.throws(() => change(source), /at most 30/);
  const edited = change(source, input(source, { caption: "A correction within a full collection." }), { figureId: source.figures[0].id });
  assert.equal(edited.figures.length, 30);
  const legacy = { ...paper(), figures: undefined };
  const [preview] = currentFigures(legacy);
  assert.equal(preview.kind, "page-preview"); assert.equal(preview.crop, undefined);
  assert.throws(() => change(legacy, input(legacy, { caption: "Only an edited caption" }), { figureId: preview.id }), /Figure crop/);
  const promoted = change(legacy, input(legacy, { crop }), { figureId: preview.id });
  assert.equal(promoted.figure.id, preview.id); assert.equal(promoted.figure.kind, "figure-crop");
  assert.equal(promoted.figure.history[0].kind, "page-preview"); assert.equal(promoted.figure.history[0].crop, undefined);
  assert.equal(legacy.figures, undefined);
});

test("known PDF changes withdraw unbound legacy vision permanently and hashed observations match only their own source", () => {
  const source = paper(); apply(source, change(source));
  const evidence = { id: "legacy-observation", figureId: source.figures[0].id, page: 1, crop, pixelsProvided: true,
    analysisMethod: "vision-model", markdown: "An earlier model interpretation, not independently verified." };
  source.visualEvidence = [evidence];
  assert.equal(visualEvidenceMatches(source, evidence), true, "Legacy records stay compatible while no byte change is known");
  bindPdfRevision(source, sourceRevision);
  assert.equal(visualEvidenceMatches(source, evidence), true);
  bindPdfRevision(source, "b".repeat(64));
  assert.equal(evidence.sourceRevisionChanged, true); assert.deepEqual(currentVisualEvidence(source), []);
  assert.equal(evidence.markdown, "An earlier model interpretation, not independently verified.");
  bindPdfRevision(source, sourceRevision);
  assert.deepEqual(currentVisualEvidence(source), [], "Reverting a PDF cannot revive a withdrawn legacy observation");
  const recent = { ...evidence, id: "bound-observation", pdfRevision: sourceRevision, sourceRevisionChanged: undefined };
  source.visualEvidence.push(recent);
  assert.deepEqual(currentVisualEvidence(source), [recent]);
  bindPdfRevision(source, "c".repeat(64));
  assert.deepEqual(currentVisualEvidence(source), []);
  source.figures[0].source.pdfRevision = "c".repeat(64);
  assert.equal(visualEvidenceMatches(source, recent), false, "Same crop geometry does not rebind older pixels to a new PDF");
  assert.throws(() => bindPdfRevision(source, "not-a-verified-hash"), error => error.status === 500);
});
