/**
 * Geometry preparation and a portable annotated PDF download writer.
 * Geometry helpers have no dependencies. The writer loads pdf-lib only when
 * invoked; it never touches a source file or rasterizes a page.
 *
 * Reader annotations use the rotated, cropped PDF.js viewport, with a top-left
 * origin and coordinates normalized independently to viewport width/height.
 * The writer must resolve inherited MediaBox/CropBox/Rotate before calling this
 * module. The writer retains the source document and its existing /Annots, and
 * encodes popup text with PDFHexString.fromText (UTF-16BE).
 */

export class AnnotationPdfGeometryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AnnotationPdfGeometryError';
    this.code = code;
    this.status = 422;
  }
}

function fail(code, message) { throw new AnnotationPdfGeometryError(code, message); }
const finite = value => typeof value === 'number' && Number.isFinite(value);

function box(value, name) {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(finite)) {
    fail('pdf_page_geometry_invalid', `${name} must contain four finite coordinates.`);
  }
  const normalized = [Math.min(value[0], value[2]), Math.min(value[1], value[3]), Math.max(value[0], value[2]), Math.max(value[1], value[3])];
  if (normalized[2] <= normalized[0] || normalized[3] <= normalized[1]) {
    fail('pdf_page_geometry_invalid', `${name} has no area.`);
  }
  return normalized;
}

/**
 * Resolved source-page metadata, in default PDF user-space units (not points).
 * Invalid metadata is rejected, rather than guessing PDF.js's recovery page.
 * UserUnit scales physical dimensions; it must not be applied to stored PDF
 * coordinates a second time. It is not an inheritable PDF page attribute.
 */
export function annotationPageGeometry({ mediaBox, cropBox, rotation = 0, userUnit = 1 } = {}) {
  const media = box(mediaBox, 'MediaBox');
  const crop = cropBox === undefined ? media : box(cropBox, 'CropBox');
  const view = [Math.max(media[0], crop[0]), Math.max(media[1], crop[1]), Math.min(media[2], crop[2]), Math.min(media[3], crop[3])];
  if (view[2] <= view[0] || view[3] <= view[1]) fail('pdf_page_geometry_unsupported', 'CropBox does not intersect MediaBox; an exact annotation export is unavailable.');
  if (!finite(rotation) || rotation % 90 !== 0) fail('pdf_page_geometry_unsupported', 'Page rotation must be a multiple of 90 degrees.');
  if (!finite(userUnit) || userUnit <= 0 || userUnit > 75000) fail('pdf_page_geometry_unsupported', 'UserUnit must be greater than zero and at most 75000.');
  rotation = ((rotation % 360) + 360) % 360;
  const [left, bottom, right, top] = view;
  const width = right - left, height = top - bottom;
  // An independently derived inverse viewport transform. The matrix maps a
  // normalized SVG path directly into default PDF user space.
  const matrix = rotation === 90 ? [0, height, width, 0, left, bottom]
    : rotation === 180 ? [-width, 0, 0, height, right, bottom]
      : rotation === 270 ? [0, -height, -width, 0, right, top]
        : [width, 0, 0, -height, left, top];
  const viewportWidth = rotation % 180 ? height : width;
  const viewportHeight = rotation % 180 ? width : height;
  return Object.freeze({ view: Object.freeze(view), matrix: Object.freeze(matrix), rotation, userUnit, viewportWidth, viewportHeight,
    physicalWidth: viewportWidth * userUnit, physicalHeight: viewportHeight * userUnit });
}

function point(value) {
  if (!value || !finite(value.x) || !finite(value.y) || value.x < 0 || value.x > 1 || value.y < 0 || value.y > 1) {
    fail('annotation_geometry_invalid', 'Annotation points must stay inside their normalized source page.');
  }
  return value;
}
function transform(geometry, x, y) {
  const [a, b, c, d, e, f] = geometry.matrix;
  return [a * x + c * y + e, b * x + d * y + f];
}
function bounds(points) {
  return [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))];
}

export function normalizedPointToPdf(geometry, value) {
  const { x, y } = point(value);
  return transform(geometry, x, y);
}

/** QuadPoints keep visual TL, TR, BL, BR order; /AP must use these same corners.
 * In particular do not let a reader infer the underline edge after sorting the
 * raw PDF coordinates: on a rotated page that may be a different visual edge.
 */
export function normalizedRectToPdf(geometry, value) {
  point(value);
  // Match the persisted annotation API's tolerance. Older valid selections may
  // exceed an edge by <= 1e-6; clamp that rounding error, never an arbitrary crop.
  if (!finite(value.width) || !finite(value.height) || value.width <= 0 || value.height <= 0 || value.x + value.width > 1 + 1e-6 || value.y + value.height > 1 + 1e-6) {
    fail('annotation_geometry_invalid', 'Annotation rectangles must have positive area inside their normalized source page.');
  }
  const right = Math.min(1, value.x + value.width), bottom = Math.min(1, value.y + value.height);
  if (right <= value.x || bottom <= value.y) fail('annotation_geometry_invalid', 'An annotation rectangle has no visible area inside its source page.');
  const corners = [transform(geometry, value.x, value.y), transform(geometry, right, value.y), transform(geometry, value.x, bottom), transform(geometry, right, bottom)];
  return { rect: bounds(corners), quadPoints: corners.flat(), underline: [corners[2], corners[3]] };
}

/**
 * /InkList uses ordinary PDF coordinates. The appearance must draw normalized
 * paths under appearance.matrix, with their original normalized line width.
 * AnnotationLayer's SVG has preserveAspectRatio="none": a single scalar /BS.W
 * cannot exactly reproduce that anisotropic pen. fallbackWidth is an explicit
 * geometric-mean approximation for editors which regenerate the appearance.
 * Pressure is metadata only: the current reader does not render variable width.
 */
export function normalizedInkToPdf(geometry, stroke) {
  if (!stroke || !finite(stroke.width) || stroke.width <= 0 || stroke.width > 0.05 || !Array.isArray(stroke.points) || stroke.points.length < 1 || stroke.points.length > 12000) {
    fail('annotation_geometry_invalid', 'Ink needs a normalized width and 1–12000 points.');
  }
  const points = stroke.points.map(value => {
    point(value);
    if (value.pressure !== undefined && (!finite(value.pressure) || value.pressure < 0 || value.pressure > 1)) fail('annotation_geometry_invalid', 'Ink pressure must be between zero and one.');
    return { x: value.x, y: value.y };
  });
  // A legacy single-point stroke is a dot, not an empty path. A zero-length
  // segment with round line caps preserves its location without inventing drag.
  if (points.length === 1) points.push({ ...points[0] });
  const half = stroke.width / 2;
  const x0 = Math.max(0, Math.min(...points.map(p => p.x)) - half);
  const x1 = Math.min(1, Math.max(...points.map(p => p.x)) + half);
  const y0 = Math.max(0, Math.min(...points.map(p => p.y)) - half);
  const y1 = Math.min(1, Math.max(...points.map(p => p.y)) + half);
  const rect = bounds([[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => transform(geometry, x, y)));
  return { rect, inkList: points.flatMap(value => normalizedPointToPdf(geometry, value)),
    fallbackWidth: stroke.width * Math.sqrt(geometry.viewportWidth * geometry.viewportHeight),
    appearance: { matrix: [...geometry.matrix], clip: [...geometry.view], width: stroke.width, points } };
}

/** Preflight only. A logical cross-page annotation becomes one plan per source
 * segment (never one rectangle across pages). Geometry-free records are marked
 * as page comments; the writer/UI must not invent an exact highlighted passage.
 */
export function planAnnotationPdfGeometry({ pages, annotations, paperId } = {}) {
  if (!Array.isArray(pages) || !pages.length || !Array.isArray(annotations)) fail('annotation_export_invalid', 'Source page metadata and saved annotations are required.');
  const geometries = pages.map(annotationPageGeometry);
  const plans = [], warnings = [];
  for (const annotation of annotations) {
    if (!annotation || annotation.deletedAt) continue;
    if (paperId !== undefined && annotation.paperId !== paperId) fail('annotation_paper_mismatch', 'An annotation does not belong to the requested paper.');
    if (!['highlight', 'underline', 'note', 'ink', 'translation', 'explanation'].includes(annotation.kind)) fail('annotation_kind_unsupported', 'This annotation kind cannot be exported.');
    if (typeof annotation.id !== 'string' || !annotation.id) fail('annotation_export_invalid', 'Saved annotations must have an ID.');
    if (annotation.kind === 'ink' && annotation.segments?.length) fail('annotation_geometry_invalid', 'Ink annotations cannot span multiple source pages.');
    const segments = annotation.segments?.length ? annotation.segments : [{ page: annotation.page, quote: annotation.quote, rects: annotation.rects }];
    if (segments.length > 20) fail('annotation_geometry_invalid', 'An annotation may span at most 20 source pages.');
    let previousPage = 0, totalRectangles = 0;
    for (const [segmentIndex, segment] of segments.entries()) {
      if (!Number.isInteger(segment.page) || segment.page <= previousPage || segment.page > geometries.length) fail('annotation_page_invalid', 'Annotation source pages must be ordered, distinct, and present in the PDF.');
      previousPage = segment.page;
      const geometry = geometries[segment.page - 1];
      if (segment.rects !== undefined && (!Array.isArray(segment.rects) || segment.rects.length > 300)) fail('annotation_geometry_invalid', 'Annotation rectangles are invalid.');
      totalRectangles += segment.rects?.length || 0;
      if (totalRectangles > 300) fail('annotation_geometry_invalid', 'An annotation may contain at most 300 rectangles.');
      const rectangles = (segment.rects || []).map(value => normalizedRectToPdf(geometry, value));
      let strokes = [];
      if (annotation.kind === 'ink') {
        if (!Array.isArray(annotation.strokes) || !annotation.strokes.length || annotation.strokes.length > 200) fail('annotation_geometry_invalid', 'Ink annotations need 1–200 strokes.');
        if (annotation.strokes.reduce((total, stroke) => total + (stroke?.points?.length || 0), 0) > 12000) fail('annotation_geometry_invalid', 'An annotation may contain at most 12000 ink points.');
        strokes = annotation.strokes.map(stroke => normalizedInkToPdf(geometry, stroke));
      }
      const pageComment = !rectangles.length && !strokes.length;
      if (pageComment) warnings.push({ code: 'annotation_page_comment', annotationId: annotation.id, page: segment.page });
      plans.push({ annotationId: annotation.id, kind: annotation.kind, page: segment.page, segmentIndex, segmentCount: segments.length,
        quote: segment.quote ?? '', body: annotation.body ?? '', color: annotation.color,
        tags: annotation.tags ?? [], createdAt: annotation.createdAt, updatedAt: annotation.updatedAt,
        rectangles, strokes, pageComment, appearanceMatrix: [...geometry.matrix] });
    }
  }
  return { pages: geometries, plans, warnings };
}

export class AnnotationPdfExportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AnnotationPdfExportError';
    this.code = code;
    this.status = 422;
  }
}
const exportFailure = (code, message) => new AnnotationPdfExportError(code, message);
const colors = {
  yellow: [240 / 255, 200 / 255, 59 / 255], green: [99 / 255, 184 / 255, 125 / 255],
  blue: [110 / 255, 171 / 255, 235 / 255], pink: [237 / 255, 134 / 255, 166 / 255],
  purple: [179 / 255, 138 / 255, 217 / 255],
};
const kindLabels = { highlight: 'Highlight / 高亮', underline: 'Underline / 下划线', note: 'Note / 笔记', ink: 'Handwriting / 手写',
  translation: 'AI translation — verify against source / AI 翻译，请核对原文', explanation: 'AI explanation — verify against source / AI 解释，请核对原文' };

function contentsFor(plan) {
  if (typeof plan.body !== 'string' || plan.body.length > 50000 || typeof plan.quote !== 'string' || plan.quote.length > 12000 ||
    !Array.isArray(plan.tags) || plan.tags.length > 20 || plan.tags.some(tag => typeof tag !== 'string' || tag.length > 80)) {
    throw exportFailure('annotation_content_invalid', 'Saved annotation text or tags are invalid; no PDF was exported.');
  }
  const parts = [kindLabels[plan.kind]];
  if (plan.body) parts.push(plan.body);
  if (plan.quote) parts.push(`Selected source / 原文选文:\n${plan.quote}`);
  if (plan.tags.length) parts.push(`Tags / 标签: ${plan.tags.join(', ')}`);
  parts.push(`Source page / 来源页: ${plan.page}${plan.segmentCount > 1 ? ` · Part / 分段 ${plan.segmentIndex + 1}/${plan.segmentCount}` : ''}`);
  if (plan.pageComment) parts.push('Page comment only: no exact text position was saved. / 仅页级批注：未保存精确选文位置。');
  return parts.join('\n\n');
}

function pdfDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value)) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  return `D:${date.toISOString().slice(0, 19).replace(/[-:T]/g, '')}Z`;
}
const number = value => {
  if (!finite(value)) throw exportFailure('annotation_geometry_invalid', 'An annotation contains invalid drawing coordinates.');
  // PDF numbers cannot use scientific notation. Source page numbers have at
  // most ten fractional digits here, comfortably below visible subpixel error.
  return value.toFixed(10).replace(/\.?0+$/, '') || '0';
};
const coordinates = values => values.map(number).join(' ');
const unionRects = rectangles => bounds(rectangles.flatMap(rect => [[rect[0], rect[1]], [rect[2], rect[3]]]));
const expandRect = (rect, padding) => [rect[0] - padding, rect[1] - padding, rect[2] + padding, rect[3] + padding];

/**
 * Export a new byte array containing all source pages/content/existing Annots
 * plus ordinary PDF markup annotations. This is a rewritten copy, not an
 * incremental/signed-PDF update. No page is flattened and no font is needed for
 * Unicode popup Contents. annotationCount counts added markup objects, so a
 * multi-page note or multi-stroke ink record can contribute more than one.
 */
export async function exportAnnotatedPdf({ pdfBytes, annotations, paperId } = {}) {
  const lib = await import('pdf-lib');
  const { PDFDocument, PDFDict, PDFArray, PDFName, PDFNumber, PDFHexString, PDFString, PDFNull } = lib;
  const name = value => PDFName.of(value);
  if (!(pdfBytes instanceof Uint8Array) && !(pdfBytes instanceof ArrayBuffer)) throw exportFailure('pdf_source_invalid', 'A readable source PDF is required for annotated export.');
  const input = pdfBytes instanceof Uint8Array ? new Uint8Array(pdfBytes) : new Uint8Array(pdfBytes.slice(0));
  let document;
  try {
    document = await PDFDocument.load(input, { updateMetadata: false, throwOnInvalidObject: true });
  } catch (error) {
    // pdf-lib 1.x's ES5 Error subclass loses its prototype in native Node, so
    // instanceof alone misses its own encryption error. Match only this exact
    // library-owned message; never relay an arbitrary parse error to the UI.
    if (error instanceof lib.EncryptedPDFError || error?.message === new lib.EncryptedPDFError().message) throw exportFailure('pdf_encrypted_unsupported', 'Encrypted PDFs cannot be exported with annotations. Export an unencrypted copy first.');
    throw exportFailure('pdf_source_invalid', 'The source PDF could not be read safely; no annotated copy was created.');
  }
  try {
    if (document.isEncrypted) throw exportFailure('pdf_encrypted_unsupported', 'Encrypted PDFs cannot be exported with annotations. Export an unencrypted copy first.');
    const context = document.context;
    const form = document.catalog.lookupMaybe(name('AcroForm'), PDFDict);
    if (form?.has(name('XFA'))) throw exportFailure('pdf_xfa_unsupported', 'XFA PDFs are not supported for annotated export. The source PDF is unchanged.');
    // Do not pretend that a full rewrite preserves digital signatures. Signature
    // fields may inherit /FT: inspecting the actual signature value dictionary
    // also catches those fields without mutating/normalizing the AcroForm.
    const visited = new Set();
    function inspect(object) {
      const resolved = context.lookup(object);
      if (!resolved || visited.has(resolved)) return;
      visited.add(resolved);
      if (resolved instanceof PDFDict) {
        if (resolved.get(name('Type')) === name('Sig') || (resolved.has(name('ByteRange')) && resolved.has(name('Contents')))) {
          throw exportFailure('pdf_signed_unsupported', 'Digitally signed PDFs cannot be rewritten without invalidating their signatures. The source PDF is unchanged.');
        }
        for (const [, value] of resolved.entries()) inspect(value);
      } else if (resolved instanceof PDFArray) for (const value of resolved.asArray()) inspect(value);
    }
    // Direct nested dictionaries and indirect signature objects are both covered.
    for (const [, object] of context.enumerateIndirectObjects()) inspect(object);
    const pages = document.getPages();
    if (!pages.length) throw exportFailure('pdf_source_invalid', 'The source PDF contains no readable pages.');
    const numericArray = array => array.asArray().map(value => context.lookup(value, PDFNumber).asNumber());
    const pageMetadata = pages.map(page => ({
      mediaBox: numericArray(page.node.MediaBox()), cropBox: page.node.CropBox() ? numericArray(page.node.CropBox()) : undefined,
      rotation: page.node.Rotate()?.asNumber() ?? 0, userUnit: page.node.lookupMaybe(name('UserUnit'), PDFNumber)?.asNumber() ?? 1,
    }));
    const prepared = planAnnotationPdfGeometry({ pages: pageMetadata, annotations, paperId });
    const existing = pages.map(page => {
      const raw = page.node.get(name('Annots'));
      const array = raw === undefined ? undefined : context.lookup(raw);
      if (array === undefined || array === PDFNull) return [];
      if (!(array instanceof PDFArray) || array.asArray().some(value => !(context.lookup(value) instanceof PDFDict))) {
        throw exportFailure('pdf_annotations_invalid', 'Existing PDF annotations could not be preserved safely; no annotated copy was created.');
      }
      return [...array.asArray()];
    });
    const knownNames = new Set();
    for (const entries of existing) for (const ref of entries) {
      const nm = context.lookup(ref, PDFDict).lookup(name('NM'));
      if (nm instanceof PDFString || nm instanceof PDFHexString) knownNames.add(nm.decodeText());
    }
    function uniqueName(base) {
      let value = base, suffix = 2;
      while (knownNames.has(value)) value = `${base}:copy${suffix++}`;
      knownNames.add(value);
      return PDFHexString.fromText(value);
    }
    const added = pages.map(() => []);
    let annotationCount = 0;
    function appearance(rect, body, color, opacity = 1, multiply = false) {
      const graphics = context.obj({ Type: 'ExtGState', ca: opacity, CA: opacity, ...(multiply ? { BM: 'Multiply' } : {}) });
      const stream = context.flateStream(`q\n/GS0 gs\n${coordinates(color)} rg\n${coordinates(color)} RG\n${body}\nQ`, {
        Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: rect, Matrix: [1, 0, 0, 1, 0, 0],
        Resources: { ExtGState: { GS0: graphics } },
      });
      return context.obj({ N: context.register(stream) });
    }
    function add(plan, subtype, rect, ap, extra = {}, suffix = '') {
      const entries = {
        Type: 'Annot', Subtype: subtype, Rect: rect, P: pages[plan.page - 1].ref, F: 4,
        T: PDFHexString.fromText('Paper Workbench'), Subj: PDFHexString.fromText(kindLabels[plan.kind]),
        Contents: PDFHexString.fromText(contentsFor(plan)), NM: uniqueName(`paper-workbench:${plan.annotationId}:p${plan.page}:s${plan.segmentIndex}${suffix}`),
        C: colors[plan.color] || colors[plan.kind === 'ink' ? 'blue' : 'yellow'], AP: ap,
        ...(pdfDate(plan.createdAt) ? { CreationDate: PDFString.of(pdfDate(plan.createdAt)) } : {}),
        ...(pdfDate(plan.updatedAt) ? { M: PDFString.of(pdfDate(plan.updatedAt)) } : {}), ...extra,
      };
      added[plan.page - 1].push(context.register(context.obj(entries)));
      annotationCount++;
    }
    const pageComments = pages.map(() => 0);
    for (const plan of prepared.plans) {
      const geometry = prepared.pages[plan.page - 1];
      const color = colors[plan.color] || colors[plan.kind === 'ink' ? 'blue' : 'yellow'];
      if (plan.pageComment) {
        const index = pageComments[plan.page - 1]++;
        const width = Math.min(0.08, 18 / geometry.physicalWidth), height = Math.min(0.08, 18 / geometry.physicalHeight);
        const rows = Math.max(1, Math.floor(0.9 / (height + 0.01)));
        const x = Math.min(0.9, 0.02 + Math.floor(index / rows) * (width + 0.01)), y = 0.02 + (index % rows) * (height + 0.01);
        const rect = normalizedRectToPdf(geometry, { x, y, width, height }).rect;
        const [left, bottom, right, top] = rect, inset = Math.min(right - left, top - bottom) * 0.18;
        const icon = `${coordinates([left, bottom, right - left, top - bottom])} re f\n0.25 0.25 0.25 RG\n${number(inset / 3)} w\n` +
          [0.3, 0.5, 0.7].map(ratio => `${coordinates([left + inset, bottom + (top - bottom) * ratio])} m ${coordinates([right - inset, bottom + (top - bottom) * ratio])} l S`).join('\n');
        add(plan, 'Text', rect, appearance(rect, icon, color), { Name: 'Comment', Open: false });
      } else if (plan.kind === 'ink') {
        for (const [index, stroke] of plan.strokes.entries()) {
          const [left, bottom, right, top] = stroke.appearance.clip;
          const path = stroke.appearance.points.map((point, at) => `${coordinates([point.x, point.y])} ${at ? 'l' : 'm'}`).join('\n');
          const body = `${coordinates([left, bottom, right - left, top - bottom])} re W n\n${coordinates(stroke.appearance.matrix)} cm\n${number(stroke.appearance.width)} w 1 J 1 j\n${path}\nS`;
          add(plan, 'Ink', stroke.rect, appearance(stroke.rect, body, color), { InkList: [stroke.inkList], BS: { Type: 'Border', W: stroke.fallbackWidth, S: 'S' }, CA: 1 }, `:stroke${index}`);
        }
      } else {
        const underline = plan.kind === 'underline';
        const lineWidth = 0.0025 * geometry.viewportHeight;
        const rawRect = unionRects(plan.rectangles.map(value => value.rect));
        const rect = underline ? expandRect(rawRect, lineWidth / 2) : rawRect;
        const body = underline
          ? `${number(lineWidth)} w 0 J\n` + plan.rectangles.map(value => `${coordinates(value.underline[0])} m ${coordinates(value.underline[1])} l S`).join('\n')
          : plan.rectangles.map(({ quadPoints: q }) => `${coordinates(q.slice(0, 2))} m ${coordinates(q.slice(2, 4))} l ${coordinates(q.slice(6, 8))} l ${coordinates(q.slice(4, 6))} l h f`).join('\n');
        add(plan, underline ? 'Underline' : 'Highlight', rect, appearance(rect, body, color, underline ? 1 : 0.32, !underline), {
          QuadPoints: plan.rectangles.flatMap(value => value.quadPoints), CA: underline ? 1 : 0.32, Border: [0, 0, 0],
        });
      }
    }
    for (let index = 0; index < pages.length; index++) {
      if (!added[index].length) continue;
      // A fresh page-local array retains every old reference even if a malformed
      // producer shared one /Annots array between pages. Never normalize page
      // resources/content streams merely to append an annotation.
      pages[index].node.set(name('Annots'), context.obj([...existing[index], ...added[index]]));
    }
    const bytes = await document.save({ updateFieldAppearances: false, addDefaultPage: false });
    return { bytes, warnings: prepared.warnings, annotationCount };
  } catch (error) {
    if (error instanceof AnnotationPdfExportError || error instanceof AnnotationPdfGeometryError) throw error;
    throw exportFailure('pdf_export_unsupported', 'This PDF could not be exported safely with annotations. The source PDF is unchanged.');
  }
}
