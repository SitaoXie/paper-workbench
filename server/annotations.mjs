import { randomUUID } from "node:crypto";
import { ApiError } from "./network.mjs";

export const annotationKinds = ["highlight", "underline", "note", "ink", "translation", "explanation"];
const colors = ["yellow", "green", "blue", "pink", "purple"];
const fields = ["kind", "page", "rects", "quote", "body", "color", "tags", "strokes", "language"];
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

export function validateAnnotation(input, paper, previous) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ApiError("Annotation must be a JSON object.");
  if (Object.keys(input).some((key) => !fields.includes(key) && key !== "restore"))
    throw new ApiError("Annotation contains unsupported fields.");
  if (input.restore !== undefined && (input.restore !== true || !previous))
    throw new ApiError("restore must be true on an existing annotation.");
  const merged = { ...previous, ...input };
  const { kind } = merged;
  if (!annotationKinds.includes(kind)) throw new ApiError("Unknown annotation kind.");
  const result = { kind, page: validatePage(merged.page ?? 1, paper) };
  if (merged.quote !== undefined) result.quote = plain(merged.quote, "quote", 12000);
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
  if (merged.rects !== undefined) {
    if (!Array.isArray(merged.rects) || merged.rects.length > 300) throw new ApiError("rects must contain at most 300 rectangles.");
    result.rects = merged.rects.map((rect) => {
      if (!point(rect) || !number(rect.width) || !number(rect.height) || rect.width <= 0 || rect.height <= 0 || rect.x + rect.width > 1.000001 || rect.y + rect.height > 1.000001)
        throw new ApiError("Annotation rectangles must stay within their normalized page.");
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
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
  return `# ${safe(paper.title)} — Notes\n\n${annotations.map((item) =>
    `## ${item.kind} · [p.${item.page}]\n\n${item.quote ? item.quote.split("\n").map((line) => `> ${safe(line)}`).join("\n") + "\n\n" : ""}${safe(item.body || (item.kind === "ink" ? "Handwritten annotation (stroke geometry is available in the JSON export)." : ""))}${item.tags?.length ? `\n\nTags: ${item.tags.map(safe).join(", ")}` : ""}\n\n${item.createdAt}`
  ).join("\n\n---\n\n")}\n`;
}
