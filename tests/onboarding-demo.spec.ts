import {test,expect} from '@playwright/test';

for(const locale of ['zh','en'])test(`sample reading is bilingual and isolated without model calls (${locale})`,async({page})=>{
 const paths:string[]=[];const writes:string[]=[];const errors:string[]=[];
 page.on('request',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/')){paths.push(u.pathname);if(!['GET','HEAD'].includes(r.method()))writes.push(u.pathname);}});
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`/${locale}/?demo=1&paper=demo-evidence-paper`);
 await expect(page.locator('.reading-prose')).toContainText(locale==='zh'?'怎么读这个实验':'How to read this experiment');
 await expect(page.locator('.reading-provenance')).toContainText(locale==='zh'?'预写示例':'Prewritten example');
 await page.getByLabel(locale==='zh'?'解读版本':'Reading version',{exact:true}).selectOption('demo-quick');
 await expect(page.locator('.reading-prose')).not.toContainText('How to read this experiment');
 await expect(page.locator('.reading-prose')).not.toContainText('怎么读这个实验');
 await page.getByLabel(locale==='zh'?'阅读语言':'Reading language',{exact:true}).selectOption(locale==='zh'?'en':'zh-CN');
 await expect(page.locator('.reading-prose')).toContainText(locale==='zh'?'The idea in one sentence':'一句话理解');
 await page.locator('.reading-prose .citation-link').first().click();
 await expect(page.locator('[data-pdf-page="2"] canvas[data-rendered="true"]')).toBeVisible();
 await expect(page.locator('.pdf-search-highlight').first()).toBeVisible();
 expect(new URL(page.url()).searchParams.get('demo')).toBe('1');
 await page.locator('.demo-actions button').first().click();
 await expect(page.locator('.conversation')).toContainText('No model call');
 await expect(page.locator('.composer')).not.toBeVisible();
 await page.locator('.assistant-header button').last().click();
 await page.locator('.demo-actions button').nth(1).click();
 await expect(page.locator('.notebook-panel')).toContainText('To verify');
 await page.locator('.notebook-panel button').first().click();
 const menu=page.locator('.mobile-menu');if(await menu.isVisible())await menu.click();
 await page.getByRole('button',{name:/Paper Workbench/}).click();
 await expect(page.locator('.collection-paper-open')).toContainText('A Tiny Retrieval Study');
 expect(new URL(page.url()).searchParams.get('demo')).toBe('1');
 expect(errors).toEqual([]);expect(writes).toEqual([]);expect(paths.length).toBeGreaterThan(5);expect(paths.every(p=>p.startsWith('/api/demo/'))).toBeTruthy();
});

test('empty workspace guide opens sample and exits without adding papers',async({page,request})=>{
 // This spec uses only the isolated test server; a clean list is not assumed
 // because other tests may have imported fixtures into that disposable store.
 await page.goto('/en/?view=library');
 if(await page.getByRole('button',{name:'Expand navigation',exact:true}).isVisible())await page.getByRole('button',{name:'Expand navigation',exact:true}).click();
 await page.getByRole('button',{name:'Getting started',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Make your next paper make sense.'})).toBeVisible();
 const before=await(await request.get('/api/papers')).json();
 await page.getByRole('button',{name:/Explore the sample/}).click();
 await expect(page.locator('.reading-prose')).toBeVisible();
 await page.getByRole('link',{name:'Back to my library',exact:true}).click();
 expect(new URL(page.url()).searchParams.has('demo')).toBeFalsy();
 const after=await(await request.get('/api/papers')).json();expect(after).toEqual(before);
});
