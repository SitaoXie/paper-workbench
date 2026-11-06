import {test,expect,type Page,type Route,type Locator} from '@playwright/test';

const evidence='Exact source evidence: finite samples limit the conclusion.';
const markdown=`## Empirical evidence\n\n${'Background context before the exact selection. '.repeat(45)}${evidence} End of this paragraph.\n\n`+
  Array.from({length:30},(_,index)=>`## Following section ${index+1}\n\n${'Additional results and limitations remain readable without a floating question covering the paper. '.repeat(8)}`).join('\n\n');
async function fixture(page:Page,{deferred=false,clipboardFails=false}={}){
  const reading={id:'draft-reading',style:'quick',language:'en',mode:'agent',createdAt:'2026-10-22T00:00:00Z',markdown,translations:{'zh-CN':{language:'zh-CN',markdown,createdAt:'2026-10-22T00:00:00Z'}}};
  const older={...reading,id:'draft-older',markdown:markdown.replace(evidence,'Older fixed-version source evidence.')};
  const papers=['draft-a','draft-b'].map(id=>({id,title:`Selection draft ${id}`,authors:[],source:'web',createdAt:reading.createdAt,abstract:'An original source abstract.',text:'Source text.',tags:[],readingVersions:[reading,older],activeReadingId:reading.id}));
  const calls:{path:string;method:string;body:any}[]=[],pending:Route[]=[];
  await page.addInitScript(fail=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{if(fail)throw new DOMException('Permission denied','NotAllowedError');}}}),clipboardFails);
  await page.route('**/api/**',async route=>{
    if(new URL(route.request().url()).pathname==='/api/collections'){await route.fulfill({json:{collections:[]}});return;}
    const req=route.request(),url=new URL(req.url()),path=url.pathname.slice(4);calls.push({path,method:req.method(),body:req.method()==='GET'?undefined:req.postDataJSON()});
    if(path.endsWith('/assist')&&deferred){pending.push(route);return;}
    let json:any={};
    if(path==='/settings')json={provider:'openai',model:'configured-model',modelConfigured:true,apiKeyConfigured:true};
    else if(path==='/papers')json={papers};
    else if(/^\/papers\/[^/]+$/.test(path)){const paper=papers.find(item=>item.id===path.split('/')[2])!;if(req.method()==='PATCH')Object.assign(paper,req.postDataJSON());json={paper};}
    else if(path==='/chats')json={messages:[],conversationId:null};
    else if(path.endsWith('/annotations'))json={annotations:[]};else if(path.endsWith('/activities'))json={activities:[]};
    else if(path.endsWith('/assist'))json={result:{text:'An exact-selection explanation.'}};
    await route.fulfill({json});
  });
  await page.goto('/en/?paper=draft-a');await expect(page.locator('.reading-prose .selection-source')).toBeVisible();
  return {calls,pending,modelCalls:()=>calls.filter(call=>call.method==='POST'&&/\/(assist|chat|report|translate)$/.test(call.path))};
}
async function selectEvidence(page:Page,text=evidence){
  const paragraph=page.locator('.reading-prose p').filter({hasText:text}).first();await expect(paragraph).toBeAttached();
  await paragraph.evaluate((element,phrase)=>{
    const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let node:Node|null;
    while((node=walker.nextNode())){const start=node.textContent!.indexOf(phrase);if(start<0)continue;
      const range=document.createRange();range.setStart(node,start);range.setEnd(node,start+phrase.length);
      const rect=range.getClientRects()[0];window.scrollBy({top:rect.top-220,behavior:'instant'});
      (window as any).__draftSource={range:range.cloneRange(),start:node,startOffset:start,endOffset:start+phrase.length};
      getSelection()!.removeAllRanges();getSelection()!.addRange(range);document.dispatchEvent(new Event('selectionchange'));break;
    }
  },text);
  const dialog=page.getByRole('dialog',{name:'Selection actions',exact:true});await expect(dialog).toBeVisible();
  await expect(dialog.locator('blockquote')).toHaveText(text);return dialog;
}
async function away(page:Page){
  // Wheel over source prose, leaving the draft input focused. No outside click
  // is used, so this exercises scroll folding rather than normal dismissal.
  await page.mouse.move(page.viewportSize()!.width-3,Math.min(550,page.viewportSize()!.height-100));
  await page.mouse.wheel(0,1100);
  const chip=page.getByRole('region',{name:'Selection draft',exact:true});await expect(chip).toBeVisible();return chip;
}
async function task(dialog:Locator){
  const input=dialog.getByRole('textbox',{name:'Subscription selection task',exact:true});
  if(!await input.isVisible())await dialog.getByRole('button',{name:'Show task text',exact:true}).click();
  const text=await input.inputValue();return {text,binding:JSON.parse(text.match(/\n\n(\{\n[\s\S]*?\n\})\n\n/)![1])};
}

test('scrolling away folds an unsent question and explicit return restores its exact text fragment',async({page},testInfo)=>{
  const f=await fixture(page),dialog=await selectEvidence(page);
  const question=dialog.getByLabel('Question about the overview selection',{exact:true});await question.fill('Which empirical limitation matters most?');
  const chip=await away(page);await expect(dialog).toBeHidden();
  await expect(page.locator('.overview-selection')).toHaveCount(1);await expect(chip).toContainText('Question preserved');
  const bounds=await chip.boundingBox();expect(bounds!.height).toBeLessThanOrEqual(60);expect(bounds!.width).toBeLessThanOrEqual(300);const nav=await page.locator('.reading-section-nav').boundingBox();expect(bounds!.y).toBeGreaterThanOrEqual(nav!.y+nav!.height+4);expect(bounds!.y).toBeLessThan(200);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({path:testInfo.outputPath('draft-folded.png')});
  // Merely scrolling back does not reopen the large popup.
  await page.mouse.wheel(0,-1100);await expect(chip).toBeVisible();await expect(dialog).toBeHidden();
  await page.mouse.wheel(0,1100);await chip.getByRole('button',{name:'Return to selected draft',exact:true}).click();
  await expect(dialog).toBeVisible();await expect(question).toHaveValue('Which empirical limitation matters most?');await expect(question).toBeFocused();
  const restored=await page.evaluate(()=>{const source=(window as any).__draftSource;const selected=getSelection()!.getRangeAt(0);return{top:source.range.getClientRects()[0].top,same:selected.startContainer===source.start&&selected.startOffset===source.startOffset&&selected.endOffset===source.endOffset};});
  expect(restored.top).toBeGreaterThan(100);expect(restored.top).toBeLessThan(300);expect(restored.same).toBe(true);
  expect(f.modelCalls()).toEqual([]);
});

test('folding keeps the subscription bridge mounted with its manual task, kind and language unchanged',async({page})=>{
  const f=await fixture(page,{clipboardFails:true}),dialog=await selectEvidence(page);
  await dialog.getByLabel('Question about the overview selection',{exact:true}).fill('Keep this question with its source.');
  await dialog.getByLabel('Selection result language',{exact:true}).selectOption('zh-CN');
  await dialog.getByLabel('Selection processing method',{exact:true}).selectOption('agent');
  await dialog.getByRole('button',{name:'Translate',exact:true}).click();
  await dialog.getByRole('button',{name:'Copy selection task',exact:true}).click();
  const first=await task(dialog);expect(first.binding.kind).toBe('translation');expect(first.binding.language).toBe('zh-CN');
  await dialog.getByRole('textbox',{name:'Subscription selection task',exact:true}).evaluate(node=>(window as any).__taskNode=node);
  const chip=await away(page);await expect(dialog).toBeHidden();
  expect(await page.locator('.selection-agent-bridge textarea').evaluate(node=>node===(window as any).__taskNode)).toBe(true);
  await chip.getByRole('button',{name:'Return to selected draft',exact:true}).click();
  await expect(dialog.getByRole('textbox',{name:'Subscription selection task',exact:true})).toBeVisible();
  expect(await task(dialog)).toEqual(first);
  await expect(dialog).toContainText('Select and copy the complete task below');
  await expect(dialog.getByLabel('Selection result language',{exact:true})).toHaveValue('zh-CN');
  await expect(dialog.getByLabel('Selection processing method',{exact:true})).toHaveValue('agent');
  await expect(dialog.getByLabel('Question about the overview selection',{exact:true})).toHaveValue('Keep this question with its source.');
  expect(f.modelCalls()).toEqual([]);
});

test('a response can finish while folded without reopening or creating a duplicate request',async({page})=>{
  const f=await fixture(page,{deferred:true}),dialog=await selectEvidence(page);
  await dialog.getByLabel('Question about the overview selection',{exact:true}).fill('Retain my unsent follow-up.');
  await dialog.getByRole('button',{name:'Explain',exact:true}).click();await expect.poll(()=>f.pending.length).toBe(1);
  const chip=await away(page);await expect(chip).toContainText('Processing');
  await f.pending[0].fulfill({json:{result:{text:'The response finished while its draft was folded.',source:{model:'completed-model'}}}});
  await expect(chip).toContainText('Result preserved');await expect(dialog).toBeHidden();
  await chip.getByRole('button',{name:'Return to selected draft',exact:true}).click();
  await expect(dialog.locator('.overview-selection-result')).toHaveText('The response finished while its draft was folded.');
  await expect(dialog).toContainText('completed-model');await expect(dialog.getByLabel('Question about the overview selection',{exact:true})).toHaveValue('Retain my unsent follow-up.');
  expect(f.modelCalls()).toHaveLength(1);
});

test('a failed background request stays folded with the question and explicit retry intact',async({page})=>{
  const f=await fixture(page,{deferred:true}),dialog=await selectEvidence(page);
  await dialog.getByLabel('Question about the overview selection',{exact:true}).fill('Preserve this follow-up after a failure.');
  await dialog.getByRole('button',{name:'Explain',exact:true}).click();await expect.poll(()=>f.pending.length).toBe(1);
  const chip=await away(page);await f.pending[0].fulfill({status:503,json:{error:'Temporary provider failure'}});
  await expect(chip).toContainText('Needs attention');await expect(dialog).toBeHidden();
  await chip.getByRole('button',{name:'Return to selected draft',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('Temporary provider failure');
  await expect(dialog.getByLabel('Question about the overview selection',{exact:true})).toHaveValue('Preserve this follow-up after a failure.');
  expect(f.modelCalls()).toHaveLength(1);
  await dialog.getByRole('button',{name:'Retry',exact:true}).click();await expect.poll(()=>f.pending.length).toBe(2);
  expect(f.modelCalls()[1].body).toEqual(f.modelCalls()[0].body);
  await f.pending[1].fulfill({json:{result:{text:'Recovered result for the same passage.'}}});
  await expect(dialog.locator('.overview-selection-result')).toHaveText('Recovered result for the same passage.');
});

test('explicit minimize and discard are keyboard reachable and a new selection begins expanded',async({page})=>{
  const f=await fixture(page),dialog=await selectEvidence(page);
  await dialog.getByRole('button',{name:'Minimize selection draft',exact:true}).click();
  const restore=page.getByRole('button',{name:'Return to selected draft',exact:true});await expect(restore).toBeFocused();
  await page.keyboard.press('Enter');await expect(dialog).toBeVisible();await expect(dialog.getByLabel('Question about the overview selection',{exact:true})).toBeFocused();
  await dialog.getByRole('button',{name:'Minimize selection draft',exact:true}).click();
  await page.getByRole('button',{name:'Discard selection draft',exact:true}).click();
  await expect(page.locator('.overview-selection')).toHaveCount(0);await expect(restore).toHaveCount(0);
  await selectEvidence(page);await expect(dialog).toBeVisible();await expect(dialog.getByLabel('Question about the overview selection',{exact:true})).toHaveValue('');
  await dialog.getByRole('button',{name:'Minimize selection draft',exact:true}).click();
  await selectEvidence(page,'End of this paragraph.');await expect(dialog).toBeVisible();await expect(restore).toHaveCount(0);
  expect(f.modelCalls()).toEqual([]);
});

test('a replaced source node preserves the draft but never jumps to an unrelated location',async({page})=>{
  const f=await fixture(page),dialog=await selectEvidence(page);
  await dialog.getByLabel('Question about the overview selection',{exact:true}).fill('Keep the draft even if its source layout is replaced.');
  const chip=await away(page);
  await page.locator('.reading-prose p').filter({hasText:evidence}).first().evaluate(element=>{const first=element.firstChild!;first.replaceWith(document.createTextNode(first.textContent!));});
  const before=await page.evaluate(()=>scrollY);
  await chip.getByRole('button',{name:'Return to selected draft',exact:true}).click();
  await expect(dialog).toBeVisible();await expect(dialog).toContainText('source location has changed');
  await expect(dialog.getByLabel('Question about the overview selection',{exact:true})).toHaveValue('Keep the draft even if its source layout is replaced.');
  expect(await page.evaluate(()=>scrollY)).toBe(before);expect(f.modelCalls()).toEqual([]);
});

test('version, language, paper and inactive-tab boundaries discard the scoped draft and ignore late responses',async({page})=>{
  const f=await fixture(page,{deferred:true});let dialog=await selectEvidence(page);
  await dialog.getByRole('button',{name:'Explain',exact:true}).click();await expect.poll(()=>f.pending.length).toBe(1);await away(page);
  await page.getByLabel('Reading version',{exact:true}).selectOption('draft-older');
  await expect(page.locator('.overview-selection')).toHaveCount(0);await expect(page.locator('.selection-draft-chip')).toHaveCount(0);
  await f.pending[0].fulfill({json:{result:{text:'STALE RESULT MUST NOT APPEAR'}}});await expect(page.getByText('STALE RESULT MUST NOT APPEAR')).toHaveCount(0);
  dialog=await selectEvidence(page,'Older fixed-version source evidence.');await dialog.getByRole('button',{name:'Minimize selection draft',exact:true}).click();
  await page.getByRole('tab',{name:'Paper',exact:true}).click();await expect(page.locator('.overview-selection')).toHaveCount(0);await expect(page.locator('.selection-draft-chip')).toHaveCount(0);
  await page.getByRole('tab',{name:'Overview',exact:true}).click();dialog=await selectEvidence(page,'Older fixed-version source evidence.');
  await dialog.getByRole('button',{name:'Minimize selection draft',exact:true}).click();
  await page.locator('.paper-toolbar').getByRole('button',{name:'Library',exact:true}).click();
  await page.locator('.collection-paper-open').filter({hasText:'Selection draft draft-b'}).click();await expect(page.locator('.overview-selection')).toHaveCount(0);
  dialog=await selectEvidence(page);await dialog.getByRole('button',{name:'Minimize selection draft',exact:true}).click();
  await page.getByLabel('Reading language',{exact:true}).selectOption('zh-CN');
  await expect(page.locator('.overview-selection')).toHaveCount(0);await expect(page.locator('.selection-draft-chip')).toHaveCount(0);
});

for(const mode of ['automatic','manual','expanded'] as const)test(`assistant controls preserve an Article question from the ${mode} draft state`,async({page})=>{
  const f=await fixture(page),dialog=await selectEvidence(page),question=dialog.getByLabel('Question about the overview selection',{exact:true});
  await question.fill(`Preserve this ${mode} question with its exact source.`);await dialog.getByLabel('Selection result language',{exact:true}).selectOption('zh-CN');await dialog.getByLabel('Selection processing method',{exact:true}).selectOption('agent');
  if(mode==='automatic')await away(page);else if(mode==='manual')await dialog.getByRole('button',{name:'Minimize selection draft',exact:true}).click();
  await page.getByRole('button',{name:'Open floating assistant',exact:true}).click();await expect(page.getByTestId('assistant-dock')).toBeVisible();await expect(page.locator('.selection-draft-chip')).toHaveCount(1);await expect(dialog).toBeHidden();
  await page.getByRole('button',{name:'Close floating assistant',exact:true}).click();const chip=page.getByRole('region',{name:'Selection draft',exact:true});await expect(chip).toBeVisible();
  await chip.getByRole('button',{name:'Return to selected draft',exact:true}).click();await expect(dialog).toBeVisible();await expect(question).toHaveValue(`Preserve this ${mode} question with its exact source.`);await expect(dialog.getByLabel('Selection result language',{exact:true})).toHaveValue('zh-CN');await expect(dialog.getByLabel('Selection processing method',{exact:true})).toHaveValue('agent');await expect(dialog.locator('blockquote')).toHaveText(evidence);
  // Restore focuses the question and reapplies the exact document Range in the
  // next animation frame; a visible popup can precede that browser selection.
  await expect.poll(()=>page.evaluate(()=>getSelection()?.toString()),{timeout:2000}).toBe(evidence);expect(f.modelCalls()).toEqual([]);
});

test('outside source clicks fold a prepared subscription task but dismiss a purely empty selection menu',async({page})=>{
  const f=await fixture(page);let dialog=await selectEvidence(page);await page.getByRole('button',{name:'Open floating assistant',exact:true}).click();await expect(page.locator('.overview-selection')).toHaveCount(0);await expect(page.locator('.selection-draft-chip')).toHaveCount(0);await page.getByRole('button',{name:'Close floating assistant',exact:true}).click();
  dialog=await selectEvidence(page);await dialog.getByLabel('Selection processing method',{exact:true}).selectOption('agent');await dialog.getByRole('button',{name:'Explain',exact:true}).click();const first=await task(dialog);
  // A fully expanded task can cover the bottom bubble on a small screen; the sticky toolbar remains the visible workspace entry point.
  await page.locator('.paper-toolbar').getByRole('button',{name:'Toggle assistant',exact:true}).click();await expect(page.locator('.overview-selection')).toHaveCount(1);await expect(dialog).toBeHidden();await page.getByRole('button',{name:'Close floating assistant',exact:true}).click();await page.getByRole('button',{name:'Return to selected draft',exact:true}).click();expect(await task(dialog)).toEqual(first);expect(f.modelCalls()).toEqual([]);
});

test('ordinary source clicks retain a question but a genuinely new abstract selection replaces its scope',async({page})=>{
  const f=await fixture(page),dialog=await selectEvidence(page);await dialog.getByLabel('Question about the overview selection',{exact:true}).fill('Retain until a new passage is actually selected.');
  const paragraph=page.locator('.reading-prose p').filter({hasText:evidence}).first();const bounds=await paragraph.boundingBox();await page.mouse.click(bounds!.x+2,Math.max(190,bounds!.y+10));await expect(dialog).toBeHidden();await expect(page.getByRole('region',{name:'Selection draft',exact:true})).toBeVisible();await page.getByRole('button',{name:'Return to selected draft',exact:true}).click();await expect(dialog.getByLabel('Question about the overview selection',{exact:true})).toHaveValue('Retain until a new passage is actually selected.');
  await dialog.getByRole('button',{name:'Minimize selection draft',exact:true}).click();
  const original=page.locator('.abstract-text .selection-source p');await original.scrollIntoViewIfNeeded();await original.evaluate(node=>{const range=document.createRange();range.selectNodeContents(node);getSelection()!.removeAllRanges();getSelection()!.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
  await expect(page.locator('.overview-selection')).toHaveCount(1);await expect(page.locator('.selection-draft-chip')).toHaveCount(0);await expect(page.getByRole('dialog',{name:'Selection actions',exact:true}).locator('blockquote')).toHaveText('An original source abstract.');await expect(page.getByLabel('Question about the overview selection',{exact:true})).toHaveValue('');expect(f.modelCalls()).toEqual([]);
});


test('Escape folds meaningful work and cannot discard the draft while another workspace control has focus',async({page})=>{
  const f=await fixture(page),dialog=await selectEvidence(page),question=dialog.getByLabel('Question about the overview selection',{exact:true});
  await question.fill('Keep this draft when another dialog closes.');await question.press('Escape');
  const restore=page.getByRole('button',{name:'Return to selected draft',exact:true});await expect(restore).toBeVisible();await expect(restore).toBeFocused();
  await page.getByRole('button',{name:'Open floating assistant',exact:true}).click();await page.getByLabel('Ask the research assistant',{exact:true}).focus();await page.keyboard.press('Escape');
  await expect(page.locator('.selection-draft-chip')).toHaveCount(1);if(await page.getByRole('button',{name:'Close floating assistant',exact:true}).isVisible())await page.getByRole('button',{name:'Close floating assistant',exact:true}).click();
  await restore.click();await expect(question).toHaveValue('Keep this draft when another dialog closes.');expect(f.modelCalls()).toEqual([]);
});
