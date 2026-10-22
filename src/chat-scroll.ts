/** Tab-local reading geometry only: no messages, quotes, API configuration or model output. */
export type ChatScrollPosition = {
  top: number;
  anchor?: { key: string; fraction: number };
  following: boolean;
  unread: boolean;
  tail: string;
  count: number;
  updatedAt: number;
};
const storageKey = 'pw-chat-scroll-v1';
const maxEntries = 100;
const entries = new Map<string, ChatScrollPosition>();
let loaded = false;
function valid(value: unknown): value is ChatScrollPosition {
  if (!value || typeof value !== 'object') return false;
  const p = value as ChatScrollPosition;
  return Number.isFinite(p.top) && p.top >= 0 && p.top <= 100_000_000 &&
    typeof p.following === 'boolean' && typeof p.unread === 'boolean' &&
    typeof p.tail === 'string' && p.tail.length <= 100 && Number.isSafeInteger(p.count) && p.count >= 0 && p.count <= 100_000 &&
    Number.isFinite(p.updatedAt) && (!p.anchor || (typeof p.anchor.key === 'string' && p.anchor.key.length <= 100 &&
      Number.isFinite(p.anchor.fraction) && p.anchor.fraction >= -1 && p.anchor.fraction <= 1));
}
function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw || raw.length > 100_000) return;
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved)) return;
    for (const item of saved.slice(-maxEntries)) {
      if (Array.isArray(item) && typeof item[0] === 'string' && item[0].length <= 1024 && valid(item[1])) entries.set(item[0], item[1]);
    }
  } catch { /* Blocked or obsolete storage never prevents reading. */ }
}
function persist() {
  while (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
  try { sessionStorage.setItem(storageKey, JSON.stringify([...entries])); } catch { /* In-memory positions still work. */ }
}
export function readChatScroll(key: string) { load(); return entries.get(key); }
export function saveChatScroll(key: string, value: ChatScrollPosition) {
  load();
  if (key.length > 1024 || !valid(value)) return;
  entries.delete(key); entries.set(key, value); persist();
}
export function adoptChatScroll(from: string, to: string) {
  load();
  if (from === to || !entries.has(from)) return;
  if (!entries.has(to)) entries.set(to, entries.get(from)!);
  entries.delete(from); persist();
}
export function removePaperChatScroll(paperId: string) {
  load();
  for (const key of entries.keys()) {
    try { if (JSON.parse(key)[0] === paperId) entries.delete(key); } catch { /* Ignore unrelated keys. */ }
  }
  persist();
}
/** A compact non-content anchor, including index for repeated identical messages. */
export function chatMessageAnchor(message: { id?: string; role: string; content: string }, index: number) {
  const source = message.id || `${message.role}\n${message.content}`;
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
  return `${index}-${(hash >>> 0).toString(36)}`;
}
export const nearChatBottom = (top: number, height: number, viewport: number) => height - viewport - Math.max(0, top) <= 64;
