/** Reproducible product assets: own synthetic fixture, disposable empty data,
 * no .env, no saved browser profile, and no model calls. Run after npm run build. */
import {chromium} from '@playwright/test';
import {createApp} from '../server/index.mjs';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const root=path.resolve('docs/assets'),dataDir=await mkdtemp(path.join(os.tmpdir(),'paper-demo-assets-'));
await mkdir(root,{recursive:true});
const app=await createApp({dataDir}),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser,context;
try {
 browser=await chromium.launch({channel:process.env.E2E_CHANNEL||'chrome'});
 context=await browser.newContext({viewport:{width:1440,height:1000},recordVideo:{dir:path.join(dataDir,'video'),size:{width:1440,height:1000}}});
 // Fail closed: assets must never depend on a public site or provider.
 await context.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===origin||['data:','blob:'].includes(url.protocol)?route.continue():route.abort();});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${origin}/en/?view=library`);await page.getByRole('heading',{name:'Make your next paper make sense.'}).waitFor();
 await page.screenshot({path:path.join(root,'getting-started.png')});await page.waitForTimeout(1200);
 await page.getByRole('button',{name:/Explore the sample/}).click();await page.locator('.reading-prose').waitFor();
 await page.getByRole('button',{name:'Sample Q&A',exact:true}).click();
 await page.locator('.reading-prose .citation-link').first().scrollIntoViewIfNeeded();await page.waitForTimeout(1400);
 await page.screenshot({path:path.join(root,'reading-demo.png')});
 await page.locator('.reading-prose .citation-link').first().click();await page.locator('[data-pdf-page="2"] canvas[data-rendered="true"]').waitFor();
 await page.locator('.pdf-search-highlight').first().waitFor();
 await page.screenshot({path:path.join(root,'evidence-demo.png')});await page.waitForTimeout(1800);
 await page.locator('.assistant-header button').last().click();await page.getByRole('button',{name:'Sample notes',exact:true}).click();
 await page.locator('.notebook-card').first().click();await page.waitForTimeout(1200);
 await page.screenshot({path:path.join(root,'notes-demo.png')});
 await page.goto(`${origin}/zh/?demo=1&paper=demo-evidence-paper`);await page.getByRole('tab',{name:'摘要',exact:true}).click();await page.locator('.reading-prose').waitFor();
 await page.getByRole('button',{name:'示例问答',exact:true}).click();await page.locator('.reading-prose .citation-link').first().scrollIntoViewIfNeeded();
 await page.waitForTimeout(1000);await page.screenshot({path:path.join(root,'reading-demo.zh-CN.png')});
 const video=page.video();await context.close();context=undefined;await video.saveAs(path.join(root,'reading-tour.webm'));
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,deviceScaleFactor:1});await mobile.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===origin||['data:','blob:'].includes(url.protocol)?route.continue():route.abort();});const m=await mobile.newPage();
 await m.goto(`${origin}/en/?demo=1&paper=demo-evidence-paper`);await m.locator('.reading-prose').waitFor();await m.locator('.reading-prose').scrollIntoViewIfNeeded();await m.waitForTimeout(700);await m.screenshot({path:path.join(root,'mobile-demo.png')});await mobile.close();
 if(errors.length)throw new Error(errors.join('\n'));
 console.log('Generated six screenshots and reading-tour.webm from the isolated zero-API sample.');
}finally{await context?.close();await browser?.close();await new Promise(r=>server.close(r));await rm(dataDir,{recursive:true,force:true});}
