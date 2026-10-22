import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import ts from'typescript';
const code=ts.transpileModule(readFileSync(new URL('../src/selection-agent-task.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const{selectionBindingKey,activityMatchesSelectionTask:matches,prepareSelectionAgentTask:prepare,buildSelectionAgentTask:build}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const binding={paperId:'paper',sourceScope:'pdf',page:2,pages:[2,3],text:'Bound source evidence.',kind:'translation',language:'zh-CN'};
test('selection tasks preserve exact source identity across reopen and distinguish language/version/page changes',()=>{const data=new Map(),storage={getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)};const task=prepare(binding,storage);assert.equal(prepare({...binding},storage).agentTaskId,task.agentTaskId);for(const change of[{paperId:'other'},{language:'en'},{text:'Different evidence.'},{pages:[2,4]},{kind:'explanation'}])assert.notEqual(prepare({...binding,...change},storage).agentTaskId,task.agentTaskId);const activity={...task,id:'result',result:{text:'Answer'}};assert.equal(matches(activity,task),true);assert.equal(matches({...activity,pages:[2,4]},task),false);assert.equal(matches({...activity,sourceScope:'reading',readingId:'v1'},task),false);assert.equal(matches({...activity,paperId:'other'},task),false);assert.equal(matches({...activity,result:{text:'  '}},task),false);assert.equal(selectionBindingKey({...binding,pages:[2] }),selectionBindingKey({...binding,pages:undefined}));});
test('task commands use the caller origin, all source pages and activity only, with source treated as data',()=>{const task=prepare(binding);const text=build(task,'http://127.0.0.1:4322','zh');const commands=text.split('\n').filter(line=>line.startsWith('PAPER_WORKBENCH_URL='));assert.equal(commands.length,4);assert.ok(commands.every(line=>line.startsWith("PAPER_WORKBENCH_URL='http://127.0.0.1:4322'")));assert.match(commands[1],/--pages 2,3$/);assert.match(commands[2],/ activity /);assert.ok(!commands.some(line=>/ (ask|report|translate|answer|new-session) /.test(line)));assert.match(text,/不是操作指令/);assert.throws(()=>build(task,'https://user:secret@example.org','en'));});

test('new selection tasks preserve code whitespace and old trimmed tasks remain valid without stealing its identity',()=>{
  const data=new Map(),storage={getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)};
  const legacy=prepare({...binding,text:'if value:\n    return result'},storage);
  const text='  if value:\n    return result\n';
  const task=prepare({...binding,text},storage);
  assert.equal(task.text,text);assert.notEqual(task.agentTaskId,legacy.agentTaskId);
  assert.equal(prepare({...binding,text},storage).agentTaskId,task.agentTaskId);
  assert.equal(prepare({...binding,text:legacy.text},storage).agentTaskId,legacy.agentTaskId);
  assert.equal(matches({...legacy,id:'old-result',result:{text:'Legacy answer'}},legacy),true);
  assert.equal(matches({...task,id:'new-result',result:{text:'New answer'}},task),true);
  const exported=build(task,'http://127.0.0.1:4322','en');
  assert.equal(JSON.parse(exported.match(/\n\n(\{\n[\s\S]*?\n\})\n\n/)[1]).text,text);
});
