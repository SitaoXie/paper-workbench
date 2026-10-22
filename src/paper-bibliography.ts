export type BibliographicPaper = {
  title?: string;
  authors?: readonly string[];
  publishedAt?: string;
  createdAt?: string;
  url?: string;
  pdfUrl?: string;
};

function isoDate(value: string | undefined): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return;
  const day = value.slice(0, 10), calendar = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== day) return;
  if (value.length > 10 && (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || (value[16] === ':' && Number(value.slice(17, 19)) > 59))) return;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

/** A paper's source timestamp identifies its UTC publication day, not an import day. */
export function publicationDay(value: string | undefined): string | undefined {
  return isoDate(value)?.toISOString().slice(0, 10);
}
function formattedDate(value: string | undefined, locale: string, timeZone?: string) {
  const date = isoDate(value);
  return date ? new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', ...(timeZone ? { timeZone } : {}) }).format(date) : '';
}
export function formatPublicationDate(value: string | undefined, locale = 'en'): string {
  return formattedDate(value, locale, 'UTC');
}
/** Personal activity is shown in the user's timezone; the optional zone is also useful for deterministic tests. */
export function formatActivityDate(value: string | undefined, locale = 'en', timeZone?: string): string {
  return formattedDate(value, locale, timeZone);
}
export function paperDisplayDate(paper: BibliographicPaper, locale = 'en', timeZone?: string): string {
  return formatPublicationDate(paper.publishedAt, locale) || formatActivityDate(paper.createdAt, locale, timeZone);
}

function publicUrl(value: string | undefined): URL | undefined {
  if (!value || value.length > 4096 || /[\u0000-\u0020\\]/.test(value)) return;
  try {
    const url = new URL(value), host = url.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || !host.includes('.') ||
      /(?:^|\.)(?:localhost|local|internal|test|lan|home|invalid)$/.test(host) || /^[\d.]+$/.test(host) || host.includes(':')) return;
    return url;
  } catch { return; }
}
export function arxivReference(value: string | undefined): { eprint: string; url: string } | undefined {
  const url = publicUrl(value);
  if (!url || !['arxiv.org', 'www.arxiv.org', 'export.arxiv.org'].includes(url.hostname.toLowerCase())) return;
  const path = url.pathname.replace(/^\/(?:abs|pdf|html)\//, '').replace(/\.pdf$/i, '').replace(/\/$/, '');
  if (!/^(?:\d{2}(?:0[1-9]|1[0-2])\.\d{4,5}|[a-z][a-z-]*(?:\.[a-z]{2})?\/\d{2}(?:0[1-9]|1[0-2])\d{3})(?:v[1-9]\d*)?$/i.test(path)) return;
  return { eprint: path, url: `https://arxiv.org/abs/${path}` };
}
/** Export only a stable public address. Unknown query parameters may be credentials:
 * omit the whole generic URL rather than silently exporting an altered destination.
 * A recognized arXiv identifier has a known public, query-free canonical address. */
export function bibliographySourceUrl(value: string | undefined): string | undefined {
  const arxiv = arxivReference(value);
  if (arxiv) return arxiv.url;
  const url = publicUrl(value);
  if (!url || url.search) return;
  let path: string;
  try { path = decodeURIComponent(url.pathname); } catch { return; }
  if (/(?:^|\/)(?:token|secret|session|auth|signature|password|credential)s?(?:\/|=)/i.test(path)) return;
  url.hash = '';
  return url.href.replace(/[{}\\<>"\s]/g, character => encodeURIComponent(character));
}

const clean = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
const texEscapes: Record<string, string> = {
  '\\': '\\textbackslash{}', '{': '\\textbraceleft{}', '}': '\\textbraceright{}',
  '#': '\\#', '$': '\\$', '%': '\\%', '&': '\\&', '_': '\\_',
  '^': '\\textasciicircum{}', '~': '\\textasciitilde{}',
};
/** Metadata is literal text, never trusted LaTeX. Braces use balanced macros even when the source is unbalanced. */
export function escapeBibtexText(value: string): string {
  return clean(value).replace(/[\\{}#$%&_^~]/g, character => texEscapes[character]);
}
const keyToken = (value: string, fallback: string, max = 24) => value.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z\d]/gi, '').toLowerCase().slice(0, max) || fallback;
function surname(value: string) {
  if (value.includes(',')) return value.split(',')[0];
  const parts = clean(value).split(/\s+/);
  if (/^(?:jr\.?|sr\.?|ii|iii|iv)$/i.test(parts.at(-1) || '') && parts.length > 1) parts.pop();
  return parts.at(-1) || '';
}
function titleToken(value: string) {
  const stop = new Set(['a','an','the','on','of','for','toward','towards','in','and','with','from','to','by','using']);
  return (value.match(/[\p{L}\p{N}]+/gu) || []).find(word => !stop.has(word.toLowerCase()) && keyToken(word, '').length > 1) || 'paper';
}
function shortHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
export function paperCitationKey(paper: BibliographicPaper): string {
  const author = keyToken(surname(paper.authors?.[0] || ''), 'author');
  const day = publicationDay(paper.publishedAt), year = day?.slice(0, 4) || 'nd';
  const title = keyToken(titleToken(paper.title || ''), 'paper', 20);
  const arxiv = arxivReference(paper.url) || arxivReference(paper.pdfUrl);
  const source = bibliographySourceUrl(paper.url) || bibliographySourceUrl(paper.pdfUrl);
  const identity = arxiv ? arxiv.eprint.replace(/[^a-z\d]/gi, '').toLowerCase() : shortHash(JSON.stringify([paper.authors?.map(clean) || [], clean(paper.title || ''), day || '', source || '']));
  return `${author}${year}${title}${identity}`;
}
export function paperBibtex(paper: BibliographicPaper): string {
  const fields: [string, string][] = [];
  if (paper.title?.trim()) fields.push(['title', `{${escapeBibtexText(paper.title)}}`]);
  const authors = paper.authors?.filter(name => name.trim()).map(name => {
    const literal = escapeBibtexText(name);
    // One metadata array item must remain one author, including corporate names.
    return /\band\b/i.test(name) ? `{${literal}}` : literal;
  });
  if (authors?.length) fields.push(['author', authors.join(' and ')]);
  const year = publicationDay(paper.publishedAt)?.slice(0, 4);
  if (year) fields.push(['year', year]);
  const arxiv = arxivReference(paper.url) || arxivReference(paper.pdfUrl);
  if (arxiv) fields.push(['eprint', arxiv.eprint], ['archivePrefix', 'arXiv']);
  const url = arxiv?.url || bibliographySourceUrl(paper.url) || bibliographySourceUrl(paper.pdfUrl);
  if (url) fields.push(['url', url]);
  return `@misc{${paperCitationKey(paper)},\n${fields.map(([key, value]) => `  ${key} = {${value}}`).join(',\n')}\n}`;
}
