import { randomUUID } from "node:crypto";
import net from "node:net";
import { ApiError, isPublicAddress } from "./network.mjs";

export const annotationKinds = ["highlight", "underline", "note", "ink", "translation", "explanation"];
const colors = ["yellow", "green", "blue", "pink", "purple"];
const fields = ["kind", "page", "rects", "quote", "body", "color", "tags", "strokes", "language", "segments", "markerHidden"];
const number = (value) => typeof value === "number" && Number.isFinite(value);
const point = (value) => value && number(value.x) && number(value.y) && value.x >= 0 && value.y >= 0 && value.x <= 1 && value.y <= 1;
const plain = (value, name, max, required = false) => {
  if (typeof value !== "string" || value.length > max || (required && !value.trim()) || /\u0000/.test(value))
    throw new ApiError(`${name} must be text ${required ? "between 1 and " : "of up to "}${max} characters.`);
  // Notes are untrusted Markdown; active HTML and remote image embeds are never accepted.
  if (/<\s*(?:script|iframe|object|embed|img)\b|!\[[^\]]*\]\s*[([]/i.test(value))
    throw new ApiError(`${name} cannot contain active HTML or embedded remote images.`);
  return value.trim();
};

export function validatePage(page, paper) {
  if (!Number.isInteger(page) || page < 1 || (paper.filePath
    ? !paper.pages?.some((entry) => entry.number === page) : page !== 1))
    throw new ApiError("page must reference an existing source page.");
  return page;
}

function validateRects(rects) {
  if (!Array.isArray(rects) || rects.length > 300) throw new ApiError("rects must contain at most 300 rectangles.");
  return rects.map(rect => {
    if (!point(rect) || !number(rect.width) || !number(rect.height) || rect.width <= 0 || rect.height <= 0 || rect.x + rect.width > 1.000001 || rect.y + rect.height > 1.000001)
      throw new ApiError("Annotation rectangles must stay within their normalized page.");
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
}

function validateSegments(input, paper) {
  if (!paper.filePath) throw new ApiError("Annotation segments require a locally imported PDF.");
  if (!Array.isArray(input) || !input.length || input.length > 20)
    throw new ApiError("segments must contain between 1 and 20 page anchors.");
  let previousPage = 0, quoteCharacters = 0, rectangleCount = 0;
  return input.map(entry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(entry)) ||
      Object.keys(entry).some(key => !["page", "quote", "rects"].includes(key)))
      throw new ApiError("Each annotation segment accepts only page, quote and rects.");
    const segment = { page: validatePage(entry.page, paper) };
    if (segment.page <= previousPage) throw new ApiError("Annotation segment pages must be unique and strictly increasing.");
    previousPage = segment.page;
    if (entry.quote !== undefined) segment.quote = plain(entry.quote, "segment quote", 12000);
    if (entry.rects !== undefined) segment.rects = validateRects(entry.rects);
    if (!segment.quote && !segment.rects?.length) throw new ApiError("Every annotation segment requires a quote or page rectangles.");
    quoteCharacters += segment.quote?.length || 0;
    rectangleCount += segment.rects?.length || 0;
    if (quoteCharacters > 12000 || rectangleCount > 300)
      throw new ApiError("A complete annotation is limited to 12,000 quoted characters and 300 rectangles across all segments.");
    return segment;
  });
}

export function annotationSegments(annotation) {
  return annotation.segments?.length ? annotation.segments : [{ page: annotation.page, ...(annotation.quote === undefined ? {} : { quote: annotation.quote }), ...(annotation.rects === undefined ? {} : { rects: annotation.rects }) }];
}

export function validateAnnotation(input, paper, previous) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ApiError("Annotation must be a JSON object.");
  if (Object.keys(input).some((key) => !fields.includes(key) && key !== "restore"))
    throw new ApiError("Annotation contains unsupported fields.");
  if (input.restore !== undefined && (input.restore !== true || !previous))
    throw new ApiError("restore must be true on an existing annotation.");
  if (Object.hasOwn(input, "segments") && input.segments === undefined)
    throw new ApiError("segments cannot remove existing anchors; provide the complete segments array.");
  const merged = { ...previous, ...input };
  const { kind } = merged;
  if (!annotationKinds.includes(kind)) throw new ApiError("Unknown annotation kind.");
  const result = { kind };
  if (merged.markerHidden !== undefined) {
    if (typeof merged.markerHidden !== "boolean") throw new ApiError("markerHidden must be a boolean.");
    result.markerHidden = merged.markerHidden;
  }
  if (merged.segments !== undefined) {
    if (kind === "ink" || merged.strokes !== undefined) throw new ApiError("Ink strokes retain their single-page annotation format; segments cannot contain ink.");
    const aliases = ["page", "quote", "rects"];
    if (previous?.segments?.length > 1 && !("segments" in input) && aliases.some(key => key in input))
      throw new ApiError("Update multi-page source anchors through the complete segments array, not a single-page alias.");
    let anchors = merged.segments;
    // Preserve flat edits for a one-segment record, while never collapsing a
    // multi-page record because an older client sent only its first-page fields.
    if (previous?.segments?.length === 1 && !("segments" in input))
      anchors = [{ ...previous.segments[0], ...Object.fromEntries(aliases.filter(key => key in input).map(key => [key, input[key]])) }];
    result.segments = validateSegments(anchors, paper);
    const first = result.segments[0];
    for (const key of aliases) {
      if ("segments" in input && key in input) {
        const supplied = key === "page" ? validatePage(input.page, paper) : key === "quote" ? plain(input.quote, "quote", 12000) : validateRects(input.rects);
        if (JSON.stringify(supplied) !== JSON.stringify(first[key])) throw new ApiError("Top-level page, quote and rects must match the first annotation segment.");
      }
      if (first[key] !== undefined) result[key] = first[key];
    }
  } else {
    result.page = validatePage(merged.page ?? 1, paper);
    if (merged.quote !== undefined) result.quote = plain(merged.quote, "quote", 12000);
    if (merged.rects !== undefined) result.rects = validateRects(merged.rects);
  }
  if (merged.body !== undefined) result.body = plain(merged.body, "body", 50000);
  if (merged.language !== undefined) {
    if (typeof merged.language !== "string" || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,3}$/.test(merged.language))
      throw new ApiError("language must be a BCP 47 tag.");
    try { result.language = Intl.getCanonicalLocales(merged.language)[0]; }
    catch { throw new ApiError("language must be a BCP 47 tag."); }
  }
  if (merged.color !== undefined) {
    if (!colors.includes(merged.color)) throw new ApiError("Unknown annotation color.");
    result.color = merged.color;
  } else result.color = "yellow";
  if (merged.tags !== undefined) {
    if (!Array.isArray(merged.tags) || merged.tags.length > 20) throw new ApiError("tags must contain at most 20 items.");
    result.tags = [...new Set(merged.tags.map((tag) => plain(tag, "tag", 80, true)))];
  }
  if (merged.strokes !== undefined) {
    if (!Array.isArray(merged.strokes) || merged.strokes.length > 200) throw new ApiError("strokes must contain at most 200 strokes.");
    let total = 0;
    result.strokes = merged.strokes.map((stroke) => {
      if (!stroke || !number(stroke.width) || stroke.width <= 0 || stroke.width > 0.05 || !Array.isArray(stroke.points) || !stroke.points.length || (total += stroke.points.length) > 12000)
        throw new ApiError("Ink requires normalized line widths and at most 12,000 points.");
      return { width: stroke.width, points: stroke.points.map((p) => {
        if (!point(p) || (p.pressure !== undefined && (!number(p.pressure) || p.pressure < 0 || p.pressure > 1)))
          throw new ApiError("Ink points and pressure must be between 0 and 1.");
        return { x: p.x, y: p.y, ...(p.pressure === undefined ? {} : { pressure: p.pressure }) };
      }) };
    });
  }
  if (["highlight", "underline"].includes(kind) && !result.rects?.length && !result.quote)
    throw new ApiError("A highlight or underline needs a selected quote or page rectangles.");
  if (["note", "translation", "explanation"].includes(kind) && !result.body)
    throw new ApiError("This annotation requires nonempty body text.");
  if (kind === "ink" && !result.strokes?.length) throw new ApiError("Ink annotations need at least one stroke.");
  const now = new Date().toISOString();
  return {
    ...result, id: previous?.id || randomUUID(), paperId: paper.id,
    createdAt: previous?.createdAt || now, updatedAt: now,
    ...(previous?.deletedAt && !input.restore ? { deletedAt: previous.deletedAt } : {}),
  };
}

export function annotationMarkdown(paper, annotations) {
  const safe = (value) => String(value || "").replace(/[<>]/g, (char) => char === "<" ? "&lt;" : "&gt;");
  const sourceUrl = portableSourceUrl(paper.url);
  const pdfUrl = portableSourceUrl(paper.pdfUrl || (paper.source === "pdf" ? paper.url : ""));
  const isPdf = Boolean(paper.filePath || paper.pages?.length);
  const provenance = sourceUrl
    ? `Source: [Original paper](<${sourceUrl}>).${pdfUrl && pdfUrl !== sourceUrl ? ` [PDF](<${pdfUrl}>).` : ""}`
    : "Source: Local document; no portable public source URL is available. Local filesystem paths are omitted.";
  const authors = Array.isArray(paper.authors) && paper.authors.length ? `Authors: ${paper.authors.map(safe).join(", ")}\n\n` : "";
  const locator = item => {
    if (isPdf && pdfUrl) return `[p.${item.page}](<${pdfUrl}#page=${item.page}>)`;
    if (!isPdf && sourceUrl) return `[Source text](<${sourceUrl}>)`;
    return `[p.${item.page}]${sourceUrl ? ` · [Original paper](<${sourceUrl}>)` : " (open this page in your original document)"}`;
  };
  return `# ${safe(paper.title)} — Notes\n\n${authors}${provenance}\n\n${isPdf ? "Page references use one-based PDF page indexes; printed page labels may differ.\n\n" : ""}${annotations.map(item => {
    const segments = annotationSegments(item);
    const excerpts = segments.map(segment => `${segments.length > 1 ? `### ${locator(segment)}\n\n` : ""}${segment.quote ? segment.quote.split("\n").map(line => `> ${safe(line)}`).join("\n") + "\n\n" : ""}`).join("");
    return `## ${item.kind} · ${segments.length > 1 ? `${segments.length} page segments` : locator(item)}\n\n${excerpts}${safe(item.body || (item.kind === "ink" ? "Handwritten annotation (stroke geometry is available in the JSON export)." : ""))}${item.tags?.length ? `\n\nTags: ${item.tags.map(safe).join(", ")}` : ""}\n\n${item.createdAt}`;
  }).join("\n\n---\n\n")}\n`;
}

function portableSourceUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
      (net.isIP(host) && !isPublicAddress(host)) ||
      [...url.searchParams.keys()].some(key => /token|api.?key|signature|credential|authorization|password|secret|session/i.test(key))) return "";
    url.hash = "";
    return url.href.replace(/[<>"\s]/g, character => encodeURIComponent(character));
  } catch { return ""; }
}
