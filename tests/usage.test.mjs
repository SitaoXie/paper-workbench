import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, appendFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { UsageLedger, normalizeUsage, withUsage } from '../server/usage.mjs';
import { callModel } from '../server/models.mjs';
import { defaultSettings } from '../server/storage.mjs';
import { createApp } from '../server/index.mjs';
const settings = {...defaultSettings, apiKey:'NEVER_STORE_KEY',baseUrl:'https://private-endpoint.example/v1',model:'model-a',id:'profile-a',name:'Provider A'};
const counts = {prompt_tokens:100,completion_tokens:20,total_tokens:120,prompt_tokens_details:{cached_tokens:80,cache_write_tokens:10},completion_tokens_details:{reasoning_tokens:5}};
const reply = (usage=counts,extra={}) => new Response(JSON.stringify({choices:[{message:{content:'A grounded explanation.'}}],usage,...extra}));
async function directory(t){const dir=await mkdtemp(path.join(os.tmpdir(),'pw-usage-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}

test('normalization counts provider totals once, including Anthropic cache categories',()=>{
 assert.deepEqual(normalizeUsage('openai',counts),{inputTokens:100,outputTokens:20,totalTokens:120,cachedInputTokens:80,cacheWriteTokens:10,reasoningTokens:5});
 assert.deepEqual(normalizeUsage('anthropic',{input_tokens:10,output_tokens:7,cache_creation_input_tokens:20,cache_read_input_tokens:100}),{inputTokens:130,outputTokens:7,totalTokens:137,cachedInputTokens:100,cacheWriteTokens:20,reasoningTokens:null});
 assert.equal(normalizeUsage('anthropic',{input_tokens:10,output_tokens:7}).totalTokens,17);
 assert.equal(normalizeUsage('openai',{prompt_tokens:2,completion_tokens:3}).totalTokens,5);
 assert.equal(normalizeUsage('openai',{total_tokens:9}).totalTokens,9);
 for(const value of [null,undefined,{}, {prompt_tokens:-1,completion_tokens:'3',total_tokens:true},{prompt_tokens:1.5,completion_tokens:NaN,total_tokens:Infinity}]) {
  const u=normalizeUsage('openai',value); assert.equal(u.inputTokens,null);assert.equal(u.outputTokens,null);assert.equal(u.totalTokens,null);
 }
 assert.equal(normalizeUsage('openai',{prompt_tokens:0,completion_tokens:0,total_tokens:0}).totalTokens,0);
 assert.equal(normalizeUsage('openai',{prompt_tokens:10,completion_tokens:5,total_tokens:999}).totalTokens,null);
 assert.equal(normalizeUsage('openai',{prompt_tokens:10,completion_tokens:5,completion_tokens_details:{reasoning_tokens:6}}).reasoningTokens,null);
 assert.equal(normalizeUsage('anthropic',{input_tokens:10,output_tokens:2,cache_read_input_tokens:'invalid'}).totalTokens,null);
});

test('every actual call is persisted, including charged failures, truncation and missing usage; secrets and source never enter ledger',async t=>{
 const ledger=await new UsageLedger(await directory(t)).init();
 const run=fetchImpl=>withUsage(ledger,'reading',()=>callModel(settings,[{role:'user',content:'NEVER_STORE_PAPER'}],{fetchImpl,usageStage:'draft'}));
 assert.equal(await run(async()=>reply()),'A grounded explanation.');
 await assert.rejects(run(async()=>reply(counts,{choices:[{finish_reason:'length',message:{content:'partial'}}]})),/token limit/);
 await assert.rejects(run(async()=>new Response(JSON.stringify({usage:counts,error:'NEVER_STORE_BODY'}),{status:429})),/HTTP 429/);
 await assert.rejects(run(async()=>{throw new Error('NEVER_STORE_ERROR');}),/connect/);
 await assert.rejects(run(async()=>new Response('not JSON')) ,/invalid JSON/);
 await assert.rejects(run(async()=>reply(counts,{choices:[]})),/no text/);
 await run(async()=>reply(null));
 await withUsage(ledger,'question',()=>assert.rejects(callModel(defaultSettings,[],{fetchImpl:()=>assert.fail('unconfigured')})));
 const report=await ledger.summary({days:'all'});
 assert.equal(report.requests,7);assert.equal(report.failed,5);assert.equal(report.unknownUsage,3);
 assert.equal(report.totals.totalTokens,480);assert.equal(report.reported.totalTokens,4);
 assert.equal(report.recent.filter(r=>r.status==='incomplete').length,1);
 assert.ok(report.recent.every(r=>r.operation==='reading'&&r.stage==='draft'));
 const disk=await readFile(ledger.file,'utf8');assert.doesNotMatch(disk,/NEVER_STORE|private-endpoint|messages|apiKey|baseUrl/);
 const reopened=await new UsageLedger(path.dirname(ledger.file)).init();const restored=await reopened.summary({days:'all'});
 assert.deepEqual(restored.totals,report.totals);assert.equal(restored.requests,7);assert.equal(restored.trackingSince,report.trackingSince);
});

test('parallel request scopes and model snapshots cannot mix provider, purpose or ledger',async t=>{
 const a=await new UsageLedger(await directory(t)).init(), b=await new UsageLedger(await directory(t)).init();
 const mutable={...settings};let release,ready;
 const waiting=new Promise(resolve=>{ready=resolve;});
 const first=withUsage(a,'question',()=>callModel(mutable,[],{fetchImpl:()=>{ready();return new Promise(resolve=>release=()=>resolve(reply()));}}));
 await waiting;mutable.model='model-b';
 await withUsage(b,'translation',()=>callModel({...settings,provider:'anthropic'},[],{fetchImpl:async()=>new Response(JSON.stringify({content:[{type:'text',text:'翻译'}],usage:{input_tokens:10,output_tokens:2,cache_read_input_tokens:30}}))}));
 release();await first;
 assert.equal(a.records[0].model,'model-a');assert.equal(a.records[0].operation,'question');
 assert.equal(b.records[0].provider,'anthropic');assert.equal(b.records[0].operation,'translation');assert.equal(b.records[0].totalTokens,42);
 await Promise.all(Array.from({length:25},()=>withUsage(a,'reading',()=>callModel(settings,[],{fetchImpl:async()=>reply()}))));
 const reopened=await new UsageLedger(path.dirname(a.file)).init();assert.equal(reopened.records.length,26);
});

test('calendar filters respect chosen timezone; unknown records remain visible; pagination preserves complete totals',async t=>{
 const ledger=await new UsageLedger(await directory(t)).init();
 const record=(id,startedAt,usage=counts)=>({id,startedAt,provider:'openai',model:'model-a',profileId:'profile-a',profileName:'A',operation:'question',status:'success',durationMs:1,...normalizeUsage('openai',usage)});
 await ledger.record(record('boundary','2026-10-18T16:30:00Z')); // Oct 19 in Shanghai, inside last 7 days on Oct 25.
 await ledger.record(record('before','2026-10-18T15:59:00Z'));
 await ledger.record(record('unknown','2026-10-24T23:59:00Z',null));
 let report=await ledger.summary({days:'7',timeZone:'Asia/Shanghai'},new Date('2026-10-25T10:00:00Z'));
 assert.equal(report.requests,2);assert.equal(report.unknownUsage,1);assert.deepEqual(report.daily.map(x=>x.key),['2026-10-19','2026-10-25']);
 report=await ledger.summary({days:'7',timeZone:'UTC'},new Date('2026-10-25T10:00:00Z'));assert.equal(report.requests,1);
 for(let i=0;i<60;i++)await ledger.record(record('page-'+i,'2026-10-25T01:00:00Z'));
 report=await ledger.summary({days:'all',offset:'50'},new Date('2026-10-25T10:00:00Z'));assert.equal(report.requests,63);assert.equal(report.recent.length,13);assert.equal(report.hasMore,false);
 const filtered=await ledger.summary({days:'all',model:report.models[0].key},new Date('2026-10-25T10:00:00Z'));assert.equal(filtered.requests,63);
 for(const invalid of [{days:'-1'},{timeZone:'Invalid/Zone'},{offset:'-5'},{days:['7']},{model:['x']}])await assert.rejects(ledger.summary(invalid));
});

test('partial log damage and disk write failure are disclosed without losing a successful model answer',async t=>{
 const dir=await directory(t), ledger=await new UsageLedger(dir).init();
 await appendFile(ledger.file,'{"torn":');
 const loaded=await new UsageLedger(dir).init();assert.equal(loaded.unreadableRecords,1);
 await withUsage(loaded,'question',()=>callModel(settings,[],{fetchImpl:async()=>reply()}));
 const reopened=await new UsageLedger(dir).init();assert.equal(reopened.records.length,1);assert.equal(reopened.unreadableRecords,1);
 reopened.file=dir; // Writing to a directory reliably fails even for privileged test processes.
 const answer=await withUsage(reopened,'question',()=>callModel(settings,[],{fetchImpl:async()=>reply()}));assert.equal(answer,'A grounded explanation.');
 assert.equal((await reopened.summary({days:'all'})).storage.unsavedRecords,1);
});

test('HTTP paths count each review round, coalesce translations, exclude extractive/agent imports, and survive restart',async t=>{
 const dir=await directory(t);let calls=0;
 const app=await createApp({dataDir:dir,fetchImpl:async()=>{calls++;return reply(counts);}});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`;
 const api=async(route,body,method='POST')=>{const r=await fetch(base+'/api'+route,{method:body===undefined?'GET':method,...(body!==undefined?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
 const store=app.locals.store;
 const paper={id:'usage-paper',title:'Fixture',authors:[],abstract:'A source statement.',text:'A source statement.',createdAt:new Date().toISOString()};store.data.papers.push(paper);await store.save();
 assert.equal((await api('/usage')).data.requests,0);
 await api('/settings',{apiKey:'fixture-key'},'PUT');
 const report=await api('/papers/usage-paper/report',{adversarial:true,language:'en'});assert.equal(report.status,200);assert.equal(calls,3);
 let stats=(await api('/usage?days=all')).data;assert.equal(stats.requests,3);assert.equal(stats.totals.totalTokens,360);assert.deepEqual(stats.recent.map(x=>x.stage).sort(),['draft','edit','review']);
 const translationBody={target:'reading',readingId:report.data.readingVersion.id,language:'zh-CN'};
 const [one,two]=await Promise.all([api('/papers/usage-paper/translate',translationBody),api('/papers/usage-paper/translate',translationBody)]);
 assert.equal(one.status,200);assert.equal(two.status,200);assert.equal(calls,4);
 await api('/papers/usage-paper/translate',translationBody);assert.equal(calls,4);
 await api('/chat',{paperId:paper.id,message:'source',processing:'extractive'});assert.equal(calls,4);
 await api('/papers/usage-paper/insights',{source:{agent:'Codex'},summary:{markdown:'Agent explanation',language:'en'}},'PUT');assert.equal(calls,4);
 await api('/settings/test',{});assert.equal(calls,5);
 stats=(await api('/usage?days=all')).data;assert.equal(stats.requests,5);assert.equal(stats.byOperation.find(x=>x.key==='translation').requests,1);assert.equal(stats.byOperation.find(x=>x.key==='connection-test').requests,1);
 const reopened=await new UsageLedger(dir).init();assert.equal((await reopened.summary({days:'all'})).requests,5);
 assert.equal((await api('/usage?days=999')).status,400);assert.equal(calls,5,'Viewing/filtering stats never invokes a model');
});

test('dashboard connection grouping uses IDs and cache ratios use the same reporting sample',async t=>{
 const ledger=await new UsageLedger(await directory(t)).init();
 const add=(id,profileId,model,usage)=>ledger.record({id,startedAt:'2026-10-28T01:00:00Z',provider:'openai',profileId,profileName:'Same visible name',model,operation:'question',status:'success',durationMs:1,...normalizeUsage('openai',usage)});
 await add('one','a','m1',{prompt_tokens:100,completion_tokens:10,prompt_tokens_details:{cached_tokens:80}});
 await add('two','a','m2',{prompt_tokens:900,completion_tokens:20});
 await add('three','b','m1',{prompt_tokens:300,completion_tokens:30,prompt_tokens_details:{cached_tokens:0}});
 await add('four','b','m1',null);
 let report=await ledger.summary({days:'all'},new Date('2026-10-28T12:00:00Z'));
 assert.equal(report.byProfile.length,2,'Duplicate display names are distinct connections');
 assert.equal(report.byProfile.find(p=>p.profileId==='a').requests,2);
 assert.equal(report.byProfile.find(p=>p.profileId==='a').totals.totalTokens,1030);
 assert.deepEqual(report.cache,{requests:2,inputTokens:400,cachedInputTokens:80,rate:0.2});
 report=await ledger.summary({days:'all',model:report.models.find(m=>m.model==='m2').key},new Date('2026-10-28T12:00:00Z'));
 assert.equal(report.cache.rate,null);assert.equal(report.cache.requests,0);assert.equal(report.byProfile.length,1);
});
