import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import ts from 'typescript';
import {createApp} from '../server/index.mjs';
import {currentVisualEvidence} from '../server/vision.mjs';
import {outlinePdf} from './fixtures/outline-pdf.mjs';

const moduleText = ts.transpileModule(await readFile(new URL('../src/agent-task.ts', import.meta.url), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022},
}).outputText;
const {prepareAgentQuestionTask} = await import('data:text/javascript;base64,' + Buffer.from(moduleText).toString('base64'));

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'pw-subscription-boundaries-'));
  let modelCalls = 0;
  const app = await createApp({dataDir: directory, fetchImpl: async () => {
    modelCalls++; throw new Error('Subscription imports must not invoke a provider');
  }});
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, {recursive: true, force: true});
    assert.equal(modelCalls, 0);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function api(path, body, method = 'POST') {
    const response = await fetch(origin + path, {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    return {status: response.status, data: await response.json()};
  }
  async function upload() {
    const form = new FormData();
    form.append('file', new Blob([outlinePdf()], {type: 'application/pdf'}), 'source.pdf');
    const response = await fetch(origin + '/api/upload', {method: 'POST', body: form});
    assert.equal(response.status, 201);
    return (await response.json()).paper;
  }
  async function cli(args, body) {
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['scripts/paper-workbench.mjs', ...args], {
        cwd: new URL('..', import.meta.url),
        env: {...process.env, PAPER_WORKBENCH_API_KEY: '', PAPER_WORKBENCH_URL: origin},
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '';
      child.stdout.on('data', chunk => stdout += chunk);
      child.stderr.on('data', chunk => stderr += chunk);
      child.on('error', reject);
      child.on('close', code => code ? reject(new Error(stderr || `exit ${code}`)) : resolve(JSON.parse(stdout)));
      child.stdin.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  return {app, origin, api, upload, cli, paper: await upload()};
}

function fixedBinding(task) {
  // This is the complete JSON block the subscription agent is instructed to
  // preserve in its answer payload, not reconstructed UI metadata.
  const start = task.indexOf('{\n'), end = task.indexOf('\n}\n', start);
  return JSON.parse(task.slice(start, end + 2));
}

test('CLI source applies whole-paper visual eligibility before filtering pages, while get retains auditable history', async t => {
  const f = await fixture(t), raw = f.app.locals.store.paper(f.paper.id);
  const crop = {x: .1, y: .1, width: .7, height: .2};
  raw.figures = [{id: 'chart', page: 1, crop, caption: 'Current first-page crop'}];
  const observation = (id, page, extra = {}) => ({id, figureId: 'chart', page, crop, pdfRevision: raw.pdfRevision,
    markdown: `Unverified observation ${id}`, pixelsProvided: true, modelUnverified: true, analysisMethod: 'vision-model', ...extra});
  // The crop was edited to page 2, analyzed, then restored to page 1. The old
  // matching crop must not resurrect because the latest observation is pending.
  raw.visualEvidence = [observation('older-included', 1), observation('latest-pending', 2, {excluded: true})];
  assert.deepEqual(currentVisualEvidence(raw), []);
  for (const options of [[], ['--pages', '1'], ['--pages', '1', '--include-derived']]) {
    const source = await f.cli(['source', raw.id, ...options]);
    assert.deepEqual(source.visualEvidence, []);
    assert.ok(source.pages.length);
  }
  const history = (await f.cli(['get', raw.id])).paper.visualEvidence;
  assert.equal(history.length, 2);
  assert.equal(history[0].stale, false);
  assert.equal(history[0].eligibleForContext, false, 'Source match alone is not current eligibility');
  assert.equal(history[1].eligibleForContext, false);
  raw.visualEvidence.push(observation('latest-included', 1, {excluded: false}));
  const eligible = (await f.cli(['source', raw.id, '--pages', '1'])).visualEvidence;
  assert.deepEqual(eligible.map(item => item.id), ['latest-included']);
  assert.equal(eligible[0].modelUnverified, true);
  assert.deepEqual((await f.cli(['source', raw.id, '--pages', '2'])).visualEvidence, []);
  assert.deepEqual((await f.cli(['get', raw.id])).paper.visualEvidence.map(item => item.eligibleForContext), [false, false, true]);
  // Legacy latest observations retain inclusion; no implicit migration.
  delete raw.visualEvidence.at(-1).excluded;
  assert.deepEqual((await f.cli(['source', raw.id])).visualEvidence.map(item => item.id), ['latest-included']);
});

test('copied question task imports preserve clear, new multipage, and fixed-reading metadata in an existing conversation', async t => {
  const f = await fixture(t), route = `/api/papers/${f.paper.id}`;
  const old = {quote: 'Old first-page selection', page: 1, sourceScope: 'pdf'};
  const created = await f.api('/api/chats/new', {paperId: f.paper.id, metadata: old});
  assert.equal(created.status, 201);
  const conversationId = created.data.conversationId;
  const published = await f.api(`${route}/insights`, {source: {agent: 'Fixture'}, summary: {language: 'en', markdown: 'First fixed generated overview.'}}, 'PUT');
  const readingId = published.data.paper.activeReadingId;
  await f.api(`${route}/insights`, {source: {agent: 'Fixture'}, summary: {language: 'en', markdown: 'A different active overview.'}}, 'PUT');
  const cases = [
    {input: {omitConversationSelection: true, metadata: old}, expected: undefined, jsonMetadata: null},
    {input: {metadata: {sourceScope: 'pdf', page: 2, pages: [2, 3], quote: 'Both selected pages'}}, expected: {sourceScope: 'pdf', page: 2, pages: [2, 3], quote: 'Both selected pages'}},
    {input: {metadata: {sourceScope: 'reading', readingId, quote: 'First fixed generated overview.'}}, expected: {sourceScope: 'reading', readingId, quote: 'First fixed generated overview.'}},
    {input: {}, expected: old},
  ];
  for (const [index, item] of cases.entries()) {
    const question = `Question ${index} with an explicit source policy`;
    const result = await prepareAgentQuestionTask({origin: f.origin, paperId: f.paper.id, conversationId, sessionKey: {}, question, language: 'en', ...item.input}, async () => {throw new Error('Do not create a new session');});
    const binding = fixedBinding(result.task);
    if (item.jsonMetadata === null) assert.equal(binding.metadata, null);
    else if (item.input.metadata) assert.deepEqual(binding.metadata, item.expected);
    else assert.equal(Object.hasOwn(binding, 'metadata'), false);
    await f.cli(['answer', f.paper.id, '-'], {...binding, question, answer: 'A subscription-session answer.', source: {agent: 'Fixture'}});
    const saved = await f.cli(['conversation', f.paper.id, conversationId]);
    assert.deepEqual(saved.messages.at(-2).metadata, item.expected);
    assert.deepEqual(saved.conversation.metadata, old, 'Per-question metadata must not rewrite the original session binding');
  }
  assert.equal((await f.cli(['sessions', f.paper.id])).conversations.length, 1);
});

test('subscription reading translations require an explicit version, including caption-only imports after active version changes', async t => {
  const f = await fixture(t), route = `/api/papers/${f.paper.id}/insights`, source = {agent: 'Fixture'};
  const crop = {x: .1, y: .1, width: .7, height: .2};
  const publish = caption => f.api(route, {source, figures: [{id: 'chart', page: 1, crop, caption}], summary: {language: 'en', markdown: `Reading for ${caption}.`}}, 'PUT');
  const first = (await publish('First caption')).data.paper.activeReadingId;
  const second = (await publish('Second caption')).data.paper.activeReadingId;
  const before = JSON.stringify(f.app.locals.store.paper(f.paper.id));
  for (const readingId of [undefined, '', ' ', null, 123]) {
    for (const content of [{markdown: '第一版的译文。'}, {figureCaptions: {chart: 'Translated first caption'}}]) {
      const response = await f.api(route, {source, translations: [{target: 'reading', readingId, language: 'en', ...content}]}, 'PUT');
      assert.equal(response.status, 400);
      assert.match(response.data.error, /explicit readingId/);
      assert.equal(JSON.stringify(f.app.locals.store.paper(f.paper.id)), before);
    }
  }
  const missing = await f.api(route, {source, translations: [{target: 'reading', readingId: 'not-this-version', language: 'en', markdown: 'Unknown version.'}]}, 'PUT');
  assert.equal(missing.status, 404);
  const fixed = await f.api(route, {source, translations: [{target: 'reading', readingId: first, language: 'en', figureCaptions: {chart: 'Translated first caption'}}]}, 'PUT');
  assert.equal(fixed.status, 200);
  const original = fixed.data.paper.readingVersions.find(version => version.id === first);
  assert.deepEqual(original.translations.en.figureCaptions, {chart: 'Translated first caption'});
  assert.equal(original.figures[0].caption, 'First caption');
  assert.equal(fixed.data.paper.activeReadingId, second);
  assert.equal(fixed.data.paper.readingVersions.find(version => version.id === second).translations?.en, undefined);
  const legacy = await f.api(route, {source, translations: [{target: 'summary', language: 'zh-CN', markdown: '旧摘要目标仍然兼容。'}]}, 'PUT');
  assert.equal(legacy.status, 200);
});
