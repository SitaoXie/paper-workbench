import {test,expect,type Page,type Route} from '@playwright/test';
import {referencePdf} from './fixtures/reference-pdf.mjs';

const sourceRevision='a'.repeat(64);
async function fixture(page:Page,{configured=false,missingRevision=false}={}){
 const figure={id:'original-chart',page:2,caption:'Figure 1. Original source caption.',crop:{x:.1,y:.2,width:.7,height:.2}};
 const source:any={id:'source-version',title:'Original source reading',language:'en',style:'deep',focus:'Evidence only.',mode:'agent',markdown:'## Original reading\n\nOriginal overview with bounded conclusions. [p.2]',createdAt:'2026-10-22T00:00:00Z',source:{kind:'agent',agent:'Original author'},figures:[figure],translations:{},...(!missingRevision?{derivationRevision:sourceRevision}:{})};
 const second:any={...source,id:'other-version',title:'Other source reading',createdAt:'2026-10-22T01:00:00Z',markdown:'## Other reading\n\nOther version stays separate.',figures:[],translations:{},derivationRevision:'b'.repeat(64)};
 const paper:any={id:'interactive-agent',title:'Subscription interactive workflow',authors:[],source:'pdf',createdAt:source.createdAt,abstract:'Source abstract.',text:'Original source text.',tags:[],pageCount:4,localPdfUrl:'/interactive-agent.pdf',figures:[{...figure,id:'current-library-chart'}],readingVersions:[source,second],activeReadingId:source.id};
 const pdf=await referencePdf(),writes:any[]=[];let nextRead:((route:Route)=>Promise<void>)|undefined,reads=0;
 await page.addInitScript(()=>{(window as any).__tasks=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{(window as any).__tasks.push(text);}}});});
 await page.route('**/interactive-agent.pdf',route=>route.fulfill({contentType:'application/pdf',body:pdf}));
 await page.route('**/api/**',async route=>{
    if(new URL(route.request().url()).pathname==='/api/collections'){await route.fulfill({json:{collections:[]}});return;}
  const req=route.request(),path=new URL(req.url()).pathname.slice(4);let result:any={};
  if(req.method()!=='GET')writes.push({path,body:req.postDataJSON()});
  if(path==='/settings')result={profiles:[],apiKeyConfigured:configured,modelConfigured:configured,model:'fixture-model'};
  else if(path==='/papers')result={papers:[paper]};
  else if(path===`/papers/${paper.id}`){
   if(req.method()==='PATCH')Object.assign(paper,req.postDataJSON());
   if(req.method()==='GET'){reads++;if(nextRead){const read=nextRead;nextRead=undefined;await read(route);return;}}
   result={paper};
  }else if(path==='/chats')result={messages:[],conversationId:null};
  else if(path.endsWith('/annotations'))result={annotations:[]};
  await route.fulfill({json:result});
 });
 await page.goto('/zh/?paper='+paper.id);
 await expect(page.locator('.reading-prose')).toContainText('Original overview');
 return {paper,source,second,writes,reads:()=>reads,deferRead:(callback:(route:Route)=>Promise<void>)=>{nextRead=callback;},derived:(binding:any,extra:any={})=>({...source,id:'derived-result',createdAt:'2026-10-22T02:00:00Z',mode:'agent-interactive',format:'interactive',source:{kind:'agent',agent:'Subscription fixture'},articleSource:source.source,derivationRevision:'c'.repeat(64),derivedFromReadingId:binding.sourceReadingId,derivedSourceRevision:binding.expectedSourceRevision,agentTaskId:binding.agentTaskId,translations:{},interactive:{schemaVersion:1,blocks:[{id:'scope',type:'concept',title:'Interactive source scope',text:'Only bounded source conclusions are supported.',citations:[{page:2}]}]},...extra})};
}
const bridge=(page:Page)=>page.getByRole('region',{name:'订阅互动任务',exact:true});
async function prepare(page:Page){await page.getByRole('button',{name:'将此版本转为互动导读',exact:true}).click();await expect(bridge(page)).toBeVisible();}
async function copied(page:Page){await bridge(page).getByRole('button',{name:/^(复制互动任务|已复制任务)$/}).click();const task=await page.evaluate(()=>(window as any).__tasks.at(-1) as string);return {task,binding:JSON.parse(task.match(/(?:^|\n)(\{\n[\s\S]*?\n\})/)![1])};}

test('no-provider interactive task preserves its UUID across versions, language switches and closing; opening a result is explicit',async({page})=>{
 const f=await fixture(page);await prepare(page);await expect(page.getByRole('dialog')).toHaveCount(0);
 const {task,binding}=await copied(page);expect(binding.sourceReadingId).toBe(f.source.id);expect(binding.expectedSourceRevision).toBe(sourceRevision);expect(task).toContain(`PAPER_WORKBENCH_URL='${new URL(page.url()).origin}'`);
 await page.getByLabel('解读版本',{exact:true}).selectOption(f.second.id);await expect(bridge(page)).toHaveCount(0);await page.getByLabel('解读版本',{exact:true}).selectOption(f.source.id);expect((await copied(page)).task).toBe(task);
 await page.getByLabel('阅读语言',{exact:true}).selectOption('en');await expect(page.getByRole('region',{name:'Subscription interactive task',exact:true})).toBeVisible();await page.getByLabel('Reading language',{exact:true}).selectOption('zh-CN');expect((await copied(page)).task).toBe(task);
 await bridge(page).getByRole('button',{name:'关闭订阅互动任务',exact:true}).click();await expect(bridge(page)).toHaveCount(0);await prepare(page);expect((await copied(page)).task).toBe(task);
 const result=f.derived(binding);f.paper.readingVersions.push(result);
 await bridge(page).getByRole('button',{name:'刷新互动结果',exact:true}).click();await expect(bridge(page)).toContainText('互动版已保存');await expect(page.getByLabel('解读版本',{exact:true})).toHaveValue(f.source.id);await expect(page.getByTestId('interactive-reading')).toHaveCount(0);
 const before=f.writes.length;await bridge(page).getByRole('button',{name:'打开互动版',exact:true}).click();await expect(page.getByLabel('解读版本',{exact:true})).toHaveValue(result.id);await expect(page.getByTestId('interactive-reading')).toContainText('Interactive source scope');
 expect(f.writes.slice(before)).toEqual([{path:`/papers/${f.paper.id}`,body:{activeReadingId:result.id}}]);expect(f.writes.every(write=>write.path===`/papers/${f.paper.id}`)).toBe(true);
});

test('late result refresh adds only the bound companion and retains newer other versions, figures and active selection',async({page})=>{
 const f=await fixture(page);await prepare(page);const {binding}=await copied(page);let read:Route|undefined;
 const stale=structuredClone(f.paper);stale.readingVersions.push(f.derived(binding));stale.activeReadingId=f.source.id;
 f.deferRead(async route=>{read=route;});await bridge(page).getByRole('button',{name:'刷新互动结果',exact:true}).click();await expect.poll(()=>!!read).toBe(true);
 const third={...f.second,id:'third-new',createdAt:'2026-10-22T03:00:00Z'};f.paper.readingVersions.push(third);f.second.translations['zh-CN']={language:'zh-CN',markdown:'## 其他版本的新译文\n\n这份缓存必须保留。'};f.paper.figures[0].caption='Newer library caption stays intact.';
 await page.getByLabel('解读版本',{exact:true}).selectOption(f.second.id);await expect(page.locator('.reading-prose')).toContainText('其他版本的新译文');await read!.fulfill({json:{paper:stale}});
 await expect(page.getByLabel('解读版本',{exact:true})).toHaveValue(f.second.id);await expect(page.getByLabel('解读版本',{exact:true}).locator('option')).toHaveCount(4);await expect(page.locator('.reading-prose')).toContainText('其他版本的新译文');
 await page.locator('.vision-tools > summary').click();await expect(page.locator('.vision-crop-preview figcaption')).toContainText('Newer library caption stays intact.');expect(f.writes).toHaveLength(1);
});

test('a missing token is fetched for the same source, and absent or changed source information cannot manufacture a task',async({page})=>{
 const f=await fixture(page,{missingRevision:true});const initialReads=f.reads();
 await page.getByRole('button',{name:'将此版本转为互动导读',exact:true}).click();await expect(page.getByRole('alert')).toContainText('服务端尚未提供固定版本校验信息');await expect(bridge(page)).toHaveCount(0);expect(f.reads()).toBeGreaterThan(initialReads);
 f.deferRead(async route=>{const changed=structuredClone(f.paper);changed.readingVersions[0].markdown='Changed source.';changed.readingVersions[0].derivationRevision=sourceRevision;await route.fulfill({json:{paper:changed}});});
 await page.getByRole('button',{name:'将此版本转为互动导读',exact:true}).click();await expect(page.getByRole('alert')).toContainText('固定原版已变化');await expect(bridge(page)).toHaveCount(0);
 f.source.derivationRevision=sourceRevision;await prepare(page);expect((await copied(page)).binding.expectedSourceRevision).toBe(sourceRevision);expect(f.writes).toEqual([]);
});

test('configured readers can choose the subscription route without starting an application model',async({page})=>{
 const f=await fixture(page,{configured:true});await page.getByRole('button',{name:'用订阅制作互动版',exact:true}).click();await expect(bridge(page)).toBeVisible();await copied(page);expect(f.writes).toEqual([]);
});

test('mismatched task, source revision and figure snapshots are rejected without changing the current reading',async({page})=>{
 const f=await fixture(page);await prepare(page);const {binding}=await copied(page);
 for(const change of ['wrong-source','wrong-revision','changed-figures','changed-markdown'] as const){
  f.deferRead(async route=>{const response=structuredClone(f.paper),result=f.derived(binding);if(change==='wrong-source')result.derivedFromReadingId=f.second.id;else if(change==='wrong-revision')result.derivedSourceRevision='d'.repeat(64);else if(change==='changed-figures')result.figures=[f.paper.figures[0]];else result.markdown='A translated replacement is not the original.';response.readingVersions.push(result);await route.fulfill({json:{paper:response}});});
  await bridge(page).getByRole('button',{name:'刷新互动结果',exact:true}).click();await expect(bridge(page).getByRole('alert')).toContainText('绑定不一致');await expect(page.getByLabel('解读版本',{exact:true}).locator('option')).toHaveCount(2);
 }
 f.deferRead(async route=>{const response=structuredClone(f.paper);response.readingVersions[0].derivationRevision='e'.repeat(64);await route.fulfill({json:{paper:response}});});
 await bridge(page).getByRole('button',{name:'刷新互动结果',exact:true}).click();await expect(bridge(page).getByRole('alert')).toContainText('原版来源已变化');await expect(page.locator('.reading-prose')).toContainText('Original overview');expect(f.writes).toEqual([]);
});

test('an older refresh cannot replace a result or its newer translation after navigating away and back',async({page})=>{
 const f=await fixture(page);await prepare(page);const {binding}=await copied(page);let read:Route|undefined;
 const stale=structuredClone(f.paper);stale.readingVersions.push(f.derived(binding));f.deferRead(async route=>{read=route;});await bridge(page).getByRole('button',{name:'刷新互动结果',exact:true}).click();await expect.poll(()=>!!read).toBe(true);
 await page.getByLabel('解读版本',{exact:true}).selectOption(f.second.id);await page.getByLabel('解读版本',{exact:true}).selectOption(f.source.id);
 const result=f.derived(binding);result.translations['zh-CN']={language:'zh-CN',markdown:'## 已有互动版的新译文\n\n缓存需要保留。'};f.paper.readingVersions.push(result);
 await bridge(page).getByRole('button',{name:'刷新互动结果',exact:true}).click();await expect(bridge(page)).toContainText('互动版已保存');await read!.fulfill({json:{paper:stale}});
 await expect(page.getByLabel('解读版本',{exact:true}).locator('option')).toHaveCount(3);await page.getByLabel('解读版本',{exact:true}).selectOption(result.id);await expect(page.locator('.reading-prose')).toContainText('已有互动版的新译文');
});

test('refreshing an existing companion preserves independently updated target caches without a second refresh',async({page})=>{
 const f=await fixture(page);await prepare(page);const {binding}=await copied(page),result=f.derived(binding);f.paper.readingVersions.push(result);
 await bridge(page).getByRole('button',{name:'刷新互动结果',exact:true}).click();await expect(bridge(page)).toContainText('互动版已保存');
 let read:Route|undefined;const stale=structuredClone(f.paper);f.deferRead(async route=>{read=route;});await bridge(page).getByRole('button',{name:'刷新互动结果',exact:true}).click();await expect.poll(()=>!!read).toBe(true);
 result.translations['zh-CN']={language:'zh-CN',markdown:'## 另一个代理的新互动版译文\n\n不应被旧快照覆盖。'};
 await page.getByLabel('解读版本',{exact:true}).selectOption(f.second.id);await page.getByLabel('解读版本',{exact:true}).selectOption(f.source.id);await read!.fulfill({json:{paper:stale}});
 await page.getByLabel('解读版本',{exact:true}).selectOption(result.id);await expect(page.locator('.reading-prose')).toContainText('另一个代理的新互动版译文');
});

test('an unmounted task cannot erase a newer paper snapshot when its old response arrives',async({page})=>{
 const f=await fixture(page);await prepare(page);const {binding}=await copied(page);let read:Route|undefined;
 const stale=structuredClone(f.paper);stale.readingVersions.push(f.derived(binding));f.deferRead(async route=>{read=route;});await bridge(page).getByRole('button',{name:'刷新互动结果',exact:true}).click();await expect.poll(()=>!!read).toBe(true);
 await page.locator('.paper-toolbar').getByRole('button',{name:'文库',exact:true}).click();f.paper.readingVersions.push({...f.second,id:'newer-reading',createdAt:'2026-10-22T05:00:00Z'});f.paper.activeReadingId='newer-reading';
 await page.locator('.collection-paper-open').filter({hasText:f.paper.title}).click();
 // Reopening preserves the reader's fixed version even when the server has a
 // newer default. The fresh version must still be available for explicit use.
 await expect(page.getByLabel('解读版本',{exact:true})).toHaveValue(f.source.id);
 await expect(page.getByLabel('解读版本',{exact:true}).locator('option')).toHaveCount(3);expect(f.writes).toEqual([]);
 await page.getByLabel('解读版本',{exact:true}).selectOption('newer-reading');
 await expect(page.getByLabel('解读版本',{exact:true})).toBeEnabled();
 await expect(page.locator('.reading-prose')).toContainText('Other version stays separate.');
 await read!.fulfill({json:{paper:stale}});
 await expect(page.getByLabel('解读版本',{exact:true})).toHaveValue('newer-reading');await expect(page.getByLabel('解读版本',{exact:true}).locator('option')).toHaveCount(3);
 await expect(page.locator('.reading-prose')).toContainText('Other version stays separate.');
 expect(f.writes).toEqual([{path:`/papers/${f.paper.id}`,body:{activeReadingId:'newer-reading'}}]);
});
