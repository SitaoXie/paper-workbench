import {test,expect,type Page} from '@playwright/test';

async function fixture(page:Page,language='en',withEarlier=false) {
  const focus='Inspect the empirical evidence and its limitations, while preserving counterexamples and the original uncertainty.';
  const source='A deliberately long model identifier with provider and dated release suffix';
  const reading={id:'compact-current',style:'deep',language,format:'article',mode:'agent',createdAt:'2026-10-22T00:00:00Z',focus,source:{agent:source},markdown:'## Evidence and limits\n\nThe first paragraph should be close to the reading toolbar.\n\n## Reproduction\n\nCheck the source before drawing stronger conclusions.',interactive:{schemaVersion:1,blocks:[{id:'concept',type:'concept',title:'Evidence',text:'A bounded observation.',citations:[]}]} };
  const older={...reading,id:'compact-older',mode:'extractive',source:undefined,createdAt:'2026-10-21T00:00:00Z',markdown:'## Preserved source excerpts\n\nThis is source text, not independent analysis.',interactive:undefined};
  const earlier={...older,id:'compact-earlier',createdAt:'2026-10-20T00:00:00Z',markdown:'## Fixed earlier evidence\n\nSource navigation must keep this particular version visible.'};
  const paper={id:'compact-paper',title:'Reading a paper with context',authors:[],source:'web',createdAt:reading.createdAt,text:'Source text.',abstract:'The abstract remains accessible above the generated overview.',tags:[],readingVersions:withEarlier?[reading,older,earlier]:[reading,older],activeReadingId:reading.id};
  const writes:any[]=[];
  await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{(window as any).__copied=text}}}));
  await page.route('**/api/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname.slice(4);let json:any={};
    if(req.method()!=='GET')writes.push({path,body:req.postDataJSON()});
    if(path==='/papers')json={papers:[paper]};else if(path===`/papers/${paper.id}`){if(req.method()==='PATCH')Object.assign(paper,req.postDataJSON());json={paper};}
    else if(path==='/settings')json={provider:'openai',model:'mock-model',modelConfigured:false,apiKeyConfigured:false};
    else if(path==='/chats')json={messages:[],conversationId:null};else if(path.endsWith('/annotations'))json={annotations:[]};else if(path.endsWith('/activities'))json={activities:[]};
    await route.fulfill({json});
  });
  await page.goto(`/${language.startsWith('zh')?'zh':'en'}/?paper=${paper.id}`);
  return{reading,older,earlier,paper,writes,source,focus};
}

test('the compact overview keeps its first paragraph nearby, with reachable provenance and image controls',async({page},info)=>{
  const f=await fixture(page);const overview=page.getByRole('region',{name:'Reading overview',exact:true});
  await expect(overview.locator('.reading-prose p').first()).toBeVisible();
  await overview.evaluate(el=>window.scrollTo(0,scrollY+el.getBoundingClientRect().top-90));
  const height=await overview.evaluate(el=>el.querySelector('.reading-prose p')!.getBoundingClientRect().top-el.querySelector('.reading-overview-heading')!.getBoundingClientRect().top);
  await info.attach('toolbar-geometry',{body:JSON.stringify(await overview.evaluate(el=>[...el.querySelectorAll('.reading-overview-heading,.reading-secondary-toolbar,.reading-section-nav,.reading-prose,.reading-prose h2,.reading-prose p')].map(item=>({class:item.className,tag:item.tagName,top:item.getBoundingClientRect().top,height:item.getBoundingClientRect().height,marginTop:getComputedStyle(item).marginTop,marginBottom:getComputedStyle(item).marginBottom,parent:item.parentElement?.className}))),null,2),contentType:'application/json'});
  expect(height).toBeLessThanOrEqual(info.project.name==='mobile'?200:160);
  await expect(overview.getByLabel('Current reading source and language',{exact:true})).toHaveText('AI-generatedEnglish');
  await expect(overview.getByLabel('Reading version',{exact:true})).toHaveValue(f.reading.id);
  await expect(overview.getByLabel('Reading version',{exact:true}).locator('option').first()).toContainText(f.source);
  await expect(overview.getByText(f.focus,{exact:true})).toBeHidden();
  const actions=['New version','Copy overview','Download overview','Download offline website'];
  for(const action of actions){const button=overview.getByRole('button',{name:action,exact:true});await expect(button).toBeVisible();const b=(await button.boundingBox())!;expect(b.width).toBeGreaterThanOrEqual(30);expect(b.height).toBeGreaterThanOrEqual(30);}
  const first=await overview.locator('.reading-prose p').first().boundingBox();
  const details=overview.locator('.reading-version-details'),summary=details.locator(':scope > summary');await summary.click();
  await expect(details.getByText(f.focus,{exact:true})).toBeVisible();await expect(details.getByText(f.source,{exact:true})).toBeVisible();
  expect((await overview.locator('.reading-prose p').first().boundingBox())!.y).toBeCloseTo(first!.y,0);
  const panel=(await details.locator('.reading-version-detail-body').boundingBox())!;expect(panel.x).toBeGreaterThanOrEqual(0);expect(panel.x+panel.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(panel.y).toBeGreaterThanOrEqual(0);expect(panel.y+panel.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await summary.press('Escape');await expect(details).not.toHaveAttribute('open','');await expect(summary).toBeFocused();
  await summary.click();const vision=overview.locator('.vision-tools');await vision.locator(':scope > summary').click();
  await expect(details).not.toHaveAttribute('open','');await expect(vision.getByRole('button',{name:'Configure vision',exact:true})).toBeVisible();
  const visionBounds=(await vision.locator('.vision-tools-body').boundingBox())!;expect(visionBounds.x).toBeGreaterThanOrEqual(0);expect(visionBounds.x+visionBounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);expect(visionBounds.y).toBeGreaterThanOrEqual(0);expect(visionBounds.y+visionBounds.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await expect(vision).toContainText('No model image input is recorded yet');
  expect((await overview.locator('.reading-prose p').first().boundingBox())!.y).toBeCloseTo(first!.y,0);
  await vision.locator(':scope > summary').press('Escape');await expect(vision).not.toHaveAttribute('open','');
  expect(f.writes).toEqual([]);
  await page.screenshot({path:info.outputPath('compact-reading.png')});
  await info.attach('first-paragraph-offset',{body:String(height),contentType:'text/plain'});
});

test('Chinese controls stay compact and fit when the reading companion narrows the article',async({page},info)=>{
  await fixture(page,'zh-CN');const overview=page.getByRole('region',{name:'阅读解读',exact:true});
  await expect(overview.getByLabel('当前阅读来源与语言',{exact:true})).toHaveText('AI 解读中文');
  await expect(overview.getByRole('button',{name:'生成新版本',exact:true})).toBeVisible();
  await expect(overview.getByRole('button',{name:'下载离线网页',exact:true})).toBeVisible();
  if(info.project.name==='desktop')await page.getByRole('button',{name:'打开悬浮助手',exact:true}).click();
  const overflow=await overview.evaluate(el=>{const bounds=el.getBoundingClientRect();return[...el.querySelectorAll('.reading-overview-heading button,.reading-secondary-toolbar > button,.reading-secondary-toolbar > details > summary')].some(button=>{const b=button.getBoundingClientRect();return b.left<bounds.left-1||b.right>bounds.right+1;});});expect(overflow).toBe(false);
  await overview.locator('.reading-version-details > summary').click();await expect(overview.locator('.reading-version-detail-body')).toContainText('本版关注点');
  await overview.locator('.reading-version-details > summary').press('Escape');
  await page.screenshot({path:info.outputPath('compact-chinese-reading.png')});
});

test('compact controls retain version mutation semantics and distinguish source excerpts from AI interpretation',async({page})=>{
  const f=await fixture(page);const overview=page.getByRole('region',{name:'Reading overview',exact:true});
  await overview.getByRole('button',{name:'Copy overview',exact:true}).click();expect(await page.evaluate(()=>(window as any).__copied)).toContain('The first paragraph');
  await overview.getByLabel('Reading version',{exact:true}).selectOption(f.older.id);
  await expect(overview.getByRole('heading',{name:'Preserved source excerpts',exact:true})).toBeVisible();
  await expect(overview.getByLabel('Current reading source and language',{exact:true})).toHaveText('Source excerptsEnglish');
  expect(f.writes).toEqual([{path:`/papers/${f.paper.id}`,body:{activeReadingId:f.older.id}}]);
  await overview.getByRole('button',{name:'New version',exact:true}).click();await expect(overview.getByRole('radiogroup',{name:'Reading style',exact:true})).toBeVisible();
});

test('a late failed version choice cannot roll back a newer fixed source navigation',async({page})=>{
  const f=await fixture(page,'en',true);
  let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve});let requested=false;
  await page.route(`**/api/papers/${f.paper.id}`,async route=>{
    if(route.request().method()!=='PATCH')return route.fallback();
    expect(route.request().postDataJSON()).toEqual({activeReadingId:f.older.id});
    requested=true;await pending;await route.fulfill({status:503,json:{error:'Version update temporarily unavailable'}});
  });
  const versions=page.getByLabel('Reading version',{exact:true});
  await versions.selectOption(f.older.id);await expect.poll(()=>requested).toBe(true);
  await expect(versions).toBeDisabled();
  await page.evaluate(({id})=>{location.hash=`reading=${id}&section=1`},{id:f.earlier.id});
  await expect(versions).toHaveValue(f.earlier.id);
  await expect(page.locator('.reading-prose')).toContainText('Source navigation must keep this particular version visible.');
  release();await expect(versions).toBeEnabled();
  await expect(versions).toHaveValue(f.earlier.id);
  await expect(page).toHaveURL(/#reading=compact-earlier&section=1$/);
  await expect(page.locator('.reading-prose')).toContainText('Source navigation must keep this particular version visible.');
  await expect(page.getByText('Version update temporarily unavailable',{exact:true})).toHaveCount(0);
  expect(f.paper.activeReadingId).toBe(f.reading.id);
});

test('a failed version choice still rolls back and explains failure when no newer navigation intervenes',async({page})=>{
  const f=await fixture(page);
  await page.route(`**/api/papers/${f.paper.id}`,async route=>{
    if(route.request().method()!=='PATCH')return route.fallback();
    await route.fulfill({status:503,json:{error:'Version update temporarily unavailable'}});
  });
  const versions=page.getByLabel('Reading version',{exact:true});
  await versions.selectOption(f.older.id);
  await expect(versions).toBeEnabled();await expect(versions).toHaveValue(f.reading.id);
  await expect(page.getByText('Version update temporarily unavailable',{exact:true})).toBeVisible();
  expect(f.paper.activeReadingId).toBe(f.reading.id);
});
