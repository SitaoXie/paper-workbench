import type { Figure } from "./types";

export type FigureCaptionPresentation = {
  figureCaptions?: Record<string, string>;
  /** Present when captions should follow a reading language. Missing entries
   * are explicitly identified as original captions, never silently relabeled. */
  captionLanguage?: string;
};

export function figureCaption(figure: Figure, { figureCaptions, captionLanguage }: FigureCaptionPresentation = {}) {
  const translated = figureCaptions?.[figure.id]?.trim();
  return {
    caption: translated || figure.caption,
    captionIsOriginal: !!captionLanguage && !!figure.caption?.trim() && !translated,
    captionLanguage: translated ? captionLanguage : undefined,
  };
}

export function missingFigureCaptions(figures: Figure[], captions?: Record<string, string>) {
  return figures.filter(figure => figure.caption?.trim() && !captions?.[figure.id]?.trim());
}
