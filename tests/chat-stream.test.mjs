import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readSse } from '../shared/sse.mjs';
import { callModel } from '../server/models.mjs';
import { createApp } from '../server/index.mjs';
import { defaultSettings } from '../server/storage.mjs';
import { UsageLedger,withUsage } from '../server/usage.mjs';
const settings={...defaultSettings,provider:'openai',model:'fixture',apiKey:'synthetic-key',baseUrl:'https://provider.example/v1'};
const frame=data=>`data: ${typeof data==='string'?data:JSON.stringify(data)}\r\n\r\n`;
function sse(events,chunkSize=11){const bytes=new TextEncoder().encode(events.map(frame).join(''));return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=chunkSize)c.enqueue(bytes.slice(i,i+chunkSize));c.close();}}),{headers:{'Content-Type':'text/event-stream'}});}
const chunk=(delta,finish_reason=null)=>({choices:[{index:0,delta,finish_reason}]});

test('SSE decodes UTF-8 split bytes, CRLF, heartbeat and multiline data',async()=>{
  const text=': hi\r\nevent: custom\r\ndata: 你好\r\ndata: 世界\r\n\r\n';
  const bytes=new TextEncoder().encode(text);const body=new ReadableStream({start(c){for(const b of bytes)c.enqueue(Uint8Array.of(b));c.close();}});
  const events=[];for await(const event of readSse(body))events.push(event);
  assert.deepEqual(events,[{event:'custom',data:'你好\n世界'}]);
});

test('OpenAI stream reassembles native tool arguments and exposes only display reasoning',async()=>{
 const events=[];const result=await callModel(settings,[{role:'user',content:'Read a page'}],{returnTurn:true,tools:[{name:'read_pages',parameters:{type:'object'}}],onEvent:e=>events.push(e),fetchImpl:async(_url,options)=>{
  const b=JSON.parse(options.body);assert.equal(b.stream,true);assert.deepEqual(b.stream_options,{include_usage:true});
  return sse([chunk({reasoning_content:'先读原文。',encrypted_content:'OPAQUE_PRIVATE',extra_content:{signature:'SIGNED_PRIVATE'}}),chunk({tool_calls:[{index:0,id:'call-1',function:{name:'read_pages',arguments:'{"pages":'}}]}),chunk({tool_calls:[{index:0,function:{arguments:'[1]}'}}]}),chunk({},'tool_calls'),{choices:[],usage:{prompt_tokens:4,completion_tokens:8,total_tokens:12}},'[DONE]']);
 }});
 assert.equal(result.calls[0].arguments,'{"pages":[1]}');assert.equal(result.assistant.reasoning_content,'先读原文。');assert.equal(result.assistant.encrypted_content,'OPAQUE_PRIVATE');assert.equal(result.assistant.extra_content.signature,'SIGNED_PRIVATE');assert.ok(!JSON.stringify(events).includes('PRIVATE'));assert.deepEqual(events,[{type:'reasoning',delta:'先读原文。'}]);
});

test('Anthropic stream keeps signatures and redacted blocks private while displaying thinking and answer',async()=>{
 const events=[];const result=await callModel({...settings,provider:'anthropic'},[{role:'user',content:'Test'}],{returnTurn:true,onEvent:e=>events.push(e),fetchImpl:async()=>sse([
 {type:'message_start',message:{usage:{input_tokens:10,output_tokens:1}}},
 {type:'content_block_start',index:0,content_block:{type:'thinking',thinking:''}},
 {type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'可见思考'}},
 {type:'content_block_delta',index:0,delta:{type:'signature_delta',signature:'SECRET_SIGNATURE'}},
 {type:'content_block_start',index:1,content_block:{type:'redacted_thinking',data:'ENCRYPTED_DATA'}},
 {type:'content_block_start',index:2,content_block:{type:'text',text:''}},
 {type:'content_block_delta',index:2,delta:{type:'text_delta',text:'回答'}},
 {type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:12}},
 {type:'message_stop'}
 ])});
 assert.equal(result.text,'回答');assert.equal(result.assistant.content[0].signature,'SECRET_SIGNATURE');assert.deepEqual(events,[{type:'reasoning',delta:'可见思考'},{type:'text',delta:'回答'}]);
});

test('truncated or broken streams cannot become successful answers; reported usage survives',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'stream-usage-'));t.after(()=>rm(dir,{recursive:true,force:true}));const ledger=await new UsageLedger(dir).init();
 await assert.rejects(withUsage(ledger,'question',()=>callModel(settings,[{role:'user',content:'Test'}],{onEvent:()=>{},fetchImpl:async()=>sse([chunk({content:'partial'},'length'),{choices:[],usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30}},'[DONE]'])})),/output token limit/);
 assert.equal((await ledger.summary({days:'all'})).totals.totalTokens,30);
 await assert.rejects(callModel(settings,[{role:'user',content:'Test'}],{onEvent:()=>{},fetchImpl:async()=>sse([chunk({content:'partial'})])}),/before completion/);
 await assert.rejects(callModel(settings,[{role:'user',content:'Test'}],{onEvent:()=>{},fetchImpl:async()=>sse([{error:{message:'SECRET_UPSTREAM'}}])}),error=>!error.message.includes('SECRET_UPSTREAM'));
});

async function fixture(t,fetchImpl){const dir=await mkdtemp(join(tmpdir(),'chat-stream-'));const app=await createApp({dataDir:dir,fetchImpl});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
 const api=(path,body)=>fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method:path==='/settings'?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 await api('/settings',settings);return {app,api};}

test('HTTP chat delivers tokens before upstream completion, persists only final answer and display thinking',async t=>{
 let controller;const {app,api}=await fixture(t,async()=>new Response(new ReadableStream({start(c){controller=c;c.enqueue(new TextEncoder().encode(frame(chunk({reasoning_content:'可见推理'}))+frame(chunk({content:'第一段'}))));}}),{headers:{'Content-Type':'text/event-stream'}}));
 const response=await api('/chat',{message:'研究问题',stream:true,processing:'api'});assert.match(response.headers.get('content-type'),/event-stream/);
 const iterator=readSse(response.body);const events=[];while(!events.some(e=>e.type==='text'))events.push(JSON.parse((await iterator.next()).value.data));
 assert.equal(app.locals.store.data.chats.length,0);assert.equal(events.find(e=>e.type==='text').delta,'第一段');
 controller.enqueue(new TextEncoder().encode(frame(chunk({content:'第二段'},'stop'))+frame('[DONE]')));controller.close();
 for await(const e of iterator)events.push(JSON.parse(e.data));
 const done=events.find(e=>e.type==='done');assert.equal(done.result.message.content,'第一段第二段');assert.deepEqual(done.result.message.reasoning,[{round:1,text:'可见推理'}]);assert.equal(app.locals.store.data.chats.length,2);
});

test('stream validation errors precede SSE; upstream failures emit terminal error without saving a partial response',async t=>{
 const {app,api}=await fixture(t,async()=>sse([chunk({content:'partial'}),{error:{message:'PRIVATE'}}]));
 assert.equal((await api('/chat',{message:'q',stream:'yes'})).status,400);
 const response=await api('/chat',{message:'q',stream:true});const events=[];for await(const e of readSse(response.body))events.push(JSON.parse(e.data));
 assert.equal(events.at(-1).type,'error');assert.equal(app.locals.store.data.chats.length,0);assert.ok(!JSON.stringify(events).includes('PRIVATE'));
});

test('client disconnect aborts the active provider call and does not save previews',async t=>{
 let aborted;const didAbort=new Promise(resolve=>{aborted=resolve;});
 const {app,api}=await fixture(t,async(_url,options)=>new Response(new ReadableStream({start(controller){
  controller.enqueue(new TextEncoder().encode(frame(chunk({content:'preview'}))));
  options.signal.addEventListener('abort',()=>{aborted();controller.error(new Error('aborted'));},{once:true});
 }}),{headers:{'Content-Type':'text/event-stream'}}));
 const response=await api('/chat',{message:'q',stream:true});const reader=response.body.getReader();await reader.read();await reader.cancel();
 await Promise.race([didAbort,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Upstream not cancelled')),1000);timer.unref();})]);
 assert.equal(app.locals.store.data.chats.length,0);
});

test('JSON-only compatible providers are accepted without fabricating token streaming',async()=>{
 const events=[];const result=await callModel(settings,[{role:'user',content:'q'}],{onEvent:event=>events.push(event),fetchImpl:async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'Full answer',reasoning_content:'Visible thinking'}}]}),{headers:{'Content-Type':'application/json'}})});
 assert.equal(result,'Full answer');assert.equal(events.filter(e=>e.type==='text').length,1);
});
