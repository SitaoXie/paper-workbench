import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), '文库 service '));
  for (const folder of ['scripts','server','src','shared','dist','node_modules/express','private data'])
    await mkdir(path.join(root, folder), { recursive: true });
  await copyFile(new URL('../scripts/service.mjs', import.meta.url), path.join(root, 'scripts/service.mjs'));
  for (const filename of ['package-lock.json','index.html','vite.config.ts']) await writeFile(path.join(root, filename), '{}');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ private:true, scripts:{build:'node -e "process.exit(23)"'} }));
  const dataDir = path.join(root, 'private data');
  await writeFile(path.join(dataDir, 'store.json'), JSON.stringify({ papers:['retained-paper'],settings:{fixture:'retained-setting'} }));
  await writeFile(path.join(root, '.env'), 'SERVICE_TEST_FLAG="from env file"\nSERVICE_TEST_SECRET=synthetic-test-only\n');
  await writeFile(path.join(root, 'server/index.mjs'), `
    import http from 'node:http';
    import fs from 'node:fs';
    const data = JSON.parse(fs.readFileSync(process.env.DATA_DIR + '/store.json'));
    http.createServer((req,res) => {
      res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify({status:'ok',version:'fixture',paperCount:data.papers.length,
        configured:data.settings.fixture==='retained-setting',envLoaded:process.env.SERVICE_TEST_FLAG==='from env file'}));
    }).listen(Number(process.env.PORT),'127.0.0.1');
  `);
  await writeFile(path.join(root, 'dist/index.html'), 'built fixture');
  const future = new Date(Date.now() + 10000);
  await utimes(path.join(root, 'dist/index.html'), future, future);
  const port = await freePort();
  const env = { ...process.env, PORT:String(port), DATA_DIR:dataDir };
  const run = action => execute(process.execPath, [path.join(root, 'scripts/service.mjs'), action], { cwd:tmpdir(),env,timeout:25000 });
  t.after(async () => {
    await run('stop').catch(()=>{});
    await rm(root, {recursive:true,force:true});
  });
  const pid = async () => Number(await readFile(path.join(root, '.local-data/server.pid'), 'utf8'));
  return {root,dataDir,port,run,pid,health:async()=>(await fetch(`http://127.0.0.1:${port}/api/health`)).json()};
}

test('one-click lifecycle loads env from checkout, reuses an existing service and preserves data on restart', async t => {
  const f = await fixture(t);
  const original = await readFile(path.join(f.dataDir,'store.json'),'utf8');
  const started = await f.run('start');
  assert.match(started.stdout,/服务已就绪/);
  assert.ok(!started.stdout.includes('synthetic-test-only'));
  const first = await f.pid();
  assert.equal((await f.health()).envLoaded,true);
  assert.equal((await f.health()).configured,true);
  assert.match((await f.run('status')).stdout,/服务正常/);
  await f.run('start');
  assert.equal(await f.pid(),first,'Start must not create a duplicate process');
  // A stale PID record must never determine which process restart terminates.
  await writeFile(path.join(f.root,'.local-data/server.pid'),String(process.pid));
  await f.run('restart');
  assert.notEqual(await f.pid(),first);
  assert.equal((await f.health()).paperCount,1);
  assert.equal(await readFile(path.join(f.dataDir,'store.json'),'utf8'),original);
  await f.run('stop');
  await assert.rejects(f.health());
  assert.match((await f.run('status')).stdout,/未就绪/);
});

test('a failed rebuild leaves the running service available', async t => {
  const f = await fixture(t);
  await f.run('start');
  const original = await f.pid();
  await utimes(path.join(f.root,'dist/index.html'),new Date(0),new Date(0));
  await assert.rejects(f.run('restart'),error=>error.code===1 && error.stderr.includes('服务未停止'));
  assert.equal(await f.pid(),original);
  assert.equal((await f.health()).status,'ok');
});

test('an occupied foreign port and an active operation lock never cause a process to be killed', async t => {
  const f = await fixture(t);
  const server = createServer((_req,res)=>res.end('foreign service'));
  await new Promise(resolve=>server.listen(f.port,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  for (const action of ['start','restart','stop'])
    await assert.rejects(f.run(action),error=>error.code===1 && error.stderr.includes('其他程序或其他项目'));
  assert.equal(await (await fetch(`http://127.0.0.1:${f.port}`)).text(),'foreign service');
  await writeFile(path.join(f.root,'.local-data/service.lock'),String(process.pid));
  await assert.rejects(f.run('restart'),error=>error.stderr.includes('正在进行'));
  await rm(path.join(f.root,'.local-data/service.lock'));
});
