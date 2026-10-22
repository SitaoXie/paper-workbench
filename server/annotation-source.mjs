import { ApiError } from "./network.mjs";

const revision = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const failure = (code, message, status = 409) => Object.assign(new ApiError(message, status), { code });

/** Only source bindings, never notes or a mutable figure/vision revision. */
export function annotationSourceFingerprint(paper) {
  return JSON.stringify([paper.source, paper.filePath ?? null, paper.sourcePdfRevision ?? null,
    paper.source === "pdf" ? paper.contentHash ?? null : null,
    paper.annotationExportBinding ?? null]);
}

/** Current bytes are server-read. A user acceptance is not an original hash. */
export function annotationSourceState(paper, pdfRevision) {
  if (!revision(pdfRevision)) throw new ApiError("A server-read PDF revision is required.", 500);
  const original = paper.sourcePdfRevision || (paper.source === "pdf" ? paper.contentHash : undefined);
  if (original) {
    if (!revision(original)) throw failure("pdf_source_binding_invalid", "The original PDF fingerprint is invalid. Preserve the notes and reimport the source before PDF export.");
    return { pdfRevision, bindingStatus: original === pdfRevision ? "original" : "changed", boundPdfRevision: original };
  }
  const accepted = paper.annotationExportBinding;
  if (accepted !== undefined) {
    if (!accepted || accepted.method !== "user-accepted-current-pdf" || !revision(accepted.pdfRevision) ||
        typeof accepted.acceptedAt !== "string" || !Number.isFinite(Date.parse(accepted.acceptedAt)))
      throw failure("pdf_source_binding_invalid", "The saved PDF export choice is invalid. Preserve the notes and reimport the source before PDF export.");
    return { pdfRevision, bindingStatus: accepted.pdfRevision === pdfRevision ? "user-accepted" : "changed",
      boundPdfRevision: accepted.pdfRevision,
      annotationExportBinding: { pdfRevision: accepted.pdfRevision, acceptedAt: accepted.acceptedAt, method: accepted.method } };
  }
  return { pdfRevision, bindingStatus: "unbound" };
}

export function validateAnnotationSourceAcceptance(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some(key => !["expectedPdfRevision", "acceptCurrentSource"].includes(key)) ||
      !revision(body.expectedPdfRevision) || body.acceptCurrentSource !== true)
    throw failure("pdf_source_acceptance_invalid", "Provide the current expectedPdfRevision and acceptCurrentSource:true after reviewing the current PDF.", 400);
}

/** Return a new choice without mutating the original source or any annotations. */
export function prepareAnnotationSourceAcceptance(paper, body, pdfRevision, acceptedAt = new Date().toISOString()) {
  validateAnnotationSourceAcceptance(body);
  if (body.expectedPdfRevision !== pdfRevision)
    throw failure("pdf_source_changed", "The PDF changed since it was displayed. Reload and review the current source before accepting it.");
  const state = annotationSourceState(paper, pdfRevision);
  if (state.bindingStatus === "changed")
    throw failure("pdf_source_changed", "The PDF differs from its saved source binding. This operation cannot replace that binding or erase the source change.");
  if (state.bindingStatus !== "unbound")
    throw failure("pdf_source_already_bound", "This PDF already has a source binding. Reload the source status; no new acceptance was saved.");
  return { pdfRevision, acceptedAt, method: "user-accepted-current-pdf" };
}
