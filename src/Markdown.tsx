import { lazy, Suspense } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import remarkCjkEmphasis from "./remark-cjk-emphasis";
import "katex/dist/katex.min.css";
import { t } from "./i18n";
import type { Figure } from "./types";
const PdfFigure = lazy(() => import("./PdfFigure"));
export default function Mark({
  children,
  onPage,
  figures,
  pdfUrl,
}: {
  children: string;
  onPage?: (page: number) => void;
  figures?: Figure[];
  pdfUrl?: string;
}) {
  if (figures && pdfUrl && /^:::figure[ \t]+[\w-]+[ \t]*$/m.test(children)) {
    const parts = children.split(/^:::figure[ \t]+([\w-]+)[ \t]*$/m);
    return (
      <>
        {parts.map((part, i) => {
          if (i % 2 === 0)
            return (
              <Mark key={i} onPage={onPage}>
                {part}
              </Mark>
            );
          const figure = figures.find((f) => f.id === part);
          return figure ? (
            <Suspense key={i} fallback={<p>{t("正在加载原文图表…", "Loading source figure…")}</p>}>
              <PdfFigure
                url={pdfUrl}
                page={figure.page}
                crop={figure.crop}
                caption={figure.caption}
                onOpenPage={onPage}
              />
            </Suspense>
          ) : (
            <p key={i} className="muted-label">
              {t(`图表 ${part} 尚未附上源页。`, `Figure ${part} has no attached source page.`)}
            </p>
          );
        })}
      </>
    );
  }
  const text = onPage
    ? children.replace(
        /\[p\.(\d+)(?:\s*[-–]\s*(?:p\.)?(\d+))?\]/g,
        (_match, first, last) =>
          `[p.${first}${last ? `–${last}` : ""}](#page=${first})`,
      )
    : children;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath, remarkCjkEmphasis]}
      rehypePlugins={[rehypeKatex]}
      components={{
        img: ({ alt }) => (
          <span className="muted-label">
            [{t("图片", "Image")}: {alt || t("外部图片，未自动加载", "External image, not loaded automatically")}]
          </span>
        ),
        a: ({ children, href }) =>
          href?.startsWith("#page=") && onPage ? (
            <button
              className="citation-link"
              onClick={() => onPage(Number(href.split("=")[1]))}
            >
              {children}
            </button>
          ) : (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
