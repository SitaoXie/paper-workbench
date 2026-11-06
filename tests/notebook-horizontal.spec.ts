import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { pdfDocumentKey } from '../src/reading-position';

const viewport = (page: Page) => page.getByLabel('Continuous paper pages', { exact: true });
const notebook = (page: Page) => page.getByRole('complementary', { name: 'Paper notebook', exact: true });

async function fixture(page: Page) {
  // A real two-page, two-column PDF. Its source phrases sit inside the exact
  // normalized annotation rectangles; no screenshot or empty canvas fixture.
  const renderer = await page.context().newPage();
  await renderer.setContent(`<style>@page{size:800px 1000px;margin:0}html,body{margin:0}section{position:relative;width:800px;height:1000px;break-after:page;font:16px Georgia}h1{position:absolute;left:64px;top:55px;font-size:24px}.column{position:absolute;width:270px;top:150px;line-height:24px}.left{left:64px}.right{left:480px}.source{position:absolute;top:320px;margin:0;font:16px/24px Georgia;width:176px}.source.left{left:64px}.source.right{left:480px}</style>${[1, 2].map(number => `<section><h1>Two-column evidence, page ${number}</h1><div class="column left">The controlled comparison keeps the experimental setting fixed. Source observations belong to the left column.</div><div class="column right">An independent result belongs to the right column. Reading it requires horizontal navigation at high magnification.</div><p class="source left">LEFT_SOURCE_${number}</p><p class="source right">RIGHT_SOURCE_${number}</p></section>`).join('')}`);
  const pdf = await renderer.pdf({ preferCSSPageSize: true, printBackground: true });
  await renderer.close();
  const paper = { id: 'horizontal-source', title: 'Horizontal notebook evidence', source: 'pdf', authors: [], tags: [], abstract: 'Two source columns.', text: 'Two source columns.', createdAt: '2026-10-22T00:00:00Z', pageCount: 2, localPdfUrl: '/horizontal-source.pdf' };
  const annotations = ['left', 'right'].map(side => {
    const segments = [1, 2].map(number => ({ page: number, quote: `${side.toUpperCase()}_SOURCE_${number}`, rects: [{ x: side === 'left' ? .08 : .6, y: .32, width: .22, height: .024 }] }));
    return { id: `${side}-note`, paperId: paper.id, kind: 'note', page: 1, quote: segments[0].quote, rects: segments[0].rects, segments, body: `${side.toUpperCase()} column notebook`, tags: [], createdAt: paper.createdAt, updatedAt: paper.createdAt };
  });
  await page.addInitScript(({ id, source }) => {
    localStorage.setItem('paper-workbench:assistant-width', '864');
    localStorage.setItem('pw-reading-positions-v1', JSON.stringify({ [id]: { source, tab: 'paper', pdf: { page: 1, fraction: 0, left: 0, zoom: 2 }, overviews: [], updatedAt: Date.now() } }));
  }, { id: paper.id, source: pdfDocumentKey(paper) });
  await page.route('**/horizontal-source.pdf', route => route.fulfill({ contentType: 'application/pdf', body: pdf }));
  await page.route('**/api/**', async route => {
    if(new URL(route.request().url()).pathname==='/api/collections'){await route.fulfill({json:{collections:[]}});return;}
    const path = new URL(route.request().url()).pathname.slice(4);
    let result: unknown = {};
    if (path === '/papers') result = { papers: [paper] };
    else if (path === `/papers/${paper.id}`) result = { paper };
    else if (path === '/settings') result = { provider: 'openai', model: '', modelConfigured: false, apiKeyConfigured: false };
    else if (path === '/chats') result = { conversationId: null, messages: [] };
    else if (path.endsWith('/annotations')) result = { annotations };
    else if (path.endsWith('/activities')) result = { activities: [] };
    await route.fulfill({ json: result });
  });
  await page.goto(`/en/?paper=${paper.id}`);
  await expect(page.getByLabel('PDF zoom level', { exact: true })).toHaveText('200%');
  await expect(page.locator('[data-pdf-page="1"] .pdf-text-layer[data-rendered="true"]')).toBeVisible();
}

async function openNotebook(page: Page, info: TestInfo) {
  if (!(await notebook(page).isVisible())) await page.getByTitle('Notes & annotations', { exact: true }).click();
  await expect(notebook(page)).toBeVisible();
  if (info.project.name === 'desktop') await expect(page.getByRole('separator', { name: 'Resize assistant', exact: true })).toHaveAttribute('aria-valuenow', '864');
}

async function showNote(page: Page, info: TestInfo, side: 'left' | 'right') {
  await openNotebook(page, info);
  const close = notebook(page).getByRole('button', { name: 'Close editor', exact: true });
  if (await close.isVisible()) await close.click();
  await notebook(page).locator('.notebook-card').filter({ hasText: `${side.toUpperCase()} column notebook` }).click();
}

async function locate(page: Page, info: TestInfo, number: number) {
  await notebook(page).getByRole('button', { name: `Locate excerpt on page ${number}`, exact: true }).click();
  // The mobile notebook is an overlay. Closing it must reveal the requested
  // source without changing the user's existing magnification.
  if (info.project.name === 'mobile') await notebook(page).getByRole('button', { name: 'Close notebook', exact: true }).click();
}

async function geometry(page: Page, side: string, number: number) {
  return viewport(page).evaluate((host, { side, number }) => {
    const sheet = host.querySelector<HTMLElement>(`[data-pdf-page="${number}"]`)!;
    const highlight = sheet.querySelector<SVGRectElement>(`[data-annotation-id="${side}-note"] rect`);
    const text = [...sheet.querySelectorAll<HTMLElement>('.pdf-text-layer span')].find(item => item.textContent === `${side.toUpperCase()}_SOURCE_${number}`);
    if (!highlight || !text) return null;
    const h = highlight.getBoundingClientRect(), t = text.getBoundingClientRect(), v = host.getBoundingClientRect();
    return {
      scrollLeft: host.scrollLeft, scrollTop: host.scrollTop, width: host.clientWidth,
      highlight: { left: h.left, right: h.right, top: h.top, bottom: h.bottom },
      text: { left: t.left, right: t.right, top: t.top, bottom: t.bottom },
      viewport: { left: Math.max(0, v.left), right: Math.min(innerWidth, v.left + host.clientWidth), top: Math.max(0, v.top), bottom: Math.min(innerHeight, v.top + host.clientHeight) },
      uncovered: host.contains(document.elementFromPoint((t.left + t.right) / 2, (t.top + t.bottom) / 2)),
      focused: highlight.closest('g')!.classList.contains('is-focused'),
    };
  }, { side, number });
}

async function expectSourceVisible(page: Page, info: TestInfo, side: string, number: number) {
  await expect(page.getByLabel('PDF page number', { exact: true })).toHaveValue(String(number));
  await expect(page.getByLabel('PDF zoom level', { exact: true })).toHaveText('200%');
  // Do not call click/scrollIntoView on PDF markers or source text: either would
  // repair the product's missing horizontal scroll and give a false positive.
  await expect.poll(async () => {
    const g = await geometry(page, side, number);
    return !!g && g.focused && g.uncovered && [g.highlight, g.text].every(rect => rect.left >= g.viewport.left && rect.right <= g.viewport.right + 1 && rect.top >= g.viewport.top && rect.bottom <= g.viewport.bottom);
  }).toBe(true);
  const g = (await geometry(page, side, number))!;
  // The highlight must correspond to actual rendered PDF source text.
  expect(g.text.left).toBeGreaterThanOrEqual(g.highlight.left - 2);
  expect(g.text.right).toBeLessThanOrEqual(g.highlight.right + 2);
  expect(g.text.top).toBeGreaterThanOrEqual(g.highlight.top - 3);
  expect(g.text.bottom).toBeLessThanOrEqual(g.highlight.bottom + 3);
  await info.attach(`${side}-page-${number}-geometry`, { body: JSON.stringify(g, null, 2), contentType: 'application/json' });
  return g;
}

test('a right-column note actually enters the viewport at 200%, then a left-column note pans back without zooming out', async ({ page }, info) => {
  await fixture(page);
  await showNote(page, info, 'right');
  // Start from the failure state even if opening the card already located it.
  await viewport(page).evaluate(host => { host.scrollLeft = 0; host.dispatchEvent(new Event('scroll')); });
  await expect.poll(async () => { const g = await geometry(page, 'right', 1); return !!g && g.highlight.left > g.viewport.right; }).toBe(true);
  await locate(page, info, 1);
  const right = await expectSourceVisible(page, info, 'right', 1);
  expect(right.scrollLeft).toBeGreaterThan(400);
  await page.screenshot({ path: info.outputPath('right-column-source.png') });
  await showNote(page, info, 'left');
  await locate(page, info, 1);
  const left = await expectSourceVisible(page, info, 'left', 1);
  expect(left.scrollLeft).toBeLessThan(right.scrollLeft - 300);
});

test('cross-page notebook sources keep their horizontal anchor on already magnified pages', async ({ page }, info) => {
  await fixture(page);
  await showNote(page, info, 'right');
  await locate(page, info, 2);
  const right = await expectSourceVisible(page, info, 'right', 2);
  expect(right.scrollLeft).toBeGreaterThan(400);
  await showNote(page, info, 'left');
  await locate(page, info, 1);
  const left = await expectSourceVisible(page, info, 'left', 1);
  expect(left.scrollLeft).toBeLessThan(right.scrollLeft - 300);
  await showNote(page, info, 'right');
  await locate(page, info, 2);
  const repeated = await expectSourceVisible(page, info, 'right', 2);
  expect(repeated.scrollLeft).toBeCloseTo(right.scrollLeft, 0);
  expect(repeated.scrollTop).toBeCloseTo(right.scrollTop, 0);
});

test('opening and closing the assistant does not replay an old note location after the reader scrolls away', async ({ page }, info) => {
  await fixture(page); await showNote(page, info, 'right'); await locate(page, info, 1);
  await expectSourceVisible(page, info, 'right', 1);
  if (await notebook(page).isVisible()) await notebook(page).getByRole('button', { name: 'Close notebook', exact: true }).click();
  const readPosition = () => viewport(page).evaluate(host => {
    const number = Number((document.querySelector('[aria-label="PDF page number"]') as HTMLInputElement).value);
    const sheet = host.querySelector<HTMLElement>(`[data-pdf-page="${number}"]`)!;
    return { number, top: host.scrollTop, width: host.clientWidth, fraction: (host.scrollTop - sheet.offsetTop) / sheet.offsetHeight };
  });
  const located = await readPosition(), bounds = (await viewport(page).boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + Math.min(bounds.height - 50, 350));
  await page.mouse.wheel(0, 550);
  await expect.poll(async () => (await readPosition()).top).toBeGreaterThan(located.top + 400);
  const before = await readPosition();
  for (let round = 0; round < 2; round++) {
    await page.getByRole('button', { name: 'Open floating assistant', exact: true }).click();
    await expect(page.getByLabel('Ask the research assistant', { exact: true })).toBeVisible();
    if (info.project.name === 'desktop') await expect.poll(async () => (await readPosition()).width).toBeLessThan(before.width - 100);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect((await readPosition()).top).toBeCloseTo(before.top, 0);
    expect((await readPosition()).fraction).toBeCloseTo(before.fraction, 3);
    await page.getByRole('button', { name: 'Close assistant', exact: true }).click();
    await expect.poll(async () => (await readPosition()).width).toBe(before.width);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect((await readPosition()).number).toBe(before.number);
    expect((await readPosition()).top).toBeCloseTo(before.top, 0);
    expect((await readPosition()).fraction).toBeCloseTo(before.fraction, 3);
    await expect(page.getByLabel('PDF zoom level', { exact: true })).toHaveText('200%');
  }
});

test('a manually selected table column survives assistant resize and a later pan replaces that anchor', async ({page}, info) => {
  await fixture(page);
  await page.getByRole('button',{name:'Open floating assistant',exact:true}).click();
  const host=viewport(page), measure=()=>host.evaluate(el=>({left:el.scrollLeft,top:el.scrollTop,width:el.clientWidth,max:el.scrollWidth-el.clientWidth}));
  await expect(page.getByLabel('Ask the research assistant',{exact:true})).toBeVisible();
  await host.evaluate(el=>{el.scrollTop=220;el.scrollLeft=Math.min(500,el.scrollWidth-el.clientWidth);el.dispatchEvent(new Event('scroll'));});
  const before=await measure();expect(before.left).toBeGreaterThan(200);
  for(let round=0;round<2;round++) {
    await page.getByRole('button',{name:'Close assistant',exact:true}).click();
    if(info.project.name==='desktop') await expect.poll(async()=>(await measure()).width).toBeGreaterThan(before.width+100);
    await page.getByRole('button',{name:'Open floating assistant',exact:true}).click();
    await expect.poll(async()=>(await measure()).width).toBe(before.width);
    await expect.poll(async()=>(await measure()).left).toBeCloseTo(before.left,0);
    expect((await measure()).top).toBeCloseTo(before.top,0);
  }
  // Explicitly navigating left must clear the previously retained right column.
  await host.evaluate(el=>{el.scrollLeft=70;el.dispatchEvent(new Event('scroll'));});
  await page.getByRole('button',{name:'Close assistant',exact:true}).click();
  await page.getByRole('button',{name:'Open floating assistant',exact:true}).click();
  await expect.poll(async()=>(await measure()).left).toBeCloseTo(70,0);
  await expect(page.getByLabel('PDF zoom level',{exact:true})).toHaveText('200%');
  await host.evaluate(el=>{el.scrollLeft=500;el.dispatchEvent(new Event('scroll'));});
  await page.getByRole('button',{name:'Close assistant',exact:true}).click();
  // A new source action also supersedes a deferred column when the source is
  // already visible in the temporarily wider reader.
  await page.getByRole('button',{name:'Find in PDF',exact:true}).click();
  await page.getByRole('searchbox',{name:'Find in PDF text',exact:true}).fill('LEFT_SOURCE_1');
  await expect(page.getByLabel('Search result count',{exact:true})).toHaveText('1 / 1');
  await expect(page.locator('.pdf-search-highlight').first()).toBeVisible();
  await page.getByRole('button',{name:'Open floating assistant',exact:true}).click();
  await expect.poll(async()=>(await measure()).left).toBeLessThan(200);
});
