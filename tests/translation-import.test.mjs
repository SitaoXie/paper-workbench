import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/index.mjs';
import {contentHash,defaultSettings} from '../server/storage.mjs';
import {readingDerivationRevision} from '../server/reading.mjs';
import {figureCaptionsSourceHash} from '../server/captions.mjs';
import {translateContent} from '../server/models.mjs';

const sourceQuote='有限样本不能证明不可能。';
const sourceMarkdown=`原始解读。 [限制](#page=1 "${sourceQuote}")\n\n:::figure original-chart`;
const translatedMarkdown=`Original interpretation. [Limits](#page=1 "${sourceQuote}")\n\n:::figure original-chart`;
const source={agent:'Subscription translator'};
const interactive={schemaVersion:1,blocks:[{id:'scope',type:'concept',title:'Scope',text:'The stated evidence supports only the reported sampling scope.',citations:[{page:1}]}]};
async function fixture(t,model){
 const directory=await mkdtemp(join(tmpdir(),'pw-translation-import-'));let modelCalls=0;
 const app=await createApp({dataDir:directory,fetchImpl:async(_url,options)=>{modelCalls++;if(!model)throw new Error('Unexpected model inference');return new Response(JSON.stringify({choices:[{message:{content:await model(JSON.parse(options.body))}}]}));}});
 const original={id:'original',markdown:sourceMarkdown,language:'zh-CN',style:'deep',focus:'Evidence limits',title:'Original reading',createdAt:'2026-01-01T00:00:00Z',source:{kind:'agent',agent:'Original article author'},figures:[{id:'original-chart',page:1,caption:'图1：实验测量结果。',crop:{x:.1,y:.1,width:.5,height:.3}}],translations:{}};
 const paper={id:'paper',title:'Translation import fixture',authors:[],tags:[],createdAt:original.createdAt,source:'web',pages:[{number:1,text:sourceQuote},{number:2,text:'Other evidence.'}],text:sourceQuote,figures:[],readingVersions:[original],activeReadingId:original.id};
 app.locals.store.data.papers.push(paper);
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});});
 async function api(path='',body,method=body?'PUT':'GET'){const response=await fetch(origin+'/api/papers/paper'+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};}
 const translate=(markdown,extra={})=>({source,translations:[{target:'reading',readingId:original.id,language:'en',markdown,...extra}]});
 return {app,paper,original,api,translate,calls:()=>modelCalls,configure:()=>Object.assign(app.locals.store.data.settings,{apiKey:'synthetic-test-key'})};
}

test('subscription translations reject changed source bindings atomically even beside an otherwise valid new summary',async t=>{
 const f=await fixture(t),before=JSON.stringify(f.paper);
 for(const markdown of [translatedMarkdown.replace('#page=1','#page=2'),translatedMarkdown.replace(sourceQuote,'An invented source quote.'),translatedMarkdown.replace('original-chart','nonexistent-chart'),translatedMarkdown.replace(':::figure original-chart','')]){
  const result=await f.api('/insights',{...f.translate(markdown),summary:{language:'en',markdown:'A valid new overview that must not be partly saved.'}});
  assert.equal(result.status,400);assert.match(result.data.error,/source citation or figure marker/);assert.equal(JSON.stringify(f.paper),before);
 }
 assert.equal(f.calls(),0);
});

test('plain page changes reject the entire subscription import and model response without saving a translation',async t=>{
 const f=await fixture(t,()=> 'Translated claim [p.2].');
 f.original.markdown='原文结论 [p.1]。';f.original.figures=[];
 const before=JSON.stringify(f.paper);
 const imported=await f.api('/insights',{...f.translate('Translated claim [p.2].'),summary:{language:'en',markdown:'This otherwise valid new overview must remain unsaved.'}});
 assert.equal(imported.status,400);assert.equal(JSON.stringify(f.paper),before);
 f.configure();const model=await f.api('/translate',{target:'reading',readingId:f.original.id,language:'en'},'POST');
 assert.equal(model.status,502);assert.equal(f.calls(),1);assert.equal(JSON.stringify(f.paper),before);
 const valid=await f.api('/insights',f.translate('Translated claim [第1页].'));
 assert.equal(valid.status,200);assert.equal(valid.data.paper.readingVersions[0].translations.en.markdown,'Translated claim [第1页].');
});

test('escaped-symbol/entity prose cannot bypass atomic import or model citation checks', async t => {
 for (const prefix of [String.raw`A \* B`, 'A &amp; B']) {
  let output;
  const f=await fixture(t,()=>output);
  f.original.markdown=`${prefix} reports evidence [p.4].`;f.original.figures=[];
  const before=JSON.stringify(f.paper);
  const valid=`${prefix} 报告证据 [第4页]。`;
  f.configure();
  for (const invalid of [valid.replace('第4页','第6页'),valid.replace('[第4页]',''),valid+' [p.6]']) {
   const imported=await f.api('/insights',{...f.translate(invalid),summary:{language:'en',markdown:'An otherwise valid overview must not be partially saved.'}});
   assert.equal(imported.status,400);assert.equal(JSON.stringify(f.paper),before);
   output=invalid;
   const model=await f.api('/translate',{target:'reading',readingId:f.original.id,language:'en'},'POST');
   assert.equal(model.status,502);assert.equal(JSON.stringify(f.paper),before);
  }
  assert.equal(f.calls(),3);
  const accepted=await f.api('/insights',f.translate(valid));assert.equal(accepted.status,200);
  assert.equal(accepted.data.paper.readingVersions[0].translations.en.markdown,valid);
  const saved=JSON.stringify(f.paper);
  const denied=await f.api('/insights',f.translate(valid.replace('第4页','第6页')));
  assert.equal(denied.status,400);assert.equal(JSON.stringify(f.paper),saved,'A previous valid cache must remain byte-for-byte intact');
 }
});

test('a derived version accepts faithful subscription translation and caption-only completion without rewriting originals or attribution',async t=>{
 const f=await fixture(t),before=structuredClone(f.original);
 const derived=await f.api('/insights',{source:{agent:'Companion author'},derivedInteractive:{sourceReadingId:f.original.id,expectedSourceRevision:readingDerivationRevision(f.paper,f.original),agentTaskId:'12345678-1234-4234-8234-123456789abc',interactive}});
 assert.equal(derived.status,200);const id=derived.data.readingVersion.id;
 const translated=await f.api('/insights',{source,translations:[{target:'reading',readingId:id,language:'en',markdown:translatedMarkdown,interactive}]});
 assert.equal(translated.status,200);const article=translated.data.paper.readingVersions.find(v=>v.id===id).translations.en;
 const caption=await f.api('/insights',{source:{agent:'Caption author'},translations:[{target:'reading',readingId:id,language:'en',figureCaptions:{'original-chart':'Figure 1: Measured outcomes.'}}]});
 assert.equal(caption.status,200);const version=caption.data.paper.readingVersions.find(v=>v.id===id),completed=version.translations.en;
 assert.equal(completed.markdown,article.markdown);assert.equal(completed.createdAt,article.createdAt);assert.deepEqual(completed.source,article.source);assert.deepEqual(completed.interactive,article.interactive);
 assert.equal(version.markdown,before.markdown);assert.deepEqual(version.figures,before.figures);assert.deepEqual(version.articleSource,before.source);assert.equal(version.source.agent,'Companion author');
 assert.deepEqual(f.paper.readingVersions[0],before);assert.equal(f.paper.activeReadingId,before.id);assert.equal(f.calls(),0);
});

test('sentinel article/caption imports and mixed invalid batches leave every saved version unchanged',async t=>{
 const f=await fixture(t);assert.equal((await f.api('/insights',f.translate(translatedMarkdown))).status,200);
 const before=JSON.stringify(f.paper);
 for(const value of ['null','undefined','"null"','```text\nnull\n```']){
  assert.equal((await f.api('/insights',f.translate(value))).status,400);
  const result=await f.api('/insights',{source,translations:[{target:'reading',readingId:f.original.id,language:'de',markdown:translatedMarkdown},{target:'reading',readingId:f.original.id,language:'en',figureCaptions:{'original-chart':value}}]});
  assert.equal(result.status,400);assert.equal(JSON.stringify(f.paper),before);
 }
 assert.equal(f.calls(),0);
});

test('legacy translation targets enforce the same quote/slot binding and sentinel rules',async t=>{
 const f=await fixture(t);f.paper.summary={...f.original,readingId:f.original.id};f.paper.abstract=`摘要 [来源](#page=1 "${sourceQuote}")`;
 const before=JSON.stringify(f.paper);
 for(const [target,markdown] of [['summary',translatedMarkdown.replace(sourceQuote,'Changed source wording.')],['abstract','null'],['abstract',`Abstract [source](#page=2 "${sourceQuote}")`]]){
  const result=await f.api('/insights',{source,translations:[{target,language:'en',markdown}]});
  assert.equal(result.status,400);assert.equal(JSON.stringify(f.paper),before);
 }
 assert.equal((await f.api('/insights',{source,translations:[{target:'summary',language:'en',markdown:translatedMarkdown}]})).status,200);
 assert.equal((await f.api('/insights',{source,translations:[{target:'abstract',language:'en',markdown:`Abstract [source](#page=1 "${sourceQuote}")`}]})).status,200);
 assert.equal(f.calls(),0);
});

test('invalid historical article bindings remain archived but are stale and cannot satisfy caption-only or model cache reuse',async t=>{
 const f=await fixture(t,body=>'A faithful translation. '+body.messages.at(-1).content.match(/<source>\n([\s\S]*)\n<\/source>/)[1]);
 f.original.figures=[];f.original.markdown=`原文 [限制](#page=1 "${sourceQuote}")`;
 const old={language:'en',markdown:'Bad [quote](#page=2 "Invented.")',sourceHash:contentHash(f.original.markdown),sourceUpdatedAt:f.original.createdAt,createdAt:'2026-01-02T00:00:00Z'};
 f.original.translations.en=old;const before=JSON.stringify(old);
 const read=await f.api();assert.equal(read.data.paper.readingVersions[0].translations.en.stale,true);assert.equal(JSON.stringify(old),before);
 const captions=await f.api('/insights',{source,translations:[{target:'reading',readingId:f.original.id,language:'en',figureCaptions:{}}]});assert.equal(captions.status,400);
 f.configure();const repaired=await f.api('/translate',{target:'reading',readingId:f.original.id,language:'en'},'POST');
 assert.equal(repaired.status,200);assert.equal(f.calls(),1);assert.ok(repaired.data.translation.markdown.includes(`#page=1 "${sourceQuote}"`));assert.notEqual(repaired.data.translation.stale,true);
 await f.api('/translate',{target:'reading',readingId:f.original.id,language:'en'},'POST');assert.equal(f.calls(),1);
});

test('legacy null caption caches are hidden and repaired independently of the valid article',async t=>{
 const f=await fixture(t,()=>JSON.stringify([{id:'original-chart',caption:'Figure 1: Measured outcomes.'}]));
 assert.equal((await f.api('/insights',f.translate(translatedMarkdown))).status,200);
 const version=f.paper.readingVersions[0],cached=version.translations.en;
 Object.assign(cached,{figureCaptions:{'original-chart':'null'},figureCaptionsSourceHash:figureCaptionsSourceHash(version.figures)});
 const read=await f.api(),visible=read.data.paper.readingVersions[0].translations.en;
 assert.equal(visible.figureCaptions,undefined);assert.match(visible.captionTranslationError,/incomplete/);assert.equal(cached.figureCaptions['original-chart'],'null');
 f.configure();const repaired=await f.api('/translate',{target:'reading',readingId:version.id,language:'en'},'POST');
 assert.equal(repaired.status,200);assert.equal(f.calls(),1);assert.equal(repaired.data.translation.markdown,cached.markdown);assert.equal(repaired.data.translation.createdAt,cached.createdAt);
 assert.equal(repaired.data.translation.figureCaptions['original-chart'],'Figure 1: Measured outcomes.');
});

test('model article translations reject sentinel output rather than caching a successful null result',async()=>{
 for(const value of ['null','"null"','undefined'])await assert.rejects(translateContent('Original article.','en',{...defaultSettings,apiKey:'synthetic-test-key'},{fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:value}}]}))}),error=>error.status===502&&/No usable translated text/.test(error.message));
});

test('repeated model derivation retains the first article attribution rather than the previous companion author',async t=>{
 const f=await fixture(t,()=>JSON.stringify(interactive));
 f.original.articleSource={kind:'agent',agent:'First article author'};f.original.source={kind:'agent',agent:'Earlier companion author'};f.configure();
 const result=await f.api('/report',{readingId:f.original.id,format:'interactive'},'POST');
 assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(f.calls(),1);
 assert.deepEqual(result.data.readingVersion.articleSource,f.original.articleSource);assert.equal(result.data.readingVersion.derivedFromReadingId,f.original.id);
});
