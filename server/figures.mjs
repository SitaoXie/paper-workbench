import { createHash, randomUUID } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { ApiError } from "./network.mjs";
import { discoverFigures } from "./storage.mjs";
import { validateFigures, validateMarkdown } from "./insights.mjs";

const MAX_FIGURES = 30;
const MAX_HISTORY = 20;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const LARGE_CROP_AREA = .9;
const sha256 = value => createHash("sha256").update(value).digest("hex");
const revision = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const identifier = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);

function objectWithKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new ApiError(`${label} must be a plain object.`);
  if (Object.keys(value).some(key => !allowed.includes(key)))
    throw new ApiError(`${label} contains unsupported fields.`);
}

/** Same effective collection exposed by publicPaper; automatic entries remain previews. */
export function currentFigures(paper) {
  return structuredClone(paper.figures?.length && paper.figures.every(figure => figure.source?.kind === "extracted")
    ? discoverFigures(paper) : paper.figures ?? discoverFigures(paper));
}

/** Bind optimistic writes to this paper and its complete current editable collection. */
export function figuresRevision(paper) {
  return sha256(JSON.stringify({ paperId: paper.id, figures: currentFigures(paper) }));
}

/** Hash actual local bytes. No private path or document bytes enter the public result. */
export async function pdfRevision(paper, directory) {
  if (!paper.filePath) throw new ApiError("Figure references require a locally imported PDF.");
  let handle;
  try {
    const root = await realpath(directory);
    const target = await realpath(path.resolve(root, paper.filePath));
    const relative = path.relative(root, target);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      throw new Error("Outside source directory");
    handle = await open(target, "r");
    const info = await handle.stat();
    if (!info.isFile() || !info.size || info.size > MAX_PDF_BYTES)
      throw new Error("Invalid source size");
    const bytes = await handle.readFile();
    if (!bytes.length || bytes.length > MAX_PDF_BYTES || !bytes.subarray(0, 1024).includes(Buffer.from("%PDF-")))
      throw new Error("Invalid source bytes");
    return sha256(bytes);
  } catch {
    throw new ApiError("The stored PDF is unavailable or cannot be used for figure review. Reimport the source PDF.", 409);
  } finally {
    await handle?.close().catch(() => {});
  }
}

/** Remember verified bytes without rewriting an old observation's content. */
export function bindPdfRevision(paper, verifiedRevision) {
  if (!revision(verifiedRevision)) throw new ApiError("A server-verified PDF revision is required.", 500);
  const previous = paper.pdfRevision || (paper.source === "pdf" ? paper.contentHash : undefined);
  if (previous && previous !== verifiedRevision) {
    // Legacy observations had no PDF hash. Once a known source changes, they
    // cannot safely be resurrected even if a later crop has the same geometry.
    for (const evidence of paper.visualEvidence || [])
      if (!evidence.pdfRevision) evidence.sourceRevisionChanged = true;
  }
  paper.pdfRevision = verifiedRevision;
}

/** Read-only: callers need no model configuration and this does not persist candidates. */
export async function getFigureCollection(paper, directory) {
  const sourceRevision = await pdfRevision(paper, directory);
  return { figures: currentFigures(paper), pdfRevision: sourceRevision, figuresRevision: figuresRevision(paper) };
}

function priorFigure(figure, replacedAt) {
  const previous = {};
  for (const key of ["page", "crop", "caption", "label", "kind", "largeCrop", "source", "createdAt", "updatedAt"])
    if (figure[key] !== undefined) previous[key] = structuredClone(figure[key]);
  return { ...previous, replacedAt };
}

/**
 * Validate one explicitly reviewed edit and return an isolated change plan.
 * The route must obtain a fresh server-computed PDF revision, call this function
 * without an intervening await, materialize legacy readings BEFORE assigning
 * plan.figures, then persist. Nothing here mutates the paper or reading versions.
 */
export function prepareFigureChange(paper, body, { pdfRevision: sourceRevision, figureId, now = new Date().toISOString(), idFactory = () => `figure-${randomUUID()}` } = {}) {
  if (!paper.filePath) throw new ApiError("Figure references require a locally imported PDF.");
  objectWithKeys(body, ["pdfRevision", "expectedFiguresRevision", "figure", "source"], "Figure request");
  if (!revision(body.pdfRevision) || !revision(body.expectedFiguresRevision))
    throw new ApiError("Provide pdfRevision and expectedFiguresRevision from the current figure collection.");
  if (!revision(sourceRevision)) throw new ApiError("A server-verified PDF revision is required.", 500);
  // Recompute from the live paper after the asynchronous byte read. Two writes
  // from the same old revision cannot both succeed before a store.save await.
  if (body.pdfRevision !== sourceRevision || body.expectedFiguresRevision !== figuresRevision(paper))
    throw new ApiError("The PDF or figure collection changed. Reload the figures and review the current crop before saving.", 409);
  objectWithKeys(body.source, ["method", "reviewed"], "Figure source");
  if (!["manual", "pdfjs-candidate"].includes(body.source.method) || body.source.reviewed !== true)
    throw new ApiError("Confirm that you reviewed this crop, with method manual or pdfjs-candidate and reviewed:true.");
  objectWithKeys(body.figure, ["page", "crop", "caption", "label"], "Figure");
  if (!Object.keys(body.figure).length) throw new ApiError("Provide at least one figure field to save.");

  const existing = currentFigures(paper);
  let previous;
  if (figureId !== undefined) {
    if (!identifier(figureId)) throw new ApiError("Figure id must be a valid identifier.");
    previous = existing.find(figure => figure.id === figureId);
    if (!previous) throw new ApiError("Figure not found in this paper.", 404);
  } else if (existing.length >= MAX_FIGURES) {
    throw new ApiError("A paper supports at most 30 figure references.");
  }
  const value = { ...(previous || {}), ...body.figure };
  objectWithKeys(value.crop, ["x", "y", "width", "height"], "Figure crop");
  // Reuse page and geometry validation used by external agent figure imports.
  const caption = validateMarkdown(value.caption, "Figure caption", 3000);
  let label;
  if (value.label !== undefined) {
    if (typeof value.label !== "string" || value.label.length > 120)
      throw new ApiError("Figure label must be text of at most 120 characters.");
    if (value.label.trim()) label = validateMarkdown(value.label, "Figure label", 120);
  }
  const id = previous?.id || idFactory();
  if (!identifier(id) || (!previous && existing.some(figure => figure.id === id)))
    throw new ApiError("Could not allocate a new figure identifier. Retry saving this crop.", 500);
  const source = { kind: "user", method: body.source.method, reviewed: true, pdfRevision: sourceRevision, reviewedAt: now };
  const [normalized] = validateFigures([{ id, page: value.page, caption, crop: value.crop }], paper, source);
  const largeCrop = normalized.crop.width * normalized.crop.height >= LARGE_CROP_AREA;
  if (largeCrop && source.method !== "manual")
    throw new ApiError("This crop covers nearly the whole page. Inspect it and explicitly confirm a manual crop instead of accepting an automatic candidate.");
  const figure = {
    ...normalized, ...(label ? { label } : {}), largeCrop,
    createdAt: previous?.createdAt || now, updatedAt: now,
    ...(previous ? { history: [...(Array.isArray(previous.history) ? previous.history : []), priorFigure(previous, now)].slice(-MAX_HISTORY) } : {}),
  };
  const figures = previous ? existing.map(item => item.id === previous.id ? figure : item) : [...existing, figure];
  return { figure, figures, pdfRevision: sourceRevision, figuresRevision: figuresRevision({ ...paper, figures }) };
}
