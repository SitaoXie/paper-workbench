import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.mjs';
import { defaultSettings, normalizeProfiles } from '../server/storage.mjs';
import { validateSettings } from '../server/models.mjs';
import { parseRecommendedQuestions, recommendationBinding } from '../server/recommendations.mjs';
import { recommendationSourceRevision } from '../server/recommendation-source.mjs';

const source = { id:'paper-a', title:'Synthetic method', abstract:'A residual method is compared with a plain network on a held-out dataset.', authors:[], tags:['old'], createdAt:'2026-01-01T00:00:00Z', contentHash:'pdf-hash', pages:[{number:1,text:'The residual branch learns F(x) and returns F(x)+x. The comparison uses matching depth and dataset splits.'}] };
const configuration = {profiles:[{id:'test',name:'Test connection',provider:'openai',baseUrl:'https://unit.example/v1',models:['chat-model','question-model'],model:'chat-model',apiKey:'unit-secret',contextChars:8000,maxOutputTokens:2048}],activeProfileId:'test'};
const questions = language => ({ questions: language === 'en' ? [
  {question:'How does the residual branch differ from a plain layer in the supplied method?',angle:'method'},
  {question:'What evidence in this excerpt supports the comparison with the plain network?',angle:'evidence'},
  {question:'What does the stated evaluation leave unresolved about transfer to other datasets?',angle:'limitations'},
] : [
  {question:'残差分支与普通层在计算方式上有哪些具体区别？',angle:'method'},
  {question:'文中给出的哪些证据支持残差网络与普通网络的比较？',angle:'evidence'},
  {question:'这段评估对于迁移到其他数据集还留下哪些待验证问题？',angle:'limitations'},
] });
const reply = value => new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130}}));
async function fixture(t, handler) {
  const directory = await mkdtemp(path.join(os.tmpdir(),'paper-recommendations-'));
  const calls=[];
  const app=await createApp({dataDir:directory,fetchImpl:async(url,options)=>{const body=JSON.parse(options.body);calls.push(body);return handler?handler(body,calls.length):reply(questions(body.messages[0].content.includes('in en.')?'en':'zh-CN'));}});
  app.locals.store.data.papers.push(structuredClone(source));
  app.locals.store.data.settings=validateSettings(configuration,defaultSettings);
  await app.locals.store.save();
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});});
  const api=async(route,body,method=body===undefined?'GET':'POST')=>{const response=await fetch(base+'/api'+route,{method,headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,data:await response.json()};};
  const enable=()=>api('/settings',{recommendations:{enabled:true,profileId:'test',model:'question-model'}},'PUT');
  return {app,api,calls,enable,directory};
}

test('recommendation settings are off by default, independent of chat and disabled when their model disappears',()=>{
  assert.deepEqual(normalizeProfiles(defaultSettings).recommendations,{enabled:false,profileId:'',model:''});
  let settings=validateSettings({...configuration,recommendations:{enabled:true,profileId:'test',model:'question-model'}},defaultSettings);
  assert.equal(settings.model,'chat-model');
  settings=validateSettings({model:'question-model'},settings);assert.equal(settings.recommendations.model,'question-model');
  settings=validateSettings({recommendations:{enabled:false}},settings);assert.equal(settings.recommendations.profileId,'test');
  settings=validateSettings({profiles:[{...configuration.profiles[0],models:['chat-model']}]},settings);
  assert.deepEqual(settings.recommendations,{enabled:false,profileId:'',model:''});
  for(const value of [true,null,[],{enabled:'yes'},{enabled:true,profileId:'missing',model:'a'},{apiKey:'must-not-save'}])assert.throws(()=>validateSettings({recommendations:value},settings));
  assert.equal(settings.profiles[0].recommendations,undefined);
});

test('strict question output schema rejects short, malformed, duplicate or unbounded suggestions',()=>{
  assert.equal(parseRecommendedQuestions('```json\n'+JSON.stringify(questions('en'))+'\n```').length,3);
  const duplicate={questions:[...questions('en').questions,questions('en').questions[0]]};assert.equal(parseRecommendedQuestions(JSON.stringify(duplicate)).length,3);
  for(const input of ['not json',{questions:[]},{questions:[...Array(6)].map(()=>questions('en').questions[0])},{questions:[...Array(3)].map(()=>questions('en').questions[0])},{...questions('en'),secret:'bad'}, {questions:questions('en').questions.map(item=>({...item,question:'bad'}))},{questions:questions('en').questions.map(item=>({...item,angle:'execute'}))}])
    assert.throws(()=>parseRecommendedQuestions(typeof input==='string'?input:JSON.stringify(input)));
});

test('GET and disabled POST make no model call; enabled generation uses its own model, cache, language and usage',async t=>{
  const f=await fixture(t);
  assert.deepEqual((await f.api('/papers/paper-a/recommendations')).data,{enabled:false,recommendation:null,cached:false});
  assert.equal((await f.api('/papers/paper-a/recommendations',{})).status,409);assert.equal(f.calls.length,0);
  assert.equal((await f.enable()).status,200);
  const result=await f.api('/papers/paper-a/recommendations',{language:'en'});assert.equal(result.status,200);assert.equal(result.data.cached,false);
  assert.equal(result.data.recommendation.questions.length,3);assert.equal(result.data.recommendation.source.model,'question-model');assert.equal(f.calls[0].model,'question-model');
  assert.equal(f.app.locals.store.data.settings.model,'chat-model');
  assert.equal((await f.api('/papers/paper-a/recommendations?language=en')).data.recommendation.id,result.data.recommendation.id);
  assert.equal((await f.api('/papers/paper-a/recommendations',{language:'en'})).data.cached,true);assert.equal(f.calls.length,1);
  assert.equal((await f.api('/papers/paper-a/recommendations',{language:'zh-CN'})).status,200);assert.equal(f.calls.length,2);
  assert.equal((await f.api('/papers/paper-a/recommendations?language=fr')).status,400);
  assert.equal((await f.api('/papers/paper-a/recommendations',{language:'en',refresh:1})).status,400);
  const stats=(await f.api('/usage?days=all')).data;assert.equal(stats.byOperation.find(item=>item.key==='recommendations').requests,2);assert.equal(stats.totals.totalTokens,260);
  assert.doesNotMatch(JSON.stringify(result.data),/unit-secret|unit\.example|apiKey|baseUrl/);
  assert.equal((await f.api('/papers/paper-a')).data.paper.recommendationCache,undefined);
  const reopened=await createApp({dataDir:f.directory});assert.equal(reopened.locals.store.data.papers[0].recommendationCache.length,2);
  await f.api('/settings',{recommendations:{enabled:false}},'PUT');assert.equal((await f.api('/papers/paper-a/recommendations?language=en')).data.recommendation,null);
});

test('cache identity changes with source/provider parameters but not active chat model or tags; failed refresh preserves valid cache',async t=>{
  let fail=false;
  const f=await fixture(t,()=>fail?new Response('provider failure',{status:503}):reply(questions('en')));
  await f.enable();const first=(await f.api('/papers/paper-a/recommendations',{language:'en'})).data.recommendation;
  await f.api('/settings',{model:'question-model'},'PUT');
  await f.api('/papers/paper-a',{tags:['classification']},'PATCH');
  assert.equal((await f.api('/papers/paper-a/recommendations?language=en')).data.recommendation.id,first.id);
  fail=true;assert.equal((await f.api('/papers/paper-a/recommendations',{language:'en',refresh:true})).status,502);
  assert.equal((await f.api('/papers/paper-a/recommendations?language=en')).data.recommendation.id,first.id);
  fail=false;await f.api('/papers/paper-a',{title:'Changed title'},'PATCH');assert.equal((await f.api('/papers/paper-a/recommendations?language=en')).data.recommendation,null);
  const settings=f.app.locals.store.data.settings,paper=f.app.locals.store.paper('paper-a');
  const key=recommendationBinding(paper,settings,'en').key;
  for(const patch of [{baseUrl:'https://other.example/v1'},{provider:'anthropic'},{contextChars:9000},{maxOutputTokens:3000},{extraBody:{temperature:.4}}]){
    const changed=structuredClone(settings);Object.assign(changed.profiles[0],patch);assert.notEqual(recommendationBinding(paper,changed,'en').key,key);
  }
  const changed=structuredClone(paper);changed.pages[0].text+=' Updated evidence.';assert.notEqual(recommendationBinding(changed,settings,'en').key,key);
});

test('concurrent duplicate requests coalesce; disabling while pending discards result without saving',async t=>{
  let release,started;
  const ready=new Promise(resolve=>started=resolve);
  const f=await fixture(t,()=>{started();return new Promise(resolve=>release=()=>resolve(reply(questions('en'))));});
  await f.enable();const one=f.api('/papers/paper-a/recommendations',{language:'en'});await ready;
  const two=f.api('/papers/paper-a/recommendations',{language:'en'});
  await f.api('/settings',{recommendations:{enabled:false}},'PUT');release();
  const [a,b]=await Promise.all([one,two]);assert.equal(a.status,409);assert.equal(b.status,409);assert.equal(f.calls.length,1);assert.equal(f.app.locals.store.paper('paper-a').recommendationCache,undefined);
});

test('successful concurrent callers share one generated result; source changes in flight cannot publish stale questions',async t=>{
  let release, started;
  let ready = new Promise(resolve=>started=resolve);
  const f=await fixture(t,()=>{started();return new Promise(resolve=>release=()=>resolve(reply(questions('en'))));});
  await f.enable();
  const one=f.api('/papers/paper-a/recommendations',{language:'en'});await ready;
  const two=f.api('/papers/paper-a/recommendations',{language:'en'});
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(f.calls.length,1);release();
  const [a,b]=await Promise.all([one,two]);assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(a.data.recommendation.id,b.data.recommendation.id);
  ready=new Promise(resolve=>started=resolve);
  const pending=f.api('/papers/paper-a/recommendations',{language:'en',refresh:true});await ready;
  await f.api('/papers/paper-a',{title:'Revised source title'},'PATCH');release();assert.equal((await pending).status,409);
  assert.equal((await f.api('/papers/paper-a/recommendations?language=en')).data.recommendation,null);
});

test('recommendations bound paid calls and reject substantial output-language mismatches',async t=>{
  const f=await fixture(t,()=>reply(questions('en')));await f.enable();
  assert.equal((await f.api('/papers/paper-a/recommendations',{language:'zh-CN'})).status,502);
  assert.equal((await f.api('/papers/paper-a/recommendations?language=zh-CN')).data.recommendation,null);
  for(let i=0;i<11;i++)assert.equal((await f.api('/papers/paper-a/recommendations',{language:'en',refresh:true})).status,200);
  assert.equal((await f.api('/papers/paper-a/recommendations',{language:'en',refresh:true})).status,429);assert.equal(f.calls.length,12);
  assert.equal((await f.api('/papers/paper-a/recommendations',{language:'en'})).status,200,'cached reads remain available at rate limit');
});

test('two different generations may run together while a third is rejected before provider submission',async t=>{
  const releases=[];let ready;
  const bothStarted=new Promise(resolve=>ready=resolve);
  const f=await fixture(t,body=>new Promise(resolve=>{
    releases.push(()=>resolve(reply(questions(body.messages[0].content.includes('in en.')?'en':'zh-CN'))));
    if(releases.length===2)ready();
  }));
  await f.enable();f.app.locals.store.data.papers.push({...structuredClone(source),id:'paper-b'});
  const one=f.api('/papers/paper-a/recommendations',{language:'en'}),two=f.api('/papers/paper-a/recommendations',{language:'zh-CN'});
  await bothStarted;
  assert.equal((await f.api('/papers/paper-b/recommendations',{language:'en'})).status,429);assert.equal(f.calls.length,2);
  releases.forEach(release=>release());
  for(const result of await Promise.all([one,two]))assert.equal(result.status,200);
});

test('paper classification/title edits validate atomically, deduplicate labels, persist and preserve PDF identity',async t=>{
  const f=await fixture(t);const before=structuredClone(f.app.locals.store.paper('paper-a'));
  const updated=await f.api('/papers/paper-a',{title:'  Correct title  ',tags:[' Vision ','vision','生成模型'],favorite:true},'PATCH');assert.equal(updated.status,200);assert.deepEqual(updated.data.paper.tags,['Vision','生成模型']);assert.equal(updated.data.paper.title,'Correct title');
  for(const body of [{tags:['valid','']},{tags:Array(31).fill('tag')},{tags:['x'.repeat(81)]},{title:' '},{title:'bad\nname'},{tags:42,favorite:false}])assert.equal((await f.api('/papers/paper-a',body,'PATCH')).status,400);
  const saved=f.app.locals.store.paper('paper-a');assert.equal(saved.favorite,true);assert.equal(saved.contentHash,before.contentHash);assert.deepEqual(saved.pages,before.pages);
  const reopened=await createApp({dataDir:f.directory});assert.deepEqual(reopened.locals.store.paper('paper-a').tags,['Vision','生成模型']);
});

test('public source revision invalidates open readers after title or text changes but ignores generated readings and tags',async t=>{
  const f=await fixture(t);const paper=f.app.locals.store.paper('paper-a');
  const original=(await f.api('/papers/paper-a')).data.paper.recommendationSourceRevision;
  assert.match(original,/^[a-f0-9]{64}$/);
  assert.equal((await f.api('/papers')).data.papers[0].recommendationSourceRevision,original);
  paper.tags=['another category'];paper.activeReadingId='generated';paper.summary={markdown:'Generated secondary interpretation.',language:'en'};
  assert.equal(recommendationSourceRevision(paper),original);
  paper.text='Duplicated merged text is not used when pages exist';assert.equal(recommendationSourceRevision(paper),original);
  paper.pages[0].text+=' Newly extracted paragraph.';const newText=recommendationSourceRevision(paper);assert.notEqual(newText,original);
  assert.equal((await f.api('/papers/paper-a')).data.paper.recommendationSourceRevision,newText);
  await f.api('/papers/paper-a',{title:'Corrected title'},'PATCH');assert.notEqual(recommendationSourceRevision(paper),newText);
  paper.pages=[];const noPages=recommendationSourceRevision(paper);paper.text+=' Updated source text.';assert.notEqual(recommendationSourceRevision(paper),noPages);
});
