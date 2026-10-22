import {test,expect,type Page} from '@playwright/test';
import {outlinePdf} from './fixtures/outline-pdf.mjs';
import {readFile} from 'node:fs/promises';
const numericMessage='The selection contains only numbers or symbols, with no text to translate. Select the surrounding caption or sentence.';
async function setup(page:Page, configured = false){
  const reading={id:'layout-v1',style:'deep',format:'article',language:'zh-CN',markdown:Array.from({length:16},(_,i)=>`## 阅读位置 ${i+1}\n\n${'阅读位置应在助手布局恢复后保持连续。'.repeat(28)}`).join('\n\n'),mode:'agent',createdAt:'2026-10-22T00:00:00Z'};
  const paper={id:'layout-paper',title:'Workspace continuity',authors:[],source:'pdf',createdAt:'2026-10-22T00:00:00Z',abstract:'2026',text:'2026',localPdfUrl:'/layout-source.pdf',url:'https://example.org/paper',pageCount:3,tags:[],readingVersions:[reading],activeReadingId:reading.id};
  const calls:any[]=[];let selectionFailure={error:numericMessage,code:'selection_no_translatable_text'};
  await page.route('**/layout-source.pdf',route=>route.fulfill({body:outlinePdf({firstPageText:'2026'}),contentType:'application/pdf'}));
  await page.route('**/api/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname.slice(4);let result:any={};
    if(req.method()!=='GET')calls.push({path,body:req.postDataJSON()});
    if(path==='/papers')result={papers:[paper]};
    else if(path==='/settings')result={provider:'openai',baseUrl:'https://example.org/v1',model:'test-model',modelConfigured:configured,apiKeyConfigured:configured};
    else if(path==='/papers/'+paper.id)result={paper};
    else if(path==='/chats')result={messages:[],conversationId:null};
    else if(path==='/conversations')result={conversations:[]};
    else if(path.endsWith('/annotations'))result={annotations:[]};
    else if(path.endsWith('/activities'))result={activities:[]};
    else if(path.endsWith('/assist'))return route.fulfill({status:400,json:selectionFailure});
    await route.fulfill({json:result});
  });
  return {paper,calls,setFailure:(error:string,code='')=>{selectionFailure={error,code};}};
}
async function select(page:Page,selector:string){
  const text=page.locator(selector).first();await expect(text).toBeVisible();
  await text.evaluate(el=>{el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));const range=document.createRange();range.selectNodeContents(el);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
}
for(const locale of ['zh','en'])test(`known selection errors are local in ${locale} for both overview and PDF while unknown failures remain intact`,async({page})=>{
  const f=await setup(page,true);await page.goto(`/${locale}/?paper=layout-paper`);
  await select(page,'.abstract-text p');
  const overview=page.getByRole('dialog',{name:locale==='zh'?'选文操作':'Selection actions',exact:true});
  await overview.getByRole('button',{name:locale==='zh'?'翻译':'Translate',exact:true}).click();
  await expect(overview.getByRole('alert')).toContainText(locale==='zh'?'选文只有数字或符号':'The selection contains only numbers or symbols.');
  const diagnostic='Provider upstream returned 429: preserve this exact diagnostic';f.setFailure(diagnostic,'provider_failure');
  await overview.getByRole('button',{name:locale==='zh'?'重试':'Retry',exact:true}).click();await expect(overview.getByRole('alert')).toContainText(diagnostic);
  await page.keyboard.press('Escape');
  await page.getByRole('tab',{name:locale==='zh'?'论文':'Paper',exact:true}).click();
  await expect(page.locator('[data-pdf-page="1"] .pdf-text-layer[data-rendered="true"]')).toBeVisible();
  f.setFailure('Server copy can change','selection_no_translatable_text');
  await select(page,'[data-pdf-page="1"] .pdf-text-layer span');
  await page.getByRole('dialog',{name:locale==='zh'?'选中文字操作':'Selected text actions',exact:true}).getByRole('button',{name:locale==='zh'?'翻译选中内容':'Translate selection',exact:true}).click();
  const inline=page.getByRole('dialog',{name:locale==='zh'?'就地阅读助手':'Inline reading assistant',exact:true});
  await expect(inline.getByRole('alert')).toContainText(locale==='zh'?'选文只有数字或符号':'The selection contains only numbers or symbols.');
  expect(f.calls.filter(c=>c.path.endsWith('/assist'))).toHaveLength(3);
  expect(f.calls.some(c=>c.path==='/chat'||c.path==='/chats/new')).toBeFalsy();
});
test('assistant layout and width are restored before overview anchor recovery, and explicit closing persists',async({page},info)=>{
  test.skip(info.project.name==='mobile','Desktop layout reserves reading width; mobile overlay is verified separately.');
  await setup(page);
  await page.addInitScript(()=>{(window as any).__firstPaperLayout=undefined;new MutationObserver(()=>{const el=document.querySelector('.workspace.paper-workspace');if(el&&!(window as any).__firstPaperLayout)(window as any).__firstPaperLayout={docked:el.classList.contains('has-docked-assistant'),width:el.getBoundingClientRect().width};}).observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});});
  await page.goto('/zh/?paper=layout-paper');await expect(page.getByTestId('assistant-dock')).toBeHidden();
  await page.getByRole('button',{name:'打开悬浮助手',exact:true}).click();
  const dock=page.getByTestId('assistant-dock');await expect(dock).toBeVisible();
  const resizer=page.getByRole('separator',{name:'调整助手宽度',exact:true});await resizer.focus();
  const initialWidth=Number(await resizer.getAttribute('aria-valuenow'));
  // Two key events can arrive in one frame before React commits the throttled width.
  await resizer.evaluate(el=>{for(let i=0;i<2;i++)el.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));});
  await expect(resizer).toHaveAttribute('aria-valuenow',String(initialWidth-32));
  await expect.poll(()=>dock.evaluate(el=>el.getBoundingClientRect().width)).toBe(initialWidth-32);
  const width=await dock.evaluate(el=>el.getBoundingClientRect().width);
  const heading=page.getByRole('heading',{name:'阅读位置 8',exact:true});
  await page.locator('.paper-summary').dispatchEvent('pointerdown');await heading.scrollIntoViewIfNeeded();
  const before=await heading.evaluate(el=>el.getBoundingClientRect().top),readingWidth=await page.locator('.paper-summary').evaluate(el=>el.getBoundingClientRect().width);
  await page.reload();await expect(dock).toBeVisible();
  await expect.poll(()=>heading.evaluate(el=>el.getBoundingClientRect().top)).toBeCloseTo(before,0);
  expect(await dock.evaluate(el=>el.getBoundingClientRect().width)).toBe(width);
  expect(await page.locator('.paper-summary').evaluate(el=>el.getBoundingClientRect().width)).toBe(readingWidth);
  expect(await page.evaluate(()=>(window as any).__firstPaperLayout.docked)).toBeTruthy();
  await page.getByRole('button',{name:'关闭助手',exact:true}).click();await expect(dock).toBeHidden();
  await page.locator('.paper-summary').dispatchEvent('pointerdown');await heading.scrollIntoViewIfNeeded();const closedTop=await heading.evaluate(el=>el.getBoundingClientRect().top);
  await page.reload();await expect(heading).toBeVisible();await expect(dock).toBeHidden();
  await expect.poll(()=>heading.evaluate(el=>el.getBoundingClientRect().top)).toBeCloseTo(closedTop,0);
  expect(await page.evaluate(()=>(window as any).__firstPaperLayout.docked)).toBeFalsy();
});
test('narrow-screen assistant preference is independent of desktop and respects explicit closing',async({page},info)=>{
  test.skip(info.project.name!=='mobile','Narrow-screen preference.');
  await setup(page);await page.addInitScript(()=>{if(!localStorage.getItem('paper-workbench:companion-layout-v1'))localStorage.setItem('paper-workbench:companion-layout-v1',JSON.stringify({desktop:'assistant',narrow:null}));});
  await page.goto('/zh/?paper=layout-paper');await expect(page.getByTestId('assistant-dock')).toBeHidden();
  await page.getByRole('button',{name:'打开悬浮助手',exact:true}).click();await expect(page.getByTestId('assistant-dock')).toBeVisible();
  const saved=await page.evaluate(()=>localStorage.getItem('paper-workbench:companion-layout-v1'));
  expect(JSON.parse(saved!)).toEqual({desktop:'assistant',narrow:'assistant'});
  await page.reload();await expect(page.getByTestId('assistant-dock')).toBeVisible();
  await page.getByRole('button',{name:'返回论文',exact:true}).click();await expect(page.getByTestId('assistant-dock')).toBeHidden();
  await page.reload();await expect(page.getByTestId('assistant-dock')).toBeHidden();
});

test('interactive citation prefixes match the display language in cards and exported HTML without rewriting labels',async({page})=>{
  const f=await setup(page);
  const labels=['图1','表 2: 原始实验名称','名称里的图1'];
  Object.assign(f.paper.readingVersions[0],{format:'interactive',language:'en',markdown:'## Evidence\n\nInspect the cited source.',interactive:{schemaVersion:1,blocks:[{id:'prefix-concept',type:'concept',title:'Controlled reading',text:'Evidence requires source checking.',citations:labels.map(label=>({page:2,label}))}]}});
  await page.goto('/en/?paper=layout-paper');
  const cards=page.getByTestId('interactive-reading');
  await expect(cards.getByRole('button',{name:'Figure 1 · p.2',exact:true})).toBeVisible();
  await expect(cards.getByRole('button',{name:'Table 2: 原始实验名称 · p.2',exact:true})).toBeVisible();
  await expect(cards.getByRole('button',{name:'名称里的图1 · p.2',exact:true})).toBeVisible();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download offline website',exact:true}).click();
  const html=await readFile((await (await download).path())!,'utf8');
  expect(html).toContain('Figure 1 · p.2');expect(html).toContain('Table 2: 原始实验名称 · p.2');expect(html).toContain('名称里的图1 · p.2');
  expect((f.paper.readingVersions[0] as any).interactive.blocks[0].citations.map((c:any)=>c.label)).toEqual(labels);
  expect(f.calls).toHaveLength(0);
});

test('legacy empty translation results remain inspectable but cannot be saved as notes',async({page})=>{
  const f=await setup(page);
  await page.route('**/api/papers/layout-paper/activities',route=>route.fulfill({json:{activities:[
    {id:'legacy-null',kind:'translation',text:'Legacy numeric selection 10 60',result:{text:'null'},page:1,language:'zh-CN',createdAt:'2026-10-22T00:00:00Z'},
    {id:'valid-null-discussion',kind:'explanation',text:'Null hypothesis',result:{text:'The null hypothesis describes the reference comparison.'},page:1,language:'en',createdAt:'2026-10-22T00:00:00Z'}
  ]}}));
  await page.goto('/en/?paper=layout-paper');await page.getByRole('button',{name:'Open floating assistant',exact:true}).click();
  await page.getByRole('button',{name:'Conversation history',exact:true}).click();
  const history=page.getByRole('region',{name:'Reading history',exact:true});
  await history.getByRole('tab',{name:'Translations',exact:true}).click();await history.getByRole('button',{name:/Legacy numeric selection/}).click();
  await expect(history.getByRole('status')).toContainText('no usable translation or explanation');
  await expect(history.getByRole('button',{name:'Save to notes',exact:true})).toBeDisabled();
  await history.getByText('View original record',{exact:true}).click();await expect(history.locator('pre')).toHaveText('null');
  await history.getByRole('tab',{name:'Explanations',exact:true}).click();await history.getByRole('button',{name:/Null hypothesis/}).click();
  await expect(history.getByRole('button',{name:'Save to notes',exact:true})).toBeEnabled();
  expect(f.calls.filter(c=>c.path.endsWith('/annotations'))).toHaveLength(0);
});

test('a PDF opening excerpt is not labelled as an identified original abstract',async({page})=>{
  const f=await setup(page);Object.assign(f.paper,{abstractIsExcerpt:true});
  await page.goto('/en/?paper=layout-paper');
  await expect(page.getByRole('heading',{name:'Opening excerpt Source excerpt',exact:true})).toBeVisible();
  await expect(page.locator('.abstract-excerpt-notice')).toContainText('A separate abstract was not identified');
  await select(page,'.abstract-text p');
  const selection=page.getByRole('dialog',{name:'Selection actions',exact:true});
  await expect(selection).toContainText('Opening excerpt selection');
});
