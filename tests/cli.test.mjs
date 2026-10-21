import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/index.mjs';

test('subscription CLI preserves version identity, separate notes/activities, and question context without a provider', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pw-cli-'));
  const app = await createApp({dataDir: directory, download: async url => ({url, contentType: 'text/html', buffer: Buffer.from('<html><head><title>Evidence study</title></head><body><main><h1>Evidence study</h1><p>This study compares two approaches using a controlled evaluation. Its evidence is limited to a single dataset. Further experiments are needed to establish broader applicability.</p></main></body></html>')})});
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(directory, {recursive:true,force:true}); });
  const env = {...process.env, PAPER_WORKBENCH_API_KEY: '', PAPER_WORKBENCH_URL: `http://127.0.0.1:${server.address().port}`};
  async function cli(args, body) {
    return await new Promise((resolve,reject) => {
      const process = spawn(env.NODE || 'node', ['scripts/paper-workbench.mjs', ...args], {env, stdio:['pipe','pipe','pipe']});
      let out = '', err = '';
      process.stdout.on('data', chunk => out += chunk); process.stderr.on('data', chunk => err += chunk);
      process.once('error', reject);
      process.once('close', code => code ? reject(new Error(err || `exit ${code}`)) : resolve(JSON.parse(out)));
      process.stdin.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  const {paper} = await cli(['import','https://example.com/study']);
  const published = await cli(['publish',paper.id,'-'], {source:{agent:'CLI integration fixture'}, style:'critical', focus:'Limits of evidence', summary:{language:'en',markdown:'## Evidence boundary\nThe source studies a single dataset. [p.1]'}});
  const id = published.paper.activeReadingId;
  assert.equal(published.paper.readingVersions.find(v => v.id===id).style,'critical');
  await cli(['publish',paper.id,'-'],{source:{agent:'CLI integration fixture'},translations:[{target:'reading',readingId:id,language:'zh-CN',markdown:'## 证据边界\n原文只研究了一个数据集。 [p.1]'}]});
  const versions = await cli(['readings',paper.id]);
  assert.equal(versions.readingVersions.length,1);
  assert.match(versions.readingVersions[0].translations['zh-CN'].markdown,/证据边界/);
  const note = await cli(['note',paper.id,'-'],{kind:'note',page:1,quote:'single dataset',body:'Check external validity',tags:['limits']});
  assert.equal(note.annotation.kind,'note');
  const activity = await cli(['activity',paper.id,'-'],{kind:'explanation',page:1,text:'single dataset',language:'en',result:'The evaluation does not establish results outside this dataset.',source:{agent:'CLI integration fixture'}});
  assert.equal(activity.activity.kind,'explanation');
  assert.equal((await cli(['notes',paper.id])).annotations.length,1);
  assert.equal((await cli(['sessions',paper.id])).conversations.length,0);
  const overviewSession = await cli(['new-session',paper.id,'--quote','A generated overview passage']);
  assert.deepEqual(overviewSession.conversation.metadata,{quote:'A generated overview passage'});
  const pageSession = await cli(['new-session',paper.id,'--page','1']);
  assert.deepEqual(pageSession.conversation.metadata,{page:1});
  const session = await cli(['new-session',paper.id,'--quote','single dataset','--page','1']);
  await cli(['answer',paper.id,'-'],{conversationId:session.conversationId,source:{agent:'CLI integration fixture'},question:'What needs replication?',answer:'Evaluate on additional datasets. [p.1]'});
  assert.equal((await cli(['sessions',paper.id])).conversations[0].messageCount,2);
  const bundle = await cli(['export',paper.id,'--out',join(directory,'bundle')]);
  const notes = JSON.parse(await readFile(bundle.annotations,'utf8'));
  assert.equal(notes.annotations[0].body,'Check external validity');
  assert.equal(JSON.parse(await readFile(bundle.source,'utf8')).activeReadingId,id);
  assert.equal(JSON.parse(await readFile(bundle.activities,'utf8')).activities.length,1);
  const timeoutSettings = await cli(['config','set','--request-timeout-seconds','240']);
  assert.equal(timeoutSettings.requestTimeoutSeconds,240);
  assert.equal((await cli(['config','show'])).requestTimeoutSeconds,240);
  await assert.rejects(cli(['config','set','--request-timeout-seconds','14']),/between 15 and 600/);
});
