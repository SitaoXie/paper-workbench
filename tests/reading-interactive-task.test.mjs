import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {prepareDerivedInteractive} from '../server/reading-derived.mjs';
import {publicPaper} from '../server/storage.mjs';

const code=ts.transpileModule(await readFile(new URL('../src/reading-interactive-task.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {buildReadingInteractiveTask:build}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const input=extra=>({origin:'http://127.0.0.1:4326',paperId:'paper-a',sourceReadingId:'version-a',expectedSourceRevision:'a'.repeat(64),agentTaskId:'12345678-1234-4234-8234-123456789abc',...extra});
const jsonBlocks=task=>[...task.matchAll(/(?:^|\n)(\{\n[\s\S]*?\n\})/g)].map(match=>JSON.parse(match[1]));

test('interactive subscription task fixes source and UUID, scopes every CLI command, and deliberately has no replacement prose',()=>{
 for(const locale of ['en','zh-CN']){
  const request=input({locale}),task=build(request),[binding,envelope]=jsonBlocks(task);
  assert.deepEqual(binding,{paperId:request.paperId,sourceReadingId:request.sourceReadingId,expectedSourceRevision:request.expectedSourceRevision,agentTaskId:request.agentTaskId});
  assert.deepEqual(Object.keys(envelope).sort(),['derivedInteractive','source']);
  assert.deepEqual(Object.keys(envelope.derivedInteractive).sort(),['agentTaskId','expectedSourceRevision','interactive','sourceReadingId']);
  assert.deepEqual(envelope.derivedInteractive.interactive,{schemaVersion:1,blocks:[]});
  const commands=task.split('\n').filter(line=>line.startsWith('PAPER_WORKBENCH_URL='));
  assert.equal(commands.length,6);assert.ok(commands.every(line=>line.startsWith("PAPER_WORKBENCH_URL='http://127.0.0.1:4326' node scripts/paper-workbench.mjs ")&&line.includes("'paper-a'")));
  assert.deepEqual(commands.map(line=>line.split('paper-workbench.mjs ')[1].split(' ')[0]),['get','readings','source','get','publish','readings']);
 }
});

test('task rejects ambiguous source bindings and does not embed arbitrary prose or private provider fields',()=>{
 for(const change of [{origin:'https://user:password@example.org'},{origin:'http://localhost:4326/api'},{origin:'http://localhost:4326/?secret=value'},{sourceReadingId:'../active'},{paperId:'paper;echo unsafe'},{expectedSourceRevision:''},{agentTaskId:'not-a-uuid'},{locale:'not a language'}])assert.throws(()=>build(input(change)));
 const task=build(input({sourceMarkdown:'PRIVATE-PROSE '.repeat(1000),baseUrl:'https://private.invalid',apiKey:'PRIVATE-KEY'}));
 assert.ok(!task.includes('PRIVATE-PROSE'));assert.ok(!task.includes('private.invalid'));assert.ok(!task.includes('PRIVATE-KEY'));
});

test('the copied envelope completes the real derived contract while an empty template cannot create a fake result',()=>{
 const paper={id:'paper-a',pages:[{number:1,text:'Original source.'}],figures:[],activeReadingId:'other',readingVersions:[{id:'version-a',language:'en',markdown:'Original reading. [p.1]',createdAt:'2026-01-01T00:00:00Z',style:'deep',figures:[],translations:{'zh-CN':{markdown:'不是新的原文。'}}}]};
 const revision=publicPaper(paper).readingVersions[0].derivationRevision;
 const [,envelope]=jsonBlocks(build(input({expectedSourceRevision:revision,locale:'zh-CN'})));envelope.source.agent='Subscription fixture';
 assert.throws(()=>prepareDerivedInteractive(envelope,paper),/1–24 blocks/);
 envelope.derivedInteractive.interactive.blocks=[{id:'scope',type:'concept',title:'Scope',text:'Interpretation remains bounded to the source.',citations:[{page:1}]}];
 const original=JSON.stringify(paper),result=prepareDerivedInteractive(envelope,paper);
 assert.equal(JSON.stringify(paper),original);assert.equal(result.readingVersion.language,'en');assert.equal(result.readingVersion.markdown,paper.readingVersions[0].markdown);
 assert.equal(result.readingVersion.derivedFromReadingId,'version-a');assert.deepEqual(result.readingVersion.translations,{});
});
