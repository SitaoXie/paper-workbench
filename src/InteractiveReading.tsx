import { lazy, Suspense } from "react";
import { BookOpen, Lightbulb, Sparkles } from "lucide-react";
import type { Figure, InteractiveCitation, InteractiveData } from "./types";
import { figureCaption, type FigureCaptionPresentation } from "./figure-captions";
import "./interactive-reading.css";
import { displayCitationLabel } from "./citation-label";

const PdfFigure = lazy(() => import("./PdfFigure"));
export type InteractiveReadingProps = FigureCaptionPresentation & {
  interactive: InteractiveData;
  figures?: Figure[];
  pdfUrl?: string;
  onPage?: (page: number) => void;
  language?: string;
};
export function InteractiveCitations({ citations, onPage, language = "en" }: { citations: InteractiveCitation[]; onPage?: (page: number) => void; language?: string }) {
  const chinese = language.startsWith("zh");
  return <div className="interactive-citations" aria-label={chinese ? "原文证据" : "Source evidence"}>
    {citations.length ? citations.map((citation, index) => citation.page ? <button key={index} className="citation-link" disabled={!onPage} onClick={() => onPage?.(citation.page!)}>{citation.label ? `${displayCitationLabel(citation.label, language)} · ` : ""}p.{citation.page}</button> : <span key={index}>{displayCitationLabel(citation.label, language) || (chinese ? "来源正文" : "Source text")}</span>) : <span>{chinese ? "来源正文" : "Source text"}</span>}
  </div>;
}
/** A controlled, keyboard-accessible view of the selected immutable reading.
 * Source strings remain text nodes; no model-provided HTML or code is executed. */
export default function InteractiveReading({ interactive, figures = [], pdfUrl, onPage, language = "en", figureCaptions, captionLanguage }: InteractiveReadingProps) {
  const chinese = language.startsWith("zh");
  if (interactive.schemaVersion !== 1 || !Array.isArray(interactive.blocks)) return <p role="alert">{chinese ? "此交互解读格式暂不支持，请查看文章版本。" : "This interactive format is unsupported. Open the article view."}</p>;
  return <div className="interactive-reading" data-testid="interactive-reading" lang={language}>
    <p className="interactive-intro"><BookOpen size={15} />{chinese ? "逐个探索概念、核对图表，再用问题检验理解。" : "Explore the concepts, examine the figures, then check your understanding."}</p>
    {interactive.blocks.map(block => {
      if (block.type === "concept") return <section className="interactive-concept" key={block.id} id={`interactive-${block.id}`}>
        <details open><summary><Lightbulb size={17} /><span>{block.title}</span></summary><p className="interactive-text">{block.text}</p><InteractiveCitations citations={block.citations} onPage={onPage} language={language} /></details>
      </section>;
      if (block.type === "question") return <section className="interactive-question" key={block.id} id={`interactive-${block.id}`}>
        <span className="interactive-kicker"><Sparkles size={15} />{chinese ? "检验理解" : "Check your understanding"}</span>
        <h3>{block.question}</h3><details><summary>{chinese ? "查看参考答案与证据" : "Reveal the answer and evidence"}</summary><p className="interactive-text">{block.answer}</p>{block.explanation && <p className="interactive-answer-explanation">{block.explanation}</p>}<InteractiveCitations citations={block.citations} onPage={onPage} language={language} /></details>
      </section>;
      const figure = figures.find(item => item.id === block.figureId);
      return <section className="interactive-figure" key={block.id} id={`interactive-${block.id}`}>
        {figure?.crop && pdfUrl ? <Suspense fallback={<p>{chinese ? "正在加载原图…" : "Loading source figure…"}</p>}><PdfFigure url={pdfUrl} page={figure.page} crop={figure.crop} {...figureCaption(figure, { figureCaptions, captionLanguage })} onOpenPage={onPage} /></Suspense> : <p className="interactive-source-missing">{chinese ? "此图表的已验证裁切暂不可用，请查看引用的原文页。" : "The verified crop is unavailable. Refer to the cited source page."}</p>}
        <p className="interactive-text">{block.explanation}</p><InteractiveCitations citations={block.citations} onPage={onPage} language={language} />
      </section>;
    })}
  </div>;
}
