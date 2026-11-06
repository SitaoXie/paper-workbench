import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {registerDemoWorkspace,DEMO_PAPER_ID} from '../server/demo-workspace.mjs';
import {PDFDocument} from 'pdf-lib';

test('sample has real PDF bytes, bilingual quick/deep readings and source-bound notes without providers',async(t)=>{
 const app=express();await registerDemoWorkspace(app);const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}/api/demo`;
 const get=async p=>(await fetch(base+p)).json();
 const {paper}=await get(`/papers/${DEMO_PAPER_ID}`);
 assert.equal(paper.readingVersions.length,2);assert.equal(paper.readingVersions[0].style,'quick');assert.equal(paper.readingVersions[1].style,'deep');
 for(const v of paper.readingVersions){assert.ok(v.translations.en.markdown);assert.ok(v.translations['zh-CN'].markdown);assert.match(v.source.agent,/prewritten/);}
 const pdf=await PDFDocument.load(await(await fetch(base+`/papers/${DEMO_PAPER_ID}/file`)).arrayBuffer());assert.equal(pdf.getPageCount(),3);
 const {annotations}=await get(`/papers/${DEMO_PAPER_ID}/annotations`);assert.ok(paper.pages[1].text.includes(annotations[0].quote));
 assert.equal((await get('/settings')).modelConfigured,false);
 const {messages}=await get('/chats?paperId='+DEMO_PAPER_ID);assert.equal(messages.length,2);assert.match(messages[1].content,/No model call/);
 assert.deepEqual((await get('/chats?paperId=private-paper')).messages,[]);
});

test('every demo mutation is rejected and unsupported routes never fall through to personal data',async(t)=>{
 const app=express();await registerDemoWorkspace(app);let escaped=0;app.use((_q,r)=>{escaped++;r.json({secret:'not for demo'});});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}/api/demo`;
 for(const [method,path] of [['POST','/chat'],['PUT','/settings'],['DELETE',`/papers/${DEMO_PAPER_ID}`],['PATCH',`/papers/${DEMO_PAPER_ID}`],['POST','/workspace/restore']]){
  const response=await fetch(base+path,{method});assert.equal(response.status,409);assert.equal((await response.json()).code,'DEMO_READ_ONLY');
 }
 for(const path of ['/papers/private-paper','/workspace/backup','/settings/secret','/agent-skill'])assert.equal((await fetch(base+path)).status,404);
 assert.equal(escaped,0);
});
