import {test,expect,type Page} from '@playwright/test';
import {outlinePdf} from './fixtures/outline-pdf.mjs';

async function setup(page:Page,{shortEnglish=false}={}){
  const source=(english:boolean,prefix='')=>Array.from({length:6},(_,i)=>`## ${prefix}${english?'Evidence':'证据'} ${i+1}\n\n${(english?'Controlled evidence is limited to the evaluation setting and requires independent replication. ':'受控证据仅限于当前评估条件，需要通过独立实验确认适用范围。').repeat(english&&shortEnglish?1:7)}\n\n### ${english?'Limitations':'局限'} ${i+1}\n\n${(english?'Theoretical assumptions do not replace empirical evidence. ':'理论假设不能替代经验性证据。').repeat(english&&shortEnglish?1:6)}${i===0?'\n\n:::figure fig-1':''}`).join('\n\n');
  const figures=[{id:'fig-1',page:1,crop:{x:.05,y:.05,width:.85,height:.18},caption:'A synthetic source crop.'}];
  const older={id:'older-version',style:'deep',language:'zh-CN',markdown:source(false),mode:'agent',createdAt:'2026-10-21T00:00:00Z',figures,translations:{en:{language:'en',markdown:source(true),figureCaptions:{'fig-1':'A synthetic source crop.'}},'zh-CN':{language:'zh-CN',markdown:source(false),figureCaptions:{'fig-1':'测试原文裁切。'}}}};
  const newer={...older,id:'current-version',createdAt:'2026-10-22T00:00:00Z',markdown:source(false,'新版'),translations:{}};
  const paper:any={id:'section-paper',title:'Section navigation fixture',authors:[],source:'pdf',pageCount:3,localPdfUrl:'/section-source.pdf',createdAt:newer.createdAt,abstract:'A short source abstract.',text:'Source text.',tags:[],figures,readingVersions:[newer,older],activeReadingId:newer.id};
  const writes:any[]=[];
  await page.addInitScript(()=>{(window as any).__links=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>(window as any).__links.push(text)}})});
  await page.route('**/section-source.pdf',r=>r.fulfill({body:outlinePdf(),contentType:'application/pdf'}));
  await page.route('**/api/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname.slice(4);let result:any={};
    if(req.method()!=='GET')writes.push({path,body:req.postDataJSON()});
    if(path==='/settings')result={provider:'openai',baseUrl:'https://example.org/v1',model:'test',modelConfigured:false,apiKeyConfigured:false};
    else if(path==='/papers')result={papers:[paper]};
    else if(path===`/papers/${paper.id}`){if(req.method()==='PATCH')Object.assign(paper,req.postDataJSON());result={paper};}
    else if(path==='/chats')result={messages:[],conversationId:null};
    else if(path.endsWith('/annotations'))result={annotations:[]};
    else if(path.endsWith('/activities'))result={activities:[]};
    await route.fulfill({json:result});
  });
  return{paper,writes};
}
const section=(page:Page,id:string,index:number)=>page.locator(`[id="reading-${id}-section-${index}"]`);
async function top(page:Page,id:string,index:number){return await section(page,id,index).evaluate(el=>el.getBoundingClientRect().top);}

test('compact contents overlays the article, escapes to its trigger, and binds numbered headings across figure segments',async({page},info)=>{
  await setup(page);await page.goto('/zh/?paper=section-paper');
  const nav=page.locator('.reading-section-nav'),trigger=nav.locator('.reading-section-trigger');
  await expect(section(page,'current-version',3)).toHaveAttribute('aria-label','新版证据 2');
  await trigger.scrollIntoViewIfNeeded();
  const before=await top(page,'current-version',1);
  await trigger.click();await expect(nav.getByRole('navigation',{name:'解读章节',exact:true})).toBeVisible();
  const menuBounds=await nav.getByRole('navigation').boundingBox();const viewportHeight=await page.evaluate(()=>window.visualViewport?.height||innerHeight);
  expect(menuBounds!.y).toBeGreaterThanOrEqual(64);expect(menuBounds!.y+menuBounds!.height).toBeLessThanOrEqual(viewportHeight-6);
  const preview=info.outputPath('contents-overlay.png');await page.screenshot({path:preview});
  await info.attach('contents-overlay',{path:preview,contentType:'image/png'});
  expect(await top(page,'current-version',1)).toBe(before);
  await trigger.press('Escape');await expect(nav.getByRole('navigation')).toBeHidden();await expect(trigger).toBeFocused();
  await trigger.click();await nav.getByRole('link',{name:'新版证据 3',exact:true}).click();
  await expect.poll(()=>top(page,'current-version',5)).toBeLessThan(150);
  await expect.poll(()=>top(page,'current-version',5)).toBeGreaterThan(90);
  expect(new URL(page.url()).hash).toBe('#reading=current-version&section=5');
  await expect(nav.getByRole('navigation')).toBeHidden();
  await nav.getByRole('button',{name:'复制当前章节链接',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__links.length)).toBe(1);
  const link=await page.evaluate(()=>(window as any).__links[0]);
  expect(new URL(link).search).toBe('?paper=section-paper');expect(new URL(link).hash).toBe('#reading=current-version&section=5');
  await nav.getByRole('button',{name:'返回解读顶部',exact:true}).click();
  await expect.poll(()=>top(page,'current-version',1)).toBeLessThan(160);
});

test('a shared older-version chapter overrides saved PDF mode and stays in the same translated section',async({page})=>{
  const{writes}=await setup(page);await page.goto('/zh/?paper=section-paper');
  await page.getByRole('tab',{name:'论文',exact:true}).click();
  await expect(page.locator('.pdf-reader')).toBeVisible();
  await page.goto('/zh/?paper=section-paper#reading=older-version&section=5');
  await expect(page.getByRole('tab',{name:'摘要',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.getByLabel('解读版本',{exact:true})).toHaveValue('older-version');
  await expect.poll(()=>top(page,'older-version',5)).toBeLessThan(150);
  const previousTop=await top(page,'older-version',5);
  const locale=page.getByRole('button',{name:'切换为英文',exact:true});
  const menu=page.getByRole('button',{name:'展开导航',exact:true});if(await menu.isVisible())await menu.click();
  await locale.click();
  await expect(section(page,'older-version',5)).toHaveAttribute('aria-label','Evidence 3');
  await expect.poll(()=>top(page,'older-version',5)).toBeCloseTo(previousTop,0);
  expect(writes.filter(w=>w.path.endsWith('/translate')||w.path.endsWith('/report')||w.path===`/papers/section-paper`)).toHaveLength(0);
  await page.reload();
  await expect(page.getByLabel('Reading version',{exact:true})).toHaveValue('older-version');
  await expect.poll(()=>top(page,'older-version',5)).toBeLessThan(150);
});


test('missing version or chapter is explicit and heading selection still opens in-place tools',async({page})=>{
  const{writes}=await setup(page);await page.goto('/zh/?paper=section-paper#reading=missing-version&section=5');
  await expect(page.locator('.reading-section-notice')).toContainText('链接指向的解读版本不存在');
  await expect(page.getByLabel('解读版本',{exact:true})).toHaveValue('current-version');
  await page.locator('.reading-section-notice').getByRole('button',{name:'关闭章节提示',exact:true}).click();
  await expect(page.locator('.reading-section-notice')).toHaveCount(0);
  await page.goto('/zh/?paper=section-paper#reading=current-version&section=999');
  await expect(page.locator('.reading-section-notice')).toContainText('链接指向的章节不存在');
  const paragraph=page.locator('.reading-prose p').first();await paragraph.scrollIntoViewIfNeeded();
  await paragraph.evaluate(element=>{const range=document.createRange();range.selectNodeContents(element);const selection=getSelection();selection?.removeAllRanges();selection?.addRange(range);element.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
  await expect(page.getByRole('dialog',{name:'选文操作',exact:true})).toBeVisible();
  expect(writes).toHaveLength(0);
});


test('switching to a much shorter translation preserves the current subsection instead of overshooting it',async({page})=>{
  await setup(page,{shortEnglish:true});await page.goto('/zh/?paper=section-paper#reading=older-version&section=5');
  await expect.poll(()=>top(page,'older-version',5)).toBeLessThan(150);
  const span=(await top(page,'older-version',6))-(await top(page,'older-version',5));
  await page.mouse.wheel(0,Math.floor(span*.65));
  await expect.poll(()=>top(page,'older-version',5)).toBeLessThan(80);
  const trigger=page.locator('.reading-section-trigger');await expect(trigger).toContainText('证据 3');
  const menu=page.getByRole('button',{name:'展开导航',exact:true});if(await menu.isVisible())await menu.click();
  await page.getByRole('button',{name:'切换为英文',exact:true}).click();
  await expect(section(page,'older-version',5)).toHaveAttribute('aria-label','Evidence 3');
  await expect(trigger).toContainText('Evidence 3');
  const boundary=await page.locator('.reading-section-nav').evaluate(el=>el.getBoundingClientRect().bottom+14);
  await expect.poll(()=>top(page,'older-version',5)).toBeLessThanOrEqual(boundary+12);
  await expect.poll(()=>top(page,'older-version',6)).toBeGreaterThan(boundary+12);
});

test('explicit chapter navigation supports browser back and forward without changing the active reading version',async({page})=>{
  const {writes}=await setup(page);await page.goto('/zh/?paper=section-paper#reading=older-version&section=3');
  await expect.poll(()=>top(page,'older-version',3)).toBeLessThan(150);
  const nav=page.locator('.reading-section-nav');
  await nav.locator('.reading-section-trigger').click();
  await nav.getByRole('link',{name:'证据 4',exact:true}).click();
  await expect.poll(()=>top(page,'older-version',7)).toBeLessThan(150);
  expect(new URL(page.url()).hash).toBe('#reading=older-version&section=7');
  await page.goBack();
  await expect(page.getByLabel('解读版本',{exact:true})).toHaveValue('older-version');
  await expect.poll(()=>top(page,'older-version',3)).toBeGreaterThan(90);
  await expect.poll(()=>top(page,'older-version',3)).toBeLessThan(150);
  await page.goForward();
  await expect.poll(()=>top(page,'older-version',7)).toBeGreaterThan(90);
  await expect.poll(()=>top(page,'older-version',7)).toBeLessThan(150);
  expect(writes).toHaveLength(0);
});
