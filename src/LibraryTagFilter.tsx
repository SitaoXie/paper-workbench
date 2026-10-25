import { Tags, X } from 'lucide-react';
import { useLocale } from './i18n';
import { libraryTagCounts } from './library-tags';
import type { Paper } from './types';
import './paper-recommendations.css';

export default function LibraryTagFilter({ papers, selected, onSelect }: { papers: Paper[]; selected: string; onSelect: (tag: string) => void }) {
  const { t } = useLocale();
  const tags = libraryTagCounts(papers);
  if (!tags.length && !selected) return null;
  return <div className="library-tag-filter"><label><Tags size={15}/><span>{t('分类', 'Category')}</span><select aria-label={t('按分类筛选论文', 'Filter papers by category')} value={selected} onChange={event => onSelect(event.target.value)}>
    <option value="">{t('全部分类', 'All categories')} · {papers.length}</option>
    {selected && !tags.some(item => item.tag === selected) && <option value={selected}>{selected} · 0</option>}
    {tags.map(({ tag, count }) => <option value={tag} key={tag}>{tag} · {count}</option>)}
  </select></label>{selected && <button type="button" className="text-button" onClick={() => onSelect('')}><X size={13}/>{t('清除筛选', 'Clear filter')}</button>}</div>;
}
