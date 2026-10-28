#!/usr/bin/env node
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, openSync, closeSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = path.join(root, '.local-data');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const action = process.argv[2] || 'start';
const openBrowser = process.argv.includes('--open');

function command(file, args) {
  return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}
function listener(port) {
  try {
    const pids = command('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']).split('\n').filter(Boolean);
    if (new Set(pids).size !== 1) throw new Error('端口上存在多个进程，请手动检查。');
    return Number(pids[0]);
  } catch (error) {
    if (error.status === 1) return null;
    throw error;
  }
}
function assertOwned(pid) {
  const cwd = command('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
  const argv = command('ps', ['-p', String(pid), '-o', 'command=']);
  if (!cwd.split('\n').includes(`n${root}`) || !/\bnode\b/.test(argv) || !/(?:^|\s)(?:\S*\/)?server\/index\.mjs(?:\s|$)/.test(argv))
    throw new Error('端口被其他程序或其他项目占用，已取消操作。');
}
async function health(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    const data = await response.json();
    return response.ok && data.status === 'ok' && typeof data.version === 'string';
  } catch { return false; }
}
async function ensureBuild() {
  if (!existsSync(path.join(root, 'node_modules', 'express')))
    await run('npm', ['ci']);
  const built = path.join(root, 'dist', 'index.html');
  const builtAt = existsSync(built) ? statSync(built).mtimeMs : 0;
  async function newer(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory() ? await newer(filename) : statSync(filename).mtimeMs > builtAt) return true;
    }
    return false;
  }
  if (!builtAt || ['package.json', 'package-lock.json', 'index.html', 'vite.config.ts'].some(name => statSync(path.join(root, name)).mtimeMs > builtAt) || await newer(path.join(root, 'src')) || await newer(path.join(root, 'shared')))
    await run('npm', ['run', 'build']);
}
async function run(file, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: root, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('准备失败，服务未停止。请查看上面的错误。')));
  });
}
async function stop(pid, port) {
  assertOwned(pid);
  process.kill(pid, 'SIGTERM');
  for (let i = 0; i < 100; i++) {
    try { process.kill(pid, 0); } catch (error) {
      if (error.code !== 'ESRCH') throw error;
      if (listener(port)) throw new Error('端口被另一进程接管，已取消后续操作。');
      await unlink(path.join(runtime, 'server.pid')).catch(error => { if (error.code !== 'ENOENT') throw error; });
      return;
    }
    await sleep(100);
  }
  throw new Error('服务尚未退出，未强制终止。请稍后重试。');
}
async function main() {
  if (!['start', 'restart', 'stop', 'status'].includes(action)) throw new Error('用法：node scripts/service.mjs start|restart|stop|status [--open]');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || major === 22 && minor < 13) throw new Error('请安装 Node.js 22.13 或更高版本。');
  const envFile = path.join(root, '.env');
  const env = { ...(existsSync(envFile) ? parseEnv(await readFile(envFile, 'utf8')) : {}), ...process.env };
  const port = Number(env.PORT || 4318);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是有效端口。');
  const url = `http://127.0.0.1:${port}/zh/?view=library`;
  await mkdir(runtime, { recursive: true });
  // The lock is a file opened exclusively and removed in finally; a dead
  // owner's PID can be reclaimed only after verifying it no longer exists.
  const lockFile = path.join(runtime, 'service.lock');
  let fd;
  try { fd = openSync(lockFile, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const owner = Number((await readFile(lockFile, 'utf8')).trim());
    if (!Number.isInteger(owner) || owner <= 0) throw new Error('启动操作锁异常，请稍后重试。');
    try { process.kill(owner, 0); throw new Error('已有启动或重启操作正在进行，请稍候。'); }
    catch (check) { if (check.code !== 'ESRCH') throw check; }
    await unlink(lockFile);
    fd = openSync(lockFile, 'wx', 0o600);
  }
  try {
    writeFileSync(fd, String(process.pid));
    let pid = listener(port);
    if (pid) assertOwned(pid);
    if (action === 'status') {
      console.log(pid && await health(port) ? `服务正常：${url}` : '服务未就绪。');
      return;
    }
    if (action === 'stop') { if (pid) await stop(pid, port); console.log('服务已停止。'); return; }
    if (action === 'restart' || !pid) await ensureBuild();
    if (action === 'restart' && pid) { await stop(pid, port); pid = null; }
    if (!pid) {
      const log = openSync(path.join(runtime, 'server.log'), 'a', 0o600);
      try {
        const child = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env, detached: true, stdio: ['ignore', log, log] });
        await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
        pid = child.pid;
        child.unref();
        await writeFile(path.join(runtime, 'server.pid'), String(pid), { mode: 0o600 });
      } finally { closeSync(log); }
    }
    for (let i = 0; i < 100; i++) {
      if (listener(port) === pid && await health(port)) {
        console.log(`服务已就绪：${url}`);
        if (openBrowser && process.platform === 'darwin') await run('open', [url]);
        return;
      }
      await sleep(100);
    }
    throw new Error('服务未能启动，请查看 .local-data/server.log。');
  } finally { closeSync(fd); await unlink(lockFile); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
