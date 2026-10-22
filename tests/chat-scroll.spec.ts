import {test,expect,type Page,type Route} from '@playwright/test';
async function setup(page:Page) {
 const papers=['alpha','beta'].map(id=>({id,title:`Scroll paper ${id}`,authors:[],source:'web',createdAt:'2026-10-22T00:00:00Z',abstract:'A public source for reading.',text:'A public source for reading.',tags:[],url:`https://example.org/${id}`}));
 const messages=(paper:string,session:string)=>Array.from({length:32},(_,i)=>({id:`${paper}-${session}-${i}`,role:i%2?'assistant':'user',content:`${paper} ${session} message ${i+1}\n\n${'The controlled evidence should be interpreted alongside the baseline, uncertainty, and study limitations. '.repeat(i%2?5:2)}`}));
 const conversations:Record<string,any[]> = Object.fromEntries(papers.map(p=>[p.id,['established','other'].map(id=>({id,title:`${p.id} ${id} conversation`,messages:messages(p.id,id)}))]));
 const active:Record<string,string>={alpha:'established',beta:'established'};
 const calls:{route:Route;body:any}[]=[];
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname.slice(4),paperId=url.searchParams.get('paperId')||'alpha';let result:any={};
  if(path==='/settings')result={provider:'openai',baseUrl:'https://example.org/v1',model:'test-model',modelConfigured:true,apiKeyConfigured:true};
  else if(path==='/papers')result={papers};
  else if(/^\/papers\/[^/]+$/.test(path))result={paper:papers.find(p=>p.id===path.split('/')[2])};
  else if(path==='/chats'){const id=url.searchParams.get('conversationId')||active[paperId];result={conversationId:id,messages:conversations[paperId].find(c=>c.id===id).messages};}
  else if(path==='/conversations')result={conversations:conversations[paperId].map(c=>({...c,messageCount:c.messages.length}))};
  else if(path==='/conversations/active'){const body=req.postDataJSON();active[body.paperId]=body.conversationId;result={conversationId:body.conversationId,messages:conversations[body.paperId].find(c=>c.id===body.conversationId).messages};}
  else if(path==='/chat'){calls.push({route,body:req.postDataJSON()});return;}
  else if(path.endsWith('/annotations'))result={annotations:[]};
  else if(path.endsWith('/activities'))result={activities:[]};
  await route.fulfill({json:result});
 });
 return {calls,conversations,async reply(index=0){const call=calls[index],body=call.body,session=conversations[body.paperId].find(c=>c.id===body.conversationId);const message={id:`answer-${session.messages.length}`,role:'assistant',content:'The arriving answer gives new evidence.\n\n'+'Carefully compare the controlled baseline and uncertainty. '.repeat(20)};session.messages.push({id:'submitted',role:'user',content:body.message},message);await call.route.fulfill({json:{message,conversationId:body.conversationId}});}};
}
const scroller=(page:Page)=>page.getByLabel('对话消息',{exact:true});
const composer=(page:Page)=>page.getByLabel('向研究助手提问',{exact:true});
const metrics=(page:Page)=>scroller(page).evaluate(node=>({top:node.scrollTop,max:node.scrollHeight-node.clientHeight}));
async function open(page:Page){const button=page.getByRole('button',{name:'打开悬浮助手',exact:true});await expect(button.or(composer(page))).toBeVisible();if(await button.isVisible())await button.click();await expect.poll(()=>scroller(page).locator('.message').count()).toBeGreaterThanOrEqual(32);}
async function close(page:Page){await page.getByRole('button',{name:'关闭助手',exact:true}).click();}
async function middle(page:Page,fraction=.45){
 const before=await metrics(page),box=await scroller(page).boundingBox();
 await page.mouse.move(box!.x+box!.width/2,box!.y+box!.height/2);
 await page.mouse.wheel(0,before.max*fraction-before.top);
 await expect.poll(async()=>Math.abs((await metrics(page)).top-before.max*fraction)).toBeLessThan(3);
 await expect(page.getByRole('button',{name:'跳到最新消息',exact:true})).toBeVisible();
 return (await metrics(page)).top;
}
async function samePosition(page:Page,top:number){await expect.poll(async()=>Math.abs((await metrics(page)).top-top)).toBeLessThan(3);}
async function bottom(page:Page){await expect.poll(async()=>{const m=await metrics(page);return m.max-m.top;}).toBeLessThan(3);}
async function history(page:Page,title:string){await page.getByRole('button',{name:'对话历史',exact:true}).click();await page.locator('.history-entry').filter({hasText:title}).click();await expect(composer(page)).toBeEnabled();}
async function paper(page:Page,id:string){
 await close(page);const menu=page.getByRole('button',{name:'展开导航',exact:true}),nav=page.getByRole('navigation');
 if(await menu.isVisible())await menu.click();await nav.getByRole('button',{name:'文库',exact:true}).click();
 await page.locator('.paper-card-main').filter({hasText:`Scroll paper ${id}`}).click();await open(page);
}

test('middle of a conversation survives closing, switching sessions and papers, and reloading',async({page})=>{
 await setup(page);await page.goto('/zh/?paper=alpha');await open(page);await bottom(page);
 const alpha=await middle(page);await close(page);await open(page);await samePosition(page,alpha);
 await history(page,'alpha other conversation');await bottom(page);const other=await middle(page,.7);
 await history(page,'alpha established conversation');await samePosition(page,alpha);
 await history(page,'alpha other conversation');await samePosition(page,other);
 await paper(page,'beta');await bottom(page);const beta=await middle(page,.25);
 await paper(page,'alpha');await samePosition(page,other);
 await paper(page,'beta');await samePosition(page,beta);
 await page.reload();await open(page);await samePosition(page,beta);
});

test('sending follows the question but an arriving answer does not steal the reader position',async({page},testInfo)=>{
 const f=await setup(page);await page.goto('/zh/?paper=alpha');await open(page);await middle(page);
 await composer(page).fill('Please compare this evidence.');await page.getByRole('button',{name:'发送问题',exact:true}).click();
 await expect.poll(()=>f.calls.length).toBe(1);await bottom(page);
 const reading=await middle(page,.32);await f.reply();
 await expect(scroller(page)).toContainText('The arriving answer gives new evidence.');await samePosition(page,reading);
 const unread=page.getByRole('button',{name:'有新消息，跳到最新消息',exact:true});await expect(unread).toBeVisible();
 const box=await unread.boundingBox(),area=await scroller(page).boundingBox();expect(box!.y).toBeGreaterThan(area!.y);expect(box!.y+box!.height).toBeLessThanOrEqual(area!.y+area!.height);
 await close(page);await page.getByRole('button',{name:'打开悬浮助手',exact:true}).click();await samePosition(page,reading);await expect(unread).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('unread-conversation.png')});
 await unread.focus();await page.keyboard.press('Enter');await bottom(page);await expect(unread).toHaveCount(0);await expect(scroller(page)).toBeFocused();
});

test('external answers follow only readers at the bottom and remain unread while the panel is closed',async({page})=>{
 const f=await setup(page);await page.goto('/zh/?paper=alpha');await open(page);await bottom(page);
 const append=async(text:string)=>{f.conversations.alpha[0].messages.push({id:text,role:'assistant',content:text+'\n\n'+'Additional source-grounded evidence. '.repeat(16)});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(scroller(page)).toContainText(text);};
 await append('External answer one');await bottom(page);
 const reading=await middle(page,.55);await close(page);
 f.conversations.alpha[0].messages.push({id:'external-two',role:'assistant',content:'External answer two\n\n'+'New evidence received while closed. '.repeat(20)});
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.getByRole('button',{name:'打开悬浮助手',exact:true}).click();
 await expect(scroller(page)).toContainText('External answer two');await samePosition(page,reading);
 await expect(page.getByRole('button',{name:'有新消息，跳到最新消息',exact:true})).toBeVisible();
});


test('an old pending answer never moves another paper conversation and is unread on return',async({page})=>{
 const f=await setup(page);await page.goto('/zh/?paper=alpha');await open(page);
 await composer(page).fill('Alpha pending question');await page.getByRole('button',{name:'发送问题',exact:true}).click();await expect.poll(()=>f.calls.length).toBe(1);await bottom(page);
 const alpha=await middle(page,.35);await paper(page,'beta');const beta=await middle(page,.6);
 await f.reply();await samePosition(page,beta);await expect(scroller(page)).not.toContainText('The arriving answer');
 await expect(page.getByRole('button',{name:'有新消息，跳到最新消息',exact:true})).toHaveCount(0);
 await paper(page,'alpha');await expect(scroller(page)).toContainText('The arriving answer');await samePosition(page,alpha);
 await expect(page.getByRole('button',{name:'有新消息，跳到最新消息',exact:true})).toBeVisible();
});
