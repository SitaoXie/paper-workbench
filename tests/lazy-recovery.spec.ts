import { test, expect, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

async function fixture(page: Page, illustrated = false) {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (let index = 1; index <= 4; index++) doc.addPage([600, 800]).drawText(`Recovery evidence page ${index}`, { x: 45, y: 700, font, size: 18 });
  const pdf = Buffer.from(await doc.save());
  const figure = { id: 'recovery-chart', page: 2, caption: 'Figure 1. Controlled evidence.', crop: { x: .05, y: .05, width: .8, height: .3 } };
  const paper = { id: 'lazy-recovery', title: 'Recovery evidence', authors: [], source: 'pdf', tags: [], createdAt: '2026-10-23T00:00:00Z', abstract: 'Controlled evidence and limitations.', text: 'Controlled evidence.', localPdfUrl: '/recovery.pdf', pageCount: 4, figures: [figure], activeReadingId: 'reading-recovery', readingVersions: [{ id: 'reading-recovery', mode: 'agent', style: 'deep', language: 'en', format: 'article', createdAt: '2026-10-23T00:00:00Z', markdown: `## Evidence survives\n\nUseful interpretation before the figure.${illustrated ? '\n\n:::figure recovery-chart\n\n' : '\n\n'}The conclusion remains available.`, figures: [figure] }] };
  const writes: string[] = [];
  await page.route('**/recovery.pdf', route => route.fulfill({ contentType: 'application/pdf', body: pdf }));
  await page.route('**/api/**', async route => {
    if(new URL(route.request().url()).pathname==='/api/collections'){await route.fulfill({json:{collections:[]}});return;}
    const request = route.request(), path = new URL(request.url()).pathname.slice(4);
    if (request.method() !== 'GET') writes.push(path);
    const json = path === '/settings' ? { provider: 'openai', baseUrl:'', model:'', modelConfigured: false, apiKeyConfigured: false }
      : path === '/papers' ? { papers: [paper] } : path === `/papers/${paper.id}` ? { paper }
      : path === '/chats' ? { conversationId: 'recovery-session', messages: [] }
      : path.endsWith('/annotations') ? { annotations: [{ id: 'saved-note', paperId: paper.id, type: 'note', page: 3, body: 'A saved recovery note', quote: 'Recovery evidence', createdAt: paper.createdAt, updatedAt: paper.createdAt }] }
      : path.endsWith('/activities') ? { activities: [] } : {};
    await route.fulfill({ json });
  });
  return { writes };
}
async function openAssistant(page: Page) {
  const button = page.getByRole('button', { name: /^(Open floating assistant|打开悬浮助手)$/ });
  await expect(button.or(page.locator('.composer textarea'))).toBeVisible();
  if (await button.isVisible()) await button.click();
  await expect(page.locator('.composer textarea')).toBeVisible();
}
async function closeAssistant(page: Page) {
  const button = page.getByRole('button', { name: /^(Close assistant|关闭助手)$/ });
  if (await button.isVisible()) await button.click();
}

for (const locale of ['en', 'zh']) test(`PDF module failure preserves the shell and drafts; explicit reload recovers saved geometry (${locale})`, async ({ page }) => {
  const f = await fixture(page);
  let blocked = false, failures = 0, documents = 0;
  page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++; });
  await page.route(/\/(?:assets\/PdfReader-[^/?]+\.js|src\/PdfReader\.tsx)(?:\?.*)?$/, route => {
    if (blocked) { failures++; return route.fulfill({ status: 404, contentType: 'text/javascript', body: '' }); }
    return route.continue();
  });
  await page.goto(`/${locale}/?paper=lazy-recovery`);
  await page.getByRole('tab', { name: /^(Paper|论文)$/ }).click();
  const pageInput = page.getByLabel(/^(PDF page number|PDF 页码)$/);
  await pageInput.fill('3'); await pageInput.press('Enter');
  await expect(page.locator('[data-pdf-page="3"] canvas[data-rendered="true"]')).toBeVisible();
  await page.getByRole('button', { name: /^(Zoom in PDF|放大 PDF)$/ }).click();
  const zoom = await page.getByLabel(/^(PDF zoom level|PDF 缩放比例)$/).textContent();
  const scroll = page.getByLabel(/^(Continuous paper pages|连续滚动论文页面)$/);
  // Read the real viewport after a user scroll, rather than inventing a saved record.
  await scroll.evaluate(element => { element.scrollTop += 120; element.dispatchEvent(new Event('scroll')); });
  await openAssistant(page); await page.locator('.composer textarea').fill('Preserve my unsent recovery question.'); await closeAssistant(page);
  blocked = true; await page.reload();
  const alert = page.getByRole('alert').filter({ hasText: /PDF reader is unavailable|论文阅读器暂时无法显示/ });
  await expect(alert).toBeVisible(); expect(failures).toBeGreaterThan(0);
  const navigations = documents;
  await openAssistant(page); await expect(page.locator('.composer textarea')).toHaveValue('Preserve my unsent recovery question.'); await closeAssistant(page);
  await alert.getByRole('button', { name: /^(Back to overview|返回摘要)$/ }).click();
  await expect(page.getByText('The conclusion remains available.', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /^(Paper|论文)$/ }).click(); await expect(alert).toBeVisible();
  expect(documents).toBe(navigations); // No automatic reload loop.
  blocked = false;
  await alert.getByRole('button', { name: /^(Reload page to retry|刷新页面重试)$/ }).click();
  await expect(pageInput).toHaveValue('3');
  await expect(page.getByLabel(/^(PDF zoom level|PDF 缩放比例)$/)).toHaveText(zoom!);
  await expect(page.locator('[data-pdf-page="3"] canvas[data-rendered="true"]')).toBeVisible();
  await openAssistant(page); await expect(page.locator('.composer textarea')).toHaveValue('Preserve my unsent recovery question.');
  expect(f.writes).toEqual([]);
});

test('an unavailable figure module keeps the surrounding overview readable and offers source navigation', async ({ page }) => {
  const f = await fixture(page, true);
  await page.route(/\/(?:assets\/PdfFigure-[^/?]+\.js|src\/PdfFigure\.tsx)(?:\?.*)?$/, route => route.fulfill({ status: 404, contentType: 'text/javascript', body: '' }));
  await page.goto('/en/?paper=lazy-recovery');
  const alert = page.getByRole('alert').filter({ hasText: 'The source figure is unavailable' });
  await expect(alert).toBeVisible();
  await expect(page.getByText('Useful interpretation before the figure.', { exact: true })).toBeVisible();
  await expect(page.getByText('The conclusion remains available.', { exact: true })).toBeVisible();
  await alert.getByRole('button', { name: 'View source page', exact: true }).click();
  await expect(page.getByLabel('PDF page number', { exact: true })).toHaveValue('2');
  await expect(page.locator('[data-pdf-page="2"] canvas[data-rendered="true"]')).toBeVisible();
  expect(f.writes).toEqual([]);
});

test('an unavailable figure editor can be closed without losing the reader or assistant draft', async ({ page }) => {
  const f = await fixture(page);
  await page.route(/\/(?:assets\/FigureManager-[^/?]+\.js|src\/FigureManager\.tsx)(?:\?.*)?$/, route => route.fulfill({ status: 404, contentType: 'text/javascript', body: '' }));
  await page.goto('/en/?paper=lazy-recovery'); await openAssistant(page);
  await page.locator('.composer textarea').fill('Keep this draft while the editor is unavailable.'); await closeAssistant(page);
  await page.getByRole('tab', { name: 'Paper', exact: true }).click();
  await page.getByRole('button', { name: 'Reading tools', exact: true }).click();
  await page.getByRole('button', { name: 'Review figure crops', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'The figure editor is unavailable', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Reload page to retry', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(dialog.getByRole('button', { name: 'Reload page to retry', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0); await expect(page.getByLabel('PDF page number', { exact: true })).toHaveValue('1');
  await openAssistant(page); await expect(page.locator('.composer textarea')).toHaveValue('Keep this draft while the editor is unavailable.');
  expect(f.writes).toEqual([]);
});
