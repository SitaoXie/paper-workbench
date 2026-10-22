/** Tab-local, bounded draft text and explicit user-selected passages. Never stores model configuration. */
export type DraftPassage = { text: string; page?: number; pages?: number[]; sourceLabel?: string; sourceScope?: 'pdf' | 'source-text' | 'reading' | 'abstract'; readingId?: string };
export type ChatDraft = { text: string; passage: DraftPassage | null; revision: number; updatedAt: number; contextPolicy?: "omit"; verbatim?: boolean };
const storageKey = 'pw-chat-drafts-v1';
const maxEntries = 100;
const maxCharacters = 500_000; // At most about 1 MB of UTF-16 text per tab.
let entries: Record<string, ChatDraft> | undefined;
let revision = Date.now();
export const chatDraftKey = (paperId?: string, conversationId?: string) => JSON.stringify([paperId || null, conversationId || null]);
function valid(value: unknown): value is ChatDraft {
  if (!value || typeof value !== 'object') return false;
  const d = value as ChatDraft;
  return (d.verbatim === undefined || typeof d.verbatim === 'boolean') && (d.contextPolicy === undefined || d.contextPolicy === 'omit') && typeof d.text === 'string' && d.text.length <= maxCharacters && Number.isFinite(d.revision) && Number.isFinite(d.updatedAt) &&
    (d.passage === null || (!!d.passage && typeof d.passage.text === 'string' && d.passage.text.length <= maxCharacters &&
      (d.passage.page === undefined || (Number.isInteger(d.passage.page) && d.passage.page > 0)) &&
      (d.passage.sourceScope === undefined || ['pdf','source-text','reading','abstract'].includes(d.passage.sourceScope)) &&
      (d.passage.readingId === undefined || (typeof d.passage.readingId === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(d.passage.readingId) && d.passage.sourceScope === 'reading')) &&
      (d.passage.pages === undefined || (Array.isArray(d.passage.pages) && d.passage.pages.length > 0 && d.passage.pages.length <= 20 && d.passage.pages.every((page,index,pages) => Number.isSafeInteger(page) && page > 0 && (!index || page > pages[index-1])) && d.passage.page === d.passage.pages[0])) &&
      (d.passage.sourceLabel === undefined || typeof d.passage.sourceLabel === 'string')));
}
function all() {
  if (entries) return entries;
  entries = Object.create(null) as Record<string, ChatDraft>;
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw || raw.length > maxCharacters + 100_000) return entries;
    const saved = JSON.parse(raw);
    for (const [key, value] of Object.entries(saved)) {
      const parts = JSON.parse(key);
      if (Array.isArray(parts) && parts.length === 2 && parts.every(part => part === null || typeof part === 'string') && valid(value)) {
        entries[key] = value;
        revision = Math.max(revision, value.revision);
      }
    }
  } catch { /* Storage restrictions or an obsolete value must not block editing. */ }
  return entries;
}
function persist() {
  const drafts = all();
  let size = 0;
  Object.entries(drafts).sort((a, b) => b[1].revision - a[1].revision).forEach(([key, draft], index) => {
    size += JSON.stringify(draft).length + key.length;
    if (index >= maxEntries || size > maxCharacters) delete drafts[key];
  });
  try { sessionStorage.setItem(storageKey, JSON.stringify(drafts)); } catch { /* Memory remains usable when session storage is full or unavailable. */ }
}
export function readChatDraft(key: string): ChatDraft {
  return all()[key] || { text: '', passage: null, revision: 0, updatedAt: 0 };
}
export function writeChatDraft(key: string, value: Pick<ChatDraft, 'text' | 'passage' | 'contextPolicy' | 'verbatim'>): ChatDraft {
  const next = { ...value, revision: ++revision, updatedAt: Date.now() };
  if (next.text || next.passage || next.contextPolicy) all()[key] = next;
  else delete all()[key];
  persist();
  return next;
}
export function clearChatDraft(key: string, expectedRevision: number): boolean {
  if (readChatDraft(key).revision !== expectedRevision) return false;
  if (readChatDraft(key).contextPolicy === "omit") writeChatDraft(key, {text:"",passage:null,contextPolicy:"omit"});
  else { delete all()[key]; persist(); }
  return true;
}
export function adoptChatDraft(from: string, to: string) {
  const source = readChatDraft(from), target = readChatDraft(to);
  if (from !== to && (source.text || source.passage || source.contextPolicy) && !target.text && !target.passage && !target.contextPolicy) {
    all()[to] = source; delete all()[from]; persist();
  }
}
export function removePaperDrafts(paperId: string) {
  for (const key of Object.keys(all())) if (JSON.parse(key)[0] === paperId) delete all()[key];
  persist();
}
