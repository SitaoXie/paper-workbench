import {test,expect,type Page} from '@playwright/test';
import {outlinePdf,longOutlineTitle} from './fixtures/outline-pdf.mjs';
async function setup(page:Page){
  const papers=['outline-paper','empty-paper'].map((id,i)=>({id,title:i?'Paper without embedded outline':'Paper with an authored outline',authors:[],source:'pdf',abstract:'A PDF outline fixture.',text:'Evidence.',createdAt:'2026-10-22T00:00:00Z',url:'https://example.org/paper',tags:[],pageCount:3,localPdfUrl:i?'/outline-empty.pdf':'/outline-source.pdf'}));
  await page.route('**/outline-source.pdf',route=>route.fulfill({body:outlinePdf(),contentType:'application/pdf'}));
  await page.route('**/outline-empty.pdf',route=>route.fulfill({body:outlinePdf({outline:false}),contentType:'application/pdf'}));
  await page.route('**/api/**',async route=>{
    if(new URL(route.request().url()).pathname==='/api/collections'){await route.fulfill({json:{collections:[]}});return;}
    const path=new URL(route.request().url()).pathname.slice(4);let result:any={};
    if(path==='/papers')result={papers};
    else if(path==='/settings')result={provider:'openai',baseUrl:'',model:'',modelConfigured:false,apiKeyConfigured:false};
    else if(/^\/papers\/[^/]+$/.test(path))result={paper:papers.find(p=>p.id===path.split('/')[2])};
    else if(path==='/chats')result={messages:[],conversationId:null};
    else if(path.endsWith('/annotations'))result={annotations:[]};
    else if(path.endsWith('/activities'))result={activities:[]};
    await route.fulfill({json:result});
  });
}
async function open(page:Page,id='outline-paper'){
  await page.goto('/en/?paper='+id);await page.getByRole('tab',{name:'Paper',exact:true}).click();
  await expect(page.locator('[data-pdf-page="1"] canvas[data-rendered="true"]')).toBeVisible();
  await page.getByRole('button',{name:'PDF outline',exact:true}).click();
  return page.getByRole('dialog',{name:'Paper outline',exact:true});
}
test('embedded PDF outline preserves complete titles and page labels, expands levels and locates exact destinations',async({page},info)=>{
  await setup(page);let panel=await open(page);
  await expect(panel.getByRole('navigation',{name:'Embedded PDF outline',exact:true})).toBeVisible();
  const method=panel.locator('.pdf-outline-link').filter({hasText:longOutlineTitle});
  await expect(method.locator('.pdf-outline-title')).toHaveText(longOutlineTitle);
  await expect(method).toContainText('p.2 · printed 1');
  await expect(panel.locator('.pdf-outline-link').filter({hasText:'Introduction'})).toContainText('p.1 · printed i');
  const bounds=(await panel.boundingBox())!,viewport=page.viewportSize()!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(viewport.width+1);expect(bounds.y+bounds.height).toBeLessThanOrEqual(viewport.height+1);
  expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
  const collapse=panel.getByRole('button',{name:'Collapse '+longOutlineTitle,exact:true});await collapse.click();
  const child=panel.locator('.pdf-outline-link').filter({hasText:'Controlled evidence subsection'});await expect(child).toBeHidden();
  const expand=panel.getByRole('button',{name:'Expand '+longOutlineTitle,exact:true});await expand.focus();await page.keyboard.press('Enter');await expect(child).toBeVisible();
  await method.click();await expect(panel).toBeHidden();
  await expect(page.getByLabel('PDF page number',{exact:true})).toHaveValue('2');
  const heading=page.locator('[data-pdf-page="2"] .pdf-text-layer span').filter({hasText:'Named method destination'}).first();
  await expect(heading).toBeVisible();
  const headingBounds=(await heading.boundingBox())!,pdfBounds=(await page.getByLabel('Continuous paper pages',{exact:true}).boundingBox())!;
  expect(headingBounds.y-pdfBounds.y).toBeGreaterThanOrEqual(-30);expect(headingBounds.y-pdfBounds.y).toBeLessThan(100);
  const methodScroll=await page.getByLabel('Continuous paper pages',{exact:true}).evaluate(el=>el.scrollTop);
  await page.getByRole('button',{name:'PDF outline',exact:true}).click();
  await expect(panel.locator('.pdf-outline-link').filter({hasText:longOutlineTitle})).toHaveAttribute('aria-current','location');
  await panel.locator('.pdf-outline-link').filter({hasText:'Controlled evidence subsection'}).click();
  await expect.poll(()=>page.getByLabel('Continuous paper pages',{exact:true}).evaluate(el=>el.scrollTop)).toBeGreaterThan(methodScroll+50);
  await page.getByRole('button',{name:'PDF outline',exact:true}).click();
  const currentEntry = panel.locator('.pdf-outline-link').filter({hasText:'Controlled evidence subsection'});
  await expect(currentEntry).toHaveAttribute('aria-current','location');
  await expect.poll(async () => { const row = (await currentEntry.boundingBox())!; const scroll = (await panel.locator('.pdf-outline-scroll').boundingBox())!; return row.y >= scroll.y - 1 && row.y + row.height <= scroll.y + scroll.height + 1; }).toBeTruthy();
  await page.screenshot({path:info.outputPath('pdf-outline.png')});
  await page.keyboard.press('Escape');await expect(panel).toBeHidden();
  await expect(page.getByRole('button',{name:'PDF outline',exact:true})).toBeFocused();
});
test('a PDF without an embedded outline offers local text search without copying another document headings',async({page})=>{
  await setup(page);await open(page);await expect(page.getByRole('dialog',{name:'Paper outline',exact:true})).toContainText(longOutlineTitle);
  const panel=await open(page,'empty-paper');
  await expect(panel).toContainText('This PDF has no embedded outline.');
  await expect(panel).not.toContainText(longOutlineTitle);
  await panel.getByRole('button',{name:'Find in text',exact:true}).click();
  await expect(panel).toBeHidden();
  await expect(page.getByRole('searchbox',{name:'Find in PDF text',exact:true})).toBeFocused();
});

test('page-number editing does not jump on empty or partial text, Enter and blur commit, Escape cancels',async({page})=>{
  await setup(page);await open(page);await page.getByRole('button',{name:'Close paper outline',exact:true}).click();
  const input=page.getByLabel('PDF page number',{exact:true}), viewport=page.getByLabel('Continuous paper pages',{exact:true});
  const position=()=>viewport.evaluate(el=>el.scrollTop);
  const original=await position();
  await input.fill('');expect(await position()).toBe(original);await expect(input).toHaveValue('');
  await input.pressSequentially('2');expect(await position()).toBe(original);
  await input.press('Enter');await expect.poll(position).toBeGreaterThan(original+100);
  const second=await position();
  await input.fill('3');await input.press('Escape');await expect(input).toHaveValue('2');expect(await position()).toBe(second);
  await input.fill('');await input.press('Tab');await expect(input).toHaveValue('2');expect(await position()).toBe(second);
  await input.fill('3');await input.press('Tab');await expect.poll(position).toBeGreaterThan(second+100);
  await page.getByRole('button',{name:'Back to previous position',exact:true}).click();await expect(input).toHaveValue('2');await expect.poll(position).toBeCloseTo(second,0);
});
