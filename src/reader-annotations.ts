/** PDF coordinates are normalized to page width / height so annotations survive zoom. */
export type AnnotationColor = "yellow" | "green" | "blue" | "pink" | "purple";
export type AnnotationRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type AnnotationSegment = {
  page: number;
  quote?: string;
  rects?: AnnotationRect[];
};
export type InkPoint = { x: number; y: number; pressure?: number };
export type InkStroke = { points: InkPoint[]; width: number };
export type Annotation = {
  markerHidden?: boolean;
  id: string;
  paperId: string;
  kind:
    "highlight" | "underline" | "note" | "ink" | "translation" | "explanation";
  page: number;
  rects?: AnnotationRect[];
  quote?: string;
  /** One logical annotation can have source anchors on multiple pages. */
  segments?: AnnotationSegment[];
  body?: string;
  color?: AnnotationColor;
  tags?: string[];
  language?: string;
  strokes?: InkStroke[];
  createdAt: string;
  updatedAt: string;
};
export type AnnotationDraft = Omit<
  Annotation,
  "id" | "paperId" | "createdAt" | "updatedAt"
>;
/** Older single-page records remain independent; no inferred grouping occurs. */
export function annotationSegments(annotation: Pick<Annotation, "page" | "quote" | "rects" | "segments">): AnnotationSegment[] {
  return annotation.segments?.length ? annotation.segments : [{
    page: annotation.page,
    ...(annotation.quote === undefined ? {} : { quote: annotation.quote }),
    ...(annotation.rects === undefined ? {} : { rects: annotation.rects }),
  }];
}

/** Compress consecutive source pages without suggesting a gap is selected. */
export function annotationPageLabel(annotation: Pick<Annotation, "page" | "quote" | "rects" | "segments">): string {
  const pages = [...new Set(annotationSegments(annotation).map(segment => segment.page))].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let index = 0; index < pages.length; index++) {
    const start = pages[index];
    let end = start;
    while (pages[index + 1] === end + 1) end = pages[++index];
    ranges.push(start === end ? String(start) : `${start}–${end}`);
  }
  return `p.${ranges.join(", ")}`;
}
export const annotationColors: Record<AnnotationColor, string> = {
  yellow: "#f0c83b",
  green: "#63b87d",
  blue: "#6eabeb",
  pink: "#ed86a6",
  purple: "#b38ad9",
};
export const clampNormalized = (value: number) =>
  Math.max(0, Math.min(1, value));

/** Collect text fragments without creating broad rectangles over column whitespace. */
export function normalizedSelectionRects(
  range: Range,
  page: HTMLElement,
): AnnotationRect[] {
  const bounds = page.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return [];
  const rectangles: AnnotationRect[] = [];
  for (const rect of Array.from(range.getClientRects())) {
    const x = Math.max(bounds.left, rect.left);
    const y = Math.max(bounds.top, rect.top);
    const right = Math.min(bounds.right, rect.right);
    const bottom = Math.min(bounds.bottom, rect.bottom);
    if (right - x < 1 || bottom - y < 1) continue;
    const normalized = {
      x: clampNormalized((x - bounds.left) / bounds.width),
      y: clampNormalized((y - bounds.top) / bounds.height),
      width: (right - x) / bounds.width,
      height: (bottom - y) / bounds.height,
    };
    // PDF text ranges can return duplicate span and text-node boxes.
    if (
      rectangles.some(
        (previous) =>
          Math.abs(previous.x - normalized.x) < 0.001 &&
          Math.abs(previous.y - normalized.y) < 0.001 &&
          Math.abs(previous.width - normalized.width) < 0.001 &&
          Math.abs(previous.height - normalized.height) < 0.001,
      )
    )
      continue;
    rectangles.push(normalized);
  }
  const merged: AnnotationRect[] = [];
  for (const rectangle of rectangles.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const line = merged.find(
      (candidate) =>
        Math.abs(candidate.y - rectangle.y) < 0.002 &&
        Math.abs(candidate.height - rectangle.height) < 0.003 &&
        rectangle.x <= candidate.x + candidate.width + 0.012 &&
        rectangle.x + rectangle.width >= candidate.x - 0.012,
    );
    if (!line) {
      merged.push({ ...rectangle });
      continue;
    }
    const right = Math.max(line.x + line.width, rectangle.x + rectangle.width);
    const bottom = Math.max(
      line.y + line.height,
      rectangle.y + rectangle.height,
    );
    line.x = Math.min(line.x, rectangle.x);
    line.y = Math.min(line.y, rectangle.y);
    line.width = right - line.x;
    line.height = bottom - line.y;
  }
  return merged;
}
