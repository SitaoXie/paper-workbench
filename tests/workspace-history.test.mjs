import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file,require=()=>{throw Error('Unexpected import');}){const context={exports:{},require,URL,Map,Set,Date,setTimeout,clearTimeout};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);return context.exports;}
const positions=load('reading-position.ts');
const {readWorkspaceHistory,workspaceHistoryState,workspaceLocation,workspaceUrl,loadWorkspaceHistoryPositions,saveWorkspaceHistoryPositions}=load('workspace-history.ts',()=>positions);
const plain=value=>JSON.parse(JSON.stringify(value));
test('browser navigation state admits bounded geometry and identity without copying source or private values',()=>{
 const entry={version:1,view:'paper',entryId:'entry-1',paperId:'paper-1',tab:'paper',source:'safe-document-hash',language:'zh-CN',original:false,pdf:{page:3,fraction:.25,left:120,zoom:2,quote:'private quote'},overview:{key:'context-hash',language:'zh-CN',presentation:'article',versionId:'version-1',scrollY:1050,anchor:{index:4,hash:'paragraph-hash',offset:90,text:'private text'},markdown:'private reading'},apiKey:'private-key',question:'private question'};
 const result=workspaceHistoryState(entry,{otherRouter:'retained'});const text=JSON.stringify(result);
 assert.equal(result.otherRouter,'retained');assert.doesNotMatch(text,/private/);
 assert.deepEqual(plain(readWorkspaceHistory(result).pdf),{page:3,fraction:.25,left:120,zoom:2});
 for(const invalid of [{...entry,paperId:'../outside'},{...entry,tab:'untrusted'},{...entry,version:2}])assert.equal(readWorkspaceHistory({paperWorkbench:invalid}),undefined);
 const damaged=readWorkspaceHistory({paperWorkbench:{...entry,pdf:{page:3,fraction:Infinity,left:0,zoom:2},overview:{...entry.overview,scrollY:-1}}});assert.equal(damaged.pdf,undefined);assert.equal(damaged.overview,undefined);
});
test('explicit PDF and library routes are reloadable; new paper routes drop unrelated anchors and query parameters',()=>{
 assert.deepEqual(plain(workspaceLocation('http://localhost/en/?paper=p-1&tab=paper&page=4')),{view:'paper',paperId:'p-1',tab:'paper',page:4});
 assert.deepEqual(plain(workspaceLocation('http://localhost/en/?view=library')),{view:'library'});
 assert.deepEqual(plain(workspaceLocation('http://localhost/en/?paper=p-1&page=bad')),{view:'paper',paperId:'p-1',tab:'summary'});
 assert.equal(workspaceUrl('http://localhost/en/?paper=old&secret=old#reading=old&section=5',{view:'paper',paperId:'next',tab:'paper',page:2}),'http://localhost/en/?paper=next&tab=paper&page=2');
 assert.equal(workspaceUrl('http://localhost/en/?paper=old#reading=old&section=5',{view:'library'}),'http://localhost/en/?view=library');
});
test('per-tab navigation cache survives reload using only bounded identity and geometry',()=>{
 const entries=new Map(Array.from({length:105},(_,i)=>['entry-'+i,{version:1,view:'paper',entryId:'entry-'+i,paperId:'paper-1',tab:'paper',pdf:{page:2,fraction:.35,left:270,zoom:2,quote:'private selection'},question:'private question',apiKey:'private credential'}]));
 let stored;saveWorkspaceHistoryPositions(entries,{setItem:(_,value)=>{stored=value;}});
 assert.equal(entries.size,100);assert.doesNotMatch(stored,/private/);
 const restored=loadWorkspaceHistoryPositions({getItem:()=>stored});
 assert.equal(restored.size,100);assert.equal(restored.has('entry-4'),false);
 assert.deepEqual(plain(restored.get('entry-104').pdf),{page:2,fraction:.35,left:270,zoom:2});
 const untrusted=JSON.stringify([{version:1,view:'paper',entryId:'bad',paperId:'../outside',tab:'paper'},{version:1,view:'library',entryId:'safe',question:'private question'}]);
 const filtered=loadWorkspaceHistoryPositions({getItem:()=>untrusted});assert.equal(filtered.size,1);assert.deepEqual(plain(filtered.get('safe')),{version:1,view:'library',entryId:'safe'});
});
test('restricted, malformed and oversized navigation caches degrade to memory safely',()=>{
 for(const getItem of [()=>{throw new Error('Storage denied');},()=>'{',()=>JSON.stringify({unexpected:true}),()=>('x'.repeat(300001))])assert.equal(loadWorkspaceHistoryPositions({getItem}).size,0);
 const entries=new Map([['entry',{version:1,view:'library',entryId:'entry'}]]);
 assert.doesNotThrow(()=>saveWorkspaceHistoryPositions(entries,{setItem:()=>{throw new Error('Quota exceeded');}}));assert.equal(entries.size,1);
});

test('usage page has a restorable navigation URL without paper or provider information',()=>{
 const href=workspaceUrl('http://localhost:4318/zh/?paper=old&page=4#page=4',{view:'usage'});
 assert.equal(href,'http://localhost:4318/zh/?view=usage');
 assert.deepEqual(plain(workspaceLocation(href)),{view:'usage'});
 const restored=readWorkspaceHistory(workspaceHistoryState({version:1,view:'usage',paperId:'private-paper',source:'private-config'}));
 assert.deepEqual(plain(restored),{version:1,view:'usage'});
});

test('sample navigation keeps isolation while dropping unrelated parameters',()=>{
 assert.equal(workspaceUrl('http://localhost/en/?demo=1&paper=old&secret=x',{view:'library'}),'http://localhost/en/?demo=1&view=library');
 assert.equal(workspaceUrl('http://localhost/zh/?demo=1&view=library',{view:'paper',paperId:'demo-evidence-paper',tab:'paper',page:2}),'http://localhost/zh/?demo=1&paper=demo-evidence-paper&tab=paper&page=2');
});
