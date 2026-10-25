import CitationLink from "./CitationLink";
import remarkPageCitations from "./remark-page-citations";
import { paperCitation } from "./paper-citation";
import { Children, isValidElement, createElement, lazy, Suspense, useMemo, type HTMLAttributes } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import { readingSectionId, type ReadingSection } from "./reading-sections";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import remarkCjkEmphasis from "./remark-cjk-emphasis";
import "katex/dist/katex.min.css";
import "./markdown-table.css";
import { t } from "./i18n";
import type { Figure } from "./types";
import { figureCaption, type FigureCaptionPresentation } from "./figure-captions";
import { readingFigureSlots } from "./reading-figures";
import RecoverableFeature from "./RecoverableFeature";
const ReadingVisual = lazy(() => import("./ReadingVisual"));
const PdfFigure = lazy(() => import("./PdfFigure"));
// Keep the renderer identity stable so unrelated updates do not replace a
// selected table's DOM nodes or discard its horizontal reading position.
function MarkdownTable({ node: _node, ...props }: HTMLAttributes<HTMLTableElement> & ExtraProps) {
  return <div className="markdown-table-scroll" role="region" aria-label={t("数据表格，可横向滚动", "Data table, horizontally scrollable")} tabIndex={0}>
    <table {...props} className={["markdown-table", props.className].filter(Boolean).join(" ")} />
  </div>;
}
// ReactMarkdown uses these functions as component types. Declaring `pre` inside
// Mark remounts every diagram on parent updates, collapsing message height and
// feeding a scroll/resize loop when the reader reaches the bottom.
function MarkdownPre({children}: HTMLAttributes<HTMLPreElement> & ExtraProps) {
  const code=Children.toArray(children)[0];
  if(isValidElement<{className?:string;children?:string}>(code)) {
    const kind=code.props.className==='language-mermaid'?'mermaid':code.props.className==='language-chart'?'chart':undefined;
    if(kind && typeof code.props.children==='string')return <RecoverableFeature feature="visual"><Suspense fallback={<p>{t('正在准备图形…','Preparing visual…')}</p>}><ReadingVisual kind={kind} source={code.props.children}/></Suspense></RecoverableFeature>;
  }
  return <pre>{children}</pre>;
}
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
            <RecoverableFeature key={`${i}:${pdfUrl}`} feature="figure" onExit={onPage ? () => onPage(figure.page) : undefined}><Suspense fallback={<p>{t("正在加载原文图表…", "Loading source figure…")}</p>}>
              <PdfFigure
                url={pdfUrl}
                page={figure.page}
                crop={figure.crop}
                {...figureCaption(figure, { figureCaptions, captionLanguage })}
                onOpenPage={onPage}
              />
            </Suspense>
            </RecoverableFeature>
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
        table: MarkdownTable,
        pre: MarkdownPre,
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
            <CitationLink page={citation.page} quote={citation.quote} onPage={onPage}>{children}</CitationLink>
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
