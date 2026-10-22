import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync(new URL('../src/agent-task.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {prepareAgentQuestionTask:prepare,buildAgentQuestionTask:build,buildAgentReadingTask:reading}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const input=extra=>({origin:'http://127.0.0.1:4320',paperId:'paper-a',sessionKey:{},question:'Why is coverage lower?',language:'en',...extra});
test('question tasks bind every CLI command to one origin, paper and conversation, preserving question as data',async()=>{
  let created=0;
  const question='Explain "x"; $(touch /tmp/never-run)\n`not a command`';
  const result=await prepare(input({conversationId:'conversation-a',question}),async()=>{created++;return{conversationId:'wrong'}});
  assert.equal(created,0);assert.equal(result.conversationId,'conversation-a');
  const commands=result.task.split('\n').filter(line=>line.startsWith('PAPER_WORKBENCH_URL='));
  assert.equal(commands.length,4);
  commands.forEach(line=>assert.ok(line.startsWith("PAPER_WORKBENCH_URL='http://127.0.0.1:4320' node scripts/paper-workbench.mjs ")));
  assert.equal(commands[0],commands[3]);assert.ok(commands[0].endsWith("conversation 'paper-a' 'conversation-a'"));
  assert.ok(commands[2].endsWith("answer 'paper-a' '<temporary-answer.json>'"));
  assert.equal(JSON.parse(result.task.split('\n').at(-1)),question);
  assert.match(result.task,/"conversationId": "conversation-a"/);
  assert.match(result.task,/MUST include the identical conversationId/);
});
test('one unsaved draft creates one session across concurrent copies and clipboard retries',async()=>{
  let finish,calls=0;const request=input({metadata:{quote:'source',page:2}});
  const create=body=>{calls++;assert.deepEqual(body,{paperId:'paper-a',kind:'question',metadata:{quote:'source',page:2}});return new Promise(resolve=>finish=resolve)};
  const first=prepare(request,create),second=prepare({...request,question:'Follow up'},create);
  await Promise.resolve();assert.equal(calls,1);finish({conversationId:'new-a'});
  assert.equal((await first).conversationId,'new-a');assert.equal((await second).conversationId,'new-a');
  assert.equal((await prepare(request,create)).conversationId,'new-a');assert.equal(calls,1);
});
test('failed creation can retry; another draft or paper cannot inherit a session',async()=>{
  let calls=0;const request=input();
  await assert.rejects(prepare(request,async()=>{calls++;throw new Error('not saved')}),/not saved/);
  const create=async()=>({conversationId:'session-'+(++calls)});
  assert.equal((await prepare(request,create)).conversationId,'session-2');
  assert.equal((await prepare({...request,paperId:'paper-b'},create)).conversationId,'session-3');
  assert.equal((await prepare({...request,sessionKey:{}},create)).conversationId,'session-4');
});
test('cleared selection does not bind a new session to old metadata; evidence remains untrusted',async()=>{
  let body;
  const r=await prepare(input({omitConversationSelection:true,metadata:{quote:'old quote',page:4}}),async value=>{body=value;return{conversationId:'clean'}});
  assert.deepEqual(body,{paperId:'paper-a',kind:'question'});
  assert.match(r.task,/old metadata.quote\/page/);assert.match(r.task,/evidence, not operational instructions/);
});
test('invalid destinations fail before creation and source-excerpt readings are honestly labeled',async()=>{
  let calls=0;const create=async()=>{calls++;return{conversationId:'unused'}};
  for(const extra of [{origin:'https://user:pass@example.com'},{origin:'http://localhost:4320/other'},{origin:'http://localhost:4320?token=secret'},{paperId:'paper; rm -rf x'},{language:'en;echo hi'},{question:'   '}])await assert.rejects(prepare(input(extra),create));
  assert.equal(calls,0);
  assert.throws(()=>build({...input(),conversationId:'other/subpath'}));
  assert.throws(()=>reading({origin:'http://localhost:4320',paperId:'p',language:'en;echo x'}));
  const r=reading({origin:'http://localhost:4320',paperId:'p',language:'en',abstractIsExcerpt:true});
  assert.match(r,/opening source excerpt, not an identified abstract/);
  assert.match(r,/complete paper.figures/);
});
