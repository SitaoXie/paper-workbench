import type { Paper } from './types';

/** Tags are user/source data: preserve spelling and never translate them. */
export function libraryTagCounts(papers: Pick<Paper, 'tags'>[]) {
  const counts = new Map<string, number>();
  for (const paper of papers) for (const tag of new Set(paper.tags || [])) counts.set(tag, (counts.get(tag) || 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag, 'zh-CN'));
}
export function filterLibraryTag<T extends Pick<Paper, 'tags'>>(papers: T[], tag: string): T[] {
  return tag ? papers.filter(paper => paper.tags?.includes(tag)) : papers;
}
