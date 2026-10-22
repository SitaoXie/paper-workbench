import {test,expect,type Page,type Route} from '@playwright/test';
import {outlinePdf} from './fixtures/outline-pdf.mjs';

async function fixture(page:Page){
  const readings=(prefix:string)=>Array.from({length:12},(_,i)=>`## ${prefix} section ${i+1}\n\n${'Follow the original evidence and preserve the conditions of the comparison. '.repeat(12)} [p.2]`).join('\n\n');
  const papers:any[]=['a','b'].map(id=>({id:'history-'+id,title:'History paper '+id,authors:[],source:'pdf',createdAt:'2026-10-22T00:00:00Z',abstract:'The original abstract describes a controlled result.',text:'Source evidence.',tags:[],pageCount:3,localPdfUrl:'/history-source.pdf',activeReadingId:'current-'+id,readingVersions:[{id:'current-'+id,style:'deep',language:'en',markdown:readings('Current '+id),mode:'agent',createdAt:'2026-10-22T00:00:00Z'},{id:'older-'+id,style:'quick',language:'en',markdown:readings('Older '+id),mode:'agent',createdAt:'2026-10-21T00:00:00Z'}]}));
  const writes:any[]=[],pendingDetails:{id:string;route:Route}[]=[];const heldDetails=new Set<string>();
  await page.route('**/history-source.pdf',route=>route.fulfill({body:outlinePdf(),contentType:'application/pdf'}));
  await page.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url()),path=url.pathname.slice(4);let json:any={};
    if(req.method()!=='GET')writes.push({path,body:req.postDataJSON()});
    if(path==='/settings')json={provider:'openai',baseUrl:'',model:'',modelConfigured:false,apiKeyConfigured:false};
    else if(path==='/papers')json={papers};
    else if(/^\/papers\/[^/]+$/.test(path)){const id=path.split('/')[2];if(heldDetails.has(id)&&req.method()==='GET'){pendingDetails.push({id,route});return;}const paper=papers.find(p=>p.id===id);if(req.method()==='PATCH')Object.assign(paper,req.postDataJSON());json={paper};}
    else if(path==='/chats')json={conversationId:'session-'+url.searchParams.get('paperId'),messages:[{role:'assistant',content:'This saved answer remains available during source navigation. [p.2] Also compare [p.3].'}]};
    else if(path==='/conversations')json={conversations:[]};else if(path.endsWith('/annotations'))json={annotations:[]};else if(path.endsWith('/activities'))json={activities:[]};
    await route.fulfill({json});});
  return {papers,writes,pendingDetails,holdDetail:(id:string)=>heldDetails.add(id),releaseDetail:(id:string)=>heldDetails.delete(id)};
}
async function library(page:Page){const menu=page.getByRole('button',{name:/^(Open|Expand) navigation$/});if(await menu.isVisible())await menu.click();await page.getByRole('navigation').getByRole('button',{name:'Library',exact:true}).click();}
async function closeAssistant(page:Page){const close=page.getByRole('button',{name:'Close assistant',exact:true});if(await close.isVisible())await close.click();}
const viewport=(page:Page)=>page.getByLabel('Continuous paper pages',{exact:true});
const geometry=(page:Page)=>viewport(page).evaluate(el=>({top:el.scrollTop,left:el.scrollLeft}));

test('browser Back/Forward retains the overview paragraph, PDF position and unsent assistant draft',async({page})=>{
  const {writes}=await fixture(page);await page.goto('/en/?view=library');
  await page.locator('.paper-card-main').filter({hasText:'History paper a'}).click();await closeAssistant(page);
  const heading=page.getByRole('heading',{name:'Current a section 7',exact:true});await heading.scrollIntoViewIfNeeded();
  const citation=page.locator('.reading-prose').getByRole('button',{name:'p.2',exact:true}).nth(6);await citation.scrollIntoViewIfNeeded();
  const before=await heading.evaluate(el=>el.getBoundingClientRect().top);
  const count=await page.evaluate(()=>history.length);
  await citation.click();await expect(page.getByLabel('PDF page number',{exact:true})).toHaveValue('2');await expect(page.locator('[data-pdf-page="2"] canvas[data-rendered="true"]')).toBeVisible();
  await page.getByRole('button',{name:'Zoom in PDF',exact:true}).click();await viewport(page).evaluate(el=>{el.scrollTop+=112;el.scrollLeft=40;el.dispatchEvent(new Event('scroll'));});
  const after=await geometry(page),zoom=await page.getByLabel('PDF zoom level',{exact:true}).textContent();
  await page.goBack();await expect(page.getByRole('tab',{name:'Overview',exact:true})).toHaveAttribute('aria-selected','true');
  await expect.poll(async()=>Math.abs(await heading.evaluate(el=>el.getBoundingClientRect().top)-before)).toBeLessThan(3);
  await page.goForward();await expect(page.getByLabel('PDF zoom level',{exact:true})).toHaveText(zoom!);await expect.poll(async()=>(await geometry(page)).top).toBeCloseTo(after.top,0);await expect.poll(async()=>(await geometry(page)).left).toBeCloseTo(after.left,0);
  expect(await page.evaluate(()=>history.length)).toBe(count+1);
  await page.goBack();await page.getByRole('button',{name:'Open floating assistant',exact:true}).click();
  await page.locator('.composer textarea').fill('Keep this unsent question while reading.');
  await expect(page.locator('.messages')).toContainText('saved answer remains');
  await page.locator('.messages').getByRole('button',{name:'p.2',exact:true}).click();await page.goBack();
  await expect(page.locator('.composer textarea')).toHaveValue('Keep this unsent question while reading.');
  await expect(page.locator('.messages')).toContainText('saved answer remains');expect(writes).toEqual([]);
});

test('library and distinct papers are browser history entries and restoring does not rewrite active versions',async({page})=>{
  const {writes}=await fixture(page);await page.goto('/en/?view=library');
  await page.locator('.paper-card-main').filter({hasText:'History paper a'}).click();await closeAssistant(page);
  await page.getByRole('tab',{name:'Paper',exact:true}).click();await expect(page.getByLabel('PDF page number',{exact:true})).toBeVisible();
  await page.getByLabel('PDF page number',{exact:true}).fill('3');await page.getByLabel('PDF page number',{exact:true}).press('Enter');
  await expect(page.locator('[data-pdf-page="3"] canvas[data-rendered="true"]')).toBeVisible();await viewport(page).evaluate(el=>{el.scrollTop+=70;el.dispatchEvent(new Event('scroll'));});const before=await geometry(page);
  await library(page);await page.locator('.paper-card-main').filter({hasText:'History paper b'}).click();await expect(page.locator('.paper-summary h1')).toHaveText('History paper b');
  await page.goBack();await expect(page.locator('.paper-card-main')).toHaveCount(2);
  await page.goBack();await expect(page.getByLabel('PDF page number',{exact:true})).toHaveValue('3');await expect.poll(async()=>(await geometry(page)).top).toBeCloseTo(before.top,0);
  await page.goBack();await expect(page.getByRole('tab',{name:'Overview',exact:true})).toHaveAttribute('aria-selected','true');await page.goBack();await expect(page.locator('.paper-card-main')).toHaveCount(2);
  await page.goForward();await expect(page.locator('.paper-summary h1')).toHaveText('History paper a');expect(writes).toEqual([]);
});

test('an older-version chapter survives a browser history detour to its PDF citation',async({page})=>{
  const {writes}=await fixture(page);await page.goto('/en/?paper=history-a#reading=older-a&section=5');await closeAssistant(page);
  await expect(page.getByLabel('Reading version',{exact:true})).toHaveValue('older-a');
  await page.locator('.reading-prose').getByRole('button',{name:'p.2',exact:true}).nth(4).click();await expect(page.getByLabel('PDF page number',{exact:true})).toHaveValue('2');
  await page.goBack();await expect(page.getByLabel('Reading version',{exact:true})).toHaveValue('older-a');await expect(page.getByRole('tab',{name:'Overview',exact:true})).toHaveAttribute('aria-selected','true');
  await expect.poll(()=>page.getByRole('heading',{name:'Older a section 5',exact:true}).evaluate(el=>el.getBoundingClientRect().top)).toBeLessThan(180);
  await page.goForward();await expect(page.getByLabel('PDF page number',{exact:true})).toHaveValue('2');expect(writes).toEqual([]);
});


test('a same-paper Back while details load still finishes loading its existing conversation',async({page})=>{
  const f=await fixture(page);await page.goto('/en/?view=library');f.holdDetail('history-a');
  await page.locator('.paper-card-main').filter({hasText:'History paper a'}).click();await expect.poll(()=>f.pendingDetails.length).toBe(1);
  await closeAssistant(page);await page.getByRole('tab',{name:'Paper',exact:true}).click();await expect(page.getByLabel('PDF page number',{exact:true})).toBeVisible();
  await page.goBack();await expect(page.getByRole('tab',{name:'Overview',exact:true})).toHaveAttribute('aria-selected','true');
  await f.pendingDetails[0].route.fulfill({json:{paper:f.papers[0]}});
  await page.getByRole('button',{name:'Open floating assistant',exact:true}).click();
  await expect(page.locator('.messages')).toContainText('This saved answer remains available during source navigation.');
  expect(f.writes).toEqual([]);
});

test('refresh between a fast Back and Forward preserves the final PDF pixels',async({page})=>{
  const f=await fixture(page);await page.goto('/en/?view=library');await page.locator('.paper-card-main').filter({hasText:'History paper a'}).click();await closeAssistant(page);
  await page.locator('.reading-prose').getByRole('button',{name:'p.2',exact:true}).first().click();await expect(page.locator('[data-pdf-page="2"] canvas[data-rendered="true"]')).toBeVisible();
  const departure=await viewport(page).evaluate(element=>{element.scrollTop+=270;element.dispatchEvent(new Event('scroll'));const position={top:element.scrollTop,left:element.scrollLeft};history.back();return position;});
  await expect(page.getByRole('tab',{name:'Overview',exact:true})).toHaveAttribute('aria-selected','true');await page.reload();await expect(page.locator('.reading-prose')).toBeVisible();
  await page.goForward();await expect(page.getByRole('tab',{name:'Paper',exact:true})).toHaveAttribute('aria-selected','true');
  await expect.poll(async()=>(await geometry(page)).top).toBeCloseTo(departure.top,0);expect(f.writes).toEqual([]);
});


test('zoom after going Back between two PDF source destinations stays on the restored page',async({page})=>{
  const f=await fixture(page);await page.goto('/en/?view=library');await page.locator('.paper-card-main').filter({hasText:'History paper a'}).click();await closeAssistant(page);
  await page.locator('.reading-prose').getByRole('button',{name:'p.2',exact:true}).first().click();await expect(page.getByLabel('PDF page number',{exact:true})).toHaveValue('2');
  await page.getByRole('button',{name:'Zoom in PDF',exact:true}).click();
  await page.getByRole('button',{name:'Open floating assistant',exact:true}).click();await page.locator('.messages').getByRole('button',{name:'p.3',exact:true}).click();await closeAssistant(page);
  await expect(page.getByLabel('PDF page number',{exact:true})).toHaveValue('3');await page.goBack();await expect(page.getByLabel('PDF page number',{exact:true})).toHaveValue('2');
  await page.getByRole('button',{name:'Zoom in PDF',exact:true}).click();await expect(page.getByLabel('PDF page number',{exact:true})).toHaveValue('2');expect(f.writes).toEqual([]);
});


test('a late paper response cannot overwrite a different paper or move its unsent question',async({page})=>{
  const f=await fixture(page);await page.goto('/en/?view=library');f.holdDetail('history-a');
  await page.locator('.paper-card-main').filter({hasText:'History paper a'}).click();await expect.poll(()=>f.pendingDetails.length).toBe(1);await library(page);
  await page.locator('.paper-card-main').filter({hasText:'History paper b'}).click();
  if(!await page.locator('.composer textarea').isVisible())await page.getByRole('button',{name:'Open floating assistant',exact:true}).click();
  await expect(page.locator('.messages')).toContainText('saved answer remains');await page.locator('.composer textarea').fill('This unsent question belongs only to paper B.');
  f.releaseDetail('history-a');await f.pendingDetails[0].route.fulfill({json:{paper:{...f.papers[0],title:'LATE PAPER A RESPONSE'}}});
  await expect(page.locator('.paper-summary h1')).toHaveText('History paper b');await expect(page.locator('.composer textarea')).toHaveValue('This unsent question belongs only to paper B.');
  await page.goBack();await expect(page.locator('.paper-card-main')).toHaveCount(2);await page.goBack();await expect(page.locator('.paper-summary h1')).toHaveText('History paper a');
  await expect(page.locator('.messages')).toContainText('saved answer remains');await expect(page.locator('.composer textarea')).toHaveValue('');
  await page.goForward();await expect(page.locator('.paper-card-main')).toHaveCount(2);await page.goForward();await expect(page.locator('.paper-summary h1')).toHaveText('History paper b');await expect(page.locator('.composer textarea')).toHaveValue('This unsent question belongs only to paper B.');
  const navigationOnly=await page.evaluate(()=>({state:JSON.stringify(history.state),cache:sessionStorage.getItem('paper-workbench:history-positions-v1')||''}));
  for(const value of Object.values(navigationOnly)){expect(value).not.toContain('This unsent question');expect(value).not.toContain('saved answer remains');expect(value).not.toContain('Follow the original evidence');}
  expect(f.writes).toEqual([]);
});


test('a delayed fresh active version cannot replace the fixed overview restored by browser Back',async({page})=>{
  const f=await fixture(page);f.papers[0].activeReadingId='older-a';
  await page.goto('/en/?view=library');
  await page.locator('.paper-card-main').filter({hasText:'History paper a'}).click();await closeAssistant(page);
  await expect(page.getByLabel('Reading version',{exact:true})).toHaveValue('older-a');
  await expect(page.getByRole('heading',{name:'Older a section 1',exact:true})).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  await library(page);await page.locator('.paper-card-main').filter({hasText:'History paper b'}).click();
  await expect(page.locator('.paper-summary h1')).toHaveText('History paper b');
  f.holdDetail('history-a');await page.goBack();await expect(page.locator('.paper-card-main')).toHaveCount(2);
  await page.goBack();await expect.poll(()=>f.pendingDetails.length).toBe(1);
  await expect(page.getByLabel('Reading version',{exact:true})).toHaveValue('older-a');
  // The library snapshot still points at A; the delayed detail legitimately
  // reports a newer default B. Returning to this history entry is read-only.
  await f.pendingDetails[0].route.fulfill({json:{paper:{...f.papers[0],title:'History paper a — fresh metadata',activeReadingId:'current-a'}}});
  await expect(page.locator('.paper-summary h1')).toHaveText('History paper a — fresh metadata');
  await expect(page.getByLabel('Reading version',{exact:true})).toHaveValue('older-a');
  await expect(page.getByRole('heading',{name:'Older a section 1',exact:true})).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');expect(f.writes).toEqual([]);
  await page.getByLabel('Reading version',{exact:true}).selectOption('current-a');
  await expect(page.getByLabel('Reading version',{exact:true})).toBeEnabled();
  await expect(page.getByLabel('Reading version',{exact:true})).toHaveValue('current-a');
  await expect(page.getByRole('heading',{name:'Current a section 1',exact:true})).toBeVisible();
  expect(f.writes).toEqual([{path:'/papers/history-a',body:{activeReadingId:'current-a'}}]);
  const generated={...f.papers[0].readingVersions[0],id:'generated-a',mode:'extractive',markdown:'## Newly requested source excerpts\n\nA new reading remains the explicit user choice.',createdAt:'2026-10-22T12:00:00Z'};
  await page.route('**/api/papers/history-a/report',async route=>{
    f.writes.push({path:'/papers/history-a/report',body:route.request().postDataJSON()});
    await route.fulfill({json:{paper:{...f.papers[0],activeReadingId:generated.id,readingVersions:[generated,...f.papers[0].readingVersions]}}});
  });
  await page.getByRole('button',{name:'New version',exact:true}).click();
  await page.getByRole('button',{name:'Create source excerpts',exact:true}).click();
  await expect(page.getByLabel('Reading version',{exact:true})).toHaveValue(generated.id);
  await expect(page.getByRole('heading',{name:'Newly requested source excerpts',exact:true})).toBeVisible();
  expect(f.writes).toEqual([{path:'/papers/history-a',body:{activeReadingId:'current-a'}},{path:'/papers/history-a/report',body:{language:'en',style:'quick',format:'article',focus:'',adversarial:false}}]);
});


test('a delayed initial detail cannot undo an explicitly saved version choice',async({page})=>{
  const f=await fixture(page),staleDetail=structuredClone(f.papers[0]);
  f.holdDetail('history-a');await page.goto('/en/?view=library');
  await page.locator('.paper-card-main').filter({hasText:'History paper a'}).click();
  await expect.poll(()=>f.pendingDetails.length).toBe(1);
  await page.getByLabel('Reading version',{exact:true}).selectOption('older-a');
  await expect(page.getByLabel('Reading version',{exact:true})).toBeEnabled();
  await expect(page.getByLabel('Reading version',{exact:true})).toHaveValue('older-a');
  expect(f.writes).toEqual([{path:'/papers/history-a',body:{activeReadingId:'older-a'}}]);
  // This GET started before the PATCH. It may finish later with the snapshot
  // that existed before the user's successfully saved change.
  await f.pendingDetails[0].route.fulfill({json:{paper:staleDetail}});
  if(!await page.locator('.composer textarea').isVisible())await page.getByRole('button',{name:'Open floating assistant',exact:true}).click();
  await expect(page.locator('.messages')).toContainText('This saved answer remains available during source navigation.');
  await expect(page.getByLabel('Reading version',{exact:true})).toHaveValue('older-a');
  await expect(page.getByRole('heading',{name:'Older a section 1',exact:true})).toBeVisible();
  expect(f.writes).toHaveLength(1);
});
