import {test,expect,type Page,type Route} from '@playwright/test';

async function setup(page:Page,{deferCreation=false}={}){
  const papers=['alpha','beta'].map(id=>({id,title:`Handoff paper ${id}`,authors:[],source:'web',abstract:'An opening source excerpt.',abstractIsExcerpt:true,text:'The study compares empirical results and uncertainty.',createdAt:'2026-10-22T00:00:00Z',tags:[]}));
  const active:Record<string,string|undefined>={};
  const sessions:Record<string,any[]>={alpha:[{id:'earlier-alpha',title:'Earlier question',messages:[{role:'user',content:'Prior evidence question'},{role:'assistant',content:'A prior response.'}]}],beta:[]};
  const creations:{route:Route;body:any;id:string}[]=[];
  await page.addInitScript(()=>{
    (window as any).__copiedTasks=[];
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{(window as any).__copiedTasks.push(text)}}});
  });
  await page.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname.slice(4),paperId=url.searchParams.get('paperId')||'alpha';let result:any={};
    if(path==='/settings')result={provider:'openai',baseUrl:'https://example.org/v1',model:'unconfigured',modelConfigured:false,apiKeyConfigured:false};
    else if(path==='/papers')result={papers};
    else if(/^\/papers\/[^/]+$/.test(path))result={paper:papers.find(p=>p.id===path.split('/')[2])};
    else if(path==='/chats'){
      const id=url.searchParams.get('conversationId')||active[paperId];result={conversationId:id||null,messages:sessions[paperId].find(s=>s.id===id)?.messages||[]};
    }else if(path==='/chats/new'){
      const body=req.postDataJSON(),id=`created-${creations.length+1}`;creations.push({route,body,id});
      if(deferCreation)return;
      active[body.paperId]=id;sessions[body.paperId].push({id,title:'Copied question',messages:[]});result={conversationId:id,messages:[]};
    }else if(path==='/conversations')result={conversations:sessions[paperId].map(s=>({...s,messageCount:s.messages.length}))};
    else if(path==='/conversations/active'){
      const b=req.postDataJSON();active[b.paperId]=b.conversationId;result={conversationId:b.conversationId,messages:sessions[b.paperId].find(s=>s.id===b.conversationId)?.messages||[]};
    }else if(path.endsWith('/annotations'))result={annotations:[]};
    else if(path.endsWith('/activities'))result={activities:[]};
    await route.fulfill({json:result});
  });
  return{creations};
}
const composer=(page:Page)=>page.getByLabel('向研究助手提问',{exact:true});
async function openAssistant(page:Page){const button=page.getByRole('button',{name:'打开悬浮助手',exact:true});await expect(button.or(composer(page))).toBeVisible();if(await button.isVisible())await button.click();await expect(composer(page)).toBeVisible();}
async function closeAssistant(page:Page){const b=page.getByRole('button',{name:'关闭助手',exact:true});if(await b.isVisible())await b.click();}
async function copied(page:Page){return await page.evaluate(()=>(window as any).__copiedTasks as string[]);}

test('subscription copy fixes one session and both entry points reuse the same binding',async({page})=>{
  const{creations}=await setup(page);await page.goto('/zh/?paper=alpha');await openAssistant(page);
  await composer(page).fill('请继续比较经验结果，不要保存笔记。');
  await page.locator('.subscription-chat').click();
  await expect.poll(async()=> (await copied(page)).length).toBe(1);
  expect(creations).toHaveLength(1);
  let task=(await copied(page))[0];
  expect(task).toContain('"conversationId": "created-1"');
  expect(task).toContain(`PAPER_WORKBENCH_URL='${new URL(page.url()).origin}'`);
  expect(task).toContain("conversation 'alpha' 'created-1'");
  expect(task).toContain('请继续比较经验结果，不要保存笔记。');
  await page.locator('.subscription-chat').click();
  expect(creations).toHaveLength(1);
  await closeAssistant(page);
  await page.locator('.reading-tools').getByRole('button',{name:'用 Codex / Claude',exact:true}).click();
  await page.getByRole('button',{name:'复制代理任务',exact:true}).click();
  await expect(page.getByLabel('代理任务',{exact:true})).toHaveValue(task);
  expect(creations).toHaveLength(1);
  await expect(page.locator('.translation-actions')).toContainText('首页摘录');
  // Same text in another session must not reveal the previous task binding.
  await openAssistant(page);await page.getByRole('button',{name:'对话历史',exact:true}).click();
  await page.locator('.history-entry').filter({hasText:'Earlier question'}).click();
  await composer(page).fill('请继续比较经验结果，不要保存笔记。');
  await closeAssistant(page);
  await expect(page.getByLabel('代理任务',{exact:true})).toHaveValue('');
  await page.getByRole('button',{name:/^(复制代理任务|已复制任务)$/}).click();
  await expect(page.getByLabel('代理任务',{exact:true})).toHaveValue(/"conversationId": "earlier-alpha"/);
  expect(creations).toHaveLength(1);
});

test('a late session creation cannot copy a task over another paper or replace its draft',async({page})=>{
  const{creations}=await setup(page,{deferCreation:true});await page.goto('/zh/?paper=alpha');await openAssistant(page);
  await composer(page).fill('Pending alpha question');await page.locator('.subscription-chat').click();
  await expect.poll(()=>creations.length).toBe(1);
  await closeAssistant(page);
  const menu=page.getByRole('button',{name:'展开导航',exact:true});if(await menu.isVisible())await menu.click();
  await page.getByRole('navigation').getByRole('button',{name:'文库',exact:true}).click();
  await page.locator('.paper-card-main').filter({hasText:'Handoff paper beta'}).click();await openAssistant(page);
  await composer(page).fill('Do not replace this beta draft');
  await creations[0].route.fulfill({json:{conversationId:'created-1',messages:[]}});
  await expect(page.locator('.subscription-chat')).toBeEnabled();
  await expect(composer(page)).toHaveValue('Do not replace this beta draft');
  expect(await copied(page)).toHaveLength(0);
  await closeAssistant(page);await page.locator('.reading-tools').getByRole('button',{name:'用 Codex / Claude',exact:true}).click();
  await expect(page.getByLabel('代理任务',{exact:true})).toHaveValue('');
});
