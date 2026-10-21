import { useRef, useState, type PointerEvent, type CSSProperties } from "react";
import { MessageSquare } from "lucide-react";
import {
  annotationColors,
  clampNormalized,
  type Annotation,
  type AnnotationColor,
  type InkPoint,
  type InkStroke,
} from "./reader-annotations";

type Props = {
  annotations: Annotation[];
  drawing: boolean;
  color: AnnotationColor;
  drafts: { stroke: InkStroke; color: AnnotationColor }[];
  focusedId?: string;
  onStroke: (stroke: InkStroke) => void;
  onSelect?: (id: string) => void;
  language?: string;
};
const pathFor = (stroke: InkStroke) =>
  stroke.points
    .map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`)
    .join(" ");

/** Visuals do not intercept text selection. Only explicit handwriting mode captures the page. */
export default function AnnotationLayer({
  annotations,
  drawing,
  color,
  drafts,
  focusedId,
  onStroke,
  onSelect,
  language,
}: Props) {
  const current = useRef<InkStroke | null>(null);
  const [preview, setPreview] = useState<InkStroke | null>(null);
  const pointer = useRef<number | null>(null);
  const markers = annotations.filter(
    (annotation) =>
      annotation.body ||
      annotation.kind === "note" ||
      annotation.kind === "ink",
  );
  const markerY = (annotation: Annotation) =>
    annotation.rects?.[0]?.y ?? annotation.strokes?.[0]?.points[0]?.y ?? 0.02;
  const pointFor = (event: PointerEvent<SVGSVGElement>): InkPoint => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: clampNormalized((event.clientX - bounds.left) / bounds.width),
      y: clampNormalized((event.clientY - bounds.top) / bounds.height),
      pressure: event.pressure || 0.5,
    };
  };
  return (
    <div className={`reader-annotation-layer ${drawing ? "is-drawing" : ""}`}>
      <svg
        className="reader-annotation-paint"
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {annotations.map((annotation) => (
          <g
            key={annotation.id}
            className={annotation.id === focusedId ? "is-focused" : undefined}
            data-annotation-id={annotation.id}
          >
            {annotation.rects?.map((rect, index) =>
              annotation.kind === "underline" ? (
                <line
                  key={index}
                  x1={rect.x}
                  x2={rect.x + rect.width}
                  y1={rect.y + rect.height}
                  y2={rect.y + rect.height}
                  stroke={annotationColors[annotation.color || "yellow"]}
                  strokeWidth=".0025"
                />
              ) : (
                <rect
                  key={index}
                  x={rect.x}
                  y={rect.y}
                  width={rect.width}
                  height={rect.height}
                  rx=".001"
                  fill={annotationColors[annotation.color || "yellow"]}
                  fillOpacity={annotation.id === focusedId ? 0.58 : 0.32}
                />
              ),
            )}
            {annotation.strokes?.map((stroke, index) => (
              <path
                key={index}
                d={pathFor(stroke)}
                fill="none"
                stroke={annotationColors[annotation.color || "blue"]}
                strokeWidth={stroke.width}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </g>
        ))}
        {[...drafts, ...(preview ? [{ stroke: preview, color }] : [])].map(
          ({ stroke, color: strokeColor }, index) => (
            <path
              key={`draft-${index}`}
              d={pathFor(stroke)}
              fill="none"
              stroke={annotationColors[strokeColor]}
              strokeWidth={stroke.width}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ),
        )}
      </svg>
      {!drawing &&
        markers.map((annotation, index) => {
          const rect = annotation.rects?.[0];
          const point = annotation.strokes?.[0]?.points[0];
          return (
            <button
              key={annotation.id}
              type="button"
              className={`reader-annotation-marker ${annotation.id === focusedId ? "is-focused" : ""}`}
              style={
                {
                  top: `${Math.min(0.95, rect?.y ?? point?.y ?? 0.02) * 100}%`,
                  right:
                    4 +
                    28 *
                      markers
                        .slice(0, index)
                        .filter(
                          (previous) =>
                            Math.abs(markerY(previous) - markerY(annotation)) <
                            0.04,
                        ).length,
                  "--annotation-color":
                    annotationColors[annotation.color || "yellow"],
                } as CSSProperties
              }
              onClick={(event) => {
                event.stopPropagation();
                onSelect?.(annotation.id);
              }}
              title={
                annotation.body ||
                annotation.quote ||
                (language?.startsWith("en") ? "Handwriting" : "手写笔记")
              }
              aria-label={`${language?.startsWith("en") ? "Open note" : "打开笔记"}: ${(annotation.body || annotation.quote || "").slice(0, 60)}`}
            >
              <MessageSquare size={13} />
            </button>
          );
        })}
      {drawing && (
        <svg
          className="reader-ink-input"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          role="img"
          aria-label={
            language?.startsWith("en") ? "Handwriting canvas" : "手写画布"
          }
          onPointerDown={(event) => {
            if (event.button !== 0 || pointer.current !== null) return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            pointer.current = event.pointerId;
            current.current = { points: [pointFor(event)], width: 0.003 };
            setPreview({ ...current.current });
          }}
          onPointerMove={(event) => {
            if (pointer.current !== event.pointerId || !current.current) return;
            const point = pointFor(event);
            const last = current.current.points.at(-1)!;
            if (
              Math.hypot(point.x - last.x, point.y - last.y) < 0.0007 ||
              current.current.points.length >= 4000
            )
              return;
            current.current.points.push(point);
            setPreview({ ...current.current });
          }}
          onPointerUp={(event) => {
            if (pointer.current !== event.pointerId || !current.current) return;
            const stroke = current.current;
            if (stroke.points.length === 1)
              stroke.points.push({
                ...stroke.points[0],
                x: Math.min(1, stroke.points[0].x + 0.0001),
              });
            onStroke(stroke);
            current.current = null;
            pointer.current = null;
            setPreview(null);
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            current.current = null;
            pointer.current = null;
            setPreview(null);
          }}
        />
      )}
    </div>
  );
}
