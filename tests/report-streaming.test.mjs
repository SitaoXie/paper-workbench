import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {callModel,generateReport} from '../server/models.mjs';
import {defaultSettings} from '../server/storage.mjs';
import {createApp} from '../server/index.mjs';
const settings={...defaultSettings,baseUrl:'https://fixture.example/v1',model:'fixture',apiKey:'fixture',requestTimeoutSeconds:.12};
const frame=data=>new TextEncoder().encode(`data: ${typeof data==='string'?data:JSON.stringify(data)}\n\n`);
const chunk=(delta,finish_reason=null)=>({choices:[{index:0,delta,finish_reason}]});
function timedStream(signal,{silent=false,heartbeat=false}={}){
 let timer;
 return new Response(new ReadableStream({start(c){
  signal.addEventListener('abort',()=>{clearInterval(timer);c.error(signal.reason);},{once:true});
  c.enqueue(frame(chunk({reasoning_content:'Thinking'})));
  if(silent)return;
  let n=0;
  timer=setInterval(()=>{if(++n<6)c.enqueue(heartbeat&&n<5?new TextEncoder().encode(': keepalive\n\n'):frame(chunk({content:'Part.'})));else {clearInterval(timer);c.enqueue(frame(chunk({},'stop')));c.enqueue(frame('[DONE]'));c.close();}},45);
 },cancel(){clearInterval(timer);}}),{headers:{'content-type':'text/event-stream'}});
}
test('active streaming outlives the request inactivity timeout while retaining all text',async()=>{
 const events=[],start=Date.now();
 const text=await callModel(settings,[{role:'user',content:'Test'}],{onEvent:e=>events.push(e),fetchImpl:async(_,options)=>timedStream(options.signal)});
 assert.ok(Date.now()-start>200);assert.equal(text,'Part.'.repeat(5));assert.equal(events[0].type,'reasoning');
});
test('provider keepalives extend the wait before final answer tokens arrive',async()=>{
 const text=await callModel(settings,[{role:'user',content:'Test'}],{onEvent:()=>{},fetchImpl:async(_,options)=>timedStream(options.signal,{heartbeat:true})});
 assert.equal(text,'Part.');
});
test('silent streaming and caller cancellation terminate without an incomplete result',async()=>{
 await assert.rejects(callModel(settings,[{role:'user',content:'Test'}],{onEvent:()=>{},fetchImpl:async(_,options)=>timedStream(options.signal,{silent:true})}),/no data/);
 const controller=new AbortController();
 const result=callModel(settings,[{role:'user',content:'Test'}],{signal:controller.signal,onEvent:()=>{},fetchImpl:async(_,options)=>{setTimeout(()=>controller.abort(),20);return timedStream(options.signal,{silent:true});}});
 await assert.rejects(result,/cancelled/);
});
test('caller total deadline still bounds a question-agent stream even with active output',async()=>{
 await assert.rejects(callModel(settings,[{role:'user',content:'Test'}],{timeoutMs:75,onEvent:()=>{},fetchImpl:async(_,options)=>timedStream(options.signal)}),/timed out/);
});
test('million-character report context reaches the model without the old 300K ceiling',async()=>{
 const paper={id:'large',title:'Large input',authors:[],abstract:'Abstract',text:'',pages:[{number:1,text:'Source evidence. '.repeat(70000)+'SOURCE_END'}]};
 let body;
 const report=await generateReport(paper,{...settings,contextChars:2000000,requestTimeoutSeconds:15},{adversarial:false,fetchImpl:async(_,options)=>{body=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{message:{content:'Complete report.'},finish_reason:'stop'}]}));}});
 assert.equal(body.stream,true);assert.ok(report.contextCharacters>1000000);assert.match(JSON.stringify(body.messages),/SOURCE_END/);assert.equal(report.markdown,'Complete report.');
});
for(const cancel of [false,true])test(`report progress exposes streamed stages and ${cancel?'cancels without saving':'saves only the completed result'}`,async t=>{
 const dataDir=await mkdtemp(path.join(tmpdir(),'pw-report-stream-'));
 let release,started;
 const ready=new Promise(resolve=>started=resolve);
 const app=await createApp({dataDir,fetchImpl:async(_,options)=>{
  assert.equal(JSON.parse(options.body).stream,true);
  return new Response(new ReadableStream({start(c){
   options.signal.addEventListener('abort',()=>c.error(options.signal.reason),{once:true});
   c.enqueue(frame(chunk({reasoning_content:'Visible reasoning'})));c.enqueue(frame(chunk({content:'First. '})));
   release=()=>{c.enqueue(frame(chunk({content:'Finished.'})));c.enqueue(frame(chunk({},'stop')));c.enqueue(frame('[DONE]'));c.close();};started();
  }}),{headers:{'content-type':'text/event-stream'}});
 }});
 const store=app.locals.store;
 store.data.settings={...settings,requestTimeoutSeconds:15};
 store.data.papers.push({id:'paper',title:'Fixture',authors:[],abstract:'Source abstract.',text:'Source text.',pages:[],createdAt:new Date().toISOString()});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dataDir,{recursive:true,force:true});});
 const pending=fetch(base+'/api/papers/paper/report',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({adversarial:false})});
 await ready;
 let progress;
 for(let n=0;n<20;n++){progress=await fetch(base+'/api/papers/paper/report/progress').then(r=>r.json());if(progress.text)break;await new Promise(resolve=>setImmediate(resolve));}
 assert.equal(progress.running,true);assert.equal(progress.stage,'draft');assert.equal(progress.text,'First. ');assert.equal(progress.reasoning,'Visible reasoning');assert.ok(progress.updatedAt);
 assert.equal(store.paper('paper').report,undefined);
 if(cancel){assert.equal((await fetch(base+'/api/papers/paper/report/cancel',{method:'POST'})).status,200);const res=await pending;assert.equal(res.status,499);assert.equal(store.paper('paper').report,undefined);}
 else{release();const res=await pending;assert.equal(res.status,200);assert.equal((await res.json()).report.markdown,'First. Finished.');}
 assert.equal((await fetch(base+'/api/papers/paper/report/progress').then(r=>r.json())).running,false);
});
