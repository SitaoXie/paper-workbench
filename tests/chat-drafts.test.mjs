import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const compiled = ts.transpileModule(fs.readFileSync(new URL('../src/chat-drafts.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
let instance = 0;
async function store(storage = new Map()) {
  globalThis.sessionStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  return import('data:text/javascript;base64,' + Buffer.from(compiled + `\n// Instance ${++instance}`).toString('base64'));
}
test('draft revisions protect newer edits, preserve selected passages and isolate equal session IDs by paper', async () => {
  const memory = new Map(), s = await store(memory);
  const a = s.chatDraftKey('a', 'same'), b = s.chatDraftKey('b', 'same');
  const first = s.writeChatDraft(a, { text: 'Submitted', passage: { text: 'Source evidence', page: 4 } });
  s.writeChatDraft(b, { text: 'Other paper', passage: null });
  const edited = s.writeChatDraft(a, { text: 'New text', passage: first.passage });
  assert.equal(s.clearChatDraft(a, first.revision), false);
  assert.deepEqual(s.readChatDraft(a), edited);
  const reloaded = await store(memory);
  assert.equal(reloaded.readChatDraft(a).text, 'New text');
  assert.equal(reloaded.readChatDraft(a).passage.page, 4);
  assert.equal(reloaded.readChatDraft(b).text, 'Other paper');
  reloaded.removePaperDrafts('a');
  assert.equal(reloaded.readChatDraft(a).text, '');
  assert.equal(reloaded.readChatDraft(b).text, 'Other paper');
});
test('draft storage retains the newest 100 sessions and stays under the configured text budget', async () => {
  const memory = new Map(), s = await store(memory);
  for (let i = 0; i < 110; i++) s.writeChatDraft(s.chatDraftKey('a', String(i)), { text: 'draft ' + i, passage: null });
  const saved = JSON.parse(memory.get('pw-chat-drafts-v1'));
  assert.equal(Object.keys(saved).length, 100);
  assert.equal(s.readChatDraft(s.chatDraftKey('a', '109')).text, 'draft 109');
  assert.equal(s.readChatDraft(s.chatDraftKey('a', '0')).text, '');
  for (let i = 0; i < 10; i++) s.writeChatDraft(s.chatDraftKey('b', String(i)), { text: 'x'.repeat(90_000), passage: null });
  assert.ok(memory.get('pw-chat-drafts-v1').length < 501_000);
  assert.equal(s.readChatDraft(s.chatDraftKey('b', '9')).text.length, 90_000);
});
test('missing or blocked session storage does not prevent in-memory editing and pending session adoption', async () => {
  const s = await store();
  globalThis.sessionStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const from = s.chatDraftKey('a'), to = s.chatDraftKey('a', 'created');
  s.writeChatDraft(from, { text: 'Keep me', passage: null });
  s.adoptChatDraft(from, to);
  assert.equal(s.readChatDraft(to).text, 'Keep me');
  assert.equal(s.readChatDraft(from).text, '');
  const before = s.readChatDraft(to);
  assert.equal(s.clearChatDraft(to, before.revision), true);
  assert.equal(s.readChatDraft(to).text, '');
});

test('explicitly removed selection stays omitted through success and reload without losing another conversation context', async () => {
  const memory = new Map(), s = await store(memory), key = s.chatDraftKey('a', 'selected');
  const draft = s.writeChatDraft(key, {text:'Use the whole paper',passage:null,contextPolicy:'omit'});
  assert.equal(s.clearChatDraft(key, draft.revision), true);
  const reloaded = await store(memory);
  assert.equal(reloaded.readChatDraft(key).text, '');
  assert.equal(reloaded.readChatDraft(key).contextPolicy, 'omit');
  assert.equal(reloaded.readChatDraft(s.chatDraftKey('a','other')).contextPolicy, undefined);
  reloaded.writeChatDraft(key, {text:'New selection',passage:{page:4,text:'Another selected passage'}});
  assert.equal(reloaded.readChatDraft(key).contextPolicy, undefined);
});
