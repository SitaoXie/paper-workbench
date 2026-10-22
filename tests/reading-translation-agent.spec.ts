import {test,expect,type Page,type Route} from '@playwright/test';
import {referencePdf} from './fixtures/reference-pdf.mjs';

async function fixture(page:Page,mode:'translation'|'captions'|'interactive'='translation'){
  const figure={id:'source-figure',page:2,caption:'Original source caption.',crop:{x:.05,y:.2,width:.8,height:.15}};
  const interactive={schemaVersion:1,blocks:[{id:'concept',type:'concept',title:'Source concept',text:'Evidence has a limited scope.',citations:[{page:2}]}]};
  const version:any={id:'fixed-version',language:'en',style:'deep',mode:'agent',markdown:'## Original reading\n\nOriginal reasoning with [evidence](#page=2 "Primary source at the destination.").\n\n:::figure source-figure',createdAt:'2026-10-22T00:00:00Z',figures:[figure],translations:{},...(mode==='interactive'?{interactive,format:'interactive'}:{})};
  if(mode!=='translation')version.translations['zh-CN']={language:'zh-CN',markdown:'## 保持不变的中文正文\n\n来源 [p.2]。\n\n:::figure source-figure',...(mode==='interactive'?{figureCaptions:{'source-figure':'已经保存的中文图注'}}:{})};
  const second={...version,id:'other-version',createdAt:'2026-10-22T01:00:00Z',markdown:'## Another reading\n\nAnother version stays separate.',figures:[],translations:{}};
  const paper:any={id:'translation-agent',title:'Subscription language workflow',authors:[],source:'pdf',createdAt:version.createdAt,abstract:'Original source abstract.',text:'Source text.',tags:[],pageCount:4,localPdfUrl:'/translation-agent.pdf',figures:[figure],readingVersions:[version,second],activeReadingId:version.id};
  const pdf=await referencePdf();let nextRead:((route:Route)=>Promise<void>)|undefined;const writes:any[]=[];
  await page.addInitScript(()=>{(window as any).__tasks=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{(window as any).__tasks.push(text);}}});});
  await page.route('**/translation-agent.pdf',r=>r.fulfill({contentType:'application/pdf',body:pdf}));
  await page.route('**/api/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname.slice(4);let result:any={};
    if(req.method()!=='GET')writes.push({path,body:req.postDataJSON()});
    if(path==='/settings')result={profiles:[],apiKeyConfigured:false,modelConfigured:false};
    else if(path==='/papers')result={papers:[paper]};
    else if(path===`/papers/${paper.id}`){
      if(req.method()==='PATCH')Object.assign(paper,req.postDataJSON());
      if(req.method()==='GET'&&nextRead){const read=nextRead;nextRead=undefined;await read(route);return;}
      result={paper};
    }else if(path==='/chats')result={messages:[],conversationId:null};
    else if(path.endsWith('/annotations'))result={annotations:[]};
    await route.fulfill({json:result});
  });
  await page.goto('/zh/?paper='+paper.id);
  return {paper,version,second,writes,deferRead:(read:(route:Route)=>Promise<void>)=>{nextRead=read;}};
}
const bridge=(page:Page)=>page.getByRole('region',{name:'订阅翻译任务',exact:true});
async function copyTask(page:Page){
  await bridge(page).getByRole('button',{name:'复制翻译任务',exact:true}).click();
  await expect(bridge(page).getByRole('button',{name:'已复制任务',exact:true})).toBeVisible();
  return page.evaluate(()=>(window as any).__tasks.at(-1) as string);
}

test('no-API translation binds the fixed version; a late refresh cannot switch another reading',async({page})=>{
  const f=await fixture(page);
  await page.getByRole('button',{name:'用订阅翻译此版本',exact:true}).click();
  await expect(bridge(page)).toBeVisible();await expect(page.getByRole('dialog',{name:/模型/})).toHaveCount(0);
  const task=await copyTask(page);expect(task).toContain('"readingId": "fixed-version"');expect(task).toContain('"language": "zh-CN"');expect(task).toContain('"mode": "translation"');expect(task).toContain(`PAPER_WORKBENCH_URL='${new URL(page.url()).origin}'`);
  let read:Route|undefined;f.deferRead(async route=>{read=route;});
  await bridge(page).getByRole('button',{name:'刷新译文',exact:true}).click();await expect.poll(()=>!!read).toBe(true);
  await page.getByLabel('解读版本',{exact:true}).selectOption(f.second.id);await expect(page.locator('.reading-prose')).toContainText('Another version stays separate.');
  f.version.translations['zh-CN']={language:'zh-CN',markdown:'## 固定版本的中文结果\n\n来源 [p.2]。\n\n:::figure source-figure',figureCaptions:{'source-figure':'源图的中文图注。'}};
  await read!.fulfill({json:{paper:{...f.paper,activeReadingId:f.version.id}}});
  await expect(page.getByLabel('解读版本',{exact:true})).toHaveValue(f.second.id);await expect(page.locator('.reading-prose')).toContainText('Another version stays separate.');
  await page.getByLabel('解读版本',{exact:true}).selectOption(f.version.id);await expect(page.locator('.reading-prose')).toContainText('固定版本的中文结果');await expect(page.locator('.reading-prose figcaption')).toContainText('源图的中文图注。');
  await expect(bridge(page)).toContainText('此版本的目标语言内容已可用');
  expect(f.paper.readingVersions).toHaveLength(2);expect(f.writes.every(w=>w.path===`/papers/${f.paper.id}`&&Object.keys(w.body).join()==='activeReadingId')).toBe(true);
});

test('caption subscription task preserves the translated article and source pixels',async({page})=>{
  const f=await fixture(page,'captions');const original=f.version.translations['zh-CN'].markdown;
  await page.getByRole('button',{name:'用订阅补译图注',exact:true}).click();const task=await copyTask(page);expect(task).toContain('"mode": "captions"');expect(task).toContain('figureCaptions');
  f.version.translations['zh-CN'].figureCaptions={'source-figure':'原有图表的中文说明。'};
  await bridge(page).getByRole('button',{name:'刷新译文',exact:true}).click();
  await expect(page.locator('.reading-prose')).toContainText('保持不变的中文正文');await expect(page.locator('.reading-prose figcaption')).toContainText('原有图表的中文说明。');
  expect(f.version.translations['zh-CN'].markdown).toBe(original);expect(f.version.figures[0].caption).toBe('Original source caption.');expect(f.writes).toEqual([]);
  await page.getByLabel('阅读语言',{exact:true}).selectOption('en');await expect(page.getByRole('region',{name:'Subscription translation task',exact:true})).toHaveCount(0);
  await page.getByLabel('Reading language',{exact:true}).selectOption('zh-CN');await expect(bridge(page)).toBeVisible();await bridge(page).getByText('查看固定任务',{exact:true}).click();await expect(page.getByLabel('固定版本翻译任务',{exact:true})).toHaveValue(task);
});

test('interactive supplement has a separate task and rejects a changed source on refresh',async({page})=>{
  const f=await fixture(page,'interactive');
  await page.getByRole('button',{name:'用订阅翻译互动卡片',exact:true}).click();const task=await copyTask(page);expect(task).toContain('"mode": "interactive"');expect(task).toContain('"readingId": "fixed-version"');
  for(const change of ['markdown','interactive','createdAt'] as const){
    f.deferRead(async route=>{
      const changed=structuredClone(f.paper),source=changed.readingVersions[0];
      if(change==='markdown')source.markdown='Changed source that this task never read.';
      else if(change==='interactive')source.interactive.blocks[0].text='A changed source concept that this task never read.';
      else source.createdAt='2026-10-23T00:00:00Z';
      await route.fulfill({json:{paper:changed}});
    });
    await bridge(page).getByRole('button',{name:'刷新译文',exact:true}).click();
    await expect(bridge(page).getByRole('alert'),`reject a source whose only changed field is ${change}`).toContainText('原解读已变化');
    await expect(page.locator('.reading-prose')).toContainText('保持不变的中文正文');
  }
  f.version.translations['zh-CN'].interactive={schemaVersion:1,blocks:[{id:'concept',type:'concept',title:'原概念的译文',text:'证据具有适用范围。',citations:[{page:2}]}]};
  await bridge(page).getByRole('button',{name:'刷新译文',exact:true}).click();await expect(bridge(page).getByRole('alert')).toHaveCount(0);await expect(bridge(page)).toContainText('此版本的目标语言内容已可用');
  await page.getByRole('group',{name:'查看方式',exact:true}).getByRole('button',{name:'交互阅读',exact:true}).click();await expect(page.getByTestId('interactive-reading')).toContainText('原概念的译文');expect(f.writes).toEqual([]);
});

test('an older same-target refresh must not replace a newer translation after returning to its version',async({page})=>{
  const f=await fixture(page);await page.getByRole('button',{name:'用订阅翻译此版本',exact:true}).click();
  let oldRead:Route|undefined;const stale=structuredClone(f.paper);stale.readingVersions[0].translations['zh-CN']={language:'zh-CN',markdown:'## 过时的缓存译文\n\n旧内容。',figureCaptions:{'source-figure':'旧图注'},createdAt:'2026-10-22T02:00:00Z'};
  f.deferRead(async route=>{oldRead=route;});await bridge(page).getByRole('button',{name:'刷新译文',exact:true}).click();await expect.poll(()=>!!oldRead).toBe(true);
  await page.getByLabel('解读版本',{exact:true}).selectOption(f.second.id);await page.getByLabel('解读版本',{exact:true}).selectOption(f.version.id);
  f.version.translations['zh-CN']={language:'zh-CN',markdown:'## 更新且有效的译文\n\n新内容。',figureCaptions:{'source-figure':'新图注'},createdAt:'2026-10-22T03:00:00Z'};
  await bridge(page).getByRole('button',{name:'刷新译文',exact:true}).click();await expect(page.locator('.reading-prose')).toContainText('更新且有效的译文');
  await oldRead!.fulfill({json:{paper:stale}});await expect(page.locator('.reading-prose')).toContainText('更新且有效的译文');
});
test('an unmounted refresh cannot erase a derived version after reopening the same paper',async({page})=>{
  const f=await fixture(page);await page.getByRole('button',{name:'用订阅翻译此版本',exact:true}).click();
  let oldRead:Route|undefined;const oldPaper=structuredClone(f.paper);oldPaper.readingVersions[0].translations['zh-CN']={language:'zh-CN',markdown:'## 旧任务译文\n\n原版本。',figureCaptions:{'source-figure':'原图注'}};
  f.deferRead(async route=>{oldRead=route;});await bridge(page).getByRole('button',{name:'刷新译文',exact:true}).click();await expect.poll(()=>!!oldRead).toBe(true);
  await page.locator('.paper-toolbar').getByRole('button',{name:'文库',exact:true}).click();
  const derived={...f.second,id:'derived-new',createdAt:'2026-10-22T03:00:00Z',markdown:'## 新派生版\n\n新图表修订后的版本。',language:'zh-CN'};f.paper.readingVersions.push(derived);f.paper.activeReadingId=derived.id;
  await page.locator('.paper-card-main').filter({hasText:'Subscription language workflow'}).click();
  // Loading a newer library snapshot preserves the previous fixed reading;
  // choosing its new derived version is a separate, explicit user action.
  await expect(page.getByLabel('解读版本',{exact:true})).toHaveValue(f.version.id);
  await expect(page.getByLabel('解读版本',{exact:true}).locator('option')).toHaveCount(3);expect(f.writes).toEqual([]);
  await page.getByLabel('解读版本',{exact:true}).selectOption('derived-new');
  await expect(page.getByLabel('解读版本',{exact:true})).toBeEnabled();
  await expect(page.locator('.reading-prose')).toContainText('新图表修订后的版本。');
  await oldRead!.fulfill({json:{paper:oldPaper}});await expect(page.getByLabel('解读版本',{exact:true})).toHaveValue('derived-new');await expect(page.getByLabel('解读版本',{exact:true}).locator('option')).toHaveCount(3);
  await expect(page.locator('.reading-prose')).toContainText('新图表修订后的版本。');
  expect(f.writes).toEqual([{path:`/papers/${f.paper.id}`,body:{activeReadingId:'derived-new'}}]);
});

test('an independent paper update protects its newer target cache without another subscription refresh',async({page})=>{
  const f=await fixture(page);await page.getByRole('button',{name:'用订阅翻译此版本',exact:true}).click();
  let oldRead:Route|undefined;const stale=structuredClone(f.paper);stale.readingVersions[0].translations['zh-CN']={language:'zh-CN',markdown:'## 旧的目标语言缓存\n\n过时结果。',figureCaptions:{'source-figure':'旧图注'},createdAt:'2026-10-22T02:00:00Z'};
  f.deferRead(async route=>{oldRead=route;});await bridge(page).getByRole('button',{name:'刷新译文',exact:true}).click();await expect.poll(()=>!!oldRead).toBe(true);
  // Another local import is observed through the normal version-selection
  // response. No second subscription refresh increments its request epoch.
  f.version.translations['zh-CN']={language:'zh-CN',markdown:'## 另一个代理的新结果\n\n应保留此正文。\n\n:::figure source-figure',figureCaptions:{'source-figure':'应保留此图注'},createdAt:'2026-10-22T03:00:00Z'};
  await page.getByLabel('解读版本',{exact:true}).selectOption(f.second.id);await page.getByLabel('解读版本',{exact:true}).selectOption(f.version.id);await expect(page.locator('.reading-prose')).toContainText('另一个代理的新结果');
  await oldRead!.fulfill({json:{paper:stale}});await expect(page.locator('.reading-prose')).toContainText('另一个代理的新结果');await expect(page.locator('.reading-prose figcaption')).toContainText('应保留此图注');
});

test('refreshing a fixed translation respects original view and a different reading language',async({page})=>{
  const f=await fixture(page);await page.getByRole('button',{name:'用订阅翻译此版本',exact:true}).click();
  await page.getByRole('button',{name:'查看原文',exact:true}).click();
  f.version.translations['zh-CN']={language:'zh-CN',markdown:'## 缓存中文译文\n\n只在译文视图显示。\n\n:::figure source-figure',figureCaptions:{'source-figure':'中文缓存图注'}};
  await bridge(page).getByRole('button',{name:'刷新译文',exact:true}).click();await expect(page.locator('.reading-prose')).toContainText('Original reasoning');await expect(page.getByRole('button',{name:'返回译文',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'返回译文',exact:true}).click();await expect(page.locator('.reading-prose')).toContainText('缓存中文译文');await expect(page.locator('.reading-prose figcaption')).toContainText('中文缓存图注');
  let oldRead:Route|undefined;f.deferRead(async route=>{oldRead=route;});await bridge(page).getByRole('button',{name:'刷新译文',exact:true}).click();await expect.poll(()=>!!oldRead).toBe(true);
  await page.getByLabel('阅读语言',{exact:true}).selectOption('en');await oldRead!.fulfill({json:{paper:f.paper}});await expect(page.locator('.reading-prose')).toContainText('Original reasoning');await expect(page.getByLabel('Reading language',{exact:true})).toHaveValue('en');
  await page.getByLabel('Reading language',{exact:true}).selectOption('zh-CN');await expect(page.locator('.reading-prose')).toContainText('缓存中文译文');expect(f.writes).toEqual([]);
});
