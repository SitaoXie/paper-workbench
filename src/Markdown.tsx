import remarkPageCitations from "./remark-page-citations";
import { paperCitation } from "./paper-citation";
import { createElement, lazy, Suspense, useMemo, type HTMLAttributes } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import { readingSectionId, type ReadingSection } from "./reading-sections";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import remarkCjkEmphasis from "./remark-cjk-emphasis";
import "katex/dist/katex.min.css";
import { t } from "./i18n";
import type { Figure } from "./types";
import { figureCaption, type FigureCaptionPresentation } from "./figure-captions";
import { readingFigureSlots } from "./reading-figures";
const PdfFigure = lazy(() => import("./PdfFigure"));
export default function Mark({
  children,
  onPage,
  onSource,
  figures,
  pdfUrl,
  figureCaptions,
  captionLanguage,
  sectionNavigation,
  sourceOffset = 0,
}: {
  children: string;
  onPage?: (page: number, quote?: string) => void;
  onSource?: (source:'abstract'|'text') => void;
  figures?: Figure[];
  pdfUrl?: string;
  sectionNavigation?: { readingId: string; sections: ReadingSection[]; href: (index: number) => string; onNavigate: (index: number) => void };
  sourceOffset?: number;
} & FigureCaptionPresentation) {
  const headings = useMemo(() => {
    const headings: Components = {};
    if (sectionNavigation) for (let depth = 1; depth <= 6; depth++) {
      const tag = `h${depth}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      headings[tag] = ({ node, children: content }: HTMLAttributes<HTMLHeadingElement> & ExtraProps) => {
        const offset = node?.position?.start.offset;
        const section = offset === undefined ? undefined : sectionNavigation.sections.find(item => item.offset === sourceOffset + offset);
        if (!section) return createElement(tag, {}, content);
        return createElement(tag, { id: readingSectionId(sectionNavigation.readingId, section.index), 'data-reading-section': section.index, 'aria-label': section.title }, content,
          <a className="reading-heading-link" href={sectionNavigation.href(section.index)} aria-label={t(`链接到章节：${section.title}`, `Link to section: ${section.title}`)} title={t("链接到本节", "Link to this section")} onClick={event => { event.preventDefault(); sectionNavigation.onNavigate(section.index); }}>#</a>);
      };
    }
    return headings;
  }, [sectionNavigation, sourceOffset]);
  const figureSlots = useMemo(() => figures && pdfUrl ? readingFigureSlots(children) : [], [children, !!figures, pdfUrl]);
  if (figures && pdfUrl && figureSlots.length) {
    const parts: { text: string; start: number; figure?: string }[] = [];
    let cursor = 0;
    for (const match of figureSlots) {
      parts.push({ text: children.slice(cursor, match.start), start: cursor });
      parts.push({ text: "", start: match.start, figure: match.id });
      cursor = match.end;
    }
    parts.push({ text: children.slice(cursor), start: cursor });
    return (
      <>
        {parts.map((part, i) => {
          if (!part.figure)
            return (
              <Mark key={i} onPage={onPage} onSource={onSource} sectionNavigation={sectionNavigation} sourceOffset={sourceOffset + part.start}>
                {part.text}
              </Mark>
            );
          const figure = figures.find((f) => f.id === part.figure);
          return figure ? (
            <Suspense key={i} fallback={<p>{t("正在加载原文图表…", "Loading source figure…")}</p>}>
              <PdfFigure
                url={pdfUrl}
                page={figure.page}
                crop={figure.crop}
                {...figureCaption(figure, { figureCaptions, captionLanguage })}
                onOpenPage={onPage}
              />
            </Suspense>
          ) : (
            <p key={i} className="muted-label">
              {t(`图表 ${part.figure} 尚未附上源页。`, `Figure ${part.figure} has no attached source page.`)}
            </p>
          );
        })}
      </>
    );
  }
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath, remarkCjkEmphasis, ...(onPage || onSource ? [remarkPageCitations] : [])]}
      rehypePlugins={[rehypeKatex]}
      components={{
        ...headings,
        img: ({ alt }) => (
          <span className="muted-label">
            [{t("图片", "Image")}: {alt || t("外部图片，未自动加载", "External image, not loaded automatically")}]
          </span>
        ),
        a: ({ children, href, title }) => {
          const source=href==='#source=abstract'?'abstract':href==='#source=text'?'text':undefined;
          if(source)return onSource?<button className="citation-link" title={source==='abstract'?t('查看原始摘要','View original abstract'):t('查看来源正文','View source text')} onClick={()=>onSource(source)}>{source==='abstract'?t('原始摘要','Abstract'):t('来源正文','Source text')}</button>:<span>{children}</span>;
          const citation = paperCitation(href, title);
          return citation && onPage ? (
            <button
              className="citation-link"
              title={citation.quote ? t(`定位原文 · p.${citation.page}`, `Locate source passage · p.${citation.page}`) : undefined}
              onClick={() => onPage(citation.page, citation.quote)}
            >
              {children}
              {citation.quote && typeof children === "string" && !/^p\./i.test(children) && <small> · p.{citation.page}</small>}
            </button>
          ) : (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          );
        },
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
