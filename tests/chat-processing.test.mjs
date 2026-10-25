import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/index.mjs';
import {answerQuestion} from '../server/models.mjs';
import {defaultSettings} from '../server/storage.mjs';
import {legacyVisualHistoryPrefix} from '../server/answer-presentation.mjs';

async function fixture(t,model=()=> 'A configured model answer.'){
 const directory=await mkdtemp(join(tmpdir(),'pw-chat-processing-')),calls=[];
 const app=await createApp({dataDir:directory,fetchImpl:async(_url,options)=>{const body=JSON.parse(options.body);calls.push(body);return new Response(JSON.stringify({choices:[{message:{content:await model(body)}}]}));}});
 const paper={id:'source-paper',title:'Source paper',authors:[],tags:[],source:'web',createdAt:'2026-01-01',abstract:'Reliable observations depend on bounded experimental evidence.',text:'Reliable observations depend on bounded experimental evidence. The method retrieves original source passages and keeps interpretation separate from direct quotations.'};
 app.locals.store.data.papers.push(paper);
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});});
 async function api(path,body){const response=await fetch(origin+'/api'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};}
 return {app,paper,api,calls,configure:()=>Object.assign(app.locals.store.data.settings,{apiKey:'synthetic-configured-key'})};
}

test('historical API answers hide leaked prefixes without rewriting stored records or user messages', async t => {
 const f = await fixture(t, () => legacyVisualHistoryPrefix + '新的回答');
 f.configure();
 const created = await f.api('/chats/new', {paperId:f.paper.id});
 const conversationId = created.data.conversationId;
 const records = [
  {id:'old-user',role:'user',content:legacyVisualHistoryPrefix,conversationId,paperId:f.paper.id},
  {id:'old-answer',role:'assistant',content:legacyVisualHistoryPrefix + legacyVisualHistoryPrefix + '旧回答',conversationId,paperId:f.paper.id,source:{toolImageCount:1}},
 ];
 f.app.locals.store.data.chats.push(...records);
 const snapshot = JSON.stringify(records);
 const history = await f.api(`/chats?paperId=${f.paper.id}&conversationId=${conversationId}`);
 assert.equal(history.status,200);
 assert.equal(history.data.messages[0].content,legacyVisualHistoryPrefix);
 assert.equal(history.data.messages[1].content,'旧回答');
 assert.equal(JSON.stringify(records),snapshot);
 const reply = await f.api('/chat',{paperId:f.paper.id,conversationId,message:'继续',processing:'api'});
 assert.equal(reply.status,200);
 assert.equal(reply.data.message.content,'新的回答');
 assert.equal(f.app.locals.store.data.chats.at(-1).content,'新的回答');
 assert.equal(f.calls[0].messages.find(m=>m.role==='assistant').content,'旧回答');
});

test('invalid processing and explicit unconfigured API fail before conversations, active state or messages can change',async t=>{
 const f=await fixture(t),before=JSON.stringify(f.app.locals.store.data);
 for(const processing of [null,'','subscription','model','API',true,1,[],{}]){
  const response=await f.api('/chat',{paperId:f.paper.id,message:'What is the evidence?',processing});
  assert.equal(response.status,400);assert.match(response.data.error,/processing/);assert.equal(JSON.stringify(f.app.locals.store.data),before);
 }
 const unconfigured=await f.api('/chat',{paperId:f.paper.id,message:'What is the evidence?',processing:'api'});
 assert.equal(unconfigured.status,409);assert.equal(unconfigured.data.code,'chat_model_unconfigured');assert.match(unconfigured.data.error,/Codex \/ Claude/);assert.match(unconfigured.data.error,/configure a model API/);
 assert.equal(JSON.stringify(f.app.locals.store.data),before);assert.equal(f.calls.length,0);
});

test('explicit extraction with a configured key makes no upstream call and only writes the addressed session',async t=>{
 const f=await fixture(t);f.configure();const settings=JSON.stringify(f.app.locals.store.data.settings);
 const first=await f.api('/chats/new',{paperId:f.paper.id,metadata:{quote:'Bounded evidence',sourceScope:'source-text'}}),second=await f.api('/chats/new',{paperId:f.paper.id});
 const activeBefore=JSON.stringify(f.app.locals.store.data.activeConversations);
 for(const message of ['What evidence supports these observations?','这些证据有哪些局限？']){
  const response=await f.api('/chat',{paperId:f.paper.id,conversationId:first.data.conversationId,message,processing:'extractive',apiKey:'ignored-request-key'});
  assert.equal(response.status,200);assert.equal(response.data.mode,'extractive');assert.equal(response.data.message.mode,'extractive');assert.equal(response.data.conversationId,first.data.conversationId);
  assert.match(response.data.message.content,/Codex \/ Claude/);assert.match(response.data.message.content,/subscription|订阅/);assert.match(response.data.message.content,/model API|模型 API/);
  assert.equal(response.data.userMessage.metadata.sourceScope,'source-text');
 }
 assert.equal(f.calls.length,0);assert.equal(JSON.stringify(f.app.locals.store.data.settings),settings);assert.equal(JSON.stringify(f.app.locals.store.data.activeConversations),activeBefore);
 const chats=f.app.locals.store.data.chats;assert.equal(chats.length,4);assert.ok(chats.every(message=>message.conversationId===first.data.conversationId));assert.equal(chats.filter(message=>message.conversationId===second.data.conversationId).length,0);
 assert.equal((await f.api('/chat',{conversationId:first.data.conversationId,message:'Wrong paper',processing:'extractive'})).status,404);assert.equal(chats.length,4);
});

test('explicit API answers stay in their captured session while a concurrent extraction uses another one',async t=>{
 let started,release;const ready=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const f=await fixture(t,async()=>{started();await gate;return 'Model response for the original session.';});f.configure();const settings=JSON.stringify(f.app.locals.store.data.settings);
 const first=await f.api('/chats/new',{paperId:f.paper.id});
 const pending=f.api('/chat',{paperId:f.paper.id,conversationId:first.data.conversationId,message:'Synthesize the evidence.',processing:'api'});await ready;
 const second=await f.api('/chats/new',{paperId:f.paper.id});
 const local=await f.api('/chat',{paperId:f.paper.id,conversationId:second.data.conversationId,message:'Find source observations.',processing:'extractive'});
 assert.equal(local.status,200);assert.equal(local.data.mode,'extractive');assert.equal(f.calls.length,1);
 release();const answer=await pending;assert.equal(answer.status,200);assert.equal(answer.data.mode,'model');assert.equal(answer.data.conversationId,first.data.conversationId);
 const chats=f.app.locals.store.data.chats;assert.equal(chats.filter(message=>message.conversationId===first.data.conversationId).length,2);assert.equal(chats.filter(message=>message.conversationId===second.data.conversationId).length,2);
 assert.equal(JSON.stringify(f.app.locals.store.data.settings),settings);
});

test('omitted processing remains compatible and forceExtractive is a per-call model option',async t=>{
 const f=await fixture(t);
 const local=await f.api('/chat',{paperId:f.paper.id,message:'Find reliable observations.'});assert.equal(local.status,200);assert.equal(local.data.mode,'extractive');assert.equal(f.calls.length,0);
 f.configure();const api=await f.api('/chat',{paperId:f.paper.id,message:'Explain reliable observations.'});assert.equal(api.status,200);assert.equal(api.data.mode,'model');assert.equal(f.calls.length,1);
 const settings={...defaultSettings,baseUrl:'http://127.0.0.1:9999',apiKey:'synthetic-key'},before=JSON.stringify(settings);
 const direct=await answerQuestion([f.paper],'Find reliable observations.',[],settings,{forceExtractive:true,fetchImpl:async()=>{throw new Error('Explicit extraction must never reach an upstream endpoint');}});
 assert.equal(direct.mode,'extractive');assert.equal(JSON.stringify(settings),before);
});
