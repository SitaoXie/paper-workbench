import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
async function load(name) {
  const source = fs.readFileSync(new URL('../src/' + name, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}
const { loadPaperRecommendations: loadQuestions, recommendationConfiguration, paperRecommendationIdentity, consumeRecommendationRefresh } = await load('paper-recommendations.ts');
const controller = () => new AbortController();
const input = signal => ({ paperId: 'paper/one', language: 'zh-CN', enabled: true, signal });
const cached = { enabled: true, recommendation: { id: 'saved' }, cached: true };

test('disabled recommendations and cancelled work make no API request', async () => {
  const abort = controller();
  await loadQuestions(() => assert.fail('disabled request'), { ...input(abort.signal), enabled: false });
  abort.abort();
  await loadQuestions(() => assert.fail('cancelled request'), input(abort.signal));
});
test('opening the assistant reads cached questions without another model request', async () => {
  const requests = [];
  const result = await loadQuestions(async (path, options) => { requests.push([path,options]); return cached; }, input(controller().signal));
  assert.equal(result, cached);
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], '/papers/paper%2Fone/recommendations?language=zh-CN');
  assert.equal(requests[0][1].method, undefined);
});
test('a missing cache generates once; an explicit refresh makes exactly one POST', async () => {
  const requests = [];
  const request = async (path, options) => { requests.push([path,options]); return options.method === 'POST' ? cached : { enabled: true, recommendation: null, cached: false }; };
  await loadQuestions(request, input(controller().signal));
  assert.equal(requests.length,2);
  assert.equal(requests[1][1].method,'POST');
  assert.deepEqual(JSON.parse(requests[1][1].body), { language: 'zh-CN', refresh: false });
  requests.length = 0;
  await loadQuestions(request, { ...input(controller().signal), language: 'en', refresh: true });
  assert.equal(requests.length,1);
  assert.deepEqual(JSON.parse(requests[0][1].body), { language: 'en', refresh: true });
});
test('disabling or switching paper during cache lookup cannot start a later paid generation', async () => {
  const abort = controller(); let resolve, calls = 0;
  const pending = loadQuestions(() => { calls++; return new Promise(done => { resolve = done; }); }, input(abort.signal));
  abort.abort(); resolve({ enabled: true, recommendation: null, cached: false });
  await pending; assert.equal(calls,1);
  calls = 0;
  await loadQuestions(async () => { calls++; return { enabled: false, recommendation: null, cached: false }; }, input(controller().signal));
  assert.equal(calls,1);
});
test('cache or provider failures are surfaced with no automatic retries', async () => {
  let calls = 0;
  await assert.rejects(loadQuestions(async () => { calls++; throw new Error('connection failed'); }, input(controller().signal)), /connection failed/);
  assert.equal(calls,1);
  calls = 0;
  await assert.rejects(loadQuestions(async (_path, options) => {
    calls++; if (options.method === 'POST') throw new Error('provider failed');
    return { enabled: true, recommendation: null, cached: false };
  }, input(controller().signal)), /provider failed/);
  assert.equal(calls,2);
});
test('chat model switching does not invalidate the dedicated recommendation request identity', () => {
  const profile = { id: 'dedicated', provider: 'openai', baseUrl: 'https://model.example/v1', model: 'model-a', apiKeyConfigured: true, extraBody: {} };
  const settings = { profiles: [profile], model: 'chat-a', recommendations: { enabled: true, profileId: 'dedicated', model: 'starter' } };
  const key = recommendationConfiguration(settings);
  assert.equal(recommendationConfiguration({ ...settings, model: 'chat-b', profiles: [{ ...profile, model: 'chat-b' }] }), key);
  assert.notEqual(recommendationConfiguration({ ...settings, recommendations: { ...settings.recommendations, model: 'other-starter' } }), key);
  assert.notEqual(recommendationConfiguration({ ...settings, profiles: [{ ...profile, extraBody: { temperature: 0.2 } }] }), key);
});

test('open-paper request identity follows source revisions without being reset by generated reading versions', () => {
  const settings={recommendations:{enabled:false}},paper={id:'paper-a',pdfRevision:'same-pdf',recommendationSourceRevision:'source-v1'};
  const original=paperRecommendationIdentity(paper,'en',settings);
  assert.notEqual(paperRecommendationIdentity({...paper,recommendationSourceRevision:'source-v2'},'en',settings),original);
  assert.equal(paperRecommendationIdentity({...paper,activeReadingId:'different-reading',summary:{markdown:'New generated reading'}},'en',settings),original);
  assert.notEqual(paperRecommendationIdentity(paper,'zh-CN',settings),original);
});

test('manual refresh cannot repeat a paid POST when a reader switches languages away and back', async () => {
  const consumed={current:0},attempt={sequence:1,identity:'zh-version',refresh:true},requests=[];
  const request=async(path,options)=>{requests.push([path,options.method]);return cached;};
  for(const identity of ['zh-version','en-version','zh-version']) {
    const refresh=consumeRecommendationRefresh(attempt,identity,consumed);
    await loadQuestions(request,{...input(controller().signal),language:identity.startsWith('zh')?'zh-CN':'en',refresh});
  }
  assert.deepEqual(requests.map(item=>item[1]),['POST',undefined,undefined]);
  assert.equal(consumeRecommendationRefresh({...attempt,sequence:2},'zh-version',consumed),true);
  // A request superseded by navigation must not revive when returning later.
  const canceled={sequence:3,identity:'zh-version',refresh:true};
  assert.equal(consumeRecommendationRefresh(canceled,'en-version',consumed),false);
  assert.equal(consumeRecommendationRefresh(canceled,'zh-version',consumed),false);
});

test('library categories preserve source labels, count papers once and leave unfiltered data intact', async () => {
  const { libraryTagCounts, filterLibraryTag } = await load('library-tags.ts');
  const papers = [{ id: 'a', tags: ['视觉表征', 'CNN', 'CNN'] }, { id: 'b', tags: ['CNN'] }, { id: 'c', tags: ['语言模型'] }];
  const snapshot = JSON.stringify(papers);
  assert.equal(libraryTagCounts(papers).find(item => item.tag === 'CNN').count, 2);
  assert.deepEqual(filterLibraryTag(papers, 'CNN').map(paper => paper.id), ['a','b']);
  assert.deepEqual(filterLibraryTag(papers, 'cnn'), []);
  assert.equal(filterLibraryTag(papers, ''), papers);
  assert.equal(JSON.stringify(papers), snapshot);
});
