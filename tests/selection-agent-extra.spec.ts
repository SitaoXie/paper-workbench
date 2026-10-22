import { test, expect, type Page, type Route, type Locator } from '@playwright/test';

async function fixture(page: Page, { long = false, failSession = false, clipboardFails = false, historicalReading = false } = {}) {
  const source = long ? 'LONG_SOURCE_EVIDENCE '.repeat(700) + 'SOURCE_END_SENTINEL' : 'Finite samples support a bounded empirical claim.';
  const renderer = await page.context().newPage();
  await renderer.setContent(`<style>@page{size:800px 1800px;margin:30px}body{margin:0;font:8px/10px monospace}p{width:700px}</style><p>${source}</p>`);
  const pdf = await renderer.pdf({ preferCSSPageSize: true }); await renderer.close();
  const reading = { id: 'agent-version', style: 'quick', language: 'en', markdown: `## Interpretation\n\n${source}`, mode: 'agent', createdAt: '2026-10-22T00:00:00Z' };
  const oldReading = { ...reading, id: 'old-fixed-version', markdown: '## Older fixed interpretation\n\nThis is the archived version that originally prompted the question.' };
  const papers = ['agent-a', 'agent-b'].map(id => ({ id, title: `Subscription ${id}`, source: 'pdf', authors: [], tags: [], text: source, abstract: 'A bounded abstract.', pageCount: 1, localPdfUrl: '/agent-extra.pdf', createdAt: reading.createdAt, readingVersions: historicalReading ? [reading, oldReading] : [reading], activeReadingId: reading.id }));
  const calls: { path: string; method: string; body: any }[] = [];
  const refreshes: Route[] = []; let defer = false, sessionCount = 0;
  await page.addInitScript(fail => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { if (fail) throw new DOMException('Permission denied', 'NotAllowedError'); (window as any).__copiedTask = text; } } }), clipboardFails);
  await page.route('**/agent-extra.pdf', route => route.fulfill({ contentType: 'application/pdf', body: pdf }));
  await page.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname.slice(4);
    calls.push({ path, method: req.method(), body: req.method() === 'GET' ? undefined : req.postDataJSON() });
    if (path.endsWith('/activities') && url.searchParams.has('agentTaskId') && defer) { refreshes.push(route); return; }
    let result: any = {};
    if (path === '/settings') result = { provider: 'openai', model: 'configured-model', baseUrl: 'https://example.org/v1', apiKeyConfigured: true, modelConfigured: true };
    else if (path === '/papers') result = { papers };
    else if (/^\/papers\/[^/]+$/.test(path)) result = { paper: papers.find(p => p.id === path.split('/')[2]) };
    else if (path === '/chats') result = { conversationId: 'initial-chat', messages: historicalReading ? [{ id: 'saved-user-question', role: 'user', content: 'Does the older interpretation follow from the source?', metadata: { quote: 'This is the archived version that originally prompted the question.', sourceScope: 'reading', readingId: oldReading.id } }, { id: 'saved-answer', role: 'assistant', content: 'Recheck the interpretation against the evidence.' }] : [] };
    else if (path === '/chats/new') { sessionCount++; if (failSession && sessionCount === 1) { await route.fulfill({ status: 503, json: { error: 'Temporary session creation failure' } }); return; } result = { conversationId: `selection-chat-${sessionCount}`, messages: [] }; }
    else if (path === '/chat') result = { conversationId: 'selection-chat-1', message: { role: 'assistant', content: 'A scoped answer.' } };
    else if (path.endsWith('/annotations')) result = { annotations: [] };
    else if (path.endsWith('/activities')) result = { activities: [] };
    else if (path.endsWith('/assist')) result = { result: { text: 'Unexpected API result.' } };
    await route.fulfill({ json: result });
  });
  await page.goto('/en/?paper=agent-a');
  return { source, calls, refreshes, defer: () => { defer = true; }, modelCalls: () => calls.filter(call => call.method === 'POST' && /\/(assist|chat|report|translate)$/.test(call.path)) };
}

async function selectOverview(page: Page) {
  const prose = page.locator('.reading-prose p').first(); await expect(prose).toBeVisible();
  await prose.scrollIntoViewIfNeeded();
  await prose.evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange')); });
  return page.getByRole('dialog', { name: 'Selection actions', exact: true });
}
async function selectPdf(page: Page) {
  await page.getByRole('tab', { name: 'Paper', exact: true }).click();
  const layer = page.locator('[data-pdf-page="1"] .pdf-text-layer[data-rendered="true"]'); await expect(layer).toBeVisible();
  await layer.locator('span').first().click();
  const dialog = page.getByRole('dialog', { name: 'Selected text actions', exact: true }); let text = '';
  // Initial fit-width rendering can replace the text-layer nodes. Select the
  // current rendered layer, then wait for the actual selection UI to capture it.
  await expect(async () => {
    text = await layer.evaluate(element => { const range = document.createRange(), first = element.querySelector('span')!.firstChild!, last = [...element.querySelectorAll('span')].at(-1)!.firstChild!; range.setStart(first, 0); range.setEnd(last, last.textContent!.length); const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange')); return selection.toString(); });
    await expect(dialog).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 5000 });
  return { dialog, text };
}
async function task(dialog: Locator) {
  const input = dialog.getByRole('textbox', { name: 'Subscription selection task', exact: true });
  if (!(await input.isVisible())) await dialog.getByRole('button', { name: 'Show task text', exact: true }).click();
  const text = await input.inputValue(); return { text, binding: JSON.parse(text.match(/\n\n(\{\n[\s\S]*?\n\})\n\n/)![1]) };
}

test('a configured API never runs when subscription processing is chosen; clipboard rejection retains a full stable task', async ({ page }) => {
  const f = await fixture(page, { clipboardFails: true });
  let dialog = await selectOverview(page);
  await dialog.getByLabel('Selection processing method', { exact: true }).selectOption('agent');
  await dialog.getByRole('button', { name: 'Translate', exact: true }).click();
  await dialog.getByRole('button', { name: 'Copy selection task', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'Subscription selection task', exact: true })).toBeVisible();
  await expect(dialog).toContainText('Select and copy the complete task below');
  const first = await task(dialog); expect(first.binding.text).toBe(f.source);
  await dialog.getByRole('button', { name: 'Close selection actions', exact: true }).click();
  dialog = await selectOverview(page); await dialog.getByRole('button', { name: 'Translate', exact: true }).click();
  expect((await task(dialog)).binding.agentTaskId).toBe(first.binding.agentTaskId);
  await dialog.getByRole('button', { name: 'Close selection actions', exact: true }).click();
  const pdf = await selectPdf(page); await pdf.dialog.getByLabel('Selection processing method', { exact: true }).selectOption('agent');
  await pdf.dialog.getByRole('button', { name: 'Translate selection', exact: true }).click();
  const inline = page.getByRole('dialog', { name: 'Inline reading assistant', exact: true });
  await inline.getByRole('button', { name: 'Copy selection task', exact: true }).click();
  const pdfTask = await task(inline); expect(pdfTask.binding).toMatchObject({ sourceScope: 'pdf', page: 1, pages: [1], text: f.source });
  expect(f.modelCalls()).toEqual([]); expect(f.calls.filter(call => call.method !== 'GET')).toEqual([]);
});

test('late subscription refreshes cannot populate a new kind or paper', async ({ page }) => {
  const f = await fixture(page); let dialog = await selectOverview(page);
  await dialog.getByLabel('Selection processing method', { exact: true }).selectOption('agent');
  await dialog.getByRole('button', { name: 'Explain', exact: true }).click(); const original = await task(dialog);
  f.defer(); await dialog.getByRole('button', { name: 'Refresh agent result', exact: true }).click(); await expect.poll(() => f.refreshes.length).toBe(1);
  await dialog.getByRole('button', { name: 'Translate', exact: true }).click(); const next = await task(dialog); expect(next.binding.agentTaskId).not.toBe(original.binding.agentTaskId);
  await f.refreshes[0].fulfill({ json: { activities: [{ ...original.binding, result: { text: 'STALE_EXPLANATION_MUST_NOT_APPEAR' } }] } });
  await expect(dialog.locator('.overview-selection-result')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Refresh agent result', exact: true }).click(); await expect.poll(() => f.refreshes.length).toBe(2);
  // Switch via the application, preserving the JS runtime and pending request.
  await dialog.getByRole('button', { name: 'Close selection actions', exact: true }).click();
  await page.locator('.paper-toolbar').getByRole('button', { name: 'Library', exact: true }).click();
  await page.locator('.paper-card-main').filter({ hasText: 'Subscription agent-b' }).click();
  dialog = await selectOverview(page); await dialog.getByRole('button', { name: 'Translate', exact: true }).click();
  expect((await task(dialog)).binding.paperId).toBe('agent-b');
  await f.refreshes[1].fulfill({ json: { activities: [{ ...next.binding, result: { text: 'STALE_PAPER_A_MUST_NOT_APPEAR' } }] } });
  await expect(dialog.locator('.overview-selection-result')).toHaveCount(0); expect(f.modelCalls()).toEqual([]);
});

test('PDF question session failure preserves the exact input and retry creates a scoped session', async ({ page }) => {
  const f = await fixture(page, { failSession: true }); const { dialog } = await selectPdf(page);
  await dialog.getByLabel('Question about selected text', { exact: true }).fill('Which evidence limits this specific empirical conclusion?');
  await dialog.getByRole('button', { name: 'Ask assistant', exact: true }).click();
  await expect(dialog).toBeVisible(); await expect(dialog.getByLabel('Question about selected text', { exact: true })).toHaveValue('Which evidence limits this specific empirical conclusion?');
  await expect(page.getByRole('alert').filter({ hasText: 'preserved' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Ask assistant', exact: true }).click();
  await expect(page.getByLabel('Ask the research assistant', { exact: true })).toHaveValue('Which evidence limits this specific empirical conclusion?');
  const sessions = f.calls.filter(call => call.path === '/chats/new'); expect(sessions).toHaveLength(2); expect(sessions[1].body.metadata).toMatchObject({ quote: f.source, page: 1, pages: [1] }); expect(f.modelCalls()).toEqual([]);
});

test('a pending PDF subscription result cannot overwrite a newly selected result language', async ({ page }) => {
  const f = await fixture(page); const { dialog } = await selectPdf(page);
  await dialog.getByLabel('Selection processing method', { exact: true }).selectOption('agent');
  await dialog.getByRole('button', { name: 'Translate selection', exact: true }).click();
  const inline = page.getByRole('dialog', { name: 'Inline reading assistant', exact: true });
  const first = await task(inline); f.defer();
  await inline.getByRole('button', { name: 'Refresh agent result', exact: true }).click(); await expect.poll(() => f.refreshes.length).toBe(1);
  await inline.getByRole('combobox', { name: 'Inline result language', exact: true }).selectOption('zh-CN');
  const next = await task(inline); expect(next.binding).toMatchObject({ language: 'zh-CN', kind: 'translation', sourceScope: 'pdf' }); expect(next.binding.agentTaskId).not.toBe(first.binding.agentTaskId);
  await f.refreshes[0].fulfill({ json: { activities: [{ ...first.binding, result: { text: 'OLD_ENGLISH_RESULT_MUST_NOT_APPEAR' } }] } });
  await expect(inline.locator('.pdf-inline-markdown')).toHaveText(''); expect(f.modelCalls()).toEqual([]);
});

test('an oversized overview selection cannot be silently accepted as a truncated subscription task', async ({ page }) => {
  const f = await fixture(page, { long: true }); const dialog = await selectOverview(page);
  expect(f.source.length).toBeGreaterThan(12000);
  await expect(dialog.getByRole('alert')).toContainText('too long');
  await dialog.getByLabel('Selection result language', { exact: true }).selectOption('zh-CN');
  await expect(dialog.getByRole('alert')).toContainText('too long');
  await dialog.getByLabel('Selection processing method', { exact: true }).selectOption('agent');
  const translate = dialog.getByRole('button', { name: 'Translate', exact: true }); if (await translate.isEnabled()) await translate.click();
  await expect(dialog.getByRole('alert')).toContainText('too long');
  await expect(dialog.locator('.selection-agent-bridge')).toHaveCount(0); expect(f.modelCalls()).toEqual([]);
});

test('an oversized PDF selection refuses processing instead of exporting a truncated task', async ({ page }) => {
  const f = await fixture(page, { long: true }); const { dialog, text } = await selectPdf(page); expect(text.length).toBeGreaterThan(12000);
  await dialog.getByLabel('Selection processing method', { exact: true }).selectOption('agent');
  const translate = dialog.getByRole('button', { name: 'Translate selection', exact: true }); if (await translate.isEnabled()) await translate.click();
  await expect(page.getByRole('alert').filter({ hasText: /too long|shorter/i })).toBeVisible();
  await dialog.getByLabel('Selection result language', { exact: true }).selectOption('zh-CN');
  await expect(page.getByRole('alert').filter({ hasText: /too long|shorter/i })).toBeVisible();
  await expect(page.locator('.selection-agent-bridge')).toHaveCount(0); expect(f.modelCalls()).toEqual([]);
});

test('a question about an AI overview retains its fixed version and source scope in session metadata', async ({ page }) => {
  const f = await fixture(page); const dialog = await selectOverview(page);
  await dialog.getByLabel('Question about the overview selection', { exact: true }).fill('Is this interpretation supported by source evidence?');
  await dialog.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect.poll(() => f.calls.filter(call => call.path === '/chats/new').length).toBe(1);
  expect(f.calls.find(call => call.path === '/chats/new')!.body.metadata).toMatchObject({ quote: f.source, sourceScope: 'reading', readingId: 'agent-version' });
  await page.getByRole('button', { name: 'Send question', exact: true }).click();
  await expect.poll(() => f.calls.filter(call => call.path === '/chat').length).toBe(1);
  expect(f.calls.find(call => call.path === '/chat')!.body.metadata).toMatchObject({ quote: f.source, sourceScope: 'reading', readingId: 'agent-version' });
});

test('a saved user-message source chip reopens its old fixed overview without changing the active version', async ({ page }) => {
  const f = await fixture(page, { historicalReading: true });
  await expect(page.getByLabel('Reading version', { exact: true })).toHaveValue('agent-version');
  await page.getByRole('tab', { name: 'Paper', exact: true }).click();
  await page.getByRole('button', { name: 'Open floating assistant', exact: true }).click();
  const chip = page.locator('.message.user').getByRole('button', { name: 'AI overview selection · View version', exact: true }); await expect(chip).toBeVisible();
  await chip.click();
  await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Reading version', { exact: true })).toHaveValue('old-fixed-version');
  await expect(page.getByRole('heading', { name: 'Older fixed interpretation', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#reading=old-fixed-version&section=0$/);
  expect(f.calls.filter(call => call.method !== 'GET')).toEqual([]);
  await page.reload();
  await expect(page.getByLabel('Reading version', { exact: true })).toHaveValue('old-fixed-version');
  await expect(page.getByRole('heading', { name: 'Older fixed interpretation', exact: true })).toBeVisible();
  expect(f.calls.filter(call => call.method !== 'GET')).toEqual([]);
});
