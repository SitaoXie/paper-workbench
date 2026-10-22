import {test,expect,type Page,type Route} from '@playwright/test';
async function setup(page:Page,{configured=false,failCreation=false}={}){
 const reading={id:'review-version',language:'zh-CN',style:'quick',mode:'agent',markdown:'## 经验结果\n这一段是生成的解读内容，需要对照原始论文核查。',createdAt:'2026-10-22T00:00:00Z'};
 const paper={id:'review-paper',title:'Boundary review paper',authors:[],source:'web',abstract:'A source abstract with evidence.',text:'Original source evidence.',url:'https://example.org/source',tags:[],createdAt:reading.createdAt,readingVersions:[reading],activeReadingId:reading.id};
 const profile={id:'connection',name:'Models',provider:'openai',baseUrl:'https://example.org/v1',model:'model-a',models:['model-a','model-b','model-c'],modelConfigured:configured,apiKeyConfigured:configured};
 const settings={...profile,activeProfileId:profile.id,profiles:[profile]};
 const requests:{path:string;body:any;route:Route}[]=[];
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{(window as any).__copied=text}}}));
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname.slice(4);let result:any={};
  if(req.method()!=='GET'){requests.push({path,body:req.postDataJSON(),route});if(path==='/chat'||(path==='/settings'&&req.method()==='PUT'))return;}
  if(path==='/papers')result={papers:[paper]};else if(path===`/papers/${paper.id}`)result={paper};
  else if(path==='/settings')result=settings;else if(path==='/chats')result={conversationId:'review-session',messages:[]};
  else if(path==='/chats/new'){if(failCreation&&requests.filter(r=>r.path==='/chats/new').length===1){await route.fulfill({status:503,json:{error:'Temporary session creation failure'}});return;}result={conversationId:'new-question',messages:[]};}
  else if(path.endsWith('/annotations'))result={annotations:[]};else if(path.endsWith('/activities'))result={activities:[]};
  await route.fulfill({json:result});
 });
 await page.goto('/zh/?paper='+paper.id);await expect(page.getByRole('heading',{name:paper.title,exact:true})).toBeVisible();
 return{requests,paper,settings};
}
async function open(page:Page){await page.getByRole('button',{name:'打开悬浮助手',exact:true}).click();await expect(page.getByLabel('向研究助手提问',{exact:true})).toBeVisible();}

test('copying a citation must not claim the subscription task has been copied',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'“ 引用',exact:true}).click();
 await page.getByRole('button',{name:'复制 BibTeX',exact:true}).click();await page.getByRole('button',{name:'关闭引用',exact:true}).click();await open(page);
 expect(await page.evaluate(()=>(window as any).__copied)).toMatch(/^@misc/);
 expect(await page.locator('.subscription-chat').getAttribute('aria-label')).toBe('用 Codex / Claude 订阅回答 · 复制任务');
});

async function selectQuestion(page:Page,question:string){
 const prose=page.locator('.reading-prose p').first();
 await prose.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
 const dialog=page.getByRole('dialog',{name:'选文操作',exact:true});await expect(dialog).toBeVisible();
 await dialog.getByLabel('针对摘要选文的问题',{exact:true}).fill(question);
 return dialog;
}
test('a new selection question creates its own session while a late old answer stays isolated',async({page})=>{
 const f=await setup(page,{configured:true});await open(page);await page.getByLabel('向研究助手提问',{exact:true}).fill('First question remains pending');await page.getByRole('button',{name:'发送问题',exact:true}).click();await expect.poll(()=>f.requests.filter(r=>r.path==='/chat').length).toBe(1);
 await page.getByRole('button',{name:'关闭助手',exact:true}).click();
 const dialog=await selectQuestion(page,'Keep this carefully worded second question');
 await dialog.getByRole('button',{name:'提问',exact:true}).click();
 await expect(page.getByLabel('向研究助手提问',{exact:true})).toHaveValue('Keep this carefully worded second question');
 expect(f.requests.filter(r=>r.path==='/chats/new')).toHaveLength(1);await expect(dialog).toHaveCount(0);
 const pending=f.requests.find(r=>r.path==='/chat')!;await pending.route.fulfill({json:{conversationId:'review-session',message:{role:'assistant',content:'Old session answer must stay in its own conversation.'}}});
 await expect(page.getByLabel('向研究助手提问',{exact:true})).toHaveValue('Keep this carefully worded second question');
 await expect(page.locator('.conversation')).not.toContainText('Old session answer');
 await page.getByRole('button',{name:'发送问题',exact:true}).click();await expect.poll(()=>f.requests.filter(r=>r.path==='/chat').length).toBe(2);
 expect(f.requests.filter(r=>r.path==='/chat')[1].body.conversationId).toBe('new-question');
});

test('a failed selection session keeps the exact question and retries session creation instead of explanation',async({page})=>{
 const f=await setup(page,{configured:true,failCreation:true});
 const dialog=await selectQuestion(page,'A precisely worded question that must survive a failed request.');
 await dialog.getByRole('button',{name:'提问',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('问题已保留');
 await expect(dialog.getByLabel('针对摘要选文的问题',{exact:true})).toHaveValue('A precisely worded question that must survive a failed request.');
 await dialog.getByRole('button',{name:'重试',exact:true}).click();
 await expect(page.getByLabel('向研究助手提问',{exact:true})).toHaveValue('A precisely worded question that must survive a failed request.');
 await expect(dialog).toHaveCount(0);expect(f.requests.filter(r=>r.path==='/chats/new')).toHaveLength(2);expect(f.requests.filter(r=>r.path.endsWith('/assist'))).toHaveLength(0);
});

test('all model selectors share one in-flight lock and only show confirmed choices',async({page})=>{
 const f=await setup(page,{configured:true});await page.getByRole('button',{name:'生成新版本',exact:true}).click();
 const overview=page.locator('.reading-overview').getByLabel('切换当前模型',{exact:true});
 await overview.selectOption(JSON.stringify(['connection','model-b']));await open(page);
 const assistant=page.locator('.composer-wrap').getByLabel('切换当前模型',{exact:true});
 await expect(overview).toBeDisabled();await expect(assistant).toBeDisabled();await expect(assistant).toHaveAttribute('aria-busy','true');
 await expect(page.locator('.composer-wrap').getByRole('status')).toContainText('正在切换');
 expect(f.requests.filter(r=>r.path==='/settings')).toHaveLength(1);
 const result=(model:string)=>({...f.settings,model,profiles:[{...f.settings.profiles[0],model}]});
 await f.requests.find(r=>r.path==='/settings')!.route.fulfill({json:result('model-b')});
 await expect(assistant).toBeEnabled();await expect(overview).toBeEnabled();await expect(assistant).toHaveValue(JSON.stringify(['connection','model-b']));
 await assistant.selectOption(JSON.stringify(['connection','model-c']));await expect(overview).toBeDisabled();await expect(assistant).toBeDisabled();
 await expect.poll(()=>f.requests.filter(r=>r.path==='/settings').length).toBe(2);
 await f.requests.filter(r=>r.path==='/settings')[1].route.fulfill({json:result('model-c')});
 await expect(overview).toBeEnabled();await expect(assistant).toHaveValue(JSON.stringify(['connection','model-c']));await expect(overview).toHaveValue(JSON.stringify(['connection','model-c']));
});

test('a failed model switch unlocks every selector without claiming the unsaved model',async({page})=>{
 const f=await setup(page,{configured:true});await page.getByRole('button',{name:'生成新版本',exact:true}).click();
 const overview=page.locator('.reading-overview').getByLabel('切换当前模型',{exact:true});await overview.selectOption(JSON.stringify(['connection','model-b']));await open(page);
 const assistant=page.locator('.composer-wrap').getByLabel('切换当前模型',{exact:true});await expect(assistant).toBeDisabled();
 await f.requests.find(r=>r.path==='/settings')!.route.fulfill({status:503,json:{error:'Temporary settings failure'}});
 await expect(assistant).toBeEnabled();await expect(overview).toBeEnabled();await expect(assistant).toHaveValue(JSON.stringify(['connection','model-a']));
 await expect(page.locator('.composer-wrap').getByRole('alert')).toContainText('Temporary settings failure');
});

test('a copied subscription task does not mark BibTeX or a changed question as copied',async({page})=>{
 await setup(page);await open(page);await page.getByLabel('向研究助手提问',{exact:true}).fill('Question one');await page.locator('.subscription-chat').click();
 await expect(page.locator('.subscription-chat')).toHaveAttribute('aria-label','任务已复制 · 在代理会话中粘贴');
 expect(await page.evaluate(()=>(window as any).__copied)).toContain('Question one');
 await page.getByLabel('向研究助手提问',{exact:true}).fill('Question two');expect(await page.locator('.subscription-chat').getAttribute('aria-label')).toBe('用 Codex / Claude 订阅回答 · 复制任务');
 await page.getByRole('button',{name:'关闭助手',exact:true}).click();await page.getByRole('button',{name:'“ 引用',exact:true}).click();
 await expect(page.getByRole('button',{name:'复制 BibTeX',exact:true})).toBeVisible();
});

test('saving connection settings holds the same lock and publishes the confirmed profile once',async({page})=>{
 const f=await setup(page,{configured:true});await page.getByRole('button',{name:'生成新版本',exact:true}).click();await open(page);
 await page.getByRole('button',{name:'管理模型连接',exact:true}).click();const dialog=page.getByRole('dialog',{name:'模型与 API',exact:true});
 await dialog.getByLabel('模型名称',{exact:true}).fill('model-c');await dialog.getByRole('button',{name:'保存配置',exact:true}).click();
 const selectors=page.getByLabel('切换当前模型',{exact:true});await expect(selectors).toHaveCount(2);await expect(selectors.nth(0)).toBeDisabled();await expect(selectors.nth(1)).toBeDisabled();
 await expect(dialog.getByLabel('模型名称',{exact:true})).toBeDisabled();
 await expect.poll(()=>f.requests.filter(r=>r.path==='/settings').length).toBe(1);const call=f.requests.find(r=>r.path==='/settings')!;expect(call.body.profiles[0].model).toBe('model-c');
 await call.route.fulfill({json:{...f.settings,model:'model-c',profiles:[{...f.settings.profiles[0],model:'model-c'}]}});
 await expect(dialog.getByText('配置已保存',{exact:true})).toBeVisible();await expect(dialog.getByLabel('模型名称',{exact:true})).toBeEnabled();
 await dialog.getByRole('button',{name:'关闭模型设置',exact:true}).click();await expect(selectors.nth(0)).toHaveValue(JSON.stringify(['connection','model-c']));await expect(selectors.nth(1)).toHaveValue(JSON.stringify(['connection','model-c']));
});

test('settings opened during a pending model choice cannot save a stale profile',async({page})=>{
 const f=await setup(page,{configured:true});await open(page);const selector=page.locator('.composer-wrap').getByLabel('切换当前模型',{exact:true});
 await selector.selectOption(JSON.stringify(['connection','model-b']));await page.getByRole('button',{name:'管理模型连接',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'模型与 API',exact:true});await expect(dialog.getByRole('button',{name:'保存配置',exact:true})).toBeDisabled();await expect(dialog.getByLabel('模型名称',{exact:true})).toBeDisabled();
 expect(f.requests.filter(r=>r.path==='/settings')).toHaveLength(1);
 await f.requests.find(r=>r.path==='/settings')!.route.fulfill({json:{...f.settings,model:'model-b',profiles:[{...f.settings.profiles[0],model:'model-b'}]}});
 await expect(dialog.getByRole('button',{name:'保存配置',exact:true})).toBeEnabled();await expect(dialog.getByLabel('模型名称',{exact:true})).toHaveValue('model-b');
});
