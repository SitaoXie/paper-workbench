import {test,expect,type Page,type APIRequestContext} from '@playwright/test';

async function fixture(page:Page, request:APIRequestContext) {
  const renderer=await page.context().newPage();
  await renderer.setContent('<style>body{font:18px Georgia;margin:30px}section{break-before:page}</style><p>Finite samples support an empirical claim.</p><section><p>Unobserved routes may still exist in the distribution.</p></section>');
  const buffer=await renderer.pdf({width:'600px',height:'300px'});await renderer.close();
  const response=await request.post('/api/upload',{multipart:{file:{name:'subscription-passage.pdf',mimeType:'application/pdf',buffer}}});
  expect(response.ok(),await response.text()).toBeTruthy();
  return (await response.json()).paper;
}
async function selectPdf(page:Page,crossPage=false) {
  const first=page.locator('[data-pdf-page="1"] .pdf-text-layer span').filter({hasText:'Finite samples'}).first();
  await expect(first).toBeVisible();
  // Start a fresh gesture in the page margin. Clicking an existing highlighted
  // passage would correctly open its note before this programmatic range.
  await page.getByRole('region',{name:'Paper PDF reader',exact:true}).getByLabel('Continuous paper pages',{exact:true}).click({position:{x:4,y:4}});
  // The new gesture starts on source text; a margin click alone is only a
  // focus reset and intentionally does not reopen a dismissed identical quote.
  await first.dispatchEvent('pointerdown',{pointerId:1,pointerType:'mouse',isPrimary:true});
  if(crossPage)await expect(page.locator('[data-pdf-page="2"] .pdf-text-layer span').filter({hasText:'Unobserved routes'}).first()).toBeAttached();
  await first.evaluate((element,cross)=>{const last=cross?Array.from(document.querySelectorAll('[data-pdf-page="2"] .pdf-text-layer span')).find(el=>el.textContent?.includes('Unobserved routes'))!:element;const range=document.createRange();range.setStart(element.firstChild!,0);range.setEnd(last.firstChild!,last.firstChild!.textContent!.length);const selection=getSelection()!;selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));},crossPage);
  await expect(page.getByRole('dialog',{name:'Selected text actions',exact:true})).toBeVisible();
}
async function selectionTask(dialog:ReturnType<Page['getByRole']>) {
  await dialog.getByRole('button',{name:'Show task text',exact:true}).click();
  const text=await dialog.getByRole('textbox',{name:'Subscription selection task',exact:true}).inputValue();
  return {text,binding:JSON.parse(text.match(/\n\n(\{\n[\s\S]*?\n\})\n\n/)![1])};
}

test('subscription-only cross-page translation imports in place, reuses its task, and saves one anchored note without chat or model calls',async({page,request})=>{
  const paper=await fixture(page,request);const modelCalls:string[]=[];
  page.on('request',req=>{if(req.method()==='POST'&&/\/(assist|chat|chats\/new|report|translate)(\?|$)/.test(new URL(req.url()).pathname))modelCalls.push(req.url());});
  await page.goto(`/en/?paper=${paper.id}`);await page.getByRole('tab',{name:'Paper',exact:true}).click();
  await selectPdf(page,true);
  await page.getByRole('button',{name:'Translate selection',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Inline reading assistant',exact:true});await expect(dialog).toBeVisible();
  const {text,binding}=await selectionTask(dialog);expect(text).toContain(`PAPER_WORKBENCH_URL='${new URL(page.url()).origin}'`);expect(text).toContain('--pages 1,2');
  expect(binding).toMatchObject({paperId:paper.id,sourceScope:'pdf',page:1,pages:[1,2],kind:'translation',language:'en'});
  await dialog.getByRole('button',{name:'Refresh agent result',exact:true}).click();await expect(dialog).toContainText('No result for this task yet');
  const payload={...binding,result:{text:'A bounded sample is evidence, not a proof of absence.'},source:{agent:'Acceptance agent'}};
  const saved=await request.post(`/api/papers/${paper.id}/activities`,{data:payload});expect(saved.status(),await saved.text()).toBe(201);
  const repeated=await request.post(`/api/papers/${paper.id}/activities`,{data:payload});expect(repeated.status()).toBe(200);
  await dialog.getByRole('button',{name:'Refresh agent result',exact:true}).click();await expect(dialog.locator('.pdf-inline-markdown')).toContainText(payload.result.text);
  await expect(dialog.getByRole('button',{name:'Saved',exact:true})).toBeDisabled();
  const notes=(await (await request.get(`/api/papers/${paper.id}/annotations`)).json()).annotations;expect(notes).toHaveLength(1);expect(notes[0].segments.map((segment:any)=>segment.page)).toEqual([1,2]);expect(notes[0].body).toContain(payload.result.text);
  await dialog.getByRole('button',{name:'Close inline assistant',exact:true}).click();await selectPdf(page,true);await page.getByRole('button',{name:'Translate selection',exact:true}).click();
  const reopened=await selectionTask(dialog);expect(reopened.binding.agentTaskId).toBe(binding.agentTaskId);
  await dialog.getByRole('button',{name:'Refresh agent result',exact:true}).click();await expect(dialog.locator('.pdf-inline-markdown')).toContainText(payload.result.text);
  expect(modelCalls).toEqual([]);expect((await (await request.get(`/api/conversations?paperId=${paper.id}`)).json()).conversations).toHaveLength(0);
});

test('overview subscription results require exact version, language and quote binding and an old refresh cannot overwrite a new operation',async({page})=>{
  const reading={id:'fixed-v1',style:'deep',language:'en',markdown:'## Evidence\nA finite sample is not the entire distribution.',createdAt:'2026-10-22T00:00:00Z',mode:'agent'};
  const paper={id:'overview-agent',title:'Scoped selection',authors:[],source:'web',abstract:'Original abstract.',text:'Original source.',tags:[],createdAt:reading.createdAt,readingVersions:[reading],activeReadingId:reading.id};
  let returned:any[]=[];const writes:string[]=[];let deferred:any;
  await page.route('**/api/**',async route=>{
    if(new URL(route.request().url()).pathname==='/api/collections'){await route.fulfill({json:{collections:[]}});return;}const req=route.request(),url=new URL(req.url()),path=url.pathname.slice(4);let json:any={};
    if(req.method()!=='GET')writes.push(path);
    if(path==='/settings')json={provider:'openai',baseUrl:'',model:'',modelConfigured:false,apiKeyConfigured:false};
    else if(path==='/papers')json={papers:[paper]};else if(path===`/papers/${paper.id}`)json={paper};
    else if(path.endsWith('/activities')){if(url.searchParams.has('agentTaskId')&&deferred===true){deferred=route;return;}json={activities:returned};}
    else if(path.endsWith('/annotations'))json={annotations:[]};else if(path==='/chats')json={messages:[],conversationId:null};else if(path==='/conversations')json={conversations:[]};
    await route.fulfill({json});});
  await page.goto(`/en/?paper=${paper.id}`);const prose=page.locator('.reading-prose p').first();await expect(prose).toBeVisible();await prose.scrollIntoViewIfNeeded();
  await prose.evaluate(element=>{const range=document.createRange();range.selectNodeContents(element);const selection=getSelection()!;selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
  const dialog=page.getByRole('dialog',{name:'Selection actions',exact:true});await dialog.getByRole('button',{name:'Explain',exact:true}).click();
  const {binding}=await selectionTask(dialog);expect(binding).toMatchObject({paperId:paper.id,sourceScope:'reading',readingId:reading.id,kind:'explanation'});expect(binding.page).toBeUndefined();
  returned=[{...binding,id:'wrong',readingId:'wrong-v2',result:{text:'Do not show this mismatched result.'},createdAt:reading.createdAt}];
  await dialog.getByRole('button',{name:'Refresh agent result',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('does not match');await expect(dialog.locator('.overview-selection-result')).toHaveCount(0);
  returned=[{...binding,id:'correct',result:{text:'The fixed reading describes finite-sample uncertainty.'},source:{agent:'Acceptance agent'},createdAt:reading.createdAt}];
  await dialog.getByRole('button',{name:'Refresh agent result',exact:true}).click();await expect(dialog.locator('.overview-selection-result')).toContainText('finite-sample uncertainty');
  deferred=true;await dialog.getByRole('button',{name:'Refresh agent result',exact:true}).click();await expect.poll(()=>typeof deferred).toBe('object');
  await dialog.getByRole('combobox',{name:'Selection result language',exact:true}).selectOption('zh-CN');
  await deferred.fulfill({json:{activities:returned}});await expect(dialog.locator('.overview-selection-result')).toHaveCount(0);
  expect(writes).toEqual([]);
});
