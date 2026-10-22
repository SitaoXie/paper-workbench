import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {PDFDocument,PDFName,PDFArray,PDFDict} from 'pdf-lib';
import {createApp} from '../server/index.mjs';
import {outlinePdf} from './fixtures/outline-pdf.mjs';

async function fixture(t,{source='upload'}={}){
 const dir=await mkdtemp(join(tmpdir(),'pw-annotation-export-'));let modelCalls=0;
 const bytes=outlinePdf();
 const feed='<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2501.00001v1</id><title>Synthetic annotation source</title><summary>Source evidence for isolated annotation export testing.</summary><published>2025-01-01</published><author><name>Fixture Author</name></author></entry></feed>';
 const app=await createApp({dataDir:dir,download:async url=>({buffer:url.includes('api/query')?Buffer.from(feed):bytes,url,contentType:url.includes('api/query')?'application/atom+xml':'application/pdf'}),fetchImpl:async()=>{modelCalls++;throw new Error('No model call is needed for a PDF export');}});const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`;const data=new FormData();data.append('file',new Blob([bytes],{type:'application/pdf'}),'source.pdf');
 const upload=source==='upload'?await fetch(base+'/api/upload',{method:'POST',body:data}):await fetch(base+'/api/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:source==='arxiv'?'https://arxiv.org/abs/2501.00001':'https://example.org/source.pdf'})});assert.equal(upload.status,201);const {paper}=await upload.json();
 async function add(body){const response=await fetch(`${base}/api/papers/${paper.id}/annotations`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,201,await response.clone().text());return (await response.json()).annotation;}
 return {app,dir,base,paper,bytes,add,modelCalls:()=>modelCalls};
}

test('PDF annotation download keeps source bytes and saved notes intact while exporting Chinese, cross-page and ink marks',async t=>{
 const f=await fixture(t);await f.add({kind:'highlight',segments:[{page:1,quote:'Introduction to evidence',rects:[{x:.08,y:.06,width:.65,height:.05}]},{page:2,quote:'Method page',rects:[{x:.08,y:.06,width:.4,height:.05}]}],body:'中文证据笔记',tags:['复核'],color:'yellow'});
 await f.add({kind:'underline',page:3,quote:'Results and limitations',rects:[{x:.08,y:.22,width:.6,height:.05}],body:'Preserve the limit',color:'blue'});
 await f.add({kind:'ink',page:2,strokes:[{width:.004,points:[{x:.1,y:.5},{x:.3,y:.6}]},{width:.008,points:[{x:.35,y:.6},{x:.4,y:.65}]}],body:'手写说明',color:'pink'});
 await f.add({kind:'note',page:1,body:'未定位的整页笔记',tags:['general']});
 const removed=await f.add({kind:'note',page:1,body:'Deleted note should stay deleted'});await fetch(`${f.base}/api/papers/${f.paper.id}/annotations/${removed.id}`,{method:'DELETE'});
 const before=JSON.stringify(f.app.locals.store.data.annotations);const response=await fetch(`${f.base}/api/papers/${f.paper.id}/annotations/export?format=pdf`);assert.equal(response.status,200,await response.clone().text());assert.match(response.headers.get('content-type'),/application\/pdf/);assert.match(response.headers.get('content-disposition'),/attachment; filename="paper-annotated.pdf"/);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-annotation-count'),'6');assert.equal(response.headers.get('x-annotation-page-comments'),'1');
 const exported=await PDFDocument.load(await response.arrayBuffer(),{updateMetadata:false});assert.equal(exported.getPageCount(),3);const contents=[];let count=0;for(const page of exported.getPages()){const annots=page.node.lookup(PDFName.of('Annots'),PDFArray);for(let i=0;i<annots.size();i++){const annotation=annots.lookup(i,PDFDict);count++;contents.push(annotation.lookup(PDFName.of('Contents')).decodeText());assert.ok(annotation.has(PDFName.of('AP')));}}assert.equal(count,6);assert.ok(contents.some(text=>text.includes('中文证据笔记')));assert.ok(contents.some(text=>text.includes('复核')));assert.ok(contents.some(text=>text.includes('未定位的整页笔记')));assert.ok(contents.every(text=>!text.includes('Deleted note')));
 assert.deepEqual(await readFile(join(f.dir,f.app.locals.store.data.papers[0].filePath)),f.bytes);assert.equal(JSON.stringify(f.app.locals.store.data.annotations),before);assert.equal(f.modelCalls(),0);
});

test('annotation PDF export rejects changed or absent sources and leaves alternate exports available',async t=>{
 const f=await fixture(t);await f.add({kind:'note',page:1,body:'Retain this note'});const file=join(f.dir,f.app.locals.store.data.papers[0].filePath);await appendFile(file,'\n% changed bytes');let response=await fetch(`${f.base}/api/papers/${f.paper.id}/annotations/export?format=pdf`);assert.equal(response.status,409);assert.match((await response.json()).error,/source PDF changed/);response=await fetch(`${f.base}/api/papers/${f.paper.id}/annotations/export?format=json`);assert.equal(response.status,200);assert.equal((await response.json()).annotations.length,1);
 f.app.locals.store.data.papers[0].filePath=undefined;response=await fetch(`${f.base}/api/papers/${f.paper.id}/annotations/export?format=pdf`);assert.equal(response.status,404);response=await fetch(`${f.base}/api/papers/${f.paper.id}/annotations/export?format=bogus`);assert.equal(response.status,400);assert.equal(f.modelCalls(),0);
});

test('API-valid rectangles with subpixel edge excess export as clamped marks on the source page',async t=>{
 const f=await fixture(t);await f.add({kind:'highlight',page:1,rects:[{x:.9,y:.96,width:.1000005,height:.0400005}],body:'A saved edge selection'});
 const response=await fetch(`${f.base}/api/papers/${f.paper.id}/annotations/export?format=pdf`);assert.equal(response.status,200,await response.clone().text());
 const doc=await PDFDocument.load(await response.arrayBuffer());const page=doc.getPage(0);const mark=page.node.lookup(PDFName.of('Annots'),PDFArray).lookup(0,PDFDict);const rect=mark.lookup(PDFName.of('Rect'),PDFArray).asArray().map(value=>value.asNumber());
 assert.equal(rect[2],page.getWidth());assert.equal(rect[1],0);
 assert.equal(f.app.locals.store.data.annotations[0].rects[0].width,.1000005,'Export must not rewrite the saved selection');assert.equal(f.modelCalls(),0);
});

test('all PDF import paths retain an immutable source hash and a later current-figure hash cannot rebind old notes',async t=>{
 for(const source of ['upload','url','arxiv']){
  const f=await fixture(t,{source});const raw=f.app.locals.store.paper(f.paper.id);const digest=createHash('sha256').update(f.bytes).digest('hex');
  assert.equal(raw.sourcePdfRevision,digest);assert.equal(raw.pdfRevision,digest);
  await f.add({kind:'note',page:1,body:'An anchor from the imported source'});
  let response=await fetch(`${f.base}/api/papers/${f.paper.id}/annotations/export?format=pdf`);assert.equal(response.status,200,source);
  const file=join(f.dir,raw.filePath);await appendFile(file,'\n% independently replaced source bytes');
  raw.pdfRevision=createHash('sha256').update(await readFile(file)).digest('hex');
  response=await fetch(`${f.base}/api/papers/${f.paper.id}/annotations/export?format=pdf`);assert.equal(response.status,409,source);assert.equal((await response.json()).code,'pdf_source_changed');
  assert.equal(raw.sourcePdfRevision,digest);assert.equal(f.app.locals.store.data.annotations[0].body,'An anchor from the imported source');assert.equal(f.modelCalls(),0);
 }
});

test('legacy upload hashes remain usable while unbound legacy arXiv exports fail explicitly without signing current bytes',async t=>{
 const uploaded=await fixture(t);delete uploaded.app.locals.store.paper(uploaded.paper.id).sourcePdfRevision;delete uploaded.app.locals.store.paper(uploaded.paper.id).pdfRevision;
 await uploaded.add({kind:'note',page:1,body:'Legacy upload remains anchored by contentHash'});
 assert.equal((await fetch(`${uploaded.base}/api/papers/${uploaded.paper.id}/annotations/export?format=pdf`)).status,200);
 const legacy=await fixture(t,{source:'arxiv'});const raw=legacy.app.locals.store.paper(legacy.paper.id);delete raw.sourcePdfRevision;
 await legacy.add({kind:'note',page:1,body:'Legacy note without a provable original hash'});
 const before=JSON.stringify(legacy.app.locals.store.data);const response=await fetch(`${legacy.base}/api/papers/${legacy.paper.id}/annotations/export?format=pdf`);
 assert.equal(response.status,409);assert.equal((await response.json()).code,'pdf_source_unbound');assert.equal(JSON.stringify(legacy.app.locals.store.data),before);
 for(const format of ['json','markdown'])assert.equal((await fetch(`${legacy.base}/api/papers/${legacy.paper.id}/annotations/export?format=${format}`)).status,200);
 assert.equal(raw.sourcePdfRevision,undefined);assert.equal(legacy.modelCalls(),0);
});

test('legacy readers can explicitly accept current PDF bytes for export without claiming an original hash or verifying notes',async t=>{
 const f=await fixture(t,{source:'arxiv'});const raw=f.app.locals.store.paper(f.paper.id);delete raw.sourcePdfRevision;
 await f.add({kind:'note',page:1,body:'Historical position remains a user responsibility'});
 const notes=JSON.stringify(f.app.locals.store.data.annotations),before=JSON.stringify(raw);
 const endpoint=`${f.base}/api/papers/${f.paper.id}/annotations/pdf-source`;
 let response=await fetch(endpoint);assert.equal(response.status,200);const status=await response.json();
 assert.equal(status.bindingStatus,'unbound');assert.match(status.pdfRevision,/^[a-f0-9]{64}$/);assert.equal(status.boundPdfRevision,undefined);assert.equal(JSON.stringify(raw),before);
 const post=body=>fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 for(const body of [{},{expectedPdfRevision:status.pdfRevision,acceptCurrentSource:false},{expectedPdfRevision:status.pdfRevision,acceptCurrentSource:true,sourcePdfRevision:status.pdfRevision}]){
  response=await post(body);assert.equal(response.status,400);assert.equal((await response.json()).code,'pdf_source_acceptance_invalid');
 }
 response=await post({expectedPdfRevision:'f'.repeat(64),acceptCurrentSource:true});assert.equal(response.status,409);assert.equal((await response.json()).code,'pdf_source_changed');assert.equal(raw.annotationExportBinding,undefined);
 response=await post({expectedPdfRevision:status.pdfRevision,acceptCurrentSource:true});assert.equal(response.status,201);const accepted=await response.json();
 assert.equal(accepted.bindingStatus,'user-accepted');assert.equal(accepted.boundPdfRevision,status.pdfRevision);
 assert.deepEqual(Object.keys(accepted.annotationExportBinding).sort(),['acceptedAt','method','pdfRevision']);
 assert.equal(accepted.annotationExportBinding.method,'user-accepted-current-pdf');assert.ok(Number.isFinite(Date.parse(accepted.annotationExportBinding.acceptedAt)));
 assert.equal(raw.sourcePdfRevision,undefined);assert.equal(raw.pdfRevision,status.pdfRevision);assert.equal(JSON.stringify(f.app.locals.store.data.annotations),notes);
 assert.deepEqual((await createApp({dataDir:f.dir})).locals.store.paper(f.paper.id).annotationExportBinding,accepted.annotationExportBinding);
 response=await fetch(`${f.base}/api/papers/${f.paper.id}/annotations/export?format=pdf`);assert.equal(response.status,200);assert.equal(response.headers.get('x-annotation-source-binding'),'user-accepted');
 response=await post({expectedPdfRevision:status.pdfRevision,acceptCurrentSource:true});assert.equal(response.status,409);assert.equal((await response.json()).code,'pdf_source_already_bound');assert.deepEqual(raw.annotationExportBinding,accepted.annotationExportBinding);
 await appendFile(join(f.dir,raw.filePath),'\n% source changed after user acceptance');
 response=await fetch(endpoint);const changed=await response.json();assert.equal(response.status,200);assert.equal(changed.bindingStatus,'changed');assert.equal(changed.boundPdfRevision,status.pdfRevision);assert.notEqual(changed.pdfRevision,status.pdfRevision);
 response=await post({expectedPdfRevision:changed.pdfRevision,acceptCurrentSource:true});assert.equal(response.status,409);assert.equal((await response.json()).code,'pdf_source_changed');assert.deepEqual(raw.annotationExportBinding,accepted.annotationExportBinding);
 response=await fetch(`${f.base}/api/papers/${f.paper.id}/annotations/export?format=pdf`);assert.equal(response.status,409);assert.equal((await response.json()).code,'pdf_source_changed');assert.equal(f.modelCalls(),0);
});

test('source acceptance cannot replace original binding and concurrent legacy acceptance saves exactly one immutable choice',async t=>{
 const original=await fixture(t);const originalEndpoint=`${original.base}/api/papers/${original.paper.id}/annotations/pdf-source`;
 const post=(url,expectedPdfRevision)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedPdfRevision,acceptCurrentSource:true})});
 let status=await (await fetch(originalEndpoint)).json();assert.equal(status.bindingStatus,'original');assert.equal(status.boundPdfRevision,original.paper.sourcePdfRevision);
 let response=await post(originalEndpoint,status.pdfRevision);assert.equal(response.status,409);assert.equal((await response.json()).code,'pdf_source_already_bound');
 const rawOriginal=original.app.locals.store.paper(original.paper.id);assert.equal(rawOriginal.annotationExportBinding,undefined);
 await appendFile(join(original.dir,rawOriginal.filePath),'\n% changed original');
 status=await (await fetch(originalEndpoint)).json();assert.equal(status.bindingStatus,'changed');response=await post(originalEndpoint,status.pdfRevision);assert.equal(response.status,409);assert.equal((await response.json()).code,'pdf_source_changed');assert.equal(rawOriginal.annotationExportBinding,undefined);
 const legacy=await fixture(t,{source:'arxiv'});const raw=legacy.app.locals.store.paper(legacy.paper.id);delete raw.sourcePdfRevision;
 const endpoint=`${legacy.base}/api/papers/${legacy.paper.id}/annotations/pdf-source`;const source=await (await fetch(endpoint)).json();
 const responses=await Promise.all([post(endpoint,source.pdfRevision),post(endpoint,source.pdfRevision)]);assert.deepEqual(responses.map(item=>item.status).sort(),[201,409]);
 const accepted=await responses.find(item=>item.status===201).json();assert.deepEqual(raw.annotationExportBinding,accepted.annotationExportBinding);
 const conflict=await responses.find(item=>item.status===409).json();assert.ok(['pdf_source_binding_changed','pdf_source_already_bound'].includes(conflict.code));
 assert.equal(raw.sourcePdfRevision,undefined);assert.equal(legacy.modelCalls(),0);assert.equal(original.modelCalls(),0);
});
