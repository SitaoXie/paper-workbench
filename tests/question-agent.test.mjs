import {isCitationPhase,withEmptyCitationPhase} from './helpers/citation-phase.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answerQuestion, callModel } from '../server/models.mjs';
import { defaultSettings, Store } from '../server/storage.mjs';
import { createApp } from '../server/index.mjs';
import { UsageLedger, withUsage } from '../server/usage.mjs';
import { createQuestionToolbox, parseWebSearch, rankQuestionPapers, runQuestionAgent, searchPublicWeb } from '../server/question-agent.mjs';
import ts from 'typescript';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const paper = { id: 'paper-a', title: 'Masking study', authors: ['Researcher'], abstract: 'Image representation learning.',
  pages: [{ number: 1, text: 'Background and definitions.' }, { number: 2, text: 'Masking ratio 75% worked well in this experiment. This is not a universal optimum.' }],
  figures: [{ id: 'figure-a', page: 2, caption: 'Masking ratio comparison.' }] };
const settings = { ...defaultSettings, baseUrl: 'https://provider.example/v1', apiKey: 'synthetic-key', model: 'fixture' };
const resultHtml = '<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fpaper">Research result</a><div class="result__snippet">Search snippet only.</div></div>';
const reply = (provider, calls, text = '', extra = {}) => new Response(JSON.stringify(provider === 'anthropic'
  ? { content: calls.length ? [{ type: 'thinking', thinking: 'PRIVATE_REASONING_SENTINEL', signature: 'signed' }, ...calls.map(c => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args }))] : [{ type: 'text', text }], stop_reason: calls.length ? 'tool_use' : 'end_turn', usage: { input_tokens: 10, output_tokens: 5 }, ...extra }
  : { choices: [{ message: { role: 'assistant', content: text || null, ...(calls.length ? { reasoning_content: 'PRIVATE_REASONING_SENTINEL', tool_calls: calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: typeof c.args === 'string' ? c.args : JSON.stringify(c.args) } })) } : {}) }, finish_reason: calls.length ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }, ...extra }));

for (const provider of ['openai', 'anthropic']) test(`${provider}: native search → page read → cited answer preserves tool protocol, provenance and per-round token usage`, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'question-agent-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const ledger = await new UsageLedger(dir).init(), requests = [];
  const fetchImpl = async (_url, options) => {
    if(isCitationPhase(options))return reply(provider, [], '{"bindings":[]}');
    const body = JSON.parse(options.body); requests.push(body);
    assert.equal(body.max_tokens, 65536);
    assert.ok(body.tools.every(tool => !JSON.stringify(tool).includes('search_web')));
    if (requests.length === 1) return reply(provider, [{ id: 'search1', name: 'search_papers', args: { query: 'masking ratio', paperId: paper.id } }]);
    if (requests.length === 2) {
      assert.match(JSON.stringify(body.messages.at(-1)), /75%/);
      assert.match(JSON.stringify(body.messages.at(-2)), /PRIVATE_REASONING_SENTINEL/);
      if (provider === 'anthropic') assert.equal(body.messages.at(-1).content[0].tool_use_id, 'search1');
      else assert.equal(body.messages.at(-1).tool_call_id, 'search1');
      return reply(provider, [{ id: 'page1', name: 'read_pages', args: { paperId: paper.id, pages: [2] } }]);
    }
    assert.match(JSON.stringify(body.messages.at(-1)), /universal optimum/);
    return reply(provider, [], 'The experiment used 75%; it is not a universal optimum. [p.2]');
  };
  const answer = await withUsage(ledger, 'question', () => answerQuestion([paper], 'Why this ratio?', [{ role: 'user', content: 'We were discussing masking.' }], { ...settings, provider }, { fetchImpl }));
  assert.equal(requests.length, 3); assert.equal(answer.source.pixelsProvided, false);
  const agent = answer.source.questionAgent;
  assert.equal(agent.modelCalls, 3); assert.equal(agent.webEnabled, false);
  assert.deepEqual(agent.steps.map(step => step.tool), ['search_papers', 'read_pages']);
  assert.equal(agent.steps[1].references[0].page, 2); assert.equal(agent.steps[1].references[0].complete, true);
  assert.ok(!JSON.stringify(answer).includes('PRIVATE_REASONING_SENTINEL'));
  const usage = await ledger.summary({ days: 'all' });
  assert.equal(usage.requests, 4); assert.equal(usage.totals.totalTokens, 60);
  assert.equal(answer.source.citationLocations.modelCalls,1);
  assert.deepEqual(usage.recent.map(item => item.stage).sort(), ['question-agent-1','question-agent-2','question-agent-3','question-citation-alignment']);
});

test('local tools validate scope, preserve exact page ranges and distinguish metadata from PDF pixels', async () => {
  const long = { ...paper, pages: [{ number: 1, text: 'A'.repeat(13000) }] };
  const execute = createQuestionToolbox({ papers: [long] });
  await assert.rejects(execute('read_pages', { paperId: paper.id, pages: [1] }, 4000), /No page was truncated/);
  const first = await execute('read_pages', { paperId: paper.id, pages: [1] }, 20000);
  const page = first.pages[0]; assert.equal(page.complete, true); assert.equal(page.nextOffset, null);
  assert.equal(page.text, long.pages[0].text); assert.equal(first.pixelsProvided, false);
  for (const args of [{paperId:'other',pages:[1]}, {paperId:paper.id,pages:[3]}, {paperId:paper.id,pages:[0]}, {paperId:paper.id,pages:[1],offset:-1}, {paperId:paper.id,pages:[1],script:'ignored?'}]) await assert.rejects(execute('read_pages', args));
  assert.deepEqual((await execute('search_papers',{query:'unmatched technical term'})).hits, []);
  const textOnly = createQuestionToolbox({papers:[{id:'metadata',metadataOnly:true,abstract:'Only an abstract.'}]});
  const metadata = await textOnly('read_pages',{paperId:'metadata',pages:[1]});
  assert.equal(metadata.pages[0].page,null);assert.equal(metadata.metadataOnly,true);
});

for (const provider of ['openai','anthropic']) test(`${provider}: external search → webpage read round trip exposes only grounded links and final evidence`,async()=>{
  let count=0,downloads=0;
  const run=await runQuestionAgent({papers:[paper],selected:[paper],provider,webSearch:true,question:'Find external research',messages:[{role:'system',content:'Research'},{role:'user',content:'Find external research'}],
    search:async query=>({provider:'Test search',results:[{url:'https://example.org/source',title:'Original source',snippet:'Search snippet'}]}),
    download:async url=>{downloads++;assert.equal(url,'https://example.org/source');return{url,contentType:'text/html',buffer:Buffer.from('<title>Original source</title><main>Verifiable webpage evidence.</main>')};},
    call:(messages,options)=>callModel({...settings,provider},messages,{...options,fetchImpl:async(_url,request)=>{
      const body=JSON.parse(request.body);count++;
      if(count===1)return reply(provider,[{id:'web-search',name:'search_web',args:{query:'public research'}}]);
      if(count===2){assert.match(JSON.stringify(body.messages.at(-1)),/Search snippet/);return reply(provider,[{id:'web-read',name:'read_webpage',args:{url:'https://example.org/source'}}]);}
      assert.match(JSON.stringify(body.messages.at(-1)),/Verifiable webpage evidence/);
      return reply(provider,[],'Evidence from [Original source](https://example.org/source).');
    }})});
  assert.equal(count,3);assert.equal(downloads,1);assert.equal(run.evidence.webEnabled,true);
  assert.deepEqual(run.evidence.steps.map(step=>step.tool),['search_web','read_webpage']);
  assert.equal(run.evidence.steps[0].provider,'Test search');assert.equal(run.evidence.steps[1].references[0].url,'https://example.org/source');
});

test('extraction ignores enabled web flag and never invokes tools or any model',async()=>{
  const answer=await answerQuestion([paper],'masking',[],settings,{forceExtractive:true,webSearch:true,fetchImpl:async()=>assert.fail('no model'),download:async()=>assert.fail('no web')});
  assert.equal(answer.mode,'extractive');assert.equal(answer.source,undefined);
});

test('web tools are opt-in; search snippets and fetched page excerpts remain distinct; only observed URLs may be read', async () => {
  const calls = [];
  const download = async url => { calls.push(url); return {buffer:Buffer.from(url.includes('duckduckgo')?resultHtml:'<html><title>Original</title><main>Original evidence. <script>PRIVATE_SCRIPT</script>'+ 'Context. '.repeat(2000)+'</main></html>'),contentType:'text/html',url}; };
  const search = (query, options) => searchPublicWeb(query, {...options,env:{}});
  const off = createQuestionToolbox({papers:[paper],download,search});
  await assert.rejects(off('search_web',{query:'paper'}),/disabled/);
  await assert.rejects(off('read_webpage',{url:'https://example.org/paper'}),/disabled/); assert.equal(calls.length,0);
  const on = createQuestionToolbox({papers:[paper],webSearch:true,download,search});
  await assert.rejects(on('read_webpage',{url:'https://unobserved.example/paper'}),/search results/);
  const found=await on('search_web',{query:'paper'});assert.match(found.coverage,/snippets only/);assert.equal(found.results[0].url,'https://example.org/paper');
  const read=await on('read_webpage',{url:found.results[0].url});assert.equal(read.coverage,'webpage excerpt');assert.ok(read.nextOffset>0);assert.ok(!read.text.includes('PRIVATE_SCRIPT'));
  const continued=await on('read_webpage',{url:found.results[0].url,offset:read.nextOffset});assert.equal(continued.start,read.end);assert.equal(calls.length,2,'same request caches fetched webpage text');
  await assert.rejects(createQuestionToolbox({papers:[],webSearch:true,question:'Read http://127.0.0.1/private'})('read_webpage',{url:'http://127.0.0.1/private'}),/Private/);
  assert.throws(()=>parseWebSearch('<html>Please verify you are human</html>'),/unavailable/);
  assert.deepEqual(parseWebSearch('<div class="no-results">No results found</div>'),[]);
});

test('Tavily receives only search terms, stores no key in results, and sanitizes provider errors',async()=>{
  let payload;
  const result=await searchPublicWeb('public research terms',{env:{TAVILY_API_KEY:'private-search-key'},fetchImpl:async(url,options)=>{
    assert.equal(url,'https://api.tavily.com/search');assert.equal(options.headers.Authorization,'Bearer private-search-key');assert.equal(options.redirect,'error');
    payload=JSON.parse(options.body);return new Response(JSON.stringify({results:[{title:'Source',url:'https://example.org/source',content:'Evidence'},{url:'javascript:alert(1)'}]}));
  }});
  assert.equal(payload.query,'public research terms');assert.equal(payload.include_answer,false);assert.equal(payload.include_raw_content,false);
  assert.equal(result.results.length,1);assert.ok(!JSON.stringify(result).includes('private-search-key'));
  await assert.rejects(searchPublicWeb('q',{env:{PAPER_WORKBENCH_SEARCH_PROVIDER:'tavily'}}),/TAVILY_API_KEY/);
  await assert.rejects(searchPublicWeb('q',{env:{TAVILY_API_KEY:'key'},fetchImpl:async()=>new Response('SECRET_UPSTREAM_BODY',{status:401})}),error=>error.message.includes('401')&&!error.message.includes('SECRET'));
});

test('invalid/disabled tool calls return typed errors to the model without network access or fake evidence',async()=>{
  let count=0;
  const answer=await answerQuestion([paper],'Explain',[],settings,{download:async()=>assert.fail('web is off'),fetchImpl:async()=>{
    if(++count===1)return reply('openai',[{id:'bad-json',name:'read_pages',args:'{'},{id:'disabled',name:'search_web',args:{query:'x'}},{id:'scope',name:'read_pages',args:{paperId:'private',pages:[1]}},{id:'invalid-query',name:'search_papers',args:{query:{unsafe:'not a string'}}}]);
    return reply('openai',[],'Evidence was not retrieved; answer limited to initial context.');
  }});
  assert.equal(answer.source.questionAgent.steps.length,4);assert.ok(answer.source.questionAgent.steps.every(step=>!step.ok&&step.references.length===0));
  assert.equal(answer.source.questionAgent.steps[3].query,undefined);
});

test('agent enforces call/round limits and asks for a final answer with tools disabled',async()=>{
  let count=0;
  const answer=await answerQuestion([paper],'Keep investigating',[],settings,{fetchImpl:async(_url,options)=>{
    const body=JSON.parse(options.body);count++;
    if(body.tool_choice==='none')return reply('openai',[],'Tool budget reached; no unsupported conclusion.');
    return reply('openai',[{id:'call'+count,name:'search_papers',args:{query:'no-match'}}]);
  }});
  assert.equal(count,5);assert.equal(answer.source.questionAgent.limitReached,true);assert.equal(answer.source.questionAgent.steps.length,4);
  let rounds=0;
  await assert.rejects(answerQuestion([paper],'Loop',[],settings,{fetchImpl:async()=>reply('openai',[{id:'again'+(++rounds),name:'search_papers',args:{query:'no-match'}}])}),/no further tool calls/);
  assert.equal(rounds,5);
});

test('tool evidence fits the reserved character budget; too-large results are errors, not silently truncated JSON',async()=>{
  let round=0;
  const run=await runQuestionAgent({papers:[{...paper,pages:[{number:1,text:'x'.repeat(30000)}]}],selected:[paper],messages:[{role:'system',content:'Test'},{role:'user',content:'Read'}],question:'Read',provider:'openai',toolBudget:1000,
    call:async(messages)=>++round===1?{calls:[{id:'r',name:'read_pages',arguments:{paperId:paper.id,pages:[1]}}],assistant:{role:'assistant',content:null,tool_calls:[{id:'r',type:'function',function:{name:'read_pages',arguments:JSON.stringify({paperId:paper.id,pages:[1]})}}]}}:{calls:[],text:'Bounded answer'}});
  assert.ok(run.evidence.toolCharacters<=1000);
});

test('library relevance can select a paper beyond the first eight, including follow-up topic history',()=>{
  const papers=[...Array.from({length:8},(_,i)=>({...paper,id:'noise-'+i,title:'Other',abstract:'',pages:[{number:1,text:'Unrelated ocean observations.'}]})),{...paper,id:'ninth'}];
  assert.equal(rankQuestionPapers(papers,'Why this ratio?',[{role:'user',content:'Discuss masking 75%'}])[0].id,'ninth');
});

test('chat route validates web option before mutation and saves agent provenance in the fixed session across reload',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'question-agent-route-'));let count=0;
  const app=await createApp({dataDir:directory,fetchImpl:withEmptyCitationPhase(async()=>++count===1?reply('openai',[{id:'read',name:'read_pages',args:{paperId:paper.id,pages:[2]}}]):reply('openai',[],'Evidence [p.2]'))});
  app.locals.store.data.papers.push({...paper,tags:[],createdAt:'2026-01-01'});Object.assign(app.locals.store.data.settings,settings);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});});
  const send=body=>fetch(`http://127.0.0.1:${server.address().port}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const before=JSON.stringify(app.locals.store.data);
  for(const value of [null,'true',1,{}]){assert.equal((await send({paperId:paper.id,message:'Q',webSearch:value})).status,400);assert.equal(JSON.stringify(app.locals.store.data),before);}
  const response=await send({paperId:paper.id,message:'Read evidence',processing:'api',webSearch:false});assert.equal(response.status,200);
  const saved=await response.json();const reopened=await new Store(directory).init();
  const persisted=reopened.data.chats.find(item=>item.id===saved.message.id);
  assert.equal(persisted.conversationId,saved.conversationId);assert.equal(persisted.source.questionAgent.steps[0].references[0].page,2);
  assert.equal(count,2);
});

test('evidence UI renders bilingual source links, partial coverage and failures without unsafe HTML or protocols',async()=>{
  const source=await readFile(new URL('../src/AgentEvidence.tsx',import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const exports={};vm.runInNewContext(code,{exports,require:createRequire(import.meta.url)});
  const evidence={version:1,webEnabled:false,modelCalls:2,limitReached:true,steps:[{tool:'read_pages',ok:true,references:[{paperId:'paper-a',title:'<script>bad</script>',page:2,start:0,end:500,complete:false}]},{tool:'read_webpage',ok:false,error:'Unavailable',references:[{url:'javascript:alert(1)',title:'unsafe'}]}]};
  for(const chinese of [true,false]){
    const html=renderToStaticMarkup(React.createElement(exports.default,{evidence,chinese,paperId:'paper-a',onPage:()=>{}}));
    assert.match(html,chinese?/检索与来源/:/Retrieval &amp; sources/);assert.match(html,chinese?/部分原文/:/excerpt/);
    assert.ok(!html.includes('<script>'));assert.ok(!html.includes('href="javascript:'));assert.match(html,/<button/);
  }
});
