import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const compiled=ts.transpileModule(readFileSync(new URL('../src/question-task-store.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {loadQuestionTasks:load,saveQuestionTasks:save,questionTaskKey:key,questionTaskStorageKey:storageKey,completedQuestionTaskAnswer:complete}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const task=extra=>({agentTaskId:'11111111-1111-4111-8111-111111111111',task:'Fixed task text',question:'What does the evidence show?',boundQuestion:'What does the evidence show?',paperId:'paper-a',conversationId:'session-a',language:'en',draftRevision:10,createdAt:100,updatedAt:100,status:'pending',copied:false,...extra});
const storage=()=>{const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),data};};
const messages=t=>{const common={paperId:t.paperId,conversationId:t.conversationId,agentTaskId:t.agentTaskId};return [{...common,id:'user-one',role:'user',content:t.boundQuestion,...(t.metadata?{metadata:t.metadata}:{})},{...common,id:'answer-one',role:'assistant',content:'A grounded imported answer.',mode:'agent',source:{agent:'Codex'}}]};
test('pending and completed task states reload with fixed task and conversation bindings; dismissal stays deleted',()=>{
 const s=storage(),a=task(),b=task({paperId:'paper-b',status:'completed',answerId:'answer-b',updatedAt:101});
 assert.equal(save({[key(a.paperId,a.conversationId)]:a,[key(b.paperId,b.conversationId)]:b},s).storageFailed,false);
 assert.deepEqual({...load(s).tasks},{[key(b.paperId,b.conversationId)]:b,[key(a.paperId,a.conversationId)]:a});
 const next=load(s).tasks;delete next[key(a.paperId,a.conversationId)];save(next,s);
 assert.equal(load(s).tasks[key(a.paperId,a.conversationId)],undefined);assert.equal(load(s).tasks[key(b.paperId,b.conversationId)].status,'completed');
});
test('persisted input is validated, strips unrelated fields and cannot mismatch a paper/session storage key',()=>{
 const s=storage(),a=task();s.setItem(storageKey,JSON.stringify({[key(a.paperId,a.conversationId)]:{...a,apiKey:'must-not-persist'},wrong:task({conversationId:'different'}),invalid:task({agentTaskId:'bad'})}));
 const restored=load(s);assert.equal(Object.keys(restored.tasks).length,1);save(restored.tasks,s);assert.ok(!s.getItem(storageKey).includes('apiKey'));
 for(const change of [{status:'finished'},{status:'completed'},{draftRevision:-1},{metadata:{page:2,pages:[3,2]}},{metadata:{readingId:'wrong',sourceScope:'pdf'}},{task:'x'.repeat(40001)}])assert.equal(Object.keys(save({[key(a.paperId,a.conversationId)]:task(change)},s).tasks).length,0);
});
test('tab storage stays bounded and keeps the newest handoffs without truncating a retained task',()=>{
 const s=storage(),tasks={};for(let i=0;i<40;i++){const t=task({conversationId:'session-'+i,updatedAt:i});tasks[key(t.paperId,t.conversationId)]=t;}
 assert.equal(Object.keys(save(tasks,s).tasks).length,30);assert.equal(load(s).tasks[key('paper-a','session-0')],undefined);
 for(let i=0;i<40;i++)tasks[key('paper-a','session-'+i)].task='x'.repeat(39000);
 const result=save(tasks,s);assert.ok(s.getItem(storageKey).length<=500000);assert.equal(result.tasks[key('paper-a','session-39')].task.length,39000);
});
test('blocked or malformed storage reports a visible failure while in-memory tasks remain usable',()=>{
 const blocked={getItem(){throw Error('blocked')},setItem(){throw Error('quota')}};assert.equal(load(blocked).storageFailed,true);
 const a=task(),result=save({[key(a.paperId,a.conversationId)]:a},blocked);assert.equal(result.storageFailed,true);assert.equal(result.tasks[key(a.paperId,a.conversationId)].task,a.task);
 const s=storage();s.setItem(storageKey,'{bad');assert.equal(load(s).storageFailed,true);s.setItem(storageKey,'x'.repeat(500001));assert.equal(load(s).storageFailed,true);
});
test('completion requires the exact imported adjacent question/agent-answer pair for this task and scope',()=>{
 const t=task();assert.equal(complete(t,messages(t)),'answer-one');
 for(const altered of [[messages(t)[1]],[{...messages(t)[0],content:'Other question'},messages(t)[1]],[messages(t)[0],{...messages(t)[1],mode:'api'}],[messages(t)[0],{...messages(t)[1],source:{}}]])assert.equal(complete(t,altered),undefined);
 for(const field of ['agentTaskId','paperId','conversationId'])for(const index of [0,1]){const m=messages(t);m[index][field]='other';assert.equal(complete(t,m),undefined);delete m[index][field];assert.equal(complete(t,m),undefined);}
 const m=messages(t);assert.equal(complete(t,[m[0],{role:'assistant',content:'Unrelated'},m[1]]),undefined);
});
test('completion preserves explicit selected-source bindings and cleared-selection intent',()=>{
 const t=task({metadata:{quote:'Original evidence',sourceScope:'reading',readingId:'version-a'}}),m=messages(t);assert.equal(complete(t,m),'answer-one');
 m[0].metadata={...t.metadata,readingId:'version-b'};assert.equal(complete(t,m),undefined);
 const clear=task({metadata:null}),cm=messages(clear);assert.equal(complete(clear,cm),'answer-one');cm[0].metadata={quote:'Old selection'};assert.equal(complete(clear,cm),undefined);
});
test('task completion respects server outer-whitespace normalization without changing internal evidence',()=>{
 const t=task({metadata:{quote:'    code = evidence\n',sourceScope:'abstract'}}),m=messages(t);m[0].metadata={...t.metadata,quote:'code = evidence'};
 assert.equal(complete(t,m),'answer-one');assert.equal(t.metadata.quote,'    code = evidence\n');
 m[0].metadata.quote='code=evidence';assert.equal(complete(t,m),undefined);
 m[0].metadata.quote='code  = evidence';assert.equal(complete(t,m),undefined);
});
