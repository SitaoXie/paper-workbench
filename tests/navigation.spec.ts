import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

async function fixture(page: Page, request: APIRequestContext, suffix: string) {
  const renderer = await page.context().newPage();
  await renderer.setContent(`<html><head><style>body{font:18px Georgia;margin:45px}section{break-before:page}</style></head><body>${Array.from({length:4}, (_,i)=>`<${i ? 'section' : 'div'}><h1>Reading continuity ${i+1}</h1>${'<p>The controlled experiment preserves evidence and uncertainty.</p>'.repeat(15)}</${i ? 'section' : 'div'}>`).join('')}</body></html>`);
  const buffer = await renderer.pdf({ format: 'A4' });
  await renderer.close();
  const uploaded = await request.post('/api/upload', { multipart: { file: { name: `continuity-${suffix}.pdf`, mimeType: 'application/pdf', buffer } } });
  expect(uploaded.ok()).toBeTruthy();
  const paper = (await uploaded.json()).paper;
  const content = Array.from({length:12},(_,i)=>`## Reading section ${i+1}\n\n${'Follow the evidence carefully before drawing a general conclusion. '.repeat(8)}\n\n[p.${i%4+1}]`).join('\n\n');
  expect((await request.put(`/api/papers/${paper.id}/insights`,{data:{source:{agent:'Test reader'},summary:{language:'en',markdown:content}}})).ok()).toBeTruthy();
  await page.goto(`/en/?paper=${paper.id}`);
  return paper;
}

test('overview citation detour returns to the same paragraph and keeps its view mounted', async ({page,request}, info)=>{
  await fixture(page,request,info.project.name);
  const heading = page.getByRole('heading',{name:'Reading section 5',exact:true});
  await heading.scrollIntoViewIfNeeded();
  const link = page.locator('.reading-prose').getByRole('button',{name:'p.1',exact:true}).nth(1);
  await link.scrollIntoViewIfNeeded();
  const originalTop = await heading.evaluate(el=>el.getBoundingClientRect().top);
  const scroll = await page.evaluate(()=>window.scrollY);
  expect(scroll).toBeGreaterThan(200);
  await link.click();
  await expect(page.getByLabel('PDF page number',{exact:true})).toHaveValue('1');
  await expect(page.locator('[data-pdf-page="1"] canvas[data-rendered="true"]')).toBeVisible();
  await page.getByRole('button',{name:'Back to overview position',exact:true}).click();
  await expect(heading).toBeVisible();
  await expect.poll(()=>heading.evaluate(el=>el.getBoundingClientRect().top)).toBeCloseTo(originalTop,0);
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeCloseTo(scroll,0);
});

test('PDF keeps zoom and page offset across tabs and returns from page jumps',async({page,request},info)=>{
  await fixture(page,request,`pdf-${info.project.name}`);
  await page.getByRole('tab',{name:'Paper',exact:true}).click();
  await expect(page.locator('[data-pdf-page="1"] canvas[data-rendered="true"]')).toBeVisible();
  await page.getByLabel('PDF page number',{exact:true}).fill('2');
  await page.getByLabel('PDF page number',{exact:true}).press("Enter");
  await page.getByRole('button',{name:'Zoom in PDF',exact:true}).click();
  const viewport=page.getByLabel('Continuous paper pages',{exact:true});
  await viewport.evaluate(el=>{el.scrollTop+=170; el.dispatchEvent(new Event('scroll'));});
  const measure=()=>viewport.evaluate(el=>({top:el.scrollTop,left:el.scrollLeft}));
  const before=await measure();
  const zoom=await page.getByLabel('PDF zoom level',{exact:true}).textContent();
  await page.getByRole('tab',{name:'Overview',exact:true}).click();
  await page.getByRole('tab',{name:'Paper',exact:true}).click();
  await expect(page.getByLabel('PDF zoom level',{exact:true})).toHaveText(zoom!);
  await expect.poll(async()=>(await measure()).top).toBeCloseTo(before.top,0);
  await page.getByLabel('PDF page number',{exact:true}).fill('4');
  await page.getByLabel('PDF page number',{exact:true}).press("Enter");
  await expect(page.getByLabel('PDF page number',{exact:true})).toHaveValue('4');
  await page.getByRole('button',{name:'Back to previous position',exact:true}).click();
  await expect(page.getByLabel('PDF page number',{exact:true})).toHaveValue('2');
  await expect.poll(async()=>(await measure()).top).toBeCloseTo(before.top,0);
});

test('the first overview citation after reload wins over the saved PDF page',async({page,request},info)=>{
  const paper=await fixture(page,request,`cold-navigation-${info.project.name}`);
  await page.getByRole('tab',{name:'Paper',exact:true}).click();
  const number=page.getByLabel('PDF page number',{exact:true});
  await expect(page.locator('[data-pdf-page="1"] canvas[data-rendered="true"]')).toBeVisible();
  await number.fill('4');await number.press('Enter');
  await expect(page.locator('[data-pdf-page="4"] canvas[data-rendered="true"]')).toBeVisible();
  await page.getByRole('button',{name:'Zoom in PDF',exact:true}).click();
  const zoom=await page.getByLabel('PDF zoom level',{exact:true}).textContent();
  await page.getByRole('tab',{name:'Overview',exact:true}).click();
  await page.reload();
  await expect(page.getByRole('tab',{name:'Overview',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.locator('.pdf-reader')).toHaveCount(0);
  await page.locator('.reading-prose').getByRole('button',{name:'p.2',exact:true}).first().click();
  await expect(number).toHaveValue('2');
  await expect(page.locator('[data-pdf-page="2"] .pdf-text-layer[data-rendered="true"]')).toBeVisible();
  await expect(page.getByLabel('PDF zoom level',{exact:true})).toHaveText(zoom!);
  await expect.poll(()=>number.inputValue()).toBe('2');
  const position=await page.getByLabel('Continuous paper pages',{exact:true}).evaluate(el=>{
    const sheet=el.querySelector<HTMLElement>('[data-pdf-page="2"]')!;
    return {top:el.scrollTop,target:sheet.offsetTop};
  });
  expect(Math.abs(position.top-position.target)).toBeLessThanOrEqual(18);
  await page.getByRole('button',{name:'Back to overview position',exact:true}).click();
  await expect(page.getByRole('tab',{name:'Overview',exact:true})).toHaveAttribute('aria-selected','true');
  expect(paper.id).toBeTruthy();
});
