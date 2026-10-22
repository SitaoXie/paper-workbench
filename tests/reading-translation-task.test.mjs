import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {prepareInsights} from '../server/insights.mjs';
import {contentHash} from '../server/storage.mjs';

const code=ts.transpileModule(await readFile(new URL('../src/reading-translation-task.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {buildReadingTranslationTask:build,resolveReadingTranslationTaskMode:resolveMode}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const input=extra=>({origin:'http://127.0.0.1:4326',paperId:'paper-a',readingId:'legacy-summary-fixed',language:'en',mode:'translation',sourceLanguage:'zh-CN',sourceCreatedAt:'2026-01-01T00:00:00Z',...extra});
const blocks=task=>[...task.matchAll(/(?:^|\n)(\{\n[\s\S]*?\n\})/g)].map(match=>JSON.parse(match[1]));

test('each mode fixes its version and language, binds every command to one quoted origin, and contains no new-reading payload',()=>{
  for(const mode of ['translation','captions','interactive'])for(const locale of ['en','zh-CN']){
    const task=build(input({mode,locale,language:'zh-cn'})),[binding,envelope]=blocks(task);
    assert.deepEqual(binding,{paperId:'paper-a',readingId:'legacy-summary-fixed',language:'zh-CN',mode,sourceLanguage:'zh-CN',sourceCreatedAt:'2026-01-01T00:00:00Z'});
    assert.deepEqual(Object.keys(envelope).sort(),['source','translations']);
    assert.deepEqual(envelope.translations,[{target:'reading',readingId:'legacy-summary-fixed',language:'zh-CN'}]);
    const commands=task.split('\n').filter(line=>line.startsWith('PAPER_WORKBENCH_URL='));
    assert.equal(commands.length,5);assert.ok(commands.every(line=>line.startsWith("PAPER_WORKBENCH_URL='http://127.0.0.1:4326' node scripts/paper-workbench.mjs ")));
    assert.deepEqual(commands.map(line=>line.split('paper-workbench.mjs ')[1].split(' ')[0]),['get','readings','get','publish','readings']);
    assert.ok(commands.every(line=>line.includes("'paper-a'")));
    assert.equal(commands[0],commands[2]);assert.equal(commands[1],commands[4]);
    assert.ok(!commands.some(line=>/ (translate|report|ask|assist|use-reading|figure|new-session) /.test(line)));
  }
});

test('only explicit identity fields are embedded; credentials, long source prose, and mutable active IDs are not accepted as task data',()=>{
  const text=build(input({sourceMarkdown:'PRIVATE LONG SOURCE '.repeat(1000),apiKey:'fixture-private-value',activeReadingId:'unrelated-active'}));
  assert.ok(!text.includes('PRIVATE LONG SOURCE'));assert.ok(!text.includes('fixture-private-value'));assert.ok(!text.includes('unrelated-active'));
  for(const change of [{origin:'https://user:password@example.org'},{origin:'http://localhost:4326/?token=secret'},{origin:'http://localhost:4326/api'},{origin:'javascript:alert(1)'},{paperId:'paper; echo unsafe'},{readingId:'../active'},{readingId:''},{language:'en;echo unsafe'},{mode:'report'},{sourceLanguage:'not a language'},{sourceCreatedAt:'not a saved timestamp'}])assert.throws(()=>build(input(change)));
  assert.ok(build(input({origin:'http://localhost:4326/'})).includes("PAPER_WORKBENCH_URL='http://localhost:4326'"));
});

test('language variants without a reusable target article upgrade component tasks to full fixed-version translation',()=>{
  for(const [sourceLanguage,language] of [['zh','zh-CN'],['en-US','en'],['zh-Hant','zh-CN']])for(const mode of ['captions','interactive']){
    const request=input({sourceLanguage,language,mode});
    assert.equal(resolveMode(request),'translation');
    assert.equal(resolveMode({...request,hasValidTargetArticle:false}),'translation');
    const task=build(request),[binding,envelope]=blocks(task);
    assert.equal(binding.mode,'translation');assert.equal(binding.sourceLanguage,sourceLanguage);assert.equal(binding.language,language);
    assert.match(task,/整篇翻译：|Full translation:/);
    assert.equal(envelope.translations[0].readingId,request.readingId);
    assert.equal(resolveMode({...request,hasValidTargetArticle:true}),mode);
    assert.equal(blocks(build({...request,hasValidTargetArticle:true}))[0].mode,mode);
  }
  assert.equal(resolveMode(input({mode:'captions',sourceLanguage:'zh-cn',language:'zh-CN'})),'captions');
  assert.equal(resolveMode(input({mode:'captions',sourceLanguage:'en',language:'en'})),'captions');
  assert.equal(resolveMode(input({mode:'captions',sourceLanguage:undefined})),'translation','Unknown original language cannot establish equality');
  assert.throws(()=>build(input({mode:'captions',hasValidTargetArticle:'true'})),/must be a boolean/);
});

function fixture(){
  const figure={id:'chart',page:1,crop:{x:.1,y:.1,width:.7,height:.2},caption:'图 1：两个评测任务的受控结果。'};
  const interactive={schemaVersion:1,blocks:[{id:'limits',type:'concept',title:'证据边界',text:'结果仅说明这两个任务中观察到的现象，不能推广到所有任务。',citations:[{page:1,label:'Source'}]}]};
  const markdown='## 证据边界\n结果限于两个任务。 [证据](#page=1 "Exact original source quote.")\n\n:::figure chart';
  const source={id:'legacy-summary-fixed',createdAt:'2026-01-01T00:00:00Z',language:'zh-CN',markdown,figures:[figure],interactive,format:'interactive',translations:{}};
  const target={markdown:'## Evidence limits\nThe findings cover two tasks. [Evidence](#page=1 "Exact original source quote.")\n\n:::figure chart',language:'en',createdAt:'2026-01-02T00:00:00Z',sourceHash:contentHash(markdown),sourceUpdatedAt:source.createdAt,figureCaptions:{chart:'Figure 1: Controlled results for two evaluation tasks.'},source:{kind:'agent',agent:'Prior translator'}};
  const translated={schemaVersion:1,blocks:[{id:'limits',type:'concept',title:'Evidence limits',text:'These findings describe observations on two tasks and do not establish results for every task.',citations:[{page:1,label:'Source'}]}]};
  source.translations.en=structuredClone(target);source.translations.fr={...target,language:'fr',markdown:'Une traduction antérieure.'};
  const paper={id:'paper-a',filePath:'pdfs/fixture.pdf',pages:[{number:1,text:'Exact original source quote.'}],figures:[{...figure,caption:'Changed current caption, outside the version'}],activeReadingId:'other-active',readingVersions:[source,{...source,id:'other-active',markdown:'Another reading',translations:{}}]};
  return{paper,target,translated};
}
function completedEnvelope(mode){const [,envelope]=blocks(build(input({mode,hasValidTargetArticle:true})));envelope.source.agent='Task contract fixture';return envelope;}

test('caption and interactive task envelopes can complete one fixed version without changing active state, original figures, or another language',()=>{
  for(const mode of ['captions','interactive','translation']){
    const {paper,target,translated}=fixture(),before=JSON.stringify(paper),envelope=completedEnvelope(mode),entry=envelope.translations[0];
    if(mode==='captions')entry.figureCaptions={chart:'Figure 1: Results remain limited to two evaluation tasks.'};
    else Object.assign(entry,{markdown:target.markdown,interactive:translated,figureCaptions:target.figureCaptions});
    const update=prepareInsights(envelope,paper),result={...paper,...update};
    assert.equal(JSON.stringify(paper),before,'Import preparation cannot mutate source snapshots');
    assert.equal(result.activeReadingId,'other-active');assert.equal(result.readingVersions.length,2);
    const version=result.readingVersions.find(item=>item.id==='legacy-summary-fixed'),saved=version.translations.en;
    assert.equal(saved.markdown,target.markdown);assert.deepEqual(version.figures,paper.readingVersions[0].figures);
    assert.deepEqual(version.translations.fr,paper.readingVersions[0].translations.fr);
    assert.deepEqual(result.readingVersions[1],paper.readingVersions[1]);
    assert.equal(Object.hasOwn(update,'summary'),false);assert.equal(Object.hasOwn(update,'report'),false);assert.equal(Object.hasOwn(update,'figures'),false);
    if(mode==='captions')assert.equal(saved.createdAt,target.createdAt);
    else {assert.deepEqual(saved.interactive,translated);assert.deepEqual(saved.figureCaptions,target.figureCaptions);}
  }
});

test('component-only imports do not bypass missing article or interactive source prerequisites',()=>{
  const {paper,target,translated}=fixture();delete paper.readingVersions[0].translations.en;
  const captions=completedEnvelope('captions');captions.translations[0].figureCaptions={chart:'A translated source caption.'};
  assert.throws(()=>prepareInsights(captions,paper),/Caption-only import requires/);
  const interactive=completedEnvelope('interactive');interactive.translations[0].interactive=translated;
  assert.throws(()=>prepareInsights(interactive,paper),/markdown must contain/);
  interactive.translations[0].markdown=target.markdown;delete paper.readingVersions[0].interactive;
  assert.throws(()=>prepareInsights(interactive,paper),/no interactive content/);
});

test('upgraded variant tasks satisfy the unchanged import boundary without falling back to active reading or changing source language',()=>{
  for(const [sourceLanguage,language] of [['zh','zh-CN'],['en-US','en'],['zh-Hant','zh-CN']]){
    const {paper,target}=fixture(),version=paper.readingVersions[0];version.language=sourceLanguage;delete version.translations[language];
    const request=input({mode:'captions',sourceLanguage,language}),[binding,envelope]=blocks(build(request));
    assert.equal(binding.mode,'translation');envelope.source.agent='Variant translation fixture';
    const entry=envelope.translations[0];
    entry.figureCaptions={chart:language==='en'?'Figure 1: Controlled results for two evaluation tasks.':'图 1：两个评测任务的受控结果。'};
    assert.throws(()=>prepareInsights(envelope,paper),/Caption-only import requires/,'A matching language prefix does not authorize caption-only import');
    entry.markdown=language==='en'?target.markdown:version.markdown;
    const update=prepareInsights(envelope,paper),saved=update.readingVersions[0];
    assert.equal(saved.language,sourceLanguage);assert.equal(saved.translations[language].markdown,entry.markdown);
    assert.equal(update.activeReadingId,undefined);assert.equal(update.readingVersions.length,2);
    assert.deepEqual(update.readingVersions[1],paper.readingVersions[1]);
  }
});
