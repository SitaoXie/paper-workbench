import { test, expect, type Page } from '@playwright/test';

async function selectAndCopy(page: Page, start: string, end: string) {
  const layer = page.locator('[data-pdf-page="1"] .pdf-text-layer');
  await layer.locator('span').filter({ hasText: start }).first().scrollIntoViewIfNeeded();
  await layer.evaluate((element, { start, end }) => {
    const spans = [...element.querySelectorAll('span')];
    const first = spans.find(span => span.textContent?.includes(start))!;
    const last = spans.find(span => span.textContent?.includes(end))!;
    const range = document.createRange();
    range.setStart(first.firstChild!, first.textContent!.indexOf(start));
    range.setEnd(last.firstChild!, last.textContent!.indexOf(end) + end.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, { start, end });
  await expect(page.getByRole('dialog', { name: 'Selected text actions', exact: true })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+c');
  return await page.evaluate(() => navigator.clipboard.readText());
}

test('PDF system copy restores a page-evidenced wrapped word while preserving uncertain and compound hyphens', async ({ page, context, request }, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const renderer = await context.newPage();
  await renderer.setContent(`<html><style>body{font:17px Georgia;margin:45px}p{line-height:1.4;margin:24px 0}section{break-before:page}</style><body>
    <h1>Bounded copy ${info.project.name}</h1>
    <p>Independent page evidence: learning. Compare cooperate and co-operate.</p>
    <p><span>We learn-</span><br><span>ing residual functions.</span></p>
    <p><span>We infer-</span><br><span>ence from these samples.</span></p>
    <p><span>The state-of-</span><br><span>the-art result needs replication.</span></p>
    <p><span>We co-</span><br><span>operate with independent groups.</span></p>
    <section><h2>Another source page</h2><p>Only this different page contains the whole word inference.</p></section>
    </body></html>`);
  const buffer = await renderer.pdf({ format: 'A4' }); await renderer.close();
  const uploaded = await request.post('/api/upload', { multipart: { file: { name: 'bounded-copy.pdf', mimeType: 'application/pdf', buffer } } });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  const paper = (await uploaded.json()).paper;
  await page.goto(`/en/?paper=${paper.id}`);
  const close = page.getByRole('button', { name: 'Close assistant', exact: true }); if (await close.isVisible()) await close.click();
  await page.getByRole('tab', { name: 'Paper', exact: true }).click();
  await expect(page.locator('[data-pdf-page="1"] .pdf-text-layer[data-rendered="true"]')).toBeVisible();
  await expect(page.locator('[data-pdf-page="2"] .pdf-text-layer[data-rendered="true"]')).toHaveCount(1);
  expect(await selectAndCopy(page, 'We learn-', 'ing residual functions.')).toBe('We learning residual functions.');
  expect(await selectAndCopy(page, 'We infer-', 'ence from these samples.')).toBe('We infer- ence from these samples.');
  expect(await selectAndCopy(page, 'The state-of-', 'the-art result needs replication.')).toBe('The state-of- the-art result needs replication.');
  expect(await selectAndCopy(page, 'We co-', 'operate with independent groups.')).toBe('We co- operate with independent groups.');
  await page.getByRole('dialog', { name: 'Selected text actions', exact: true }).getByRole('button', { name: 'Ask assistant', exact: true }).click();
  await expect(page.locator('.selected-passage')).toContainText('We co- operate with independent groups.');
});
