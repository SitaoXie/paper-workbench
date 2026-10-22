import { test, expect, type Page, type Route } from '@playwright/test';

async function setup(page: Page, configured = true) {
  const paper={id:'action-paper',title:'Questions and evidence',authors:[],abstract:'A controlled study.',text:'Original evidence.',url:'https://example.org/paper',source:'web',tags:[],createdAt:'2026-10-22T00:00:00Z'};
  const first={id:'u1',role:'user',content:'What did the study measure?',questionText:'What did the study measure?'};
  const second={id:'u2',role:'user',content:'How strong is this evidence?\n\nSelected passage [p.4]:\n> The interval includes zero.',metadata:{page:4,quote:'The interval includes zero.'}};
  const original=[first,{id:'a1',role:'assistant',content:'It measured an observed difference.'},second,{id:'a2',role:'assistant',content:'The result has uncertainty. **Check the interval.**'},{id:'u3',role:'user',content:'A later unrelated question'},{id:'a3',role:'assistant',content:'A future answer that must not leak.'}];
  const sessions:Record<string,any[]>={original:structuredClone(original)};let active='original',count=0;
  const sent:any[]=[],branches:any[]=[];let delayed:Route|undefined;
  await page.route('**/api/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname.slice(4);let result:any={};
    if(path==='/settings')result={provider:'openai',model:'selected-model',modelConfigured:configured,apiKeyConfigured:configured,baseUrl:'https://example.org/v1'};
    else if(path==='/papers')result={papers:[paper]};
    else if(path==='/papers/action-paper')result={paper};
    else if(path==='/chats')result={conversationId:active,messages:sessions[active]};
    else if(path==='/conversations')result={conversations:Object.entries(sessions).map(([id,messages])=>({id,title:id==='original'?'Original conversation':`Branch ${id}`,messageCount:messages.length,source:id==='original'?undefined:{kind:'branch'}}))};
    else if(path==='/conversations/active'){active=request.postDataJSON().conversationId;result={conversationId:active,messages:sessions[active]};}
    else if(path.endsWith('/branch')){
      const body=request.postDataJSON(),source=path.split('/')[2],index=sessions[source].findIndex(m=>m.id===body.messageId),target=sessions[source][index];
      branches.push(body);active=`branch-${++count}`;sessions[active]=structuredClone(sessions[source].slice(0,index));
      result={conversationId:active,messages:sessions[active],draft:{message:target.questionText||target.content,metadata:target.metadata||null,verbatim:!target.questionText}};
    } else if(path==='/chat'){
      const body=request.postDataJSON();sent.push(body);const userMessage={id:`new-u${sent.length}`,role:'user',content:body.message,questionText:body.questionText,metadata:body.metadata||undefined};
      const message={id:`new-a${sent.length}`,role:'assistant',content:'Fresh answer from the selected model.'};sessions[body.conversationId].push(userMessage,message);
      result={conversationId:body.conversationId,userMessage,message};
    } else if(path.endsWith('/annotations'))result={annotations:[]};
    else if(path.endsWith('/activities'))result={activities:[]};
    await route.fulfill({json:result});
  });
  await page.goto('/en/?paper=action-paper');
  await page.getByRole('button',{name:'Open floating assistant',exact:true}).click();
  await expect(page.locator('.message.assistant').last()).toContainText('future answer');
  return {original,sessions,sent,branches};
}

test('answer copy is exact and an edited question creates a branch without future messages or losing the old draft',async({page,context})=>{
  const f=await setup(page);await context.grantPermissions(['clipboard-read','clipboard-write']);
  const answer=page.locator('.message.assistant').filter({hasText:'Check the interval.'});
  await answer.getByRole('button',{name:'Copy answer',exact:true}).click();
  const copied=await page.evaluate(()=>navigator.clipboard.readText());
  expect(copied).toContain('The result has uncertainty. **Check the interval.**');
  expect(copied).toContain('Source: <https://example.org/paper>');
  const composer=page.getByLabel('Ask the research assistant',{exact:true});await composer.fill('Keep the original unsent draft');
  await page.locator('.message.user').filter({hasText:'How strong is this evidence?'}).getByRole('button',{name:'Edit question in a new conversation',exact:true}).click();
  await expect(composer).toHaveValue(f.original[2].content);
  await expect(page.locator('.selected-passage')).toContainText('The interval includes zero.');
  await expect(page.locator('.conversation')).not.toContainText('future answer');
  await composer.fill(f.original[2].content.replace('How strong','How limited'));
  await page.reload();await expect(composer).toHaveValue(/How limited/);
  await page.getByRole('button',{name:'Send question',exact:true}).click();
  await expect(page.locator('.conversation')).toContainText('Fresh answer');
  expect(f.sent).toHaveLength(1);expect(f.sent[0].message.match(/The interval includes zero\./g)).toHaveLength(1);
  expect(f.sent[0].metadata).toEqual({page:4,quote:'The interval includes zero.'});expect(f.sent[0]).not.toHaveProperty('history');
  expect(f.sessions.original).toEqual(f.original);
  await page.getByRole('button',{name:'Conversation history',exact:true}).click();
  await expect(page.locator('.history-entry').filter({hasText:'Branch'})).toContainText('Branched conversation');
  await page.locator('.history-entry').filter({hasText:'Original conversation'}).click();
  await expect(composer).toHaveValue('Keep the original unsent draft');
  await expect(page.locator('.conversation')).toContainText('future answer');
});

test('answer again uses the current model in a new branch and the saved user is immediately editable',async({page})=>{
  const f=await setup(page);
  await page.locator('.message.assistant').filter({hasText:'observed difference'}).getByRole('button',{name:'Answer again in a new conversation',exact:true}).click();
  await expect(page.locator('.conversation')).toContainText('Fresh answer');
  expect(f.sent).toHaveLength(1);expect(f.sent[0].conversationId).toBe('branch-1');expect(f.sent[0].questionText).toBe(f.original[0].content);
  expect(f.sent[0].metadata).toBeNull();expect(f.sent[0]).not.toHaveProperty('history');expect(f.sessions.original).toEqual(f.original);
  await expect(page.locator('.message.user').getByRole('button',{name:'Edit question in a new conversation',exact:true})).toBeEnabled();
});

test('without an API, answer again prepares a separate draft for the subscription path without a hidden send',async({page})=>{
  const f=await setup(page,false);
  await page.locator('.message.assistant').filter({hasText:'observed difference'}).getByRole('button',{name:'Answer again in a new conversation',exact:true}).click();
  await expect(page.getByLabel('Ask the research assistant',{exact:true})).toHaveValue(f.original[0].content);
  expect(f.branches).toHaveLength(1);expect(f.sent).toHaveLength(0);
  await expect(page.getByLabel('Question processing mode',{exact:true})).toHaveValue('agent');
  await expect(page.getByRole('button',{name:'Prepare subscription task',exact:true})).toBeEnabled();
  expect(f.sessions.original).toEqual(f.original);
});
