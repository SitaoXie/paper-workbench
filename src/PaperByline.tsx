import { t } from './i18n';

export default function PaperByline({ authors = [], institutions = [] }: { authors?: string[]; institutions?: string[] }) {
  return <dl className="paper-byline" aria-label={t('作者与研究机构', 'Authors and institutions')}>
    <div>
      <dt>{t('作者', 'Authors')}</dt>
      <dd>
        {authors.length ? <span>{authors.slice(0, 6).join(' · ')}</span> : <span className="byline-missing">{t('作者信息未收录', 'Author information unavailable')}</span>}
        {authors.length > 6 && <details className="byline-more">
          <summary>{t(`展开其余 ${authors.length - 6} 位作者`, `Show ${authors.length - 6} more authors`)}</summary>
          <p>{authors.slice(6).join(' · ')}</p>
        </details>}
      </dd>
    </div>
    <div>
      <dt>{t('研究机构', 'Institutions')}</dt>
      <dd>{institutions.length ? institutions.join(' · ') : <span className="byline-missing">{t('机构信息未收录', 'Institution information unavailable')}</span>}</dd>
    </div>
  </dl>;
}
