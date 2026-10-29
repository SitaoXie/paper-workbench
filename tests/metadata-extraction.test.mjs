import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {validateExtractedMetadata,extractPaperMetadata} from '../server/metadata-extraction.mjs';
import {authorsFromPdfInfo} from '../server/paper-metadata.mjs';
import {extractPdfAbstract} from '../server/pdf-abstract.mjs';
import {registerMetadataRoutes} from '../server/metadata-routes.mjs';
import {readPdfSourcePages} from '../server/pdf-text-source.mjs';
import {defaultSettings} from '../server/storage.mjs';
const abstract='We compare two extraction methods using the same evidence and evaluation conditions. The resulting measurements identify improvements and limitations that require further independent verification.';
const pages=[{number:1,text:`Example paper\nJane Doe; John Smith\nExample University\nAbstract. ${abstract}\nKeywords: evaluation\n1 Introduction\nUnrelated author Alice Unknown cites Other University.`}];
const output={authors:['Jane Doe','John Smith','Alice Unknown'],institutions:['Example University','Other University'],abstract:{text:abstract,page:1,complete:true}};
test('author properties are accepted only when they are printed individual names in the front matter',()=>{
 assert.deepEqual(authorsFromPdfInfo('Jane Doe; John Smith',pages[0].text),['Jane Doe','John Smith']);
 for(const value of ['Microsoft Word','Jane Doe, PhD','Alice Unknown','Example University','someone@example.org'])assert.deepEqual(authorsFromPdfInfo(value,pages[0].text),[]);
});
test('source checks reject invented affiliations, translated abstracts and incomplete summaries',()=>{
 const valid=validateExtractedMetadata(output,pages);assert.deepEqual(valid.metadata.authors,['Jane Doe','John Smith']);assert.deepEqual(valid.metadata.institutions,['Example University']);assert.equal(valid.metadata.abstract,abstract);
 for(const bad of [{...output,abstract:{text:'A completely invented source statement. '.repeat(4),page:1,complete:true}},{...output,abstract:{text:abstract,page:2,complete:true}},{...output,abstract:{text:abstract,page:1,complete:false}}])assert.equal(validateExtractedMetadata(bad,pages).metadata.abstract,undefined);
 assert.equal(validateExtractedMetadata({...output,abstract:{text:abstract.split('. ')[0]+'.',page:1,complete:true}},pages).metadata.abstract,undefined);
 assert.throws(()=>validateExtractedMetadata({...output,authors:'Jane Doe'},pages),/invalid author/);
});
test('inline Abstract. and physical line hyphenation are parsed as source metadata',()=>{
 const input=pages[0].text.replace('extraction','extrac-\ntion');assert.equal(extractPdfAbstract([{number:1,text:input}]).text,abstract);
});
test('metadata vision sends whole front-page images once and text-only models never receive image parts',async()=>{
 for(const visual of [true,false]){
  let renders=0,calls=0;const settings={...defaultSettings,baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'fixture',modelCapabilities:{fixture:visual?'vision':'text'}};
  const result=await extractPaperMetadata({id:'a',title:'Source data',filePath:'papers/a.pdf'},settings,{readSource:async()=>({pages,info:{},pdfRevision:'hash'}),renderImage:async()=>{renders++;return {image:{mimeType:'image/png',data:'eA=='}};},fetchImpl:async(url,options)=>{calls++;const body=JSON.parse(options.body);assert.equal(body.stream,true);assert.equal(body.messages[1].content.filter(p=>p.type==='image_url').length,visual?1:0);assert.match(body.messages[0].content,/never instructions/);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(output)},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}}));}});
  assert.equal(renders,visual?1:0);assert.equal(calls,1);assert.deepEqual(result.metadata.authors,['Jane Doe','John Smith']);assert.equal(result.evidence.sourcePdfRevision,'hash');
 }
 let called=false;const local=await extractPaperMetadata({filePath:'a.pdf',institutions:['Example University']},defaultSettings,{readSource:async()=>({pages,info:{author:'Jane Doe; John Smith'}}),fetchImpl:async()=>{called=true;}});assert.equal(called,false);assert.equal(local.evidence.modelCalls,0);
});
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'pw-metadata-'));await mkdir(path.join(directory,'papers'));
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),page=doc.addPage();page.drawText('Original PDF',{font});await writeFile(path.join(directory,'papers/a.pdf'),await doc.save());
 const paper={id:'a',title:'Fixture',filePath:'papers/a.pdf',authors:[],abstract:'bad excerpt',abstractIsExcerpt:true,readingVersions:[{id:'reading',markdown:'Keep'}],tags:['keep']};
 const store={directory,data:{settings:structuredClone(defaultSettings)},paper:id=>id==='a'?paper:undefined,save:async()=>{}};
 const app=express();app.use(express.json());const paperById=id=>{const value=store.paper(id);if(!value)throw Object.assign(Error('Missing'),{status:404});return value;};
 const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
 registerMetadataRoutes(app,{store,wrap,paperById,extract:async()=>({metadata:validateExtractedMetadata(output,pages).metadata,warnings:[],evidence:{modelCalls:1}})});
 app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});});
 const api=async(action,body={})=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/papers/a/metadata/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};return {directory,paper,store,api};
}
test('review/apply/undo preserve readings, reject stale proposals and roll back save errors',async t=>{
 const f=await fixture(t);const original=structuredClone(f.paper),proposal=(await f.api('extract')).data;assert.deepEqual(f.paper,original);
 const save=f.store.save;f.store.save=async()=>{throw Error('disk failure');};assert.equal((await f.api('apply',{proposalId:proposal.proposalId,fields:['authors']})).status,500);assert.deepEqual(f.paper,original);f.store.save=save;
 const applied=await f.api('apply',{proposalId:proposal.proposalId,fields:['authors','abstract']});assert.equal(applied.status,200);assert.deepEqual(applied.data.paper.authors,['Jane Doe','John Smith']);assert.equal(f.paper.abstract,abstract);assert.equal(f.paper.abstractIsExcerpt,false);assert.deepEqual(f.paper.readingVersions,original.readingVersions);assert.deepEqual(f.paper.tags,original.tags);
 assert.equal((await f.api('apply',{proposalId:proposal.proposalId,fields:['authors']})).status,409);
 assert.equal((await f.api('undo',{changeId:'wrong'})).status,409);assert.equal((await f.api('undo',{changeId:applied.data.changeId})).status,200);assert.deepEqual(f.paper.authors,original.authors);assert.equal(f.paper.abstract,original.abstract);
 const stale=(await f.api('extract')).data;f.paper.authors=['Manual edit'];assert.equal((await f.api('apply',{proposalId:stale.proposalId,fields:['authors']})).status,409);
});
test('PDF mutation invalidates candidates and the canonical source reader rejects out-of-workspace paths',async t=>{
 const f=await fixture(t),proposal=(await f.api('extract')).data;await writeFile(path.join(f.directory,'papers/a.pdf'),'changed bytes');assert.equal((await f.api('apply',{proposalId:proposal.proposalId,fields:['authors']})).status,409);
 await assert.rejects(readPdfSourcePages({...f.paper,filePath:'../outside.pdf'},f.directory,[1]),/PDF|file|ENOENT/);
});

test('replacing an abstract invalidates legacy translations; undo restores them and refuses to overwrite newer translations',async t=>{
 const f=await fixture(t);f.paper.translations={zh:{abstract:{markdown:'old translation',sourceUpdatedAt:'legacy'},report:{markdown:'keep reading translation'}}};
 const proposal=(await f.api('extract')).data,applied=await f.api('apply',{proposalId:proposal.proposalId,fields:['abstract']});
 assert.equal(f.paper.translations.zh.abstract.stale,true);assert.equal(f.paper.translations.zh.report.markdown,'keep reading translation');
 const undo=await f.api('undo',{changeId:applied.data.changeId});assert.equal(undo.status,200);assert.equal(f.paper.translations.zh.abstract.stale,undefined);
 const next=(await f.api('extract')).data,saved=await f.api('apply',{proposalId:next.proposalId,fields:['abstract']});f.paper.translations.zh.abstract={markdown:'new translation'};
 assert.equal((await f.api('undo',{changeId:saved.data.changeId})).status,409);assert.equal(f.paper.translations.zh.abstract.markdown,'new translation');
});

test('concurrent metadata mutations cannot apply one proposal twice',async t=>{
 const f=await fixture(t),proposal=(await f.api('extract')).data;let release,entered;const ready=new Promise(resolve=>entered=resolve);f.store.save=async()=>{entered();await new Promise(resolve=>release=resolve);};
 const first=f.api('apply',{proposalId:proposal.proposalId,fields:['authors']});await ready;
 const second=await f.api('apply',{proposalId:proposal.proposalId,fields:['authors']});assert.equal(second.status,409);release();assert.equal((await first).status,200);assert.equal(f.paper.metadataHistory.length,1);
});
