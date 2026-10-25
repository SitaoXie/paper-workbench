import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createApp } from '../server/index.mjs';
import { Store } from '../server/storage.mjs';
import { Ingestor, parseArxivFeed } from '../server/ingest.mjs';

test('source institutions are imported only from explicit metadata, deduplicated without inferring from body text or email', async () => {
  const html='<html><head><title>Example</title><meta name="citation_author" content="A. Author"><meta name="citation_author_institution" content=" Example University "><meta name="citation_author_institution" content="Example University"><meta name="citation_affiliation" content="Second Institute"></head><body><article>'+ 'The paper cites a third university and author@third-university.example, which are not affiliation metadata. '.repeat(3)+'</article></body></html>';
  const importer=new Ingestor('/unused', async url=>({buffer:Buffer.from(html),contentType:'text/html',url}));
  const paper=await importer.importUrl('https://example.org/paper');
  assert.deepEqual(paper.authors,['A. Author']);
  assert.deepEqual(paper.institutions,['Example University','Second Institute']);
  const xml='<feed><entry><id>http://arxiv.org/abs/2111.06377</id><title>Fixture</title><author><name>A. Author</name><arxiv:affiliation>Example Lab</arxiv:affiliation></author><author><name>B. Author</name><arxiv:affiliation>Example Lab</arxiv:affiliation></author><summary>Source</summary></entry></feed>';
  assert.deepEqual(parseArxivFeed(xml)[0].institutions,['Example Lab']);
  assert.deepEqual(parseArxivFeed(xml.replaceAll('<arxiv:affiliation>Example Lab</arxiv:affiliation>',''))[0].institutions,[]);
});

test('author and institution patches validate atomically, persist and preserve readings and annotations',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'paper-metadata-'));
  const app=await createApp({dataDir:directory});
  const paper={id:'fixture',title:'Original title',authors:['Original author'],abstract:'Source',text:'Source text',tags:[],createdAt:'2026-01-01',pages:[],activeReadingId:'reading-a',readingVersions:[{id:'reading-a',markdown:'Preserve summary.',language:'en',style:'deep',focus:'',createdAt:'2026-01-01',figures:[],translations:{}}]};
  app.locals.store.data.papers.push(paper);app.locals.store.data.annotations.push({id:'note',paperId:'fixture',body:'Keep'});await app.locals.store.save();
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});});
  const request=async body=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/papers/fixture`,{method:body?'PATCH':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
  assert.deepEqual((await request()).data.paper.institutions,[]);
  for(const bad of [null,'not an array',[''],['A\nB'],[42],['x'.repeat(301)]]){
    const before=JSON.stringify(paper);assert.equal((await request({title:'Do not change',authors:['New'],institutions:bad})).status,400);assert.equal(JSON.stringify(paper),before);
  }
  const saved=await request({authors:[' A. Author ','A. Author','李四'],institutions:['Example University',' Example University ','第二研究所']});
  assert.equal(saved.status,200);assert.deepEqual(saved.data.paper.authors,['A. Author','李四']);assert.deepEqual(saved.data.paper.institutions,['Example University','第二研究所']);
  const reopened=await new Store(directory).init();assert.deepEqual(reopened.paper('fixture').institutions,saved.data.paper.institutions);
  assert.equal(reopened.paper('fixture').text,'Source text');assert.equal(reopened.paper('fixture').readingVersions[0].markdown,'Preserve summary.');assert.equal(reopened.paper('fixture').activeReadingId,'reading-a');assert.equal(reopened.data.annotations[0].body,'Keep');
  assert.deepEqual((await request({institutions:[]})).data.paper.institutions,[]);
});

test('bilingual byline renders names safely, expands long author lists and labels missing metadata honestly',async()=>{
  const code=ts.transpileModule(await readFile(new URL('../src/PaperByline.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const require=createRequire(import.meta.url);
  for(const language of ['zh','en']){
    const exports={};vm.runInNewContext(code,{exports,require:name=>name==='./i18n'?{t:(zh,en)=>language==='zh'?zh:en}:require(name)});
    const render=props=>renderToStaticMarkup(React.createElement(exports.default,props));
    const authors=Array.from({length:8},(_,i)=>'Author '+i);
    const html=render({authors,institutions:['<script>invalid</script>','某研究所']});
    assert.ok(authors.every(a=>html.includes(a)));assert.match(html,/<details/);assert.match(html,language==='zh'?/展开其余 2 位作者/:/Show 2 more authors/);
    assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));
    assert.match(html,language==='zh'?/研究机构/:/Institutions/);
    const missing=render({authors:[]});assert.match(missing,language==='zh'?/作者信息未收录/:/Author information unavailable/);assert.match(missing,language==='zh'?/机构信息未收录/:/Institution information unavailable/);
  }
});
