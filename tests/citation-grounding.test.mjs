import test from 'node:test';
import assert from 'node:assert/strict';
import {citationTargets,citationPassages,groundCitations} from '../server/citation-grounding.mjs';
const original='Coverage remains limited to the sampled conditions.';
const other='The method uses repeated independent trials for every condition.';
const paper={id:'paper',title:'Fixture',pages:[{number:1,text:other},{number:2,text:original}]};
const bind=(id,passageId)=>JSON.stringify({bindings:[{citationId:id,passageId}]});
test('prose citation spans exclude escaped literals, code, math, images and external links',()=>{
 const md='\\[p.1] literal [p.2] `code [p.1]` $[p.1]$ ![image](#page=1 "x") [external](https://example.com/#page=1)\n\n[semantic][source]\n\n[source]: #page=1 "Original source"\n\n[p.1, p.2] [pp.1–2]';
 const targets=citationTargets(md);assert.equal(targets.length,2);assert.equal(md.slice(targets[0].start,targets[0].end),'[p.2]');assert.equal(targets[1].title,'Original source');assert.equal(targets[1].page,1);
});
test('alignment writes the original source sentence selected by ID and changes only the citation',async()=>{
 const markdown='A narrow claim. [p.2]\n\n```\n[p.2]\n```';let prompt;
 const result=await groundCitations(markdown,paper,{call:async messages=>{prompt=JSON.parse(messages[1].content);return bind('c0',prompt.originalPassages.find(p=>p.page===2).id);}});
 assert.equal(result.markdown,`A narrow claim. [p.2](#page=2 "${original}")\n\n\`\`\`\n[p.2]\n\`\`\``);
 assert.equal(result.stats.added,1);assert.equal(result.stats.modelCalls,1);assert.equal(prompt.citations[0].page,2);assert.equal(prompt.originalPassages[0].text,original);
});
test('wrong-page IDs, duplicate bindings and invented quotes cannot create a highlight',async()=>{
 const markdown='One. [p.1] Two. [p.2]';
 for(const bindings of [
  [{citationId:'c0',passageId:'p2s0'}],
  [{citationId:'c0',passageId:'p1s0'},{citationId:'c0',passageId:'p1s0'}],
  [{citationId:'c0',passageId:'invented',quote:'FAKE_SENTENCE'}],
 ]){const result=await groundCitations(markdown,paper,{call:async()=>JSON.stringify({bindings})});assert.equal(result.markdown,markdown);assert.equal(result.stats.added,0);}
});
test('fabricated or ambiguous existing quote titles fall back to the page; valid titles need no paid call',async()=>{
 let calls=0;
 const invalid=await groundCitations('[Claim](#page=2 "NOT IN SOURCE")',paper);
 assert.equal(invalid.markdown,'[Claim](#page=2)');assert.equal(invalid.stats.downgraded,1);
 const valid=await groundCitations(`[Claim](#page=2 "${original}")`,paper,{call:async()=>{calls++;throw Error('Must not run');}});
 assert.equal(valid.stats.matched,1);assert.equal(calls,0);
 const ambiguous={...paper,pages:[{number:2,text:`${original} ${original}`}]};
 assert.equal(citationPassages(ambiguous,new Set([2])).length,0);
 const result=await groundCitations(`[Claim](#page=2 "${original}")`,ambiguous);assert.equal(result.markdown,'[Claim](#page=2)');
});
test('source quote escaping preserves quotes, backslashes, entities and the exact source binding',async()=>{
 const sentence='The configuration contains "alpha" and \\beta with &copy; as literal source text.';
 const p={...paper,pages:[{number:2,text:sentence}]};
 const result=await groundCitations('Claim. [p.2]',p,{call:async()=>bind('c0','p2s0')});
 assert.equal(citationTargets(result.markdown)[0].title,sentence);assert.equal(result.stats.added,1);
});
test('bad provider responses leave the completed prose and page references intact without retry',async()=>{
 for(const response of ['not JSON',JSON.stringify({bindings:null})]){let calls=0;const result=await groundCitations('Claim. [p.2]',paper,{call:async()=>{calls++;return response;}});assert.equal(result.markdown,'Claim. [p.2]');assert.equal(result.stats.status,'unavailable');assert.equal(calls,1);}
 const abort=new AbortController();await assert.rejects(groundCitations('Claim. [p.2]',paper,{signal:abort.signal,call:async()=>{abort.abort();throw abort.signal.reason;}}),/abort/i);
});
test('only cited pages enter the refinement budget; metadata and range-only references do not make a model call',async()=>{
 let calls=0;
 await groundCitations('Claim. [p.2]',paper,{budget:500,call:async messages=>{calls++;const input=JSON.parse(messages[1].content);assert.deepEqual(input.originalPassages.map(p=>p.page),[2]);return '{"bindings":[]}';}});
 assert.equal(calls,1);
 for(const source of [undefined,{...paper,metadataOnly:true},{...paper,pages:[]}])await groundCitations('Claim. [p.2]',source,{call:async()=>{throw Error('No PDF binding');}});
 const ranged=await groundCitations('Synthesis [pp.1–2].',paper,{call:async()=>{throw Error('Range stays a range');}});assert.equal(ranged.markdown,'Synthesis [pp.1–2].');
});

test('existing reading citation enhancement makes one paid call, preserves original prose and saves a separate version',async t=>{
 const {createApp}=await import('../server/index.mjs');const {validateSettings}=await import('../server/models.mjs');const {defaultSettings}=await import('../server/storage.mjs');const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=await import('node:path');
 const directory=await mkdtemp(path.join(tmpdir(),'pw-enhance-citations-'));let calls=0,invalidBindings=false;
 const app=await createApp({dataDir:directory,fetchImpl:async(_,options)=>{
  calls++;const body=JSON.parse(options.body);assert.equal(body.model,'citation-fixture');assert.match(body.messages[0].content,/align existing source citations/);assert.equal(body.stream,true);
  const input=JSON.parse(body.messages[1].content);const passage=input.originalPassages.find(p=>p.page===2);if(invalidBindings)return new Response(JSON.stringify({choices:[{message:{content:'not JSON'},finish_reason:'stop'}]}));return new Response(JSON.stringify({choices:[{message:{content:bind(input.citations[0].id,passage.id)},finish_reason:'stop'}]}));
 }});
 app.locals.store.data.settings=validateSettings({profiles:[{id:'main',name:'Primary',model:'main-model',models:['main-model'],baseUrl:'https://fixture.example/v1',apiKey:'fixture'},{id:'citations',name:'Citation model',model:'citation-fixture',models:['citation-fixture'],baseUrl:'https://fixture.example/v1',apiKey:'fixture'}],activeProfileId:'main'},defaultSettings);
 const originalReading={id:'original',markdown:'Coverage is bounded. [p.2]',format:'article',style:'deep',focus:'',language:'en',createdAt:new Date().toISOString(),source:{kind:'agent',agent:'fixture'}};
 app.locals.store.data.papers.push({...paper,abstract:'Source abstract.',tags:[],createdAt:new Date().toISOString(),readingVersions:[originalReading],activeReadingId:'original'});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});});
 const invalid=await fetch(`http://127.0.0.1:${server.address().port}/api/papers/paper/report`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({readingId:'original',format:'article',citationsOnly:true,profileId:'citations',model:'unconfigured'})});assert.equal(invalid.status,400);assert.equal(calls,0);
 const local=await fetch(`http://127.0.0.1:${server.address().port}/api/papers/paper/report`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({readingId:'original',format:'article',citationsOnly:true,localOnly:true})});assert.equal(local.status,200);assert.equal(calls,0);assert.equal(app.locals.store.paper('paper').readingVersions.length,1);
 invalidBindings=true;
 const failed=await fetch(`http://127.0.0.1:${server.address().port}/api/papers/paper/report`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({readingId:'original',format:'article',citationsOnly:true,profileId:'citations',model:'citation-fixture'})});
 assert.equal(failed.status,502);assert.equal(calls,1);assert.equal(app.locals.store.paper('paper').readingVersions.length,1);assert.equal(app.locals.store.paper('paper').readingVersions[0].markdown,originalReading.markdown);
 invalidBindings=false;
 const response=await fetch(`http://127.0.0.1:${server.address().port}/api/papers/paper/report`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({readingId:'original',format:'article',citationsOnly:true,profileId:'citations',model:'citation-fixture'})});
 assert.equal(app.locals.store.data.settings.activeProfileId,'main');assert.equal(app.locals.store.data.settings.model,'main-model');
 assert.equal(response.status,200);const result=await response.json();assert.equal(calls,2);
 const old=result.paper.readingVersions.find(v=>v.id==='original'),current=result.paper.readingVersions.find(v=>v.id===result.paper.activeReadingId);
 assert.equal(old.markdown,'Coverage is bounded. [p.2]');assert.notEqual(current.id,'original');assert.equal(current.markdown,`Coverage is bounded. [p.2](#page=2 "${original}")`);assert.equal(current.source.citationLocations.added,1);assert.equal(result.report.derivedFromReadingId,'original');
 const usage=await fetch(`http://127.0.0.1:${server.address().port}/api/usage?days=all`).then(r=>r.json());assert.ok(usage.recent.some(item=>item.stage==='overview-citation-alignment'));
});

test('PDF physical line breaks do not become incomplete source sentences; existing fragments expand within the same sentence',async()=>{
 const p={id:'lines',pages:[{number:1,text:'Our MAE approach masks random patches of the\ninput image and reconstructs the missing pixels. First, we use an asym-\nmetric encoder that sees only visible patches.'}]};
 const candidates=citationPassages(p,new Set([1]));
 assert.equal(candidates.length,2);assert.equal(candidates[0].text,'Our MAE approach masks random patches of the input image and reconstructs the missing pixels.');
 assert.match(candidates[1].text,/asymmetric encoder/);
 const result=await groundCitations('[Method](#page=1 "Our MAE approach masks random patches of the")',p);
 assert.equal(result.stats.expanded,1);assert.equal(result.stats.modelCalls,0);assert.equal(citationTargets(result.markdown)[0].title,candidates[0].text);
});

test('image-mode questions retain page pixels and align final citations against original text in one separate call',async t=>{
 const {answerQuestion}=await import('../server/models.mjs');const {defaultSettings}=await import('../server/storage.mjs');
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=await import('node:path');const {PDFDocument,StandardFonts}=await import('pdf-lib');
 const directory=await mkdtemp(path.join(tmpdir(),'citation-pixels-'));t.after(()=>rm(directory,{recursive:true,force:true}));const pdf=await PDFDocument.create();const font=await pdf.embedFont(StandardFonts.Helvetica);pdf.addPage().drawText(original,{x:30,y:300,size:10,font});await writeFile(path.join(directory,'fixture.pdf'),await pdf.save());
 const p={id:'image-paper',title:'Images',authors:[],abstract:'Abstract',filePath:'fixture.pdf',pageCount:1,pages:[{number:1,text:original}]};
 const calls=[];
 const result=await answerQuestion([p],'What is the limitation?',[],{...defaultSettings,apiKey:'fixture',baseUrl:'https://fixture.example/v1',model:'vision',models:['vision'],modelCapabilities:{vision:'vision'},assistant:{styleId:'detailed',pdfMode:'images'}},{
  dataDir:directory,renderImage:async()=>({image:{mimeType:'image/png',data:'aW1hZ2U='},pageCount:1}),
  fetchImpl:async(_,options)=>{const body=JSON.parse(options.body);calls.push(body);const alignment=body.messages[0].content.startsWith('You align existing source citations');
   if(alignment){const input=JSON.parse(body.messages[1].content);assert.equal(input.originalPassages[0].text,original);return new Response(JSON.stringify({choices:[{message:{content:bind('c0',input.originalPassages[0].id)},finish_reason:'stop'}]}));}
   assert.ok(body.messages.some(m=>Array.isArray(m.content)&&m.content.some(part=>part.type==='image_url')));assert.match(body.messages[0].content,/read_pages is also available/);
   return new Response(JSON.stringify({choices:[{message:{content:'Coverage is limited. [p.1]'},finish_reason:'stop'}]}));
  },
 });
 assert.equal(calls.length,2);assert.equal(result.source.pdfMode,'images');assert.equal(result.source.initialPageImageCount,1);assert.equal(result.source.citationLocations.added,1);assert.equal(result.content,`Coverage is limited. [p.1](#page=1 "${original}")`);
});
