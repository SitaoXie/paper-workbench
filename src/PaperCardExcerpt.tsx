import type { Paper } from './types';
import { paperExcerpt } from './paper-excerpt';
export default function PaperCardExcerpt({ paper, language }: { paper: Paper; language: string }) {
  const excerpt = paperExcerpt(paper, language);
  return <p lang={excerpt.language} data-excerpt-source={excerpt.source}>{excerpt.text}</p>;
}
