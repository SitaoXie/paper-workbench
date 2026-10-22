import {test,expect,type Page} from '@playwright/test';

const source='## Selected evidence\n\nBefore $E=mc^2$ after.\n\n$$\n\\frac{a}{b}=\\sqrt{x}\n$$\n\n| Case | Result |\n| --- | --- |\n| A | $x^2$ |\n\n```python\n  if x:\n    value = "$literal$"\n```';
const expected='Selected evidence\n\nBefore $E=mc^2$ after.\n\n$$\n\\frac{a}{b}=\\sqrt{x}\n$$\n\nCase\tResult\nA\t$x^2$\n\n  if x:\n    value = "$literal$"\n';
async function fixture(page:Page,markdown=source){
  const reading={id:'math-reading',style:'quick',language:'en',mode:'agent',createdAt:'2026-10-22T00:00:00Z',markdown};
  const paper={id:'math-paper',title:'Reading math precisely',authors:[],source:'web',createdAt:reading.createdAt,abstract:'An independent abstract.',text:'Source text.',tags:[],readingVersions:[reading],activeReadingId:reading.id};
  const calls:{path:string,body:any}[]=[];
  await page.route('**/api/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname.slice(4);let json:any={};
    if(req.method()!=='GET')calls.push({path,body:req.postDataJSON()});
    if(path==='/settings')json={provider:'openai',model:'configured-model',modelConfigured:true,apiKeyConfigured:true};
    else if(path==='/papers')json={papers:[paper]};else if(path===`/papers/${paper.id}`)json={paper};
    else if(path==='/chats')json={messages:[],conversationId:null};else if(path.endsWith('/annotations'))json={annotations:[]};else if(path.endsWith('/activities'))json={activities:[]};
    else if(path.endsWith('/assist'))json={result:{text:'An explanation grounded in the exact selection.'}};
    await route.fulfill({json});
  });
  await page.goto('/en/?paper='+paper.id);await expect(page.locator('.reading-prose .selection-source')).toBeVisible();
  // Put the source in the actual mobile viewport before emulating a Range;
  // offscreen selection drafts now correctly fold instead of opening a menu.
  await page.locator('.reading-prose').evaluate(element=>window.scrollBy({top:element.getBoundingClientRect().top-150,behavior:'instant'}));
  return {calls,paper,reading};
}
async function select(page:Page,selector='.reading-prose .selection-source'){
  const dialog=page.getByRole('dialog',{name:'Selection actions',exact:true});
  await page.locator(selector).scrollIntoViewIfNeeded();
  await expect(async()=>{
    await page.locator(selector).evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const selected=getSelection()!;selected.removeAllRanges();selected.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
    await expect(dialog).toBeVisible({timeout:500});
  }).toPass({timeout:5000});
  return dialog;
}
async function taskText(dialog:ReturnType<Page['locator']>){
  const task=dialog.getByRole('textbox',{name:'Subscription selection task',exact:true});
  if(!await task.isVisible())await dialog.getByRole('button',{name:'Show task text',exact:true}).click();
  return JSON.parse((await task.inputValue()).match(/\n\n(\{\n[\s\S]*?\n\})\n\n/)![1]).text;
}

test('native copy, API and subscription tasks share one precise math selection in the real overview',async({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);const f=await fixture(page);const dialog=await select(page);
  expect(await dialog.locator('blockquote').textContent()).toBe(expected);
  const before=await page.evaluate(()=>{const range=getSelection()!.getRangeAt(0);(window as any).__mathRange=[range.startContainer,range.startOffset,range.endContainer,range.endOffset];return getSelection()!.toString();});
  await page.keyboard.press('ControlOrMeta+c');expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(expected);
  expect(await page.evaluate(()=>{const r=getSelection()!.getRangeAt(0),b=(window as any).__mathRange;return r.startContainer===b[0]&&r.startOffset===b[1]&&r.endContainer===b[2]&&r.endOffset===b[3];})).toBe(true);
  expect(await page.evaluate(()=>getSelection()!.toString())).toBe(before);
  await dialog.getByRole('button',{name:'Explain',exact:true}).click();await expect(dialog.locator('.overview-selection-result')).toContainText('grounded in the exact selection');
  expect(f.calls.filter(call=>call.path.endsWith('/assist'))).toEqual([{path:`/papers/${f.paper.id}/assist`,body:{sourceScope:'reading',readingId:f.reading.id,text:expected,kind:'explanation',language:'en'}}]);
  await dialog.getByLabel('Selection processing method',{exact:true}).selectOption('agent');await dialog.getByRole('button',{name:'Explain',exact:true}).click();
  expect(await taskText(dialog)).toBe(expected);expect(f.calls.filter(call=>call.path.endsWith('/assist'))).toHaveLength(1);
});

test('native copy and source tasks preserve the leading indentation of selected code',async({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);const f=await fixture(page);const dialog=await select(page,'.reading-prose pre code');
  const code='  if x:\n    value = "$literal$"\n';expect(await dialog.locator('blockquote').textContent()).toBe(code);
  // A code-only selection keeps Chromium's native copy, which omits this
  // renderer's terminal newline. Its meaningful leading indentation is retained.
  await page.keyboard.press('ControlOrMeta+c');expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(code.slice(0,-1));
  await dialog.getByRole('button',{name:'Explain',exact:true}).click();await expect(dialog.locator('.overview-selection-result')).toBeVisible();
  expect(f.calls.at(-1)?.body.text).toBe(code);
  await dialog.getByLabel('Selection processing method',{exact:true}).selectOption('agent');await dialog.getByRole('button',{name:'Explain',exact:true}).click();expect(await taskText(dialog)).toBe(code);
});

test('selecting one rendered formula glyph copies one complete TeX formula without adjacent prose',async({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);const f=await fixture(page);
  const dialog=page.getByRole('dialog',{name:'Selection actions',exact:true});
  await expect(async()=>{
    await page.locator('.reading-prose .katex-html').first().evaluate(el=>{const node=document.createTreeWalker(el,NodeFilter.SHOW_TEXT).nextNode()!,range=document.createRange();range.setStart(node,0);range.setEnd(node,1);const selected=getSelection()!;selected.removeAllRanges();selected.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
    await expect(dialog).toBeVisible({timeout:500});
  }).toPass({timeout:5000});
  expect(await dialog.locator('blockquote').textContent()).toBe('$E=mc^2$');
  const native=await page.evaluate(()=>getSelection()!.toString());
  await page.keyboard.press('ControlOrMeta+c');await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toBe('$E=mc^2$');
  expect(await page.evaluate(()=>getSelection()!.toString())).toBe(native);
  await dialog.getByRole('button',{name:'Explain',exact:true}).click();await expect(dialog.locator('.overview-selection-result')).toBeVisible();
  expect(f.calls.at(-1)?.body.text).toBe('$E=mc^2$');
});

test('final TeX length blocks oversized selection operations even when a rendered formula is one glyph',async({page})=>{
  const tex='x'+' '.repeat(12001);const f=await fixture(page,`$${tex}$`);const dialog=await select(page);
  await expect(dialog).toContainText('Select at most 12,000 characters');
  for(const name of ['Translate','Explain','Ask'])await expect(dialog.getByRole('button',{name,exact:true})).toBeDisabled();
  await dialog.getByLabel('Selection processing method',{exact:true}).selectOption('agent');await expect(dialog.getByRole('button',{name:'Explain',exact:true})).toBeDisabled();
  await expect(dialog.getByRole('textbox',{name:'Subscription selection task',exact:true})).toHaveCount(0);
  expect(f.calls).toEqual([]);
});

test('ordinary text, cross-surface selections and editable fields keep native copy behavior',async({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);await fixture(page);await select(page);
  const result=await page.evaluate(()=>{
    const root=document.querySelector('.reading-prose .selection-source')!;
    const copy=(target:Element)=>{const data=new DataTransfer(),event=new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:data});target.dispatchEvent(event);return{prevented:event.defaultPrevented,text:data.getData('text/plain')};};
    const range=document.createRange(),plain=root.querySelector('p')!.firstChild!;range.setStart(plain,0);range.setEnd(plain,6);getSelection()!.removeAllRanges();getSelection()!.addRange(range);
    const ordinary=copy(root.querySelector('p')!);
    const outside=document.querySelector('.abstract-text') || document.querySelector('.paper-abstract') || document.querySelector('h1')!;
    range.setStart(outside.firstChild!,0);range.setEnd(root.querySelector('p')!.lastChild!,2);const crossing=copy(root.querySelector('p')!);
    range.selectNodeContents(root);const input=document.createElement('textarea');input.value='Editable native text';root.append(input);input.focus();input.select();const editable=copy(input);
    return{ordinary,crossing,editable};
  });
  expect(result).toEqual({ordinary:{prevented:false,text:''},crossing:{prevented:false,text:''},editable:{prevented:false,text:''}});
  await page.keyboard.press('ControlOrMeta+c');expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('Editable native text');
});

test('copy addressed to the toolbar and native copying with toolbar focus both use the active reading range',async({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);await fixture(page);
  await page.getByRole('button',{name:'Copy overview',exact:true}).focus();
  const dialog=await select(page);
  await expect(page.getByRole('button',{name:'Copy overview',exact:true})).toBeFocused();
  const redirected=await page.getByRole('button',{name:'Copy overview',exact:true}).evaluate(button=>{
    const data=new DataTransfer(),event=new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:data});button.dispatchEvent(event);return{prevented:event.defaultPrevented,text:data.getData('text/plain')};
  });
  expect(redirected).toEqual({prevented:true,text:expected});
  await page.keyboard.press('ControlOrMeta+c');
  await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toBe(expected);
  expect(await dialog.locator('blockquote').textContent()).toBe(expected);
});
