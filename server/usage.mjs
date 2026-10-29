import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ApiError } from './network.mjs';

const scope = new AsyncLocalStorage();
export const tokenFields = ['inputTokens', 'outputTokens', 'totalTokens', 'cachedInputTokens', 'cacheWriteTokens', 'reasoningTokens'];
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const sum = values => values.every(value => value !== null) ? count(values.reduce((a, b) => a + b, 0)) : null;
const clean = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200) : '';

export function normalizeUsage(provider, usage) {
  const u = usage && typeof usage === 'object' && !Array.isArray(usage) ? usage : {};
  let inputTokens, outputTokens, totalTokens, cachedInputTokens, cacheWriteTokens, reasoningTokens;
  if (provider === 'anthropic') {
    // Anthropic input_tokens excludes both cache reads and cache writes.
    const uncached = count(u.input_tokens);
    cachedInputTokens = count(u.cache_read_input_tokens);
    cacheWriteTokens = count(u.cache_creation_input_tokens);
    const optional = key => Object.hasOwn(u, key) && u[key] !== null ? count(u[key]) : 0;
    inputTokens = sum([uncached, optional('cache_read_input_tokens'), optional('cache_creation_input_tokens')]);
    outputTokens = count(u.output_tokens);
    totalTokens = sum([inputTokens, outputTokens]);
    reasoningTokens = null;
  } else {
    inputTokens = count(u.prompt_tokens);
    outputTokens = count(u.completion_tokens);
    totalTokens = count(u.total_tokens) ?? sum([inputTokens, outputTokens]);
    cachedInputTokens = count(u.prompt_tokens_details?.cached_tokens);
    cacheWriteTokens = count(u.prompt_tokens_details?.cache_write_tokens);
    reasoningTokens = count(u.completion_tokens_details?.reasoning_tokens);
    // These are subsets, not additional tokens. Reject impossible breakdowns.
    if (inputTokens !== null && cachedInputTokens > inputTokens) cachedInputTokens = null;
    if (inputTokens !== null && cacheWriteTokens > inputTokens) cacheWriteTokens = null;
    if (outputTokens !== null && reasoningTokens > outputTokens) reasoningTokens = null;
    if (inputTokens !== null && outputTokens !== null && totalTokens !== null && totalTokens !== sum([inputTokens, outputTokens])) totalTokens = null;
  }
  return { inputTokens, outputTokens, totalTokens, cachedInputTokens, cacheWriteTokens, reasoningTokens };
}

export function usageOperation(request) {
  if (request.path === '/api/settings/test') return 'connection-test';
  if (request.path === '/api/chat') return 'question';
  if (/\/metadata\/extract$/.test(request.path)) return 'metadata-extraction';
  if (/\/recommendations$/.test(request.path)) return 'recommendations';
  if (/\/figures\/[^/]+\/analyze$/.test(request.path)) return 'vision';
  if (/\/assist$/.test(request.path)) return request.body?.kind === 'translation' ? 'passage-translation' : 'passage-explanation';
  if (/\/translate$/.test(request.path)) return 'translation';
  if (/\/report$/.test(request.path)) return 'reading';
  return 'other';
}
export const withUsage = (ledger, operation, work) => scope.run({ ledger, operation }, work);
export function beginUsage(settings, purpose) {
  const context = scope.getStore();
  if (!context) return null;
  // Snapshot selected configuration before another request can switch models.
  return { context, started: Date.now(), record: { id: randomUUID(), startedAt: new Date().toISOString(),
    provider: settings.provider === 'anthropic' ? 'anthropic' : 'openai', model: clean(settings.model),
    profileId: clean(settings.id || settings.activeProfileId), profileName: clean(settings.name),
    operation: context.operation, ...(purpose ? { stage: clean(purpose) } : {}) } };
}
export async function finishUsage(ticket, usage, status) {
  if (!ticket) return;
  await ticket.context.ledger.record({ ...ticket.record, durationMs: Date.now() - ticket.started, status,
    ...normalizeUsage(ticket.record.provider, usage) });
}

function validRecord(value) {
  return value?.schema === 1 && typeof value.id === 'string' && ['openai', 'anthropic'].includes(value.provider) &&
    typeof value.startedAt === 'string' && Number.isFinite(Date.parse(value.startedAt)) &&
    ['success', 'failed', 'incomplete'].includes(value.status) && tokenFields.every(field => value[field] === null || count(value[field]) !== null);
}
function groupKey(record) { return JSON.stringify([record.provider, record.profileId, record.model]); }
function aggregate(records) {
  const totals = Object.fromEntries(tokenFields.map(field => [field, 0]));
  const reported = { ...totals };
  for (const record of records) for (const field of tokenFields) if (record[field] !== null) {
    totals[field] = sum([totals[field], record[field]]); reported[field]++;
  }
  return { requests: records.length, failed: records.filter(record => record.status !== 'success').length,
    unknownUsage: records.filter(record => record.totalTokens === null).length, totals, reported };
}

export class UsageLedger {
  constructor(directory) {
    this.file = path.join(directory, 'api-usage.jsonl');
    this.records = []; this.queue = Promise.resolve(); this.unreadableRecords = 0; this.unsavedRecords = 0; this.readError = false;
    this.trackingSince = new Date().toISOString();
  }
  async init() {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    let text = '';
    try { text = await readFile(this.file, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') this.readError = true; }
    for (const line of text.split('\n').filter(line => line.trim())) {
      try {
        const value = JSON.parse(line);
        if (value.schema === 1 && value.type === 'start' && Number.isFinite(Date.parse(value.startedAt))) { this.trackingSince = value.startedAt; continue; }
        if (!validRecord(value)) throw new Error('Invalid usage record');
        this.records.push({ schema: 1, id: clean(value.id), startedAt: new Date(value.startedAt).toISOString(),
          provider: value.provider, model: clean(value.model), profileId: clean(value.profileId), profileName: clean(value.profileName),
          operation: clean(value.operation) || 'other', ...(value.stage ? {stage: clean(value.stage)} : {}),
          durationMs: count(value.durationMs), status: value.status,
          ...Object.fromEntries(tokenFields.map(field => [field, value[field]])),
        });
      } catch { this.unreadableRecords++; }
    }
    if (!text && !this.readError) {
      try { await appendFile(this.file, JSON.stringify({ schema: 1, type: 'start', startedAt: this.trackingSince }) + '\n', { mode: 0o600 }); }
      catch { this.readError = true; }
    }
    return this;
  }
  record(record) {
    const entry = { schema: 1, ...record };
    this.records.push(entry);
    // Serial appends avoid racing the paper store. Leading newline isolates a
    // previously interrupted write; failed persistence never retries inference.
    this.queue = this.queue.then(async () => {
      try { await appendFile(this.file, '\n' + JSON.stringify(entry) + '\n', { mode: 0o600 }); }
      catch { this.unsavedRecords++; }
    });
    return this.queue;
  }
  async summary(query = {}, now = new Date()) {
    await this.queue;
    const days = query.days ?? '30', timeZone = query.timeZone ?? 'UTC';
    if (!['7', '30', '90', 'all'].includes(days)) throw new ApiError('days must be 7, 30, 90 or all.');
    if (typeof timeZone !== 'string' || timeZone.length > 80) throw new ApiError('Invalid time zone.');
    let formatter;
    try { formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }); }
    catch { throw new ApiError('Invalid time zone.'); }
    const dateKey = date => {
      const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
      return `${parts.year}-${parts.month}-${parts.day}`;
    };
    const today = dateKey(now), cutoff = new Date(today + 'T00:00:00Z');
    if (days !== 'all') cutoff.setUTCDate(cutoff.getUTCDate() - Number(days) + 1);
    const from = days === 'all' ? null : cutoff.toISOString().slice(0, 10);
    const model = query.model || '';
    if (typeof model !== 'string' || model.length > 650) throw new ApiError('Invalid model filter.');
    const rawOffset = query.offset ?? '0';
    if (typeof rawOffset !== 'string' || !/^\d{1,8}$/.test(rawOffset)) throw new ApiError('Invalid offset.');
    const offset = Number(rawOffset), models = new Map();
    for (const record of this.records) models.set(groupKey(record), { key: groupKey(record), provider: record.provider, model: record.model, profileName: record.profileName });
    const records = this.records.filter(record => {
      const day = dateKey(new Date(record.startedAt));
      return (!from || day >= from) && day <= today && (!model || groupKey(record) === model);
    });
    const grouped = key => {
      const groups = new Map();
      for (const record of records) { const id = key(record); if (!groups.has(id)) groups.set(id, []); groups.get(id).push(record); }
      return [...groups].map(([key, entries]) => ({ key, ...aggregate(entries) }));
    };
    const cacheRecords = records.filter(record => record.inputTokens !== null && record.cachedInputTokens !== null && record.cachedInputTokens <= record.inputTokens);
    const cacheInput = sum(cacheRecords.map(record => record.inputTokens));
    const cacheRead = sum(cacheRecords.map(record => record.cachedInputTokens));
    const profileKey = record => JSON.stringify([record.provider, record.profileId]);
    const profiles = new Map(records.map(record => [profileKey(record), {profileId:record.profileId,profileName:record.profileName,provider:record.provider}]));
    return { trackingSince: this.trackingSince, generatedAt: now.toISOString(), timeZone, from, to: today,
      ...aggregate(records), models: [...models.values()],
      cache: {requests:cacheRecords.length, inputTokens:cacheInput, cachedInputTokens:cacheRead, rate:cacheInput > 0 && cacheRead !== null ? cacheRead/cacheInput : null},
      byProfile: grouped(profileKey).map(group=>({...profiles.get(group.key),...group})).sort((a,b)=>(b.totals.totalTokens || 0)-(a.totals.totalTokens || 0)),
      byModel: grouped(groupKey).map(group => ({ ...models.get(group.key), ...group })).sort((a, b) => (b.totals.totalTokens || 0) - (a.totals.totalTokens || 0)),
      byOperation: grouped(record => record.operation), daily: grouped(record => dateKey(new Date(record.startedAt))).sort((a, b) => a.key.localeCompare(b.key)),
      recent: [...records].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(offset, offset + 50), offset,
      hasMore: offset + 50 < records.length,
      storage: { unreadableRecords: this.unreadableRecords, unsavedRecords: this.unsavedRecords, readError: this.readError },
    };
  }
}
