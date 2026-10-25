import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyVisualHistoryPrefix as marker, cleanAssistantContent, presentChatMessage, createAnswerEventFilter } from '../server/answer-presentation.mjs';
import { prepareConversationHistory } from '../server/conversation-context.mjs';
import { answerQuestion } from '../server/models.mjs';
import { defaultSettings } from '../server/storage.mjs';

test('only the exact leaked leading annotation is removed; user text and legitimate caveats survive', () => {
  const answer = '没有当前图片证据，暂时不能核实颜色。';
  assert.equal(cleanAssistantContent(` \n${marker}\n${marker} ${answer}`), answer);
  for (const text of [answer, `[Evidence unavailable] ${answer}`, `引用：${marker}`, `> ${marker}`, `\`\`\`\n${marker}\n\`\`\``])
    assert.equal(cleanAssistantContent(text), text);
  const user = { role: 'user', content: marker };
  assert.equal(presentChatMessage(user), user);
  const original = { role: 'assistant', content: `${marker}\n${answer}`, source: { toolImageCount: 1 } };
  assert.equal(presentChatMessage(original).content, answer);
  assert.equal(original.content, `${marker}\n${answer}`);
  const history = prepareConversationHistory([user, original]);
  assert.equal(history.messages[1].content, answer);
  assert.match(history.notice, /not automatically replayed/);
});

test('streaming suppresses repeated annotations across every split point without flashing partial prefixes', () => {
  const prefix = ` \n${marker}\n${marker} `;
  for (let split = 0; split <= prefix.length; split++) {
    const events = [];
    const filter = createAnswerEventFilter(e => events.push(e));
    filter.push({ type: 'round', round: 1 });
    filter.push({ type: 'text', round: 1, delta: prefix.slice(0, split) });
    assert.equal(events.filter(e => e.type === 'text').length, 0);
    filter.push({ type: 'text', round: 1, delta: prefix.slice(split) + '回答' });
    filter.push({ type: 'text', round: 1, delta: `里的引用：${marker}` });
    filter.finish();
    assert.equal(events.filter(e => e.type === 'text').map(e => e.delta).join(''), `回答里的引用：${marker}`);
  }
});

test('stream prefix detection resets between tool rounds and does not discard unrelated partial text', () => {
  const events = [], filter = createAnswerEventFilter(e => events.push(e));
  filter.push({ type: 'round', round: 1 });
  filter.push({ type: 'text', round: 1, delta: '[Earlier' });
  filter.push({ type: 'tool', tool: 'read_pages', ok: true });
  filter.push({ type: 'round', round: 2 });
  for (const delta of marker + '结论') filter.push({ type: 'text', round: 2, delta });
  filter.finish();
  assert.equal(events.filter(e => e.type === 'text' && e.round === 1).map(e => e.delta).join(''), '[Earlier');
  assert.equal(events.filter(e => e.type === 'text' && e.round === 2).map(e => e.delta).join(''), '结论');
  assert.ok(events.some(e => e.type === 'tool'));
});

test('question payload keeps visual guidance in system context; echoed annotations are absent from streamed and final answers', async () => {
  const events = [];
  const history = [{ role: 'user', content: '解释图' }, { role: 'assistant', content: `${marker}\n旧回答`, source: { toolImageCount: 1 } }];
  const result = await answerQuestion([], '接着说', history, { ...defaultSettings, apiKey: 'fixture' }, {
    onEvent: e => events.push(e),
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.messages.find(m => m.role === 'assistant').content, '旧回答');
      assert.ok(body.messages.some(m => m.role === 'system' && m.content.includes('not automatically replayed')));
      return new Response(JSON.stringify({ choices: [{ message: { content: marker + marker + '证据不足，需要重新查看图片。' } }] }));
    },
  });
  assert.equal(result.content, '证据不足，需要重新查看图片。');
  assert.equal(events.filter(e => e.type === 'text').map(e => e.delta).join(''), result.content);
});
