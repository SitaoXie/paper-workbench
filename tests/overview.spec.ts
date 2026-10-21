import {test, expect, type Page, type Route} from '@playwright/test';

test('overview selection translates in place and asks in a separate session without a fake PDF page', async ({page}) => {
  const reading={id:'overview-v1',style:'quick',language:'zh-CN',markdown:'## 研究问题\n有限采样未见到一种路线，不等于这种路线在基座模型中不存在。\n\n## 主要证据\n需要区分实验观察与理论假设。',mode:'agent',createdAt:'2026-10-22T00:00:00Z'};
  const paper={id:'overview-fixture',title:'Grounded overview',authors:[],source:'web',createdAt:'2026-10-22T00:00:00Z',abstract:'Finite samples cannot establish impossibility.',text:'Finite samples cannot establish impossibility.',tags:[],readingVersions:[reading],activeReadingId:reading.id};
  const settings={provider:'openai',baseUrl:'https://example.org/v1',model:'example-model',apiKeyConfigured:true,modelConfigured:true};
  const writes:{path:string,body:any}[]=[];
  await page.route('**/api/**',async route=>{
    const request=route.request(), path=new URL(request.url()).pathname.slice(4);
    let response:any={};
    if(request.method()!=='GET') writes.push({path,body:request.postDataJSON()});
    if(path==='/papers') response={papers:[paper]};
    else if(path==='/settings') response=settings;
    else if(path===`/papers/${paper.id}`) response={paper};
    else if(path==='/chats') response={messages:[],conversationId:null};
    else if(path.endsWith('/annotations')) response={annotations:[]};
    else if(path.endsWith('/assist')) response={result:{text:'A route absent from a finite sample may still exist in the underlying distribution.'}};
    else if(path==='/chats/new') response={conversationId:'overview-question-session'};
    await route.fulfill({json:response});
  });
  await page.goto('/zh/?paper='+paper.id);
  const prose=page.locator('.reading-prose p').first();
  await expect(prose).toBeVisible();
  await prose.evaluate(el=>{ const range=document.createRange(); range.selectNodeContents(el); const selection=window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange')); });
  const dialog=page.getByRole('dialog',{name:'选文操作',exact:true});
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('选文结果语言',{exact:true}).selectOption('en');
  await dialog.getByRole('button',{name:'翻译',exact:true}).click();
  await expect(dialog).toContainText('underlying distribution');
  expect(writes[0].body).toMatchObject({sourceScope:'reading',readingId:reading.id,kind:'translation',language:'en'});
  expect(writes[0].body.page).toBeUndefined();
  expect(writes.some(w=>w.path==='/chats/new'||w.path==='/chat')).toBeFalsy();
  await dialog.getByRole('button',{name:'提问',exact:true}).click();
  await expect(page.getByTestId('assistant-dock')).toBeVisible();
  const question=writes.find(w=>w.path==='/chats/new')!;
  expect(question.body.metadata.quote).toContain('有限采样');
  expect(question.body.metadata.page).toBeUndefined();
  await expect(page.locator('.selected-passage')).toContainText('解读选文');
  await expect(page.locator('.selected-passage')).not.toContainText('p.undefined');
  await expect(page.getByRole('button',{name:'收起悬浮助手',exact:true})).toBeVisible();
});

test('explicit language switching translates the fixed version once and reuses its cached translation',async({page})=>{
  const reading:any={id:'language-version',style:'quick',language:'zh-CN',markdown:'## 原始解读\n保留这一版的内容与结构。',mode:'agent',createdAt:'2026-10-22T00:00:00Z',translations:{}};
  const paper:any={id:'locale-overview',title:'Version language fixture',authors:[],source:'web',createdAt:'2026-10-22T00:00:00Z',abstract:'English source abstract.',text:'Source text.',tags:[],readingVersions:[reading],activeReadingId:reading.id};
  let calls=0;
  await page.route('**/api/**',async route=>{
    const req=route.request(), path=new URL(req.url()).pathname.slice(4); let response:any={};
    if(path==='/settings') response={provider:'openai',baseUrl:'https://example.org/v1',model:'model',apiKeyConfigured:true,modelConfigured:true};
    else if(path==='/papers') response={papers:[paper]};
    else if(path===`/papers/${paper.id}`) response={paper};
    else if(path.endsWith('/translate')) { calls++;expect(req.postDataJSON()).toMatchObject({target:'reading',readingId:reading.id,language:'en'});reading.translations.en={markdown:'## Original interpretation\nPreserve the content and structure of this exact version.',language:'en'};response={paper}; }
    else if(path==='/chats') response={messages:[],conversationId:null};
    else if(path.endsWith('/annotations')) response={annotations:[]};
    await route.fulfill({json:response});
  });
  await page.goto('/zh/?paper='+paper.id);
  await page.getByLabel('阅读语言',{exact:true}).selectOption('en');
  await expect(page.locator('.reading-prose')).toContainText('this exact version');
  expect(calls).toBe(1);
  await expect(page.getByLabel('Reading version',{exact:true})).toHaveValue(reading.id);
  await expect(page.locator('.abstract-section')).not.toContainText('No en translation');
  await page.getByLabel('Reading language',{exact:true}).selectOption('zh-CN');
  await expect(page.locator('.reading-prose')).toContainText('保留这一版');
  await page.getByLabel('阅读语言',{exact:true}).selectOption('en');
  await expect(page.locator('.reading-prose')).toContainText('this exact version');
  expect(calls).toBe(1);
  await page.reload();
  await expect(page.locator('.reading-prose')).toContainText('this exact version');
  expect(calls).toBe(1);
});

test('history without PDF pages preserves abstract and reading origins and cannot become a PDF note', async ({page}) => {
  const prior = {id:'history-prior',style:'deep',language:'en',markdown:'## Earlier interpretation\nEvidence in the earlier fixed version.',mode:'agent',createdAt:'2026-10-21T00:00:00Z'};
  const current = {...prior,id:'history-current',markdown:'## Current interpretation\nEvidence in the current version.',createdAt:'2026-10-22T00:00:00Z'};
  const paper:any = {id:'history-origin',title:'History source fixture',authors:[],source:'web',createdAt:current.createdAt,abstract:'Abstract evidence remains its own source.',text:'Source text.',tags:[],readingVersions:[current,prior],activeReadingId:current.id};
  const activities = [
    {id:'reading-activity',kind:'translation',sourceScope:'reading',readingId:prior.id,quote:'An earlier overview selection',result:{text:'A translated passage from that fixed version.'},language:'en',createdAt:current.createdAt},
    {id:'abstract-activity',kind:'translation',sourceScope:'abstract',quote:'An original abstract selection',result:{text:'A translated passage from the original abstract.'},language:'en',createdAt:current.createdAt},
    {id:'pdf-activity',kind:'explanation',sourceScope:'pdf',page:3,quote:'A genuine PDF selection',result:{text:'An explanation with a real page anchor.'},language:'en',createdAt:current.createdAt},
  ];
  const writes:{path:string,body:any}[]=[];
  await page.route('**/api/**', async route => {
    const req=route.request(),path=new URL(req.url()).pathname.slice(4);let response:any={};
    if(req.method()!=='GET') writes.push({path,body:req.postDataJSON()});
    if(path==='/settings') response={provider:'openai',baseUrl:'https://example.org/v1',model:'test',apiKeyConfigured:false,modelConfigured:false};
    else if(path==='/papers') response={papers:[paper]};
    else if(path===`/papers/${paper.id}`) {if(req.method()==='PATCH')Object.assign(paper,req.postDataJSON());response={paper};}
    else if(path==='/chats') response={messages:[],conversationId:null};
    else if(path==='/conversations') response={conversations:[]};
    else if(path.endsWith('/activities')) response={activities};
    else if(path.endsWith('/annotations')) response={annotations:[]};
    await route.fulfill({json:response});
  });
  await page.goto('/en/?paper='+paper.id);
  await expect(page.getByLabel('Reading version',{exact:true})).toHaveValue(current.id);
  async function openHistory() {
    await page.getByRole('tab',{name:'Paper',exact:true}).click();
    await page.getByTitle('Toggle assistant',{exact:true}).click();
    await page.getByRole('button',{name:'Conversation history',exact:true}).click();
    const history=page.getByRole('region',{name:'Reading history',exact:true});
    await expect(history).toBeVisible();
    return history;
  }
  let history=await openHistory();
  await history.getByRole('tab',{name:'Translations',exact:true}).click();
  const readingEntry=history.locator('.history-activity').filter({hasText:'An earlier overview selection'});
  await expect(readingEntry).toContainText('Overview selection');
  await expect(readingEntry).not.toContainText(/p\.(?:1|undefined)/);
  await readingEntry.getByRole('button',{name:/An earlier overview selection/}).click();
  await expect(readingEntry.getByRole('button',{name:'Save to notes',exact:true})).toHaveCount(0);
  await readingEntry.getByRole('button',{name:'Back to source · Overview selection',exact:true}).click();
  await expect(page.getByRole('tab',{name:'Overview',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.getByLabel('Reading version',{exact:true})).toHaveValue(prior.id);
  await expect(page.locator('.reading-prose')).toContainText('Evidence in the earlier fixed version');
  expect(writes.filter(write=>write.body?.activeReadingId).map(write=>write.body.activeReadingId)).toEqual([prior.id]);
  await expect(page.getByTestId('assistant-dock')).toHaveCount(0);

  history=await openHistory();
  await history.getByRole('tab',{name:'Explanations',exact:true}).click();
  const pdfEntry=history.locator('.history-activity').filter({hasText:'A genuine PDF selection'});
  await pdfEntry.getByRole('button',{name:/A genuine PDF selection/}).click();
  await expect(pdfEntry).toContainText('p.3');
  await expect(pdfEntry.getByRole('button',{name:'Save to notes',exact:true})).toBeVisible();
  await history.getByRole('tab',{name:'Translations',exact:true}).click();
  const abstractEntry=history.locator('.history-activity').filter({hasText:'An original abstract selection'});
  await expect(abstractEntry).toContainText('Original abstract');
  await expect(abstractEntry).not.toContainText(/p\.(?:1|undefined)/);
  await abstractEntry.getByRole('button',{name:/An original abstract selection/}).click();
  await expect(abstractEntry.getByRole('button',{name:'Save to notes',exact:true})).toHaveCount(0);
  await abstractEntry.getByRole('button',{name:'Back to source · Original abstract',exact:true}).click();
  await expect(page.getByRole('tab',{name:'Overview',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.getByLabel('Reading version',{exact:true})).toHaveValue(prior.id);
  expect(writes.filter(write=>write.body?.activeReadingId)).toHaveLength(1);
  expect(writes.some(write=>write.path.endsWith('/annotations'))).toBeFalsy();
});

test('image evidence renders inline and display math and limits the submitted focus to 3000 characters', async ({page,context}) => {
  const renderer=await context.newPage();
  await renderer.setContent('<h1>Measured evidence</h1><svg width="400" height="220"><rect x="20" y="30" width="100" height="150" fill="#914158"/></svg>');
  const pdf=await renderer.pdf({format:'A4'});await renderer.close();
  const figure={id:'math-figure',page:1,caption:'Measured outcomes',crop:{x:.01,y:.01,width:.7,height:.3}};
  const evidence={id:'math-evidence',figureId:figure.id,page:1,crop:figure.crop,markdown:'The expression is $E=mc^2$.\n\n$$\n\\frac{a}{b}=\\sqrt{x}\n$$',language:'en',imageHash:'1234567890abcdef1234567890abcdef',mimeType:'image/png',width:900,height:500,createdAt:'2026-10-22T00:00:00Z',source:{kind:'model',model:'vision-test',profileId:'vision-profile'},pixelsProvided:true,analysisMethod:'vision-model',modelUnverified:true,binding:'client-rendered-pdf-crop',limitations:[]};
  const paper:any={id:'vision-math',title:'Visual math fixture',authors:[],source:'pdf',createdAt:evidence.createdAt,abstract:'Model interpretations need source checks.',text:'Source text.',tags:[],pageCount:1,localPdfUrl:'/vision-math-source.pdf',figures:[figure],visualEvidence:[evidence]};
  const profile={id:'vision-profile',name:'Vision fixture',provider:'openai',baseUrl:'https://example.org/v1',model:'vision-test',models:['vision-test'],modelCapabilities:{'vision-test':'vision'},apiKeyConfigured:true,modelConfigured:true};
  const requests:any[]=[];
  await page.route('**/vision-math-source.pdf',route=>route.fulfill({contentType:'application/pdf',body:pdf}));
  await page.route('**/api/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname.slice(4);let response:any={};
    if(path==='/settings') response={...profile,profiles:[profile],activeProfileId:profile.id,vision:{enabled:true,profileId:profile.id,model:'vision-test'}};
    else if(path==='/papers') response={papers:[paper]};
    else if(path===`/papers/${paper.id}`) response={paper};
    else if(path==='/chats') response={messages:[],conversationId:null};
    else if(path.endsWith('/annotations')) response={annotations:[]};
    else if(path.endsWith('/analyze')) {requests.push(req.postDataJSON());response={evidence,paper};}
    await route.fulfill({json:response});
  });
  await page.goto('/en/?paper='+paper.id);
  const tools=page.locator('.vision-tools');
  await tools.locator(':scope > summary').click();
  await tools.locator('.vision-result > summary').click();
  const result=tools.locator('.vision-markdown');
  await expect(result.locator('.katex')).toHaveCount(2);
  await expect(result.locator('.katex-display')).toHaveCount(1);
  await expect(result.locator('.katex-error')).toHaveCount(0);
  await expect(result.locator('annotation[encoding="application/x-tex"]').first()).toHaveText('E=mc^2');
  const focus=tools.getByLabel('Image analysis focus (optional)',{exact:true});
  await expect(focus).toHaveAttribute('maxlength','3000');
  await focus.fill('x'.repeat(3200));
  await expect(focus).toHaveValue('x'.repeat(3000));
  expect(requests).toEqual([]);
  await tools.getByRole('button',{name:'Analyze this figure',exact:true}).click();
  await expect.poll(()=>requests.length).toBe(1);
  expect(requests[0]).toMatchObject({focus:'x'.repeat(3000),page:1,crop:figure.crop,language:'en',image:{mimeType:'image/png'}});
  expect(requests[0].image.data.length).toBeGreaterThan(100);
  await expect(tools.getByRole('button',{name:'Analyze this figure',exact:true})).toBeEnabled();
});

test('image observations can be excluded and restored without calling the model or losing the record', async ({page,context}) => {
  const renderer=await context.newPage();
  await renderer.setContent('<h1>Measured evidence</h1><svg width="300" height="180"><rect width="150" height="110" fill="#914158"/></svg>');
  const pdf=await renderer.pdf({format:'A4'});await renderer.close();
  const figure={id:'retained-figure',page:1,caption:'Measured outcomes',crop:{x:.01,y:.01,width:.6,height:.3}};
  const evidence:any={id:'retained-observation',figureId:figure.id,page:1,crop:figure.crop,markdown:'A retained model observation with uncertain interpretation.',language:'en',imageHash:'1234567890abcdef1234567890abcdef',mimeType:'image/png',width:900,height:500,createdAt:'2026-10-22T00:00:00Z',source:{kind:'model',model:'vision-test',profileId:'vision-profile'},pixelsProvided:true,analysisMethod:'vision-model',modelUnverified:true,binding:'client-rendered-pdf-crop',limitations:[],excluded:false};
  const reading={id:'unchanged-reading',style:'quick',language:'en',markdown:'## Existing reading\nThe existing reading stays selected.',mode:'model',createdAt:evidence.createdAt};
  const paper:any={id:'vision-exclusion',title:'Observation eligibility fixture',authors:[],source:'pdf',createdAt:evidence.createdAt,abstract:'Model observations can be excluded.',text:'Source text.',tags:[],pageCount:1,localPdfUrl:'/vision-exclusion-source.pdf',figures:[figure],visualEvidence:[evidence],readingVersions:[reading],activeReadingId:reading.id};
  const profile={id:'vision-profile',name:'Vision fixture',provider:'openai',baseUrl:'https://example.org/v1',model:'vision-test',models:['vision-test'],modelCapabilities:{'vision-test':'vision'},apiKeyConfigured:true,modelConfigured:true};
  const writes:{path:string,method:string,body:any}[]=[];
  await page.route('**/vision-exclusion-source.pdf',route=>route.fulfill({contentType:'application/pdf',body:pdf}));
  await page.route('**/api/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname.slice(4);let response:any={};
    if(req.method()!=='GET')writes.push({path,method:req.method(),body:req.postDataJSON()});
    if(path==='/settings') response={...profile,profiles:[profile],activeProfileId:profile.id,vision:{enabled:true,profileId:profile.id,model:'vision-test'}};
    else if(path==='/papers') response={papers:[paper]};
    else if(path===`/papers/${paper.id}`) response={paper};
    else if(path===`/papers/${paper.id}/visual-evidence/${evidence.id}`) {evidence.excluded=req.postDataJSON().excluded;response={paper};}
    else if(path==='/chats') response={messages:[],conversationId:null};
    else if(path.endsWith('/annotations')) response={annotations:[]};
    await route.fulfill({json:response});
  });
  await page.goto('/en/?paper='+paper.id);
  const tools=page.locator('.vision-tools');
  await tools.locator(':scope > summary').click();
  await tools.locator('.vision-result > summary').click();
  await expect(tools.locator('.vision-markdown')).toContainText('A retained model observation');
  expect(writes).toEqual([]);
  await tools.getByRole('button',{name:'Exclude from future readings',exact:true}).click();
  await expect(tools.locator('.vision-result').getByRole('status')).toHaveText('Excluded from future readings. This observation remains in history.');
  await expect(tools.getByRole('button',{name:'Use in future readings',exact:true})).toBeVisible();
  await expect(tools.locator('.vision-result')).toHaveCount(1);
  await expect(tools.locator('.vision-markdown')).toContainText('A retained model observation');
  await expect(page.getByLabel('Reading version',{exact:true})).toHaveValue(reading.id);
  await tools.getByRole('button',{name:'Use in future readings',exact:true}).click();
  await expect(tools.getByRole('button',{name:'Exclude from future readings',exact:true})).toBeVisible();
  await expect(tools.locator('.vision-result').getByRole('status')).toHaveCount(0);
  await expect(tools.locator('.vision-result')).toHaveCount(1);
  await expect(tools.locator('.vision-markdown')).toContainText('A retained model observation');
  expect(writes).toEqual([
    {path:`/papers/${paper.id}/visual-evidence/${evidence.id}`,method:'PATCH',body:{excluded:true}},
    {path:`/papers/${paper.id}/visual-evidence/${evidence.id}`,method:'PATCH',body:{excluded:false}},
  ]);
});

async function translationNavigationFixture(page: Page) {
  const renderer=await page.context().newPage();
  await renderer.setContent('<h1>Translation navigation evidence</h1><p>This page provides the cited evidence.</p>');
  const pdf=await renderer.pdf({format:'A4'});await renderer.close();
  const first:any={id:'pending-interactive',style:'deep',format:'interactive',language:'zh-CN',markdown:'## 固定原文\n源解读的内容不应被改写。[p.1]',mode:'model',createdAt:'2026-10-22T00:00:00Z',interactive:{schemaVersion:1,blocks:[{id:'source-concept',type:'concept',title:'固定原文概念',text:'应保持源版本与引用。',citations:[{page:1}]}]},translations:{}};
  const second={id:'other-version',style:'quick',language:'en',markdown:'## Another version\nKeep this explicitly selected version.',mode:'model',createdAt:'2026-10-21T00:00:00Z'};
  const paper:any={id:'pending-paper',title:'Pending translation paper',authors:[],source:'pdf',createdAt:first.createdAt,abstract:'Evidence needs source fidelity.',text:'Source evidence.',tags:[],pageCount:1,localPdfUrl:'/pending-translation-source.pdf',readingVersions:[first,second],activeReadingId:first.id};
  const other:any={id:'independent-paper',title:'Independent second paper',authors:[],source:'web',createdAt:first.createdAt,abstract:'Different source.',text:'Different source.',tags:[],readingVersions:[{...second,id:'independent-version',markdown:'## Independent reading\nUnrelated paper content stays untouched.'}],activeReadingId:'independent-version'};
  const requests:{route:Route,body:any,snapshot:any}[]=[];
  await page.route('**/pending-translation-source.pdf',route=>route.fulfill({contentType:'application/pdf',body:pdf}));
  await page.route('**/api/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname.slice(4);let response:any={};
    if(path===`/papers/${paper.id}/translate`) {requests.push({route,body:req.postDataJSON(),snapshot:structuredClone(paper)});return;}
    if(path==='/settings') response={provider:'openai',baseUrl:'https://example.org/v1',model:'translation-model',apiKeyConfigured:true,modelConfigured:true};
    else if(path==='/papers') response={papers:[paper,other]};
    else if(path===`/papers/${paper.id}`) {if(req.method()==='PATCH')Object.assign(paper,req.postDataJSON());response={paper};}
    else if(path===`/papers/${other.id}`) response={paper:other};
    else if(path==='/chats') response={messages:[],conversationId:null};
    else if(path.endsWith('/annotations')) response={annotations:[]};
    await route.fulfill({json:response});
  });
  async function start() {
    await page.goto('/zh/?paper='+paper.id);
    await page.getByLabel('阅读语言',{exact:true}).selectOption('en');
    await expect.poll(()=>requests.length).toBe(1);
    expect(requests[0].body).toEqual({target:'reading',readingId:first.id,language:'en'});
    await expect(page.getByRole('button',{name:'Translating this version…',exact:true})).toBeDisabled();
  }
  async function sourcePage() {
    await page.getByTestId('interactive-reading').getByRole('button',{name:'p.1',exact:true}).click();
    await expect(page.getByRole('tab',{name:'Paper',exact:true})).toHaveAttribute('aria-selected','true');
    await expect(page.locator('.reading-overview')).toHaveCount(0);
  }
  async function finish(index=0) {
    const request=requests[index];
    const translated={markdown:'## Cached English reading\nThe fixed version was translated once.',language:'en',interactive:{schemaVersion:1,blocks:[{id:'source-concept',type:'concept',title:'Translated concept for the fixed version',text:'The source version and citations remain unchanged.',citations:[{page:1}]}]}};
    request.snapshot.readingVersions[0].translations.en=translated;
    // Return the original server snapshot: the frontend must merge only the
    // translation and must not restore this snapshot's activeReadingId.
    await request.route.fulfill({json:{paper:request.snapshot}});
  }
  return {paper,other,first,second,requests,start,sourcePage,finish};
}

test('pending fixed-version translation survives citation navigation and completes once in the background',async({page})=>{
  const fixture=await translationNavigationFixture(page);
  await fixture.start();
  await fixture.sourcePage();
  await page.getByRole('tab',{name:'Overview',exact:true}).click();
  await expect(page.getByRole('button',{name:'Translating this version…',exact:true})).toBeDisabled();
  expect(fixture.requests).toHaveLength(1);
  await fixture.sourcePage();
  await fixture.finish();
  await page.getByRole('tab',{name:'Overview',exact:true}).click();
  await expect(page.getByTestId('interactive-reading')).toContainText('Translated concept for the fixed version');
  await expect(page.getByLabel('Reading version',{exact:true})).toHaveValue(fixture.first.id);
  await expect(page.getByRole('button',{name:'Translate this version',exact:true})).toHaveCount(0);
  await fixture.sourcePage();
  await page.getByRole('tab',{name:'Overview',exact:true}).click();
  await expect(page.getByTestId('interactive-reading')).toContainText('Translated concept for the fixed version');
  expect(fixture.requests).toHaveLength(1);
});

test('background translation failure survives navigation and requires explicit retry without duplicate requests',async({page})=>{
  const fixture=await translationNavigationFixture(page);
  await fixture.start();
  await fixture.sourcePage();
  await fixture.requests[0].route.fulfill({status:502,json:{error:'Translation provider temporarily unavailable'}});
  await page.getByRole('tab',{name:'Overview',exact:true}).click();
  await expect(page.locator('.reading-overview').getByRole('alert')).toContainText('Translation provider temporarily unavailable');
  await expect(page.getByRole('button',{name:'Retry translation',exact:true})).toBeEnabled();
  await fixture.sourcePage();
  await page.getByRole('tab',{name:'Overview',exact:true}).click();
  await expect(page.locator('.reading-overview').getByRole('alert')).toContainText('Translation provider temporarily unavailable');
  await page.getByLabel('Reading language',{exact:true}).selectOption('zh-CN');
  await page.getByLabel('阅读语言',{exact:true}).selectOption('en');
  await expect(page.getByRole('button',{name:'Retry translation',exact:true})).toBeEnabled();
  expect(fixture.requests).toHaveLength(1);
  await page.getByRole('button',{name:'Retry translation',exact:true}).click();
  await expect.poll(()=>fixture.requests.length).toBe(2);
  await expect(page.getByRole('button',{name:'Translating this version…',exact:true})).toBeDisabled();
  await fixture.sourcePage();
  await page.getByRole('tab',{name:'Overview',exact:true}).click();
  await expect(page.getByRole('button',{name:'Translating this version…',exact:true})).toBeDisabled();
  expect(fixture.requests).toHaveLength(2);
  await fixture.finish(1);
  await expect(page.getByTestId('interactive-reading')).toContainText('Translated concept for the fixed version');
  await expect(page.locator('.reading-overview').getByRole('alert')).toHaveCount(0);
  expect(fixture.requests).toHaveLength(2);
});

test('a late translation cannot replace a different paper or the explicitly selected version',async({page})=>{
  const fixture=await translationNavigationFixture(page);
  await fixture.start();
  await page.getByLabel('Reading version',{exact:true}).selectOption(fixture.second.id);
  await expect(page.locator('.reading-prose')).toContainText('Keep this explicitly selected version.');
  await page.locator('.back-button').click();
  await page.locator('.paper-card-main').filter({hasText:fixture.other.title}).click();
  await expect(page.locator('.reading-prose')).toContainText('Unrelated paper content stays untouched.');
  await fixture.finish();
  await expect(page.getByLabel('Reading version',{exact:true})).toHaveValue('independent-version');
  await expect(page.locator('.reading-prose')).toContainText('Unrelated paper content stays untouched.');
  await page.locator('.back-button').click();
  await page.locator('.paper-card-main').filter({hasText:fixture.paper.title}).click();
  await expect(page.getByLabel('Reading version',{exact:true})).toHaveValue(fixture.second.id);
  await expect(page.locator('.reading-prose')).toContainText('Keep this explicitly selected version.');
  await page.getByLabel('Reading version',{exact:true}).selectOption(fixture.first.id);
  await expect(page.getByTestId('interactive-reading')).toContainText('Translated concept for the fixed version');
  expect(fixture.requests).toHaveLength(1);
});

test('Chinese punctuation emphasis renders semantically while literal code and math remain unchanged',async({page})=>{
  const markdown='这篇论文最有用的结论是：**策略概率的重新分配，已经足以解释跨任务迁移、遗忘，以及有限采样预算下覆盖率的升降。**作者比较训练结果。\n\n与此同时，3,840 个 RL 回答中有 **487 个（12.7%）**使用了同题基座样本里未出现的路线。\n\n`**487 个（12.7%）**使用`\n\n$\\text{**中文。**后文}$\n\nEnglish **clear evidence** remains bold.';
  const version={id:'chinese-emphasis',style:'deep',language:'zh-CN',format:'article',markdown,mode:'agent',createdAt:'2026-10-22T00:00:00Z'};
  const paper={id:'chinese-markdown',title:'Chinese reading typography',authors:[],source:'web',createdAt:version.createdAt,abstract:'Source evidence.',text:'Source evidence.',tags:[],readingVersions:[version],activeReadingId:version.id};
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname.slice(4);let response:any={};
    if(path==='/settings') response={provider:'openai',baseUrl:'https://example.org/v1',model:'test',apiKeyConfigured:false,modelConfigured:false};
    else if(path==='/papers') response={papers:[paper]};
    else if(path===`/papers/${paper.id}`) response={paper};
    else if(path==='/chats') response={messages:[],conversationId:null};
    else if(path.endsWith('/annotations')) response={annotations:[]};
    await route.fulfill({json:response});
  });
  await page.goto('/zh/?paper='+paper.id);
  const prose=page.locator('.reading-prose');
  await expect(prose.locator('strong')).toHaveCount(3);
  await expect(prose.locator('strong').nth(0)).toHaveText('策略概率的重新分配，已经足以解释跨任务迁移、遗忘，以及有限采样预算下覆盖率的升降。');
  await expect(prose.locator('strong').nth(1)).toHaveText('487 个（12.7%）');
  await expect(prose.locator('strong').nth(2)).toHaveText('clear evidence');
  await expect(prose.locator('p').first()).not.toContainText('**');
  await expect(prose.locator('code')).toHaveText('**487 个（12.7%）**使用');
  await expect(prose.locator('.katex')).toHaveCount(1);
  await expect(prose.locator('annotation[encoding="application/x-tex"]')).toHaveText('\\text{**中文。**后文}');
});
