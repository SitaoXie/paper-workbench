import test from "node:test";
import assert from "node:assert/strict";
import { visualEvidenceRecord, currentVisualEvidence, visualEvidenceContext, visualContextProvenance, assertVisualEvidenceIncludable } from "../server/vision.mjs";

const crop = { x: .1, y: .2, width: .7, height: .3 };
const figure = { id: "chart", page: 1, crop, caption: "An experiment with uncertainty.", source: { reviewed: true } };
const input = { figure, pdfRevision: "a".repeat(64), image: { mimeType: "image/png" }, imageHash: "b".repeat(64), width: 400, height: 200, focus: "Read the curves." };
const record = () => visualEvidenceRecord(input, "Unverified chart interpretation.", "en", { id: "vision-profile", model: "explicit-vision-model" });

test("new observations default to pending even for reviewed crops, while legacy inclusion remains unchanged", () => {
  const fresh = record();
  assert.equal(fresh.excluded, true); assert.equal(fresh.modelUnverified, true);
  const legacy = { ...record(), id: "legacy" }; delete legacy.excluded;
  const paper = { filePath: "source.pdf", pdfRevision: input.pdfRevision, figures: [figure], visualEvidence: [legacy] };
  assert.deepEqual(currentVisualEvidence(paper), [legacy]);
  paper.visualEvidence.push(fresh);
  assert.deepEqual(currentVisualEvidence(paper), [], "A pending latest observation must not fall back to the included legacy result");
  assert.equal(visualEvidenceContext(paper), "");
  assert.deepEqual(visualContextProvenance(paper, `[Visual evidence ${legacy.id}]`), { pixelsProvided: false, visualEvidenceMode: "none", visualEvidenceIds: [] });
  assert.throws(() => assertVisualEvidenceIncludable(paper, legacy), error => error.status === 409 && /newer observation/.test(error.message));
  assert.doesNotThrow(() => assertVisualEvidenceIncludable(paper, fresh));
  fresh.excluded = false;
  assert.deepEqual(currentVisualEvidence(paper), [fresh]);
  assert.equal(fresh.modelUnverified, true); assert.equal(fresh.verified, undefined);
  assert.match(visualEvidenceContext(paper), /UNVERIFIED/);
});

test("latest observations cannot be included when crop, PDF revision, or legacy source binding has changed", () => {
  for (const change of ["crop", "page", "pdf", "figure-pdf", "legacy-revision", "missing-figure"]) {
    const evidence = record();
    const paper = { filePath: "source.pdf", pdfRevision: input.pdfRevision, figures: [structuredClone(figure)], visualEvidence: [evidence] };
    if (change === "crop") paper.figures[0].crop.x = .2;
    if (change === "page") paper.figures[0].page = 2;
    if (change === "pdf") paper.pdfRevision = "c".repeat(64);
    if (change === "figure-pdf") paper.figures[0].source.pdfRevision = "c".repeat(64);
    if (change === "legacy-revision") { delete evidence.pdfRevision; evidence.sourceRevisionChanged = true; }
    if (change === "missing-figure") paper.figures = [];
    assert.throws(() => assertVisualEvidenceIncludable(paper, evidence), error => error.status === 409 && /no longer matches/.test(error.message), change);
    assert.equal(evidence.excluded, true); assert.equal(evidence.modelUnverified, true);
  }
});
