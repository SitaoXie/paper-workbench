import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

async function fixture(page: Page, request: APIRequestContext, name: string) {
  const renderer = await page.context().newPage();
  await renderer.setContent(`<html><head><title>${name}</title><style>body{font:18px Georgia;margin:48px}section{break-before:page}p{line-height:1.45}svg{display:block;margin:30px 0}</style></head><body>
    <h1>${name}</h1><p><a href="#evidence">Read the evidence section</a></p>
    <svg width="450" height="170"><text x="20" y="100">10</text><text x="100" y="100">60</text><rect x="70" y="40" width="200" height="80" fill="#aab9cc"/></svg>
    <p><span>Figure 1: Controlled trials preserve uncertainty.</span><br><span>Higher average scores require a separate check.</span><br><span>Evidence differs across samples and conditions.</span></p>
    <section><h2>Second page</h2><div style="height:300px"></div><h3 id="evidence">Evidence anchor inside this page</h3><p>The destination must reveal this paragraph, not just the top of the page.</p></section>
    <section><h2>Third page</h2><p>Independent replication remains necessary.</p></section>
    </body></html>`);
  const buffer = await renderer.pdf({ format:'A4' }); await renderer.close();
  const response = await request.post('/api/upload',{multipart:{file:{name:`${name}.pdf`,mimeType:'application/pdf',buffer}}});
  expect(response.ok(),await response.text()).toBeTruthy(); return (await response.json()).paper;
}
async function open(page: Page,id:string) {
  await page.goto(`/en/?paper=${id}`);
  const close=page.getByRole('button',{name:'Close assistant',exact:true}); if(await close.isVisible()) await close.click();
  await page.getByRole('tab',{name:'Paper',exact:true}).click();
  await expect(page.locator('[data-pdf-page="1"] .pdf-text-layer[data-rendered="true"]')).toBeVisible();
}

test('native dragging from outside a PDF caption selects the caption and copying preserves line spaces',async({page,request,context},info)=>{
  const paper=await fixture(page,request,`Caption edges ${info.project.name}`); await open(page,paper.id);
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  const layer=page.locator('[data-pdf-page="1"] .pdf-text-layer');
  const start=layer.locator('span').filter({hasText:'Figure 1: Controlled trials preserve uncertainty.'}).first();
  const end=layer.locator('span').filter({hasText:'Evidence differs across samples and conditions.'}).first();
  await start.scrollIntoViewIfNeeded();
  const a=(await start.boundingBox())!,b=(await end.boundingBox())!;
  await page.mouse.move(a.x-1,a.y+a.height*.5); await page.mouse.down();
  await page.mouse.move(b.x+b.width+20,b.y+b.height*.7,{steps:20}); await page.mouse.up();
  await expect(page.getByRole('dialog',{name:'Selected text actions',exact:true})).toBeVisible();
  await page.keyboard.press('ControlOrMeta+c');
  const copied=await page.evaluate(()=>navigator.clipboard.readText());
  expect(copied).toBe('Figure 1: Controlled trials preserve uncertainty. Higher average scores require a separate check. Evidence differs across samples and conditions.');
  await page.getByRole('dialog',{name:'Selected text actions',exact:true}).getByRole('button',{name:'Ask assistant',exact:true}).click();
  await expect(page.locator('.selected-passage')).toContainText(copied);
});

test('an internal PDF destination reveals its heading within a page and back restores source position',async({page,request},info)=>{
  const paper=await fixture(page,request,`PDF destinations ${info.project.name}`); await open(page,paper.id);
  const viewport=page.getByLabel('Continuous paper pages',{exact:true});
  const before=await viewport.evaluate(el=>el.scrollTop);
  const link=page.locator('[data-pdf-page="1"] .pdf-annotation-layer a').first();
  await expect(link).toHaveAttribute('href','#pdf-reference-1-1'); await expect(link).toHaveAccessibleName('Paper reference “Read the evidence section” · from page 1'); await link.click();
  await expect(page.getByLabel('PDF page number',{exact:true})).toHaveValue('2');
  const heading=page.locator('[data-pdf-page="2"] .pdf-text-layer span').filter({hasText:'Evidence anchor inside this page'}).first();
  await expect(heading).toBeVisible();
  const destination=(await heading.boundingBox())!,bounds=(await viewport.boundingBox())!;
  expect(destination.y).toBeGreaterThanOrEqual(bounds.y-2);
  expect(destination.y-bounds.y).toBeLessThan(85);
  await page.getByRole('button',{name:'Back to previous position',exact:true}).click();
  await expect.poll(()=>viewport.evaluate(el=>el.scrollTop)).toBeCloseTo(before,0);
});

test('semantic citations verify a unique source quote, preserve reading position, and never fabricate a failed match',async({page,request},info)=>{
  const paper=await fixture(page,request,`Evidence navigation ${info.project.name}`);
  const quote='The destination must reveal this paragraph, not just the top of the page.';
  const summary=`## Read with evidence\n\n${'Inspect the method and its limitations. '.repeat(15)}\n\n[Measured evidence](#page=2 "${quote}")\n\n[Unverified assertion](#page=2 "This invented sentence does not occur in the PDF at all.")\n\n[External example](https://example.org/#page=2 "${quote}")`;
  expect((await request.put(`/api/papers/${paper.id}/insights`,{data:{source:{agent:'Evidence test'},summary:{language:'en',markdown:summary}}})).ok()).toBeTruthy();
  await page.goto(`/en/?paper=${paper.id}`);
  const close=page.getByRole('button',{name:'Close assistant',exact:true});if(await close.isVisible())await close.click();
  const link=page.getByRole('button',{name:'Measured evidence · p.2',exact:true});
  await expect(page.getByRole('link',{name:'External example',exact:true})).toHaveAttribute('href','https://example.org/#page=2');
  await link.click();
  await expect(page.getByText('Source passage located · p.2',{exact:true})).toBeVisible();
  await expect(page.locator('[data-pdf-page="2"] .pdf-search-highlight').first()).toBeVisible();
  const viewport=page.getByLabel('Continuous paper pages',{exact:true});
  const hit=(await page.locator('[data-pdf-page="2"] .pdf-search-highlight').first().boundingBox())!;
  const bounds=(await viewport.boundingBox())!;
  expect(hit.y).toBeGreaterThan(bounds.y+20);expect(hit.y).toBeLessThan(bounds.y+bounds.height-15);
  await viewport.evaluate(el=>{el.scrollTop+=90;el.dispatchEvent(new Event('scroll'));});
  const offset=await viewport.evaluate(el=>el.scrollTop);
  await page.getByRole('tab',{name:'Overview',exact:true}).click();
  await page.getByRole('tab',{name:'Paper',exact:true}).click();
  await expect.poll(()=>viewport.evaluate(el=>el.scrollTop)).toBeCloseTo(offset,0);
  await page.getByRole('button',{name:'Back to overview position',exact:true}).click();
  await page.getByRole('button',{name:'Unverified assertion · p.2',exact:true}).click();
  await expect(page.getByText('No exact passage match. Opened the source page.',{exact:true})).toBeVisible();
  await expect(page.getByLabel('PDF page number',{exact:true})).toHaveValue('2');
  await expect(page.locator('.pdf-search-highlight')).toHaveCount(0);
});

test('translation history returns to the exact source passage and remembers its category and expanded record',async({page,request},info)=>{
  const paper=await fixture(page,request,`History return ${info.project.name}`);
  const quote='The destination must reveal this paragraph, not just the top of the page.';
  const saved=await request.post(`/api/papers/${paper.id}/activities`,{data:{kind:'translation',sourceScope:'pdf',page:2,text:quote,language:'en',result:{text:'The source target is the paragraph inside page two.'},source:{agent:'History acceptance'}}});
  expect(saved.ok(),await saved.text()).toBeTruthy();
  await open(page,paper.id);
  await page.getByRole('button',{name:'Open floating assistant',exact:true}).click();
  await page.getByRole('button',{name:'Conversation history',exact:true}).click();
  const history=page.getByRole('region',{name:'Reading history',exact:true});
  await history.getByRole('tab',{name:'Translations',exact:true}).click();
  await history.getByRole('button',{name:new RegExp('^The destination must reveal')}).click();
  await history.getByRole('button',{name:'Back to source · p.2',exact:true}).click();
  await expect(page.getByText('Source passage located · p.2',{exact:true})).toBeVisible();
  const highlight=page.locator('[data-pdf-page="2"] .pdf-search-highlight').first();
  await expect(highlight).toBeVisible();
  const source=(await highlight.boundingBox())!,viewport=(await page.getByLabel('Continuous paper pages',{exact:true}).boundingBox())!;
  expect(source.y).toBeGreaterThan(viewport.y+20);expect(source.y).toBeLessThan(viewport.y+viewport.height-15);
  await page.getByRole('button',{name:'Open floating assistant',exact:true}).click();
  await page.getByRole('button',{name:'Conversation history',exact:true}).click();
  await expect(history.getByRole('tab',{name:'Translations',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(history.getByRole('button',{name:new RegExp('^The destination must reveal')})).toHaveAttribute('aria-expanded','true');
  await expect(history.locator('.history-activity-detail .prose')).toContainText('paragraph inside page two');
});

test('fit-to-window contains a tall source crop in both dimensions and resets panning after zoom',async({page,request},info)=>{
  const paper=await fixture(page,request,`Tall source crop ${info.project.name}`);
  const result=await request.put(`/api/papers/${paper.id}/insights`,{data:{source:{agent:'Source crop fixture'},summary:{language:'en',markdown:'## Inspect the complete image\n\n:::figure tall-crop'},figures:[{id:'tall-crop',page:1,caption:'Tall evidence crop with its full vertical extent preserved.',crop:{x:.05,y:.03,width:.9,height:.92}}]}});
  expect(result.ok()).toBeTruthy();await page.goto(`/en/?paper=${paper.id}`);
  const figure=page.locator('.reading-prose figure');await figure.scrollIntoViewIfNeeded();
  await figure.getByRole('button',{name:'Enlarge figure on page 1',exact:true}).click();
  const modal=page.getByRole('dialog',{name:'Source figure · Page 1',exact:true});
  const canvas=modal.locator('canvas[data-rendered="true"]'),area=modal.locator('.pdf-figure-lightbox-scroll');
  const fit=async()=>{
    await expect(canvas).toBeVisible();
    await expect.poll(async()=>canvas.evaluate(el=>{const c=el.getBoundingClientRect(),a=el.closest('.pdf-figure-lightbox-scroll')!.getBoundingClientRect();return c.left>=a.left&&c.right<=a.right+1&&c.top>=a.top&&c.bottom<=a.bottom+1;})).toBeTruthy();
    const measure=await area.evaluate(el=>({height:el.clientHeight,scroll:el.scrollHeight,width:el.clientWidth,scrollWidth:el.scrollWidth}));
    expect(measure.scroll).toBeLessThanOrEqual(measure.height+1);expect(measure.scrollWidth).toBeLessThanOrEqual(measure.width+1);
  };
  await fit();
  for(let i=0;i<4;i++)await modal.getByRole('button',{name:'Enlarge figure',exact:true}).click();
  await expect.poll(()=>area.evaluate(el=>el.scrollHeight-el.clientHeight)).toBeGreaterThan(30);
  await area.focus();await page.keyboard.press('ArrowDown');
  await expect.poll(()=>area.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
  await modal.getByRole('button',{name:'Fit figure to window',exact:true}).click();await fit();
  expect(await area.evaluate(el=>el.scrollTop)).toBe(0);
  await page.keyboard.press('Escape');await expect(modal).toBeHidden();
});
