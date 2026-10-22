import {test,expect,type Page,type Route} from '@playwright/test';

async function fixture(page:Page,{configured=false,rejectClipboard=false}={}){
  const paper={id:'question-mode',title:'Question processing evidence',authors:[],source:'web',abstract:'The empirical evaluation compares a measured baseline.',text:'The empirical evaluation compares a measured baseline. A small sample does not establish universal coverage.',url:'https://example.org/public-paper',tags:[],createdAt:'2026-10-22T00:00:00Z'};
  const writes:{path:string;body:any}[]=[];
  let active:string|undefined;
  const sessions=new Map<string,any[]>();
  await page.addInitScript(({reject})=>{
    (window as any).__questionCopied=[];
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{
      if(reject)throw new DOMException('Clipboard permission denied','NotAllowedError');
      (window as any).__questionCopied.push(text);
    }}});
  },{reject:rejectClipboard});
  await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname.slice(4),method=request.method();let json:any={};
    if(method!=='GET')writes.push({path,body:request.postDataJSON()});
    if(path==='/settings')json={provider:'openai',baseUrl:'https://example.org/v1',model:'test-model',modelConfigured:configured,apiKeyConfigured:configured};
    else if(path==='/papers')json={papers:[paper]};
    else if(path===`/papers/${paper.id}`)json={paper};
    else if(path==='/chats'){
      const id=url.searchParams.get('conversationId')||active;json={conversationId:id||null,messages:id?sessions.get(id)||[]:[]};
    }else if(path==='/chats/new'){
      active=`question-session-${sessions.size+1}`;sessions.set(active,[]);json={conversationId:active,messages:[]};
    }else if(path==='/chat'){
      const body=request.postDataJSON();active=body.conversationId||`question-session-${sessions.size+1}`;
      const userMessage={id:`user-${writes.length}`,role:'user',content:body.message,questionText:body.questionText,metadata:body.metadata||undefined};
      const message={id:`answer-${writes.length}`,role:'assistant',content:body.processing==='extractive'?'**Local extractive mode · no model was called**\n\nA retrieved source passage.':'An answer from the configured model.'};
      sessions.set(active,[...(sessions.get(active)||[]),userMessage,message]);json={conversationId:active,userMessage,message};
    }else if(path==='/conversations/active'){active=request.postDataJSON().conversationId;json={conversationId:active,messages:sessions.get(active!)||[]};}
    else if(path==='/conversations')json={conversations:[...sessions].map(([id,messages])=>({id,title:`Bound question ${id}`,messageCount:messages.length}))};
    else if(path.endsWith('/annotations'))json={annotations:[]};
    else if(path.endsWith('/activities'))json={activities:[]};
    await route.fulfill({json});
  });
  await page.goto(`/en/?paper=${paper.id}`);
  const open=page.getByRole('button',{name:'Open floating assistant',exact:true});await expect(open.or(page.getByLabel('Ask the research assistant',{exact:true}))).toBeVisible();if(await open.isVisible())await open.click();
  await expect(page.getByLabel('Ask the research assistant',{exact:true})).toBeEnabled();
  return {paper,writes,sessions};
}
const composer=(page:Page)=>page.getByLabel('Ask the research assistant',{exact:true});
const mode=(page:Page)=>page.getByLabel('Question processing mode',{exact:true});
const bridge=(page:Page)=>page.getByRole('region',{name:'Subscription question task',exact:true});
const taskText=(page:Page)=>page.getByLabel('Subscription question task text',{exact:true});
const modelWrites=(writes:{path:string}[])=>writes.filter(call=>/\/(chat|report|translate|assist|analyze)$/.test(call.path));

async function visibleTask(page:Page){
  await expect(bridge(page)).toBeVisible();
  const show=bridge(page).getByRole('button',{name:'Show task text',exact:true});
  if(await show.isVisible())await show.click();
  await expect(taskText(page)).toBeVisible();return taskText(page).inputValue();
}

test('without an API, Send and Enter prepare one stable subscription task and retain the unsent question',async({page})=>{
  const f=await fixture(page);await expect(mode(page)).toHaveValue('agent');
  const question='Which empirical result is strongest, and what remains untested?';await composer(page).fill(question);
  await page.locator('.composer .send-button').click();const task=await visibleTask(page);
  expect(task).toContain(question);expect(task).toContain('"paperId": "question-mode"');expect(task).toContain('"conversationId": "question-session-1"');
  expect(task).toContain(`PAPER_WORKBENCH_URL='${new URL(page.url()).origin}'`);
  await expect(composer(page)).toHaveValue(question);expect(modelWrites(f.writes)).toEqual([]);
  await composer(page).press('Enter');await expect(taskText(page)).toHaveValue(task);await expect(composer(page)).toHaveValue(question);
  expect(f.writes.filter(call=>call.path==='/chats/new')).toHaveLength(1);expect(modelWrites(f.writes)).toEqual([]);
  await expect(page.locator('.messages .message.user')).toHaveCount(0);
});

test('a denied clipboard still exposes the full subscription task without clearing or submitting the draft',async({page})=>{
  const f=await fixture(page,{rejectClipboard:true});const question='Keep the quoted baseline and discuss uncertainty.';
  await composer(page).fill(question);await composer(page).press('Enter');const task=await visibleTask(page);
  expect(task).toContain(question);expect(task).toContain("conversation 'question-mode' 'question-session-1'");
  await expect(composer(page)).toHaveValue(question);expect(modelWrites(f.writes)).toEqual([]);
  await page.locator('.composer .send-button').click();await expect(taskText(page)).toHaveValue(task);
  expect(f.writes.filter(call=>call.path==='/chats/new')).toHaveLength(1);expect(modelWrites(f.writes)).toEqual([]);
});

test('configured API defaults to API, but an explicit subscription choice never sends a hidden model request',async({page})=>{
  const f=await fixture(page,{configured:true});await expect(mode(page)).toHaveValue('api');
  await composer(page).fill('Give an API answer about the controlled baseline.');await composer(page).press('Enter');
  await expect(page.locator('.message.assistant')).toContainText('An answer from the configured model.');
  expect(modelWrites(f.writes)).toHaveLength(1);expect(f.writes.find(call=>call.path==='/chat')!.body.processing).toBe('api');
  const question='Use my subscription to inspect the assumptions.';await composer(page).fill(question);await mode(page).selectOption('agent');
  await page.locator('.composer .send-button').click();const task=await visibleTask(page);expect(task).toContain(question);
  await expect(composer(page)).toHaveValue(question);expect(modelWrites(f.writes)).toHaveLength(1);
  await mode(page).selectOption('api');await composer(page).press('Enter');await expect(composer(page)).toHaveValue('');
  expect(modelWrites(f.writes)).toHaveLength(2);expect(f.writes.filter(call=>call.path==='/chat').map(call=>call.body.processing)).toEqual(['api','api']);
});

for(const configured of [false,true])test(`local source search is explicit and bypasses model routing with API configured=${configured}`,async({page})=>{
  const f=await fixture(page,{configured});await mode(page).selectOption('extractive');
  await composer(page).fill('Find the measured baseline in the source.');await composer(page).press('Enter');
  await expect(page.locator('.message.assistant')).toContainText('Local extractive mode · no model was called');
  await expect(composer(page)).toHaveValue('');expect(modelWrites(f.writes)).toHaveLength(1);
  expect(f.writes.find(call=>call.path==='/chat')!.body).toMatchObject({paperId:f.paper.id,processing:'extractive',message:'Find the measured baseline in the source.'});
  await expect(bridge(page)).toHaveCount(0);
});

test('a suggested question follows subscription mode and binds the clicked question instead of sending extracts',async({page})=>{
  const f=await fixture(page);const suggestion=page.locator('.suggestion-grid button').first(),question=(await suggestion.innerText()).trim();
  await suggestion.click();const task=await visibleTask(page);expect(task).toContain(question);
  await expect(composer(page)).toHaveValue(question);expect(modelWrites(f.writes)).toEqual([]);
  expect(f.writes.filter(call=>call.path==='/chats/new')).toHaveLength(1);
});

test('a late subscription refresh stays in its fixed session and never replaces another unsent question',async({page})=>{
  const f=await fixture(page),question='Original unsent subscription question.';
  await composer(page).fill(question);await composer(page).press('Enter');await visibleTask(page);
  let delayed:Route|undefined,hold=true;
  await page.route('**/api/chats?**',async route=>{
    if(hold&&new URL(route.request().url()).searchParams.get('conversationId')==='question-session-1'){delayed=route;return;}
    await route.fallback();
  });
  await bridge(page).getByRole('button',{name:'Refresh answer',exact:true}).click();await expect.poll(()=>!!delayed).toBe(true);
  await page.getByRole('button',{name:'New conversation',exact:true}).click();
  await expect(composer(page)).toHaveValue('');await composer(page).fill('The new session owns this different draft.');
  const reply={id:'agent-answer-1',role:'assistant',content:'An imported answer bound only to the first session.'};
  f.sessions.set('question-session-1',[reply]);hold=false;
  await delayed!.fulfill({json:{conversationId:'question-session-1',messages:[reply]}});
  await expect(composer(page)).toHaveValue('The new session owns this different draft.');
  await expect(page.locator('.message.assistant').filter({hasText:reply.content})).toHaveCount(0);await expect(bridge(page)).toHaveCount(0);
  await page.getByRole('button',{name:'Conversation history',exact:true}).click();
  await page.locator('.history-entry').filter({hasText:'Bound question question-session-1'}).click();
  await expect(composer(page)).toHaveValue(question);await expect(bridge(page)).toBeVisible();
  await bridge(page).getByRole('button',{name:'Refresh answer',exact:true}).click();
  await expect(bridge(page).getByRole('status')).toContainText('Checked this conversation.');
  await expect(page.locator('.messages')).toContainText(reply.content);await expect(composer(page)).toHaveValue(question);
  expect(modelWrites(f.writes)).toEqual([]);
});
