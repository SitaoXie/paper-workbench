import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
async function moduleFile(name) {
  const code=ts.transpileModule(fs.readFileSync(new URL('../src/'+name,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
}
test('selection errors use a known code or exact legacy message and preserve unknown diagnostics',async()=>{
  const {ApiRequestError,selectionErrorMessage}=await moduleFile('selection-errors.ts');
  const safe=new ApiRequestError('New server wording',400,'selection_no_translatable_text');
  assert.match(selectionErrorMessage(safe,'zh-CN'),/^选文只有数字或符号/);
  assert.match(selectionErrorMessage(safe,'en'),/^The selection contains only numbers/);
  const legacy='The selection contains only numbers or symbols, with no text to translate. Select the surrounding caption or sentence.';
  assert.match(selectionErrorMessage(new Error(legacy),'zh'),/^选文只有数字或符号/);
  for(const message of ['Provider 429: quota exceeded',legacy+' Extra details','Upstream: '+legacy])assert.equal(selectionErrorMessage(new Error(message),'zh'),message);
  assert.equal(selectionErrorMessage(new ApiRequestError(legacy,502,'provider_failure'),'zh'),legacy);
  assert.equal(new ApiRequestError('no',500,{bad:true}).code,undefined);
});
test('companion preferences contain only bounded layout data and keep desktop separate from narrow screens',async()=>{
  const storage=new Map();globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
  const s=await moduleFile('assistant-layout.ts');
  assert.equal(s.readCompanionMode(1440),null);assert.equal(s.readCompanionMode(390),null);
  s.saveCompanionMode('assistant',1440);assert.equal(s.readCompanionMode(1440),'assistant');assert.equal(s.readCompanionMode(390),null);
  s.saveCompanionMode('notebook',390);assert.equal(s.readCompanionMode(390),'notebook');assert.equal(s.readCompanionMode(1440),'assistant');
  s.saveCompanionMode(null,1440);assert.equal(s.readCompanionMode(1440),null);
  s.saveAssistantWidth(900);assert.equal(s.initialAssistantWidth(1100),692);assert.equal(s.initialAssistantWidth(1920),900);
  s.saveAssistantWidth(10000);assert.equal(s.savedAssistantWidth(),900);
  assert.deepEqual(JSON.parse(storage.get('paper-workbench:companion-layout-v1')),{desktop:null,narrow:'notebook'});
  storage.set('paper-workbench:companion-layout-v1',JSON.stringify({desktop:'private draft',narrow:{text:'private'}}));assert.equal(s.readCompanionMode(1440),null);
  globalThis.localStorage={getItem(){throw new Error('unavailable')},setItem(){throw new Error('unavailable')}};
  assert.equal(s.readCompanionMode(1440),null);assert.equal(s.initialAssistantWidth(1440),720);assert.doesNotThrow(()=>s.saveCompanionMode('assistant',1440));
});
test('citation display changes only a conventional numbered prefix and never source names or bindings',async()=>{
  const {displayCitationLabel:f}=await moduleFile('citation-label.ts');
  assert.equal(f('图1','en'),'Figure 1');assert.equal(f('表 2: 原始实验名称','en'),'Table 2: 原始实验名称');
  assert.equal(f('图1.2(a)','en'),'Figure 1.2(a)');assert.equal(f('Figure 3 — Source name','zh-CN'),'图3 — Source name');
  for(const name of ['图像检索','图1实验原名','名称里的图1','A Chinese 图1 label','Figureground'])assert.equal(f(name,'en'),name);
  assert.equal(f('表2','ja'),'表2');assert.equal(f(undefined,'en'),'');
});
