import {test,expect,type Page,type Route} from '@playwright/test';

async function fixture(page:Page,{configured=false,rejectClipboard=false}={}){
  const paper={id:'question-mode',title:'Question processing evidence',authors:[],source:'web',abstract:'The empirical evaluation compares a measured baseline.',text:'The empirical evaluation compares a measured baseline. A small sample does not establish universal coverage.',url:'https://example.org/public-paper',tags:[],createdAt:'2026-10-22T00:00:00Z'};
  const writes:{path:string;body:any}[]=[];
  let active:string|undefined;
  let settings:any={provider:'openai',baseUrl:'https://example.org/v1',model:'test-model',modelConfigured:configured,apiKeyConfigured:configured,activeProfileId:'test',profiles:[{id:'test',name:'Test API',provider:'openai',baseUrl:'https://example.org/v1',model:'test-model',models:['test-model'],modelConfigured:configured,apiKeyConfigured:configured}]};
  const sessions=new Map<string,any[]>();
  await page.addInitScript(({reject})=>{
    (window as any).__questionCopied=[];
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{
      if(reject)throw new DOMException('Clipboard permission denied','NotAllowedError');
      (window as any).__questionCopied.push(text);
    }}});
  },{reject:rejectClipboard});
  await page.route('**/api/**',async route=>{
    if(new URL(route.request().url()).pathname==='/api/collections'){await route.fulfill({json:{collections:[]}});return;}
    const request=route.request(),url=new URL(request.url()),path=url.pathname.slice(4),method=request.method();let json:any={};
    if(method!=='GET')writes.push({path,body:request.postDataJSON()});
    if(path==='/settings'){if(method==='PUT'){const b=request.postDataJSON();settings={...settings,...b,assistant:{...settings.assistant,...b.assistant}};}json=settings;}
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
const mode=(page:Page)=>page.getByRole('button',{name:'Choose model or subscription assistant',exact:true});
async function chooseMode(page:Page,choice:'agent'|'api'){await mode(page).click();await page.getByRole('dialog',{name:'Models and subscription assistant',exact:true}).getByRole('button',{name:choice==='agent'?/Codex \/ Claude/: 'test-model',exact:choice==='api'}).click();await expect(mode(page)).toContainText(choice==='agent'?'Codex / Claude':'test-model');await expect(page.getByRole('dialog',{name:'Models and subscription assistant',exact:true})).toHaveCount(0);}
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
  const f=await fixture(page);await expect(mode(page)).toContainText('Codex / Claude');
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
  const f=await fixture(page,{configured:true});await expect(mode(page)).toContainText('test-model');
  await composer(page).fill('Give an API answer about the controlled baseline.');await composer(page).press('Enter');
  await expect(page.locator('.message.assistant')).toContainText('An answer from the configured model.');
  expect(modelWrites(f.writes)).toHaveLength(1);expect(f.writes.find(call=>call.path==='/chat')!.body.processing).toBe('api');
  const question='Use my subscription to inspect the assumptions.';await composer(page).fill(question);await chooseMode(page,'agent');
  await page.locator('.composer .send-button').click();const task=await visibleTask(page);expect(task).toContain(question);
  await expect(composer(page)).toHaveValue(question);expect(modelWrites(f.writes)).toHaveLength(1);
  await chooseMode(page,'api');await composer(page).press('Enter');await expect(composer(page)).toHaveValue('');
  expect(modelWrites(f.writes)).toHaveLength(2);expect(f.writes.filter(call=>call.path==='/chat').map(call=>call.body.processing)).toEqual(['api','api']);
});

for(const configured of [false,true])test(`model menu exposes only supported answer routes with API configured=${configured}`,async({page})=>{
  const f=await fixture(page,{configured});await mode(page).click();
  const menu=page.getByRole('dialog',{name:'Models and subscription assistant',exact:true});
  await expect(menu.getByRole('button',{name:/Codex \/ Claude/})).toBeEnabled();
  const apiModel=menu.getByRole('button',{name:'test-model',exact:true});
  if(configured)await expect(apiModel).toBeEnabled();else await expect(apiModel).toBeDisabled();
  await expect(menu).not.toContainText(/Local (extractive|source search)/);
  await menu.getByRole('button',{name:/Codex \/ Claude/}).click();
  await expect(menu).toHaveCount(0);await expect(mode(page)).toContainText('Codex / Claude');
  await composer(page).fill('Find the measured baseline in the source.');await composer(page).press('Enter');
  expect(await visibleTask(page)).toContain('Find the measured baseline in the source.');
  expect(modelWrites(f.writes)).toEqual([]);
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
  await expect(bridge(page).getByRole('status')).toContainText('Checked this conversation; no matching question and answer was found.');
  await expect(bridge(page)).toContainText('Subscription task ready');
  await expect(page.locator('.messages')).toContainText(reply.content);await expect(composer(page)).toHaveValue(question);
  expect(modelWrites(f.writes)).toEqual([]);
});

function importedPair(task:string){
  const binding=JSON.parse(task.match(/\{\n[\s\S]*?\n\}/)![0]);
  const question=JSON.parse(task.split('\n').at(-1)!);
  const common={paperId:binding.paperId,conversationId:binding.conversationId,agentTaskId:binding.agentTaskId};
  return [{...common,id:'import-user-'+binding.agentTaskId,role:'user',content:question,...(binding.metadata?{metadata:binding.metadata}:{})},{...common,id:'import-answer-'+binding.agentTaskId,role:'assistant',content:'A verified imported answer for this exact task.',mode:'agent',source:{agent:'Codex'}}];
}
async function reopenAssistant(page:Page){
  const open=page.getByRole('button',{name:'Open floating assistant',exact:true});await expect(open.or(composer(page))).toBeVisible();if(await open.isVisible())await open.click();
  await expect(composer(page)).toBeEnabled();
}

test('a pending task survives reload without rebuilding or changing the configured subscription choice; dismissal persists',async({page})=>{
  const f=await fixture(page,{configured:true});await chooseMode(page,'agent');
  await composer(page).fill('Resume this pending task after a browser refresh.');await composer(page).press('Enter');const task=await visibleTask(page);
  await page.reload();await reopenAssistant(page);await expect(mode(page)).toContainText('Codex / Claude');expect(await visibleTask(page)).toBe(task);
  await expect(composer(page)).toHaveValue('Resume this pending task after a browser refresh.');
  expect(f.writes.filter(call=>call.path==='/chats/new')).toHaveLength(1);expect(modelWrites(f.writes)).toEqual([]);
  await bridge(page).getByRole('button',{name:'Close subscription question task',exact:true}).click();await expect(bridge(page)).toHaveCount(0);
  await page.reload();await reopenAssistant(page);await expect(bridge(page)).toHaveCount(0);
  await expect(composer(page)).toHaveValue('Resume this pending task after a browser refresh.');expect(modelWrites(f.writes)).toEqual([]);
});

for(const language of ['en','zh'])test(`a correctly bound imported pair completes the task and clears only its unchanged question in ${language}`,async({page})=>{
  const f=await fixture(page);await composer(page).fill('Which result actually supports the empirical claim?');await composer(page).press('Enter');const task=await visibleTask(page),pair=importedPair(task);
  f.sessions.set('question-session-1',pair);
  if(language==='zh')await page.goto(`/zh/?paper=${f.paper.id}`);
  const region=page.getByRole('region',{name:language==='zh'?'订阅问答任务':'Subscription question task',exact:true});
  await expect(region).toBeVisible();await region.getByRole('button',{name:language==='zh'?'刷新回答':'Refresh answer',exact:true}).click();
  await expect(region).toContainText(language==='zh'?'订阅回答已导入':'Subscription answer imported');
  await expect(region).not.toContainText(language==='zh'?'应用尚未提交此问题':'The app has not submitted this question');
  await expect(page.locator('.composer textarea')).toHaveValue('');await expect(page.locator('.messages')).toContainText(pair[1].content);
  await page.reload();await expect(region).toContainText(language==='zh'?'订阅回答已导入':'Subscription answer imported');await expect(page.locator('.composer textarea')).toHaveValue('');
  expect(f.writes.filter(call=>call.path==='/chats/new')).toHaveLength(1);expect(modelWrites(f.writes)).toEqual([]);
});

test('polling recognizes the fixed imported task while preserving a newer same-session draft',async({page})=>{
  const f=await fixture(page);await composer(page).fill('The question handed to my agent.');await composer(page).press('Enter');const task=await visibleTask(page);
  await composer(page).fill('A new question that has not been handed off.');f.sessions.set('question-session-1',importedPair(task));
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(bridge(page)).toContainText('Subscription answer imported');await expect(composer(page)).toHaveValue('A new question that has not been handed off.');
  await page.reload();await reopenAssistant(page);await expect(bridge(page)).toContainText('Subscription answer imported');await expect(composer(page)).toHaveValue('A new question that has not been handed off.');
  expect(modelWrites(f.writes)).toEqual([]);
});

test('a matching late refresh completes only the old session and preserves the new session draft',async({page})=>{
  const f=await fixture(page);await composer(page).fill('First session question.');await composer(page).press('Enter');const task=await visibleTask(page),pair=importedPair(task);
  let delayed:Route|undefined;await page.route('**/api/chats?**',async route=>{if(new URL(route.request().url()).searchParams.get('conversationId')==='question-session-1'&&!delayed){delayed=route;return;}await route.fallback();});
  await bridge(page).getByRole('button',{name:'Refresh answer',exact:true}).click();await expect.poll(()=>!!delayed).toBe(true);
  await page.getByRole('button',{name:'Close assistant',exact:true}).click();
  const source=page.locator('.abstract-text p').first();await source.scrollIntoViewIfNeeded();const quote=await source.innerText();
  await source.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const selection=getSelection()!;selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
  const selection=page.getByRole('dialog',{name:'Selection actions',exact:true});await expect(selection).toBeVisible();await selection.getByLabel('Question about the overview selection',{exact:true}).fill('Untouched draft in my second session.');
  await selection.getByRole('button',{name:'Ask',exact:true}).click();await expect(composer(page)).toHaveValue('Untouched draft in my second session.');
  await expect(page.locator('.selected-passage')).toContainText(quote);
  f.sessions.set('question-session-1',pair);await delayed!.fulfill({json:{conversationId:'question-session-1',messages:pair}});
  await expect(composer(page)).toHaveValue('Untouched draft in my second session.');await expect(page.locator('.selected-passage')).toContainText(quote);await expect(bridge(page)).toHaveCount(0);await expect(page.locator('.message.assistant').filter({hasText:pair[1].content})).toHaveCount(0);
  await page.getByRole('button',{name:'Conversation history',exact:true}).click();await page.locator('.history-entry').filter({hasText:'Bound question question-session-1'}).click();
  await expect(bridge(page)).toContainText('Subscription answer imported');await expect(composer(page)).toHaveValue('');await expect(page.locator('.messages')).toContainText(pair[1].content);expect(modelWrites(f.writes)).toEqual([]);
});

test('task restoration is isolated by paper and session after reload',async({page})=>{
  const f=await fixture(page);await composer(page).fill('Task in the first session.');await composer(page).press('Enter');const first=await visibleTask(page);
  await page.getByRole('button',{name:'New conversation',exact:true}).click();await composer(page).fill('Task in the second session.');await composer(page).press('Enter');const second=await visibleTask(page);expect(second).not.toBe(first);
  await page.reload();await reopenAssistant(page);expect(await visibleTask(page)).toBe(second);
  const other={...f.paper,id:'question-other',title:'A different paper'};
  await page.route('**/api/papers/question-other',route=>route.fulfill({json:{paper:other}}));
  await page.route('**/api/chats?**',async route=>{if(new URL(route.request().url()).searchParams.get('paperId')===other.id){await route.fulfill({json:{conversationId:'other-session',messages:[]}});return;}await route.fallback();});
  await page.goto('/en/?paper=question-other');await reopenAssistant(page);await expect(bridge(page)).toHaveCount(0);await expect(composer(page)).toHaveValue('');
  await page.goto(`/en/?paper=${f.paper.id}`);await reopenAssistant(page);expect(await visibleTask(page)).toBe(second);
  await page.getByRole('button',{name:'Conversation history',exact:true}).click();await page.locator('.history-entry').filter({hasText:'Task in the first session.'}).click();await expect(composer(page)).toHaveValue('Task in the first session.');expect(await visibleTask(page)).toBe(first);
  await expect(composer(page)).toHaveValue('Task in the first session.');expect(f.writes.filter(call=>call.path==='/chats/new')).toHaveLength(2);expect(modelWrites(f.writes)).toEqual([]);
});

test('a dismissed task is not restored by its late refresh or a browser reload',async({page})=>{
  const f=await fixture(page);await composer(page).fill('Keep my draft when I dismiss the handoff.');await composer(page).press('Enter');const task=await visibleTask(page),pair=importedPair(task);
  let delayed:Route|undefined;await page.route('**/api/chats?**',async route=>{if(new URL(route.request().url()).searchParams.get('conversationId')==='question-session-1'&&!delayed){delayed=route;return;}await route.fallback();});
  await bridge(page).getByRole('button',{name:'Refresh answer',exact:true}).click();await expect.poll(()=>!!delayed).toBe(true);
  await bridge(page).getByRole('button',{name:'Close subscription question task',exact:true}).click();
  f.sessions.set('question-session-1',pair);await delayed!.fulfill({json:{conversationId:'question-session-1',messages:pair}});
  await expect(page.locator('.messages')).toContainText(pair[1].content);await expect(bridge(page)).toHaveCount(0);await expect(composer(page)).toHaveValue('Keep my draft when I dismiss the handoff.');
  await page.reload();await reopenAssistant(page);await expect(bridge(page)).toHaveCount(0);await expect(composer(page)).toHaveValue('Keep my draft when I dismiss the handoff.');expect(modelWrites(f.writes)).toEqual([]);
});

test('a blocked tab storage exposes an actionable warning without losing the visible task',async({page})=>{
  await page.addInitScript(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='pw-question-tasks-v1')throw new DOMException('Quota exceeded','QuotaExceededError');return set.call(this,key,value);};});
  const f=await fixture(page);await composer(page).fill('Allow manual copy even if storage is blocked.');await composer(page).press('Enter');const task=await visibleTask(page);expect(task).toContain('Allow manual copy');
  await expect(page.getByRole('alert').filter({hasText:'Subscription task changes could not be saved in this tab.'})).toBeVisible();await expect(composer(page)).toHaveValue('Allow manual copy even if storage is blocked.');expect(modelWrites(f.writes)).toEqual([]);
});

test('a restored selected passage completes after the import API normalizes only its outer whitespace',async({page})=>{
  const f=await fixture(page);await composer(page).fill('Establish this selected-source session.');await composer(page).press('Enter');await visibleTask(page);
  f.paper.abstract=f.paper.text='    code = evidence\n';
  await page.evaluate(()=>{
    const drafts=JSON.parse(sessionStorage.getItem('pw-chat-drafts-v1')||'{}'),key=JSON.stringify(['question-mode','question-session-1']);
    drafts[key]={text:'What does this selected code establish?',passage:{text:'    code = evidence\n',sourceScope:'abstract'},revision:Date.now()+1000,updatedAt:Date.now()};
    sessionStorage.setItem('pw-chat-drafts-v1',JSON.stringify(drafts));
  });
  await page.reload();await reopenAssistant(page);await expect(page.locator('.selected-passage')).toContainText('code = evidence');
  await composer(page).press('Enter');const task=await visibleTask(page),pair=importedPair(task);
  expect(pair[0].metadata.quote).toBe('    code = evidence\n');pair[0].metadata.quote=pair[0].metadata.quote.trim();
  f.sessions.set('question-session-1',pair);await bridge(page).getByRole('button',{name:'Refresh answer',exact:true}).click();
  await expect(bridge(page)).toContainText('Subscription answer imported');await expect(composer(page)).toHaveValue('');await expect(page.locator('.selected-passage')).toHaveCount(0);
  expect(f.writes.filter(call=>call.path==='/chats/new')).toHaveLength(1);expect(modelWrites(f.writes)).toEqual([]);
});
