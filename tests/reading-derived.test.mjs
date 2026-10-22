import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createApp} from '../server/index.mjs';
import {publicPaper} from '../server/storage.mjs';
import {readingDerivationRevision} from '../server/reading.mjs';
import {prepareDerivedInteractive} from '../server/reading-derived.mjs';
import {outlinePdf} from './fixtures/outline-pdf.mjs';

const taskId='12345678-1234-4234-8234-123456789abc';
function original(){return {id:'source-v1',markdown:'\n  Original overview: controlled outcomes. [p.2]\n\n:::figure original-chart\n',language:'en',style:'critical',focus:'  Original focus, unchanged.  ',title:'Original interpretation',createdAt:'2026-01-01T00:00:00Z',source:{kind:'agent',agent:'Original author'},figures:[{id:'original-chart',page:2,caption:'Figure 1. Controlled observations.',crop:{x:.1,y:.2,width:.7,height:.3}}],translations:{'zh-CN':{language:'zh-CN',markdown:'已有译文，不是新的原文。'}}};}
function blocks(){return {schemaVersion:1,blocks:[
 {id:'scope',type:'concept',title:'Scope',text:'The overview describes controlled outcomes, not universal guarantees.',citations:[{page:2}]},
 {id:'chart',type:'figure',figureId:'original-chart',explanation:'The source caption describes controlled observations; no new pixel inspection is claimed.',citations:[{page:2}]},
 {id:'check',type:'question',question:'What does the comparison establish?',answer:'Only outcomes within the reported controls.',citations:[{page:2}]},
]};}
function payload(paper,extra={}){return {source:{agent:'Subscription fixture'},derivedInteractive:{sourceReadingId:'source-v1',expectedSourceRevision:readingDerivationRevision(paper,paper.readingVersions[0]),agentTaskId:taskId,interactive:blocks(),...extra}};}
async function fixture(t){
 const directory=await mkdtemp(join(tmpdir(),'pw-derived-reading-'));let modelCalls=0;
 const app=await createApp({dataDir:directory,fetchImpl:async()=>{modelCalls++;throw new Error('No inference allowed');}});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});assert.equal(modelCalls,0);});
 const origin=`http://127.0.0.1:${server.address().port}`;
 const form=new FormData();form.append('file',new Blob([outlinePdf()],{type:'application/pdf'}),'source.pdf');
 const uploaded=await fetch(origin+'/api/upload',{method:'POST',body:form});assert.equal(uploaded.status,201);
 const paper=app.locals.store.paper((await uploaded.json()).paper.id);
 paper.readingVersions=[original(),{...original(),id:'other-v2',markdown:'A later article remains selected.',createdAt:'2026-01-02T00:00:00Z',figures:[],translations:{}}];
 paper.activeReadingId='other-v2';paper.figures=[{...original().figures[0],id:'current-chart',caption:'A newer current figure.',crop:{x:.1,y:.1,width:.3,height:.2}}];
 async function put(body){const response=await fetch(origin+`/api/papers/${paper.id}/insights`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};}
 return {app,paper,origin,put};
}

test('derived import copies the exact original snapshot, attributes the companion separately, and never changes active or originals',async t=>{
 const f=await fixture(t),sourceBefore=structuredClone(f.paper.readingVersions),figuresBefore=structuredClone(f.paper.figures);
 const publicBefore=await (await fetch(f.origin+`/api/papers/${f.paper.id}`)).json();
 assert.match(publicBefore.paper.readingVersions[0].derivationRevision,/^[a-f0-9]{64}$/);
 const result=await f.put(payload(f.paper));assert.equal(result.status,200);assert.equal(result.data.reused,false);
 const version=result.data.readingVersion;
 assert.equal(version.markdown,sourceBefore[0].markdown);assert.equal(version.language,'en');assert.equal(version.style,'critical');assert.equal(version.focus,sourceBefore[0].focus);assert.equal(version.title,sourceBefore[0].title);
 assert.deepEqual(version.figures,sourceBefore[0].figures);assert.deepEqual(version.translations,{});
 assert.deepEqual(version.source,{kind:'agent',agent:'Subscription fixture'});assert.deepEqual(version.articleSource,sourceBefore[0].source);
 assert.equal(version.mode,'agent-interactive');assert.equal(version.derivedFromReadingId,'source-v1');assert.equal(version.agentTaskId,taskId);
 assert.equal(version.derivedSourceRevision,publicBefore.paper.readingVersions[0].derivationRevision);
 assert.equal(result.data.paper.activeReadingId,'other-v2');assert.equal(f.paper.readingVersions.length,3);
 assert.deepEqual(f.paper.readingVersions.slice(0,2),sourceBefore);assert.deepEqual(f.paper.figures,figuresBefore);
 assert.equal(f.paper.summary,undefined);assert.equal(f.paper.report,undefined);
});

test('same task concurrent submissions append once; changed result conflicts without changing the saved version',async t=>{
 const f=await fixture(t),body=payload(f.paper);
 const results=await Promise.all([f.put(body),f.put(body)]);
 assert.deepEqual(results.map(x=>x.status),[200,200]);assert.deepEqual(results.map(x=>x.data.reused).sort(),[false,true]);
 assert.equal(results[0].data.readingVersion.id,results[1].data.readingVersion.id);assert.equal(f.paper.readingVersions.length,3);
 const saved=structuredClone(f.paper.readingVersions.at(-1)),different=structuredClone(body);different.derivedInteractive.interactive.blocks[0].text='An intentionally different companion.';
 assert.equal((await f.put(different)).status,409);assert.deepEqual(f.paper.readingVersions.at(-1),saved);
 const retargeted=structuredClone(body);retargeted.derivedInteractive.sourceReadingId='other-v2';retargeted.derivedInteractive.expectedSourceRevision=readingDerivationRevision(f.paper,f.paper.readingVersions[1]);retargeted.derivedInteractive.interactive.blocks=[retargeted.derivedInteractive.interactive.blocks[0]];
 assert.equal((await f.put(retargeted)).status,409);assert.equal(f.paper.readingVersions.length,3);
});

test('source revision rejects stale content while unrelated active, translation and current-figure changes cannot redirect the task',async t=>{
 const f=await fixture(t),body=payload(f.paper),source=f.paper.readingVersions[0];
 source.markdown+='Changed original.';const before=JSON.stringify(f.paper);
 assert.equal((await f.put(body)).status,409);assert.equal(JSON.stringify(f.paper),before);
 source.markdown=original().markdown;
 f.paper.activeReadingId='source-v1';source.translations.en={markdown:'A translated cache is never the original.'};f.paper.figures=[];
 const result=await f.put(body);assert.equal(result.status,200);assert.equal(result.data.paper.activeReadingId,'source-v1');
 assert.deepEqual(result.data.readingVersion.figures,original().figures);assert.equal(result.data.readingVersion.markdown,original().markdown);
});

test('strict derived envelope rejects fabricated current figures, invalid paper/page bindings, executable fields and replacement content atomically',async t=>{
 const f=await fixture(t),baseline=JSON.stringify(f.paper);
 for(const [change,status] of [
  [body=>body.derivedInteractive.sourceReadingId='',400],
  [body=>body.derivedInteractive.sourceReadingId='foreign-version',404],
  [body=>body.derivedInteractive.expectedSourceRevision='not-a-revision',400],
  [body=>body.derivedInteractive.agentTaskId='not-a-uuid',400],
  [body=>body.summary={markdown:'Replacement',language:'en'},400],
  [body=>body.figures=f.paper.figures,400],
  [body=>body.derivedInteractive.markdown='Translated article disguised as original.',400],
  [body=>body.derivedInteractive.language='zh-CN',400],
  [body=>body.derivedInteractive.interactive.blocks[1].figureId='current-chart',400],
  [body=>body.derivedInteractive.interactive.blocks[1].citations=[{page:1}],400],
  [body=>body.derivedInteractive.interactive.blocks[0].citations=[{page:99}],400],
  [body=>body.derivedInteractive.interactive.blocks[0].script='alert(1)',400],
  [body=>body.derivedInteractive.interactive.blocks[0].html='<iframe src="https://example.org">',400],
  [body=>body.derivedInteractive.interactive.blocks[1].url='https://example.org/chart.png',400],
 ]){
  const body=payload(f.paper);change(body);const result=await f.put(body);assert.equal(result.status,status,JSON.stringify(result.data));assert.equal(JSON.stringify(f.paper),baseline);
 }
 const body=payload(f.paper);body.derivedInteractive.interactive.blocks[0].text='The bound 0 < x < 1 is scientific text; a citation may spell https://example.org without fetching it.';
 assert.equal((await f.put(body)).status,200,'Plain scientific text is rendered as text, not interpreted as executable content');
});

test('derivation revision binds original text, figure geometry, language and provenance but excludes translation caches',()=>{
 const paper={id:'paper',pages:[{number:1},{number:2}],readingVersions:[original()],figures:[]};
 const version=paper.readingVersions[0],revision=readingDerivationRevision(paper,version);
 for(const mutate of [v=>v.markdown+='new',v=>v.language='zh-CN',v=>v.focus='other',v=>v.title='other',v=>v.figures[0].crop.x=.2,v=>v.figures[0].caption='other',v=>v.source.agent='other']){
  const changed=structuredClone(version);mutate(changed);assert.notEqual(readingDerivationRevision(paper,changed),revision);
 }
 version.translations.en={markdown:'new cache'};paper.activeReadingId='another';paper.figures=[{id:'unrelated'}];
 assert.equal(readingDerivationRevision(paper,version),revision);
 const legacy={id:'legacy-paper',pages:paper.pages,figures:original().figures,summary:{...original(),id:undefined,figures:undefined}};
 const exposed=publicPaper(legacy).readingVersions[0];assert.equal(legacy.readingVersions,undefined);
 const body={source:{agent:'Fixture'},derivedInteractive:{sourceReadingId:exposed.id,expectedSourceRevision:exposed.derivationRevision,agentTaskId:taskId,interactive:blocks()}};
 assert.deepEqual(prepareDerivedInteractive(body,legacy).readingVersion.figures,exposed.figures);
 legacy.figures[0].caption='Changed legacy fallback';assert.throws(()=>prepareDerivedInteractive(body,legacy),error=>error.status===409);
});

test('the subscription CLI reads the source revision and publishes one idempotent companion without a model key',async t=>{
 const f=await fixture(t);
 async function cli(args,body){return await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['scripts/paper-workbench.mjs',...args],{cwd:new URL('..',import.meta.url),env:{PATH:process.env.PATH,PAPER_WORKBENCH_URL:f.origin,PAPER_WORKBENCH_API_KEY:''},stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.on('error',reject);child.on('close',code=>code?reject(new Error(stderr||`CLI exited ${code}`)):resolve(JSON.parse(stdout)));child.stdin.end(body===undefined?undefined:JSON.stringify(body));
 });}
 const initial=await cli(['readings',f.paper.id]),version=initial.readingVersions.find(item=>item.id==='source-v1');
 const body=payload(f.paper,{expectedSourceRevision:version.derivationRevision});
 const first=await cli(['publish',f.paper.id,'-'],body),second=await cli(['publish',f.paper.id,'-'],body);
 assert.equal(first.reused,false);assert.equal(second.reused,true);assert.equal(first.readingVersion.id,second.readingVersion.id);
 const readings=await cli(['readings',f.paper.id]);assert.equal(readings.activeReadingId,initial.activeReadingId);
 assert.equal(readings.readingVersions.filter(item=>item.agentTaskId===taskId).length,1);
 assert.equal(readings.readingVersions.find(item=>item.agentTaskId===taskId).markdown,version.markdown);
});
