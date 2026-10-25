import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings, normalizeProfiles } from '../server/storage.mjs';
import { callModel, generateReport, answerQuestion, translateContent, assistPassage, analyzeFigure, validateSettings } from '../server/models.mjs';
import { DEFAULT_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS } from '../shared/model-limits.mjs';

const paper = { id: 'budget-fixture', title: 'Budget fixture', abstract: 'An observed association.', authors: [], pages: [{ number: 1, text: 'The observations establish an association, not a causal effect.' }] };
const crop = { x: .1, y: .1, width: .3, height: .3 };
const image = { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6WQAAAAASUVORK5CYII=' };

test('64K is the default and maximum; explicit smaller saved profile limits survive normalization', () => {
  assert.equal(DEFAULT_OUTPUT_TOKENS, 65536);
  assert.equal(MAX_OUTPUT_TOKENS, 65536);
  assert.equal(defaultSettings.maxOutputTokens, 65536);
  const profile = { ...defaultSettings, id: 'saved', name: 'Saved', models: ['fixture'], model: 'fixture', maxOutputTokens: 8192 };
  const missing = { ...profile, id: 'missing' }; delete missing.maxOutputTokens;
  const normalized = normalizeProfiles({ profiles: [profile, missing], activeProfileId: 'saved' });
  assert.equal(normalized.maxOutputTokens, 8192);
  assert.deepEqual(normalized.profiles.map(p => p.maxOutputTokens), [8192, 65536]);
  const updated = validateSettings({ profiles: normalized.profiles.map(p => ({ ...p, maxOutputTokens: 65536 })) }, normalized);
  assert.ok(updated.profiles.every(p => p.maxOutputTokens === 65536));
  assert.throws(() => validateSettings({ maxOutputTokens: 65537 }, updated), /65,536/);
});

// Transport tests only: neither provider is contacted and the response is not
// evidence that any real model supports a 64K completion or follows the prompt.
for (const provider of ['openai', 'anthropic']) test(`${provider} forwards 64K and smaller budgets across reading, chat, translation, passage and vision`, async () => {
  for (const budget of [65536, 8192, undefined]) {
    const calls = [], settings = { ...defaultSettings, provider, apiKey: 'fixture-key', baseUrl: 'https://provider.example/v1', model: 'fixture', modelCapabilities: { fixture: 'vision' } };
    if (budget !== undefined) settings.maxOutputTokens = budget; else delete settings.maxOutputTokens;
    const fetchImpl = async (_url, options) => {
      calls.push(JSON.parse(options.body));
      const text = 'The source reports an association.';
      return new Response(JSON.stringify(provider === 'anthropic'
        ? { content: [{ type: 'text', text }], stop_reason: 'end_turn' }
        : { choices: [{ message: { content: text }, finish_reason: 'stop' }] }));
    };
    const options = { fetchImpl };
    await callModel(settings, [{ role: 'user', content: 'Explain.' }], options);
    await generateReport(paper, settings, { ...options, style: 'deep', language: 'en', adversarial: true });
    await answerQuestion([paper], 'What does the observation establish?', [], settings, options);
    await translateContent('原文报告了一种相关性。', 'en', settings, options);
    await assistPassage(paper, { kind: 'explanation', text: paper.pages[0].text, page: 1, language: 'en', sourceScope: 'pdf' }, settings, options);
    await analyzeFigure(paper, { figure: { id: 'figure-a', page: 1, crop, caption: 'A conceptual diagram.' }, image, focus: '' }, 'en', settings, options);
    assert.equal(calls.length, 8);
    assert.deepEqual(calls.map(c => c.max_tokens), Array(8).fill(budget ?? 65536));
    for (const call of calls) {
      const system = provider === 'anthropic' ? call.system : call.messages.find(m => m.role === 'system')?.content || '';
      assert.doesNotMatch(system, /\b\d[\d,]*(?:[–-]\d[\d,]*)?\s+(?:Chinese characters|English words|words)\b/i);
    }
  }
});
