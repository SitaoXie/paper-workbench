import type { Insight, Paper, ReadingVersion, Report } from './types';
const family = (language?: string) => language?.toLowerCase().split('-')[0];
function translation(values: Record<string, Insight> | undefined, language: string) {
  return Object.entries(values || {}).find(([key, value]) => family(key) === family(language) && !value.stale && value.markdown?.trim())?.[1];
}
export function excerptText(markdown: string): string {
  const text = markdown.replace(/```[^]*?```/g, '').replace(/^\s*:::figure\b.*$/gm, '').replace(/^\s*#{1,6}\s+.*$/gm, '').trim() || markdown;
  return text.split(/\n\s*\n/).find(part => part.trim())?.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').replace(/^\s*[-*>]\s?/gm, '').replace(/\s+/g, ' ').trim().slice(0, 450) || '';
}
export function paperExcerpt(paper: Paper, language: string): { text: string; language?: string; source: 'translation' | 'reading' | 'abstract' } {
  const abstracts = Object.fromEntries(Object.entries(paper.translations || {}).flatMap(([key, targets])=>targets.abstract ? [[key, targets.abstract]] : []));
  const abstract = translation(abstracts, language);
  if (abstract) return { text: excerptText(abstract.markdown), language, source: 'translation' };
  const versions: (ReadingVersion | Insight | Report)[] = paper.readingVersions?.length
    ? [...paper.readingVersions].sort((a,b)=>a.id===paper.activeReadingId ? -1 : b.id===paper.activeReadingId ? 1 : b.createdAt.localeCompare(a.createdAt))
    : [paper.summary, paper.report].filter((value): value is NonNullable<typeof value> => !!value);
  for (const version of versions) {
    const cached = translation('translations' in version ? version.translations : version === paper.summary ? Object.fromEntries(Object.entries(paper.translations || {}).flatMap(([key, targets])=>targets.summary ? [[key, targets.summary]] : [])) : Object.fromEntries(Object.entries(paper.translations || {}).flatMap(([key, targets])=>targets.report ? [[key, targets.report]] : [])), language);
    if (cached) return { text: excerptText(cached.markdown), language, source: 'reading' };
    if (family(version.language) === family(language) && version.markdown?.trim()) return { text: excerptText(version.markdown), language: version.language, source: 'reading' };
  }
  const original = paper.abstract || paper.text?.slice(0, 450) || '';
  return { text: excerptText(original), language: /[\u4e00-\u9fff]/.test(original) ? 'zh' : /[A-Za-z]/.test(original) ? 'en' : undefined, source: 'abstract' };
}
