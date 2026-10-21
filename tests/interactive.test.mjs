import test from 'node:test';
import assert from 'node:assert/strict';
import { validateInteractive, validateInteractiveTranslation, generateInteractiveReading, translateInteractiveReading } from '../server/interactive.mjs';
const figures = [{ id: 'figure-real', page: 2, crop: { x: .1, y: .1, width: .7, height: .4 }, caption: 'Measured outcomes' }];
const options = { pageCount: 4, figures };
const data = { schemaVersion: 1, blocks: [
  { id: 'concept-one', type: 'concept', title: 'Coverage', text: 'Repeated trials measure coverage.', citations: [{ page: 1 }] },
  { id: 'figure-one', type: 'figure', figureId: 'figure-real', explanation: 'The source reports uncertainty.', citations: [{ page: 2 }] },
  { id: 'question-one', type: 'question', question: 'Does this prove generalization?', answer: 'No.', explanation: 'The experiment has a limited scope.', citations: [{ page: 3 }] },
] };
const chineseData = () => {
  const translated = structuredClone(data);
  Object.assign(translated.blocks[0], { title: '覆盖率', text: '重复试验测量覆盖率，结果只适用于已经测量的样本，不能据此推断所有可能情况。' });
  translated.blocks[1].explanation = '来源报告了测量结果的不确定性，阅读时应检查误差范围和实验条件。';
  Object.assign(translated.blocks[2], { question: '这能证明普遍泛化能力吗？', answer: '不能。', explanation: '实验范围有限，结论应限定在实际观察到的条件之内。' });
  return translated;
};
const mapping = value => value.blocks.map(block => ({ id: block.id, fields: ['title', 'text', 'explanation', 'question', 'answer']
  .filter(name => Object.hasOwn(block, name)).map(name => ({ name, value: block[name] })) }));
test('interactive schema retains evidence and rejects executable slots and out-of-source references', () => {
  assert.deepEqual(validateInteractive(data, options), data);
  for (const mutate of [
    x => x.script = 'alert(1)',
    x => x.blocks[0].html = '<img onerror=alert(1)>',
    x => x.blocks[0].citations = [{ page: 5 }],
    x => x.blocks[0].citations = [{ label: 'Not a source page' }],
    x => x.blocks[0].citations = [],
    x => x.blocks[1].figureId = 'invented-figure',
    x => x.blocks[1].citations = [{ page: 1 }],
    x => x.blocks[2].id = 'concept-one',
  ]) {
    const invalid = structuredClone(data); mutate(invalid);
    assert.throws(() => validateInteractive(invalid, options));
  }
  assert.throws(() => validateInteractive(data, { ...options, figures: [{ ...figures[0], crop: { x: .8, y: .1, width: .7, height: .4 } }] }));
  assert.throws(() => validateInteractive(data, { ...options, figures: [{ ...figures[0], crop: undefined }] }));
});
test('web-only readings cite source labels without inventing PDF pages', () => {
  const web = { schemaVersion: 1, blocks: [{ ...data.blocks[0], citations: [{ label: 'Source text' }] }] };
  assert.deepEqual(validateInteractive(web, { pageCount: 0 }), web);
  web.blocks[0].citations = [];
  assert.deepEqual(validateInteractive(web, { pageCount: 0 }), web);
  web.blocks[0].citations = [{ page: 1 }];
  assert.throws(() => validateInteractive(web, { pageCount: 0 }));
});
test('translation changes display language while preserving exact source bindings', async () => {
  const translated = chineseData();
  assert.deepEqual(validateInteractiveTranslation(translated, data, options), translated);
  assert.deepEqual(await translateInteractiveReading({ ...options, interactive: data, language: 'zh-CN', callModel: async () => JSON.stringify(mapping(translated)) }), translated);
  for (const mutate of [x => x.blocks[0].id = 'new-id', x => x.blocks[0].citations = [{ page: 2 }], x => delete x.blocks[2].explanation, x => x.blocks.reverse()]) {
    const invalid = structuredClone(translated); mutate(invalid);
    assert.throws(() => validateInteractiveTranslation(invalid, data, options));
    await assert.rejects(() => translateInteractiveReading({ ...options, interactive: data, language: 'zh-CN', callModel: async () => JSON.stringify(invalid) }), error => error.status === 502);
  }
});
test('generation validates model JSON and cannot silently accept incomplete output', async () => {
  let prompt = '';
  const generated = await generateInteractiveReading({ ...options, markdown: 'Coverage was measured. [p.1]', style: 'quick', language: 'en', callModel: async value => { prompt = value; return JSON.stringify(data); } });
  assert.deepEqual(generated, data);
  assert.match(prompt, /untrusted evidence/);
  assert.match(prompt, /figure-real/);
  await assert.rejects(() => generateInteractiveReading({ ...options, markdown: 'Source', callModel: async () => '{"schemaVersion":1' }), error => error.status === 502);
  await assert.rejects(() => generateInteractiveReading({ ...options, markdown: 'Source', callModel: async () => JSON.stringify({ schemaVersion: 1, blocks: [] }) }), error => error.status === 502);
});

test('generation repairs invalid JSON or an unsupported figure title once using the original evidence constraints', async () => {
  const withTitle = structuredClone(data); withTitle.blocks[1].title = 'An unsupported figure title';
  for (const invalid of ['{"schemaVersion":1', JSON.stringify(withTitle)]) {
    const prompts = [];
    const result = await generateInteractiveReading({ ...options, markdown: 'Coverage is limited to four source pages. [p.1]', language: 'en', callModel: async prompt => {
      prompts.push(prompt); return prompts.length === 1 ? invalid : JSON.stringify(data);
    } });
    assert.deepEqual(result, data);
    assert.equal(prompts.length, 2);
    assert.match(prompts[1], /only repair attempt/);
    assert.match(prompts[1], /validationError/);
    assert.match(prompts[1], /figure-real/);
    assert.match(prompts[1], /Coverage is limited to four source pages/);
    assert.match(prompts[1], /NO title/);
    assert.ok(prompts[1].includes(JSON.stringify(invalid)));
  }
});

test('failed generation repair never relaxes executable fields or source bindings and stops after two calls', async () => {
  for (const mutate of [x => x.blocks[1].script = 'run()', x => x.blocks[1].figureId = 'invented-figure', x => x.blocks[0].citations = [{ page: 99 }]]) {
    const invalid = structuredClone(data); mutate(invalid);
    let calls = 0;
    await assert.rejects(() => generateInteractiveReading({ ...options, markdown: 'Source evidence.', callModel: async () => {
      calls++; return JSON.stringify(invalid);
    } }), error => error.status === 502 && /after one repair attempt/.test(error.message));
    assert.equal(calls, 2);
  }
});

test('translation uses one mapping-only repair and never asks the model to reproduce source bindings', async () => {
  const translated = chineseData();
  const changed = mapping(translated); changed[0].citations = [{ page: 2 }];
  for (const first of ['not JSON', JSON.stringify(changed)]) {
    const prompts = [];
    const result = await translateInteractiveReading({ ...options, interactive: data, language: 'zh-CN', callModel: async prompt => {
      prompts.push(prompt); return prompts.length === 1 ? first : JSON.stringify(mapping(translated));
    } });
    assert.deepEqual(result, translated);
    assert.equal(prompts.length, 2);
    assert.match(prompts[1], /ORIGINAL input/);
    assert.match(prompts[1], /EXACTLY unchanged/);
    assert.ok(prompts[1].includes(JSON.stringify(mapping(data))));
    assert.ok(!prompts[1].includes('"schemaVersion":1'));
    assert.ok(!prompts[0].includes('figure-real'));
    assert.match(prompts[1], /Repair the previous interactive translation mapping/);
  }
  let calls = 0;
  await assert.rejects(() => translateInteractiveReading({ ...options, interactive: data, language: 'zh-CN', callModel: async () => {
    calls++; return JSON.stringify(changed);
  } }), error => error.status === 502 && /after one repair attempt/.test(error.message));
  assert.equal(calls, 2);
});

test('schema repair does not turn provider failures into automatic provider retries', async () => {
  let calls = 0;
  await assert.rejects(() => generateInteractiveReading({ ...options, markdown: 'Source', callModel: async () => {
    calls++; throw new Error('Provider unavailable');
  } }), /Provider unavailable/);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(() => translateInteractiveReading({ ...options, interactive: data, language: 'zh-CN', callModel: async () => {
    calls++; if (calls === 1) return '{'; throw new Error('Provider unavailable');
  } }), /Provider unavailable/);
  assert.equal(calls, 2);
});

test('en/zh display-language mismatches get one repair and unchanged Chinese cannot be accepted as English', async () => {
  for (const [original, translated, language] of [[chineseData(), data, 'en'], [data, chineseData(), 'zh-CN']]) {
    const prompts = [];
    const result = await translateInteractiveReading({ ...options, interactive: original, language, callModel: async prompt => {
      prompts.push(prompt); return JSON.stringify(mapping(prompts.length === 1 ? original : translated));
    } });
    assert.deepEqual(result, translated);
    assert.equal(prompts.length, 2);
    assert.match(prompts[0], /TRANSLATABLE DISPLAY TEXT/);
    assert.match(prompts[1], /untranslated|does not appear to be translated/);
    let calls = 0;
    await assert.rejects(() => translateInteractiveReading({ ...options, interactive: original, language, callModel: async () => {
      calls++; return JSON.stringify(mapping(original));
    } }), error => error.status === 502 && /after one repair attempt/.test(error.message));
    assert.equal(calls, 2);
  }
});

test('display-only translation preserves source bindings and order even when mapping entries are reordered', async () => {
  const original = structuredClone(data);
  const translated = chineseData();
  const output = mapping(translated).reverse();
  output.forEach(entry => entry.fields.reverse());
  const result = await translateInteractiveReading({ ...options, interactive: original, language: 'zh-CN', callModel: async () => JSON.stringify(output) });
  assert.deepEqual(result, translated);
  assert.deepEqual(original, data, 'Translation cannot mutate original application data');
  assert.deepEqual(result.blocks.map(({ id, type, citations, figureId }) => ({ id, type, citations, figureId })), data.blocks.map(({ id, type, citations, figureId }) => ({ id, type, citations, figureId })));
});

test('display mapping rejects unknown, missing, duplicate and non-text fields without weakening validation', async () => {
  for (const mutate of [
    x => x.push(x[0]),
    x => x[1].id = x[0].id,
    x => x[0].id = 'unknown',
    x => x.pop(),
    x => x[0].fields.pop(),
    x => x[0].fields[1] = x[0].fields[0],
    x => x[0].fields[0].name = 'citations',
    x => x[0].fields[0].value = { script: 'bad' },
    x => x[0].fields[0].value = '',
    x => x[0].fields[0].value = 'x'.repeat(201),
    x => x[0].fields[0].script = 'bad',
    x => x[0].figureId = 'wrong-source',
  ]) {
    const invalid = mapping(chineseData()); mutate(invalid); let calls = 0;
    await assert.rejects(() => translateInteractiveReading({ ...options, interactive: data, language: 'zh-CN', callModel: async () => {
      calls++; return JSON.stringify(invalid);
    } }), error => error.status === 502 && /after one repair attempt/.test(error.message));
    assert.equal(calls, 2);
  }
});

test('basic language checks permit technical terms, formulas and brief source quotations', () => {
  const english = structuredClone(data);
  english.blocks[0].text = 'The authors call this “覆盖率”. Repeated trials estimate coverage within the tested sample, with $p(x)=\\mathrm{softmax}(x)$. A short quotation is not the surrounding explanation.';
  assert.deepEqual(validateInteractiveTranslation(english, chineseData(), { ...options, language: 'en' }), english);
  const chinese = chineseData();
  chinese.blocks[0].text += '这里保留 Transformer、pass@k 和公式 $p(x)=\\mathrm{softmax}(x)$，不改动术语。';
  assert.deepEqual(validateInteractiveTranslation(chinese, data, { ...options, language: 'zh-CN' }), chinese);
});
