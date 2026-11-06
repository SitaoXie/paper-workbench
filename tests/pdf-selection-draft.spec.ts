import {test,expect,type Page,type Route,type Locator} from '@playwright/test';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

// This helper runs inside the browser to compare exact cross-page text. Serve
// the real implementation in both Vite and the dist-only regression server.
const selectionTextModule=ts.transpileModule(readFileSync(new URL('../src/pdf-selection-text.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;

const phrase='Exact empirical evidence needs a bounded interpretation.';
const host=(page:Page)=>page.getByLabel('Continuous paper pages',{exact:true});
async function fixture(page:Page,{deferred=false,clipboardFails=false,failSession=false,deferredSession=false}={}){
  await page.route('**/src/pdf-selection-text.ts',route=>route.fulfill({contentType:'text/javascript',body:selectionTextModule}));
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
  for(let number=1;number<=9;number++){
    const sheet=pdf.addPage([600,800]);sheet.drawText(`SOURCE PAGE ${number}`,{x:44,y:740,size:22,font});
    sheet.drawText(`Prefix context. ${phrase} Trailing text.`,{x:44,y:610,size:10,font});
    for(let line=0;line<20;line++)sheet.drawText(`Page ${number} line ${line}: separate source observations remain available.`,{x:44,y:550-line*20,size:10,font});
  }
  const bytes=Buffer.from(await pdf.save());
  const papers=['pdf-draft-a','pdf-draft-b'].map(id=>({id,title:`PDF draft ${id}`,authors:[],source:'pdf',createdAt:'2026-10-22T00:00:00Z',abstract:'An original source abstract.',text:phrase,tags:[],pageCount:9,localPdfUrl:'/pdf-draft.pdf'}));
  const annotations:any[]=[];
  const calls:{path:string;method:string;body:any}[]=[],pending:Route[]=[],pendingSessions:Route[]=[];let sessions=0;
  await page.addInitScript(fail=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{if(fail)throw new DOMException('Permission denied','NotAllowedError');}}}),clipboardFails);
  await page.route('**/pdf-draft.pdf',route=>route.fulfill({contentType:'application/pdf',body:bytes}));
  await page.route('**/api/**',async route=>{
    if(new URL(route.request().url()).pathname==='/api/collections'){await route.fulfill({json:{collections:[]}});return;}
    const req=route.request(),url=new URL(req.url()),path=url.pathname.slice(4);calls.push({path,method:req.method(),body:req.method()==='GET'?undefined:req.postDataJSON()});
    if(path.endsWith('/assist')&&deferred){pending.push(route);return;}
    if(path==='/chats/new'&&deferredSession){pendingSessions.push(route);return;}
    let json:any={};
    if(path==='/settings')json={provider:'openai',model:'configured-model',modelConfigured:true,apiKeyConfigured:true};
    else if(path==='/papers')json={papers};
    else if(/^\/papers\/[^/]+$/.test(path))json={paper:papers.find(item=>item.id===path.split('/')[2])};
    else if(path==='/chats')json={messages:[],conversationId:null};
    else if(path==='/chats/new'){sessions++;if(failSession&&sessions===1){await route.fulfill({status:503,json:{error:'Temporary session creation failure'}});return;}json={conversationId:`draft-question-${sessions}`,messages:[]};}
    else if(path.endsWith('/annotations')){if(req.method()==='POST'){const annotation={...req.postDataJSON(),id:`draft-note-${annotations.length+1}`,paperId:path.split('/')[2]};annotations.push(annotation);json={annotation};}else json={annotations};}else if(path.endsWith('/activities'))json={activities:[]};
    else if(path.endsWith('/assist'))json={result:{text:'A precise result retained with its original selection.'}};
    await route.fulfill({json});
  });
  await page.goto('/en/?paper=pdf-draft-a&page=1');await expect(page.locator('[data-pdf-page="1"] .pdf-text-layer[data-rendered="true"]')).toBeVisible();
  return {calls,pending,pendingSessions,modelCalls:()=>calls.filter(call=>call.method==='POST'&&/\/(assist|chat|report|translate)$/.test(call.path))};
}
async function selectSource(page:Page){
  const layer=page.locator('[data-pdf-page="1"] .pdf-text-layer[data-rendered="true"]');await expect(layer).toBeVisible();
  const dialog=page.getByRole('dialog',{name:'Selected text actions',exact:true});
  await layer.locator('span').first().click();
  await expect(async()=>{
    await layer.evaluate((element,text)=>{
      const node=[...element.querySelectorAll('span')].find(span=>span.textContent!.includes(text))!.firstChild!;
      const start=node.textContent!.indexOf(text),range=document.createRange();range.setStart(node,start);range.setEnd(node,start+text.length);
      (window as any).__pdfOriginalNode=node;
      getSelection()!.removeAllRanges();getSelection()!.addRange(range);document.dispatchEvent(new Event('selectionchange'));
    },phrase);
    await expect(dialog).toBeVisible({timeout:500});
  }).toPass({timeout:5000});return dialog;
}
async function away(page:Page){
  const box=await host(page).boundingBox();await page.mouse.move(box!.x+box!.width-9,box!.y+box!.height-30);await page.mouse.wheel(0,6500);
  const chip=page.getByRole('region',{name:'PDF selection draft',exact:true});await expect(chip).toBeVisible();
  await expect(page.locator('[data-pdf-page="1"] .pdf-text-layer[data-rendered="true"]')).toHaveCount(0);
  return chip;
}
async function task(dialog:Locator){
  const input=dialog.getByRole('textbox',{name:'Subscription selection task',exact:true});
  if(!await input.isVisible())await dialog.getByRole('button',{name:'Show task text',exact:true}).click();
  const text=await input.inputValue();return {text,binding:JSON.parse(text.match(/\n\n(\{\n[\s\S]*?\n\})\n\n/)![1])};
}
async function assertRestored(page:Page){
  await expect.poll(()=>page.evaluate(()=>getSelection()?.toString())).toBe(phrase);
  const geometry=await page.evaluate(()=>{const range=getSelection()!.getRangeAt(0),rect=range.getBoundingClientRect(),view=document.querySelector('.pdf-viewport')?.getBoundingClientRect() || document.querySelector('[aria-label="Continuous paper pages"]')!.getBoundingClientRect();return {page:range.startContainer.parentElement!.closest<HTMLElement>('[data-pdf-page]')!.dataset.pdfPage,top:rect.top,bottom:rect.bottom,viewTop:view.top,viewBottom:view.bottom,newNode:range.startContainer!==(window as any).__pdfOriginalNode};});
  expect(geometry.page).toBe('1');expect(geometry.top).toBeGreaterThan(geometry.viewTop);expect(geometry.bottom).toBeLessThan(geometry.viewBottom);expect(geometry.newNode).toBe(true);
}

test('offscreen PDF draft survives page recycling and returns to its exact partial source without model calls',async({page},info)=>{
  const f=await fixture(page),dialog=await selectSource(page),question=dialog.getByLabel('Question about selected text',{exact:true});
  await question.fill('Which limitation constrains this evidence?');await dialog.getByLabel('Selection result language',{exact:true}).selectOption('zh-CN');await dialog.getByLabel('Selection processing method',{exact:true}).selectOption('agent');
  const chip=await away(page);await expect(dialog).toBeHidden();await expect(page.locator('.pdf-selection-menu')).toHaveCount(1);await expect(chip).toContainText('Question preserved');
  const bounds=await chip.boundingBox(),toolbar=await page.locator('.pdf-zoom-toolbar').boundingBox();expect(bounds!.height).toBeLessThanOrEqual(60);expect(bounds!.y).toBeGreaterThanOrEqual(toolbar!.y+toolbar!.height);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({path:info.outputPath('pdf-draft-folded.png')});
  await chip.getByRole('button',{name:'Return to selected draft',exact:true}).click();await expect(dialog).toBeVisible();await expect(question).toHaveValue('Which limitation constrains this evidence?');await expect(question).toBeFocused();
  await expect(dialog.getByLabel('Selection result language',{exact:true})).toHaveValue('zh-CN');await expect(dialog.getByLabel('Selection processing method',{exact:true})).toHaveValue('agent');await assertRestored(page);expect(f.modelCalls()).toEqual([]);
});

test('PDF subscription UUID and manual task stay mounted through folding and source recycling',async({page})=>{
  const f=await fixture(page,{clipboardFails:true}),dialog=await selectSource(page);
  await dialog.getByLabel('Selection processing method',{exact:true}).selectOption('agent');await dialog.getByLabel('Selection result language',{exact:true}).selectOption('zh-CN');await dialog.getByRole('button',{name:'Translate selection',exact:true}).click();
  const inline=page.getByRole('dialog',{name:'Inline reading assistant',exact:true});await inline.getByRole('button',{name:'Copy selection task',exact:true}).click();const first=await task(inline);
  expect(first.binding).toMatchObject({text:phrase,sourceScope:'pdf',page:1,pages:[1],language:'zh-CN',kind:'translation'});
  await inline.getByRole('textbox',{name:'Subscription selection task',exact:true}).evaluate(node=>(window as any).__taskNode=node);
  const chip=await away(page);await expect(inline).toBeHidden();expect(await page.locator('.pdf-inline-assist .selection-agent-bridge textarea').evaluate(node=>node===(window as any).__taskNode)).toBe(true);
  await page.getByRole('button',{name:'Open floating assistant',exact:true}).click();await page.getByRole('button',{name:'Close floating assistant',exact:true}).click();await expect(chip).toBeVisible();
  await chip.getByRole('button',{name:'Return to selected draft',exact:true}).click();await expect(inline).toBeVisible();const second=await task(inline);expect(second).toEqual(first);await assertRestored(page);expect(f.modelCalls()).toEqual([]);
});

test('a deferred PDF result finishes while folded and only an explicit return expands it',async({page})=>{
  const f=await fixture(page,{deferred:true}),dialog=await selectSource(page);await dialog.getByRole('button',{name:'Explain selection',exact:true}).click();
  const inline=page.getByRole('dialog',{name:'Inline reading assistant',exact:true});await expect.poll(()=>f.pending.length).toBe(1);const chip=await away(page);await expect(chip).toContainText('Processing');
  await f.pending[0].fulfill({json:{result:{text:'A preserved bounded conclusion.'}}});await expect(chip).toContainText('Result preserved');await expect(inline).toBeHidden();
  await chip.getByRole('button',{name:'Return to selected draft',exact:true}).click();await expect(inline).toContainText('A preserved bounded conclusion.');await expect(inline.getByRole('button',{name:'Saved',exact:true})).toBeDisabled();await assertRestored(page);expect(f.modelCalls()).toHaveLength(1);
});

test('failure and unsent question survive folding with one explicit retry and no duplicate request',async({page})=>{
  const f=await fixture(page,{deferred:true}),dialog=await selectSource(page);await dialog.getByLabel('Question about selected text',{exact:true}).fill('Preserve my question.');await dialog.getByRole('button',{name:'Explain selection',exact:true}).click();
  const inline=page.getByRole('dialog',{name:'Inline reading assistant',exact:true}),chip=await away(page);
  await f.pending[0].fulfill({status:503,json:{error:'Temporary provider failure'}});await expect(chip).toContainText('Needs attention');await expect(inline).toBeHidden();
  await chip.getByRole('button',{name:'Return to selected draft',exact:true}).click();await expect(inline).toContainText('Temporary provider failure');await inline.getByRole('button',{name:'Retry',exact:true}).click();await expect.poll(()=>f.pending.length).toBe(2);expect(f.modelCalls()[1].body).toEqual(f.modelCalls()[0].body);
  await f.pending[1].fulfill({json:{result:{text:'A recovered exact-source answer.'}}});await expect(inline).toContainText('A recovered exact-source answer.');
});

test('minimize is explicit, source changes never select unrelated text, and discard removes the scoped draft',async({page})=>{
  const f=await fixture(page),dialog=await selectSource(page);await dialog.getByLabel('Question about selected text',{exact:true}).fill('Keep the exact source.');await dialog.getByRole('button',{name:'Minimize selection draft',exact:true}).click();
  const chip=page.getByRole('region',{name:'PDF selection draft',exact:true});await expect(chip).toBeVisible();
  await page.locator('[data-pdf-page="1"] .pdf-text-layer span').filter({hasText:phrase}).evaluate(node=>{node.textContent='A replaced and unrelated source.';});
  const before=await host(page).evaluate(node=>node.scrollTop);await chip.getByRole('button',{name:'Return to selected draft',exact:true}).click();await expect(dialog).toBeVisible();await expect(dialog).toContainText('cannot be restored precisely');await expect(dialog.getByLabel('Question about selected text',{exact:true})).toHaveValue('Keep the exact source.');expect(await host(page).evaluate(node=>node.scrollTop)).toBe(before);
  await dialog.getByRole('button',{name:'Minimize selection draft',exact:true}).click();await chip.getByRole('button',{name:'Discard selection draft',exact:true}).click();await expect(page.locator('.pdf-selection-menu')).toHaveCount(0);await expect(chip).toHaveCount(0);expect(f.modelCalls()).toEqual([]);
});

test('paper, UI language and inactive-tab changes clear PDF drafts and ignore late responses',async({page})=>{
  const f=await fixture(page,{deferred:true});let dialog=await selectSource(page);await dialog.getByRole('button',{name:'Explain selection',exact:true}).click();await away(page);
  await page.getByRole('tab',{name:'Overview',exact:true}).click();await expect(page.locator('.pdf-inline-assist')).toHaveCount(0);await f.pending[0].fulfill({json:{result:{text:'STALE_PDF_RESPONSE'}}});await page.getByRole('tab',{name:'Paper',exact:true}).click();await expect(page.locator('.pdf-inline-assist')).toHaveCount(0);
  await host(page).evaluate(node=>node.scrollTop=0);dialog=await selectSource(page);await dialog.getByRole('button',{name:'Minimize selection draft',exact:true}).click();if(page.viewportSize()!.width<700)await page.getByRole('button',{name:'Expand navigation',exact:true}).click();await page.getByRole('button',{name:'Switch to Chinese',exact:true}).click();await expect(page.locator('.pdf-selection-menu')).toHaveCount(0);await expect(page.locator('.pdf-selection-draft-chip')).toHaveCount(0);
  await page.getByRole('button',{name:'切换为英文',exact:true}).click();if(page.viewportSize()!.width<700)await page.getByRole('button',{name:'Expand navigation',exact:true}).click();dialog=await selectSource(page);await dialog.getByRole('button',{name:'Minimize selection draft',exact:true}).click();await page.locator('.paper-toolbar').getByRole('button',{name:'Library',exact:true}).click();await page.locator('.collection-paper-open').filter({hasText:'PDF draft pdf-draft-b'}).click();await expect(page.locator('.pdf-selection-draft-chip')).toHaveCount(0);await expect(page.locator('.pdf-selection-menu')).toHaveCount(0);
});

test('cross-page draft rebuilds both exact boundaries after recycling without substituting a repeated phrase',async({page})=>{
  const f=await fixture(page);await expect(page.locator('[data-pdf-page="2"] .pdf-text-layer[data-rendered="true"]')).toBeAttached();
  await page.locator('[data-pdf-page="1"] .pdf-text-layer span').first().click();
  const original=await page.evaluate(async text=>{
    const first=[...document.querySelectorAll('[data-pdf-page="1"] .pdf-text-layer span')].find(node=>node.textContent!.includes(text))!.firstChild!;
    const last=[...document.querySelectorAll('[data-pdf-page="2"] .pdf-text-layer span')].find(node=>node.textContent!.includes(text))!.firstChild!;
    const range=document.createRange();range.setStart(first,first.textContent!.indexOf(text));range.setEnd(last,last.textContent!.indexOf(text)+text.length);getSelection()!.removeAllRanges();getSelection()!.addRange(range);document.dispatchEvent(new Event('selectionchange'));
    const module=await import(/* @vite-ignore */ '/src/pdf-selection-text.ts');return module.selectedPdfText(range,document.querySelector('[aria-label="Continuous paper pages"]'));
  },phrase);
  const dialog=page.getByRole('dialog',{name:'Selected text actions',exact:true});await expect(dialog).toBeVisible();await dialog.getByLabel('Selection processing method',{exact:true}).selectOption('agent');await dialog.getByRole('button',{name:'Explain selection',exact:true}).click();
  const inline=page.getByRole('dialog',{name:'Inline reading assistant',exact:true}),first=await task(inline);expect(first.binding.pages).toEqual([1,2]);expect(first.binding.text).toBe(original);
  const chip=await away(page);await chip.getByRole('button',{name:'Return to selected draft',exact:true}).click();await expect(inline).toBeVisible();
  // Popup expansion precedes the animation frame that restores native Range
  // after focus. Wait for those actual endpoints, not just visible controls.
  await expect.poll(()=>page.evaluate(()=>{const selected=getSelection();if(selected?.rangeCount!==1)return;const range=selected.getRangeAt(0);return {start:range.startContainer.parentElement?.closest<HTMLElement>('[data-pdf-page]')?.dataset.pdfPage,end:range.endContainer.parentElement?.closest<HTMLElement>('[data-pdf-page]')?.dataset.pdfPage};})).toEqual({start:'1',end:'2'});
  const restored=await page.evaluate(async()=>{const range=getSelection()!.getRangeAt(0),module=await import(/* @vite-ignore */ '/src/pdf-selection-text.ts');return{start:range.startContainer.parentElement!.closest<HTMLElement>('[data-pdf-page]')!.dataset.pdfPage,end:range.endContainer.parentElement!.closest<HTMLElement>('[data-pdf-page]')!.dataset.pdfPage,text:module.selectedPdfText(range,document.querySelector('[aria-label="Continuous paper pages"]'))};});
  expect(restored).toEqual({start:'1',end:'2',text:original});expect((await task(inline)).binding.agentTaskId).toBe(first.binding.agentTaskId);expect(f.modelCalls()).toEqual([]);
});

test('zoom changes while folded retain the draft and restore the same source at the new magnification',async({page})=>{
  const f=await fixture(page),dialog=await selectSource(page);await dialog.getByLabel('Question about selected text',{exact:true}).fill('Read at the chosen scale.');const chip=await away(page);
  await page.getByRole('button',{name:'Zoom in PDF',exact:true}).click();const zoom=await page.getByLabel('PDF zoom level',{exact:true}).textContent();await expect(chip).toBeVisible();await expect(dialog).toBeHidden();
  await chip.getByRole('button',{name:'Return to selected draft',exact:true}).click();await expect(dialog).toBeVisible();await assertRestored(page);await expect(page.getByLabel('PDF zoom level',{exact:true})).toHaveText(zoom!);await expect(dialog.getByLabel('Question about selected text',{exact:true})).toHaveValue('Read at the chosen scale.');expect(f.modelCalls()).toEqual([]);
});


test('an in-flight question session can fold and fail without losing its input or submitting a duplicate',async({page})=>{
  const f=await fixture(page,{deferredSession:true}),dialog=await selectSource(page),question=dialog.getByLabel('Question about selected text',{exact:true});
  await question.fill('Which data directly support this statement?');await dialog.getByRole('button',{name:'Ask assistant',exact:true}).click();await expect.poll(()=>f.pendingSessions.length).toBe(1);const chip=await away(page);await expect(chip).toContainText('Creating session');
  await f.pendingSessions[0].fulfill({status:503,json:{error:'Temporary session creation failure'}});await expect(chip).toContainText('Needs attention');await expect(dialog).toBeHidden();await chip.getByRole('button',{name:'Return to selected draft',exact:true}).click();await expect(question).toHaveValue('Which data directly support this statement?');await expect(dialog).toContainText('preserved');
  await dialog.getByRole('button',{name:'Ask assistant',exact:true}).click();await expect.poll(()=>f.pendingSessions.length).toBe(2);await f.pendingSessions[1].fulfill({json:{conversationId:'recovered-selection-session',messages:[]}});await expect(page.getByLabel('Ask the research assistant',{exact:true})).toHaveValue('Which data directly support this statement?');
  const creates=f.calls.filter(call=>call.path==='/chats/new');expect(creates).toHaveLength(2);expect(creates[1].body.metadata).toMatchObject({quote:phrase,page:1,pages:[1]});expect(f.modelCalls()).toEqual([]);await expect(page.locator('.pdf-selection-draft-chip')).toHaveCount(0);
});

test('PDF workspace controls preserve an unsent question and ordinary source clicks only fold it',async({page})=>{
  const f=await fixture(page),dialog=await selectSource(page),question=dialog.getByLabel('Question about selected text',{exact:true});await question.fill('Keep this PDF source-bound draft.');
  await page.getByRole('button',{name:'Open floating assistant',exact:true}).click();await expect(dialog).toBeHidden();await expect(page.locator('.pdf-selection-draft-chip')).toHaveCount(1);await page.getByRole('button',{name:'Close floating assistant',exact:true}).click();
  await page.getByRole('button',{name:'Return to selected draft',exact:true}).click();await expect(question).toHaveValue('Keep this PDF source-bound draft.');
  // A click in the source is not yet a replacement selection.
  await page.locator('[data-pdf-page="1"] .pdf-text-layer span').first().click();await expect(dialog).toBeHidden();await expect(page.getByRole('region',{name:'PDF selection draft',exact:true})).toBeVisible();await page.getByRole('button',{name:'Return to selected draft',exact:true}).click();await expect(question).toHaveValue('Keep this PDF source-bound draft.');
  await dialog.getByRole('button',{name:'Close selection menu',exact:true}).click();await selectSource(page);await page.getByRole('button',{name:'Open floating assistant',exact:true}).click();await expect(page.locator('.pdf-selection-menu')).toHaveCount(0);await expect(page.locator('.pdf-selection-draft-chip')).toHaveCount(0);expect(f.modelCalls()).toEqual([]);
});


test('Escape and an unusable one-character source gesture keep a meaningful PDF draft',async({page})=>{
  const f=await fixture(page),dialog=await selectSource(page),question=dialog.getByLabel('Question about selected text',{exact:true});
  await question.fill('Keep my PDF question until a usable source replaces it.');await question.press('Escape');
  const restore=page.getByRole('button',{name:'Return to selected draft',exact:true});await expect(restore).toBeVisible();await expect(restore).toBeFocused();
  await page.getByRole('button',{name:'Open floating assistant',exact:true}).click();await page.getByLabel('Ask the research assistant',{exact:true}).focus();await page.keyboard.press('Escape');
  await expect(page.locator('.pdf-selection-draft-chip')).toHaveCount(1);if(await page.getByRole('button',{name:'Close floating assistant',exact:true}).isVisible())await page.getByRole('button',{name:'Close floating assistant',exact:true}).click();
  await restore.click();await expect(question).toHaveValue('Keep my PDF question until a usable source replaces it.');
  const first=page.locator('[data-pdf-page="1"] .pdf-text-layer span').first();await first.click();await first.evaluate(element=>{const range=document.createRange();range.setStart(element.firstChild!,0);range.setEnd(element.firstChild!,1);getSelection()!.removeAllRanges();getSelection()!.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
  await expect(restore).toBeVisible();await restore.click();await expect(question).toHaveValue('Keep my PDF question until a usable source replaces it.');await expect.poll(()=>page.evaluate(()=>getSelection()?.toString())).toBe(phrase);expect(f.modelCalls()).toEqual([]);
});
