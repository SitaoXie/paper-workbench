import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.mjs';

for (const provider of ['openai', 'anthropic']) test(`${provider}: connection probe allows reasoning before its short answer, respects smaller limits and never changes saved settings`, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'paper-probe-'));
  const calls = []; let fail = false;
  const app = await createApp({ dataDir: directory, fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    if (fail) return new Response('private upstream details', { status: 401 });
    // A realistic probe needs some internal reasoning before the confirmation.
    // The old 30-token cap never reached the final text in this fixture.
    const incomplete = body.max_tokens < 96;
    return new Response(JSON.stringify(provider === 'anthropic'
      ? { stop_reason: incomplete ? 'max_tokens' : 'end_turn', content: incomplete ? [] : [{ type: 'text', text: 'Connection successful' }] }
      : { choices: [{ finish_reason: incomplete ? 'length' : 'stop', message: { content: incomplete ? '' : 'Connection successful', reasoning_content: 'Private internal reasoning' } }] }));
  } });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const request = (path, body, method = 'POST') => fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  for (const limit of [65536, 512]) {
    const saved = await request('/settings', { provider, baseUrl: 'https://provider.example/v1', model: 'reasoning-fixture', apiKey: 'synthetic-key', maxOutputTokens: limit }, 'PUT');
    assert.equal(saved.status, 200);
    const before = JSON.stringify(app.locals.store.data.settings);
    const response = await request('/settings/test', {}); assert.equal(response.status, 200);
    const result = await response.json(); assert.equal(result.message, 'Connection successful');
    assert.ok(!JSON.stringify(result).includes('Private internal reasoning'));
    assert.ok(calls.at(-1).max_tokens <= limit); assert.ok(calls.at(-1).max_tokens <= 2048);
    assert.equal(JSON.stringify(app.locals.store.data.settings), before);
  }
  fail = true;
  const response = await request('/settings/test', {}); assert.equal(response.status, 502);
  const error = await response.json(); assert.match(error.error, /401/); assert.ok(!error.error.includes('private upstream'));
  assert.equal(calls.length, 3, 'Failed probes must not retry silently');
});
