import { test, expect, type Page, type Route } from '@playwright/test';

async function setup(page: Page) {
  const renderer = await page.context().newPage();
  await renderer.setContent(`<style>section{break-before:page}body{font:18px Georgia;margin:48px}</style>${Array.from({length:6},(_,i)=>`<${i?'section':'div'}><h1>Evidence page ${i+1}</h1><p>Selected evidence on page ${i+1} explains the controlled baseline.</p></${i?'section':'div'}>`).join('')}`);
  const pdf = await renderer.pdf({format:'A4'}); await renderer.close();
  const papers = ['alpha','beta'].map(id=>({id,title:`Draft paper ${id}`,authors:[],source:'pdf',createdAt:'2026-10-22T00:00:00Z',abstract:'Evidence for reading.',text:'A controlled experiment.',tags:[],url:`https://example.org/${id}`,pageCount:6,localPdfUrl:'/draft-source.pdf'}));
  // Deliberately reuse a conversation ID across papers: draft keys must include both.
  const conversations:Record<string, any[]> = Object.fromEntries(papers.map(p=>[p.id,[{id:'existing',title:`Established ${p.id} conversation`,messages:[{role:'user',content:`Earlier ${p.id} question`},{role:'assistant',content:`Earlier ${p.id} answer`}]}]]));
  const active:Record<string,string> = {alpha:'existing',beta:'existing'};
  const chats:{route:Route;body:any}[] = [];
  let newSession = 0;
  await page.route('**/draft-source.pdf', route=>route.fulfill({body:pdf,contentType:'application/pdf'}));
  await page.route('**/api/**', async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname.slice(4); let result:any={};
    const paperId=url.searchParams.get('paperId')||'alpha';
    if(path==='/chat'){chats.push({route,body:req.postDataJSON()});return;}
    if(path==='/settings')result={provider:'openai',baseUrl:'https://example.org/v1',model:'draft-model',modelConfigured:true,apiKeyConfigured:true};
    else if(path==='/papers')result={papers};
    else if(/^\/papers\/[^/]+$/.test(path))result={paper:papers.find(p=>p.id===path.split('/')[2])};
    else if(path==='/chats'){
      const id=url.searchParams.get('conversationId')||active[paperId];
      result={messages:conversations[paperId]?.find(c=>c.id===id)?.messages||[],conversationId:id};
    } else if(path==='/chats/new'){
      const body=req.postDataJSON(), id=`created-${++newSession}`,p=body.paperId||'alpha';
      conversations[p].push({id,title:'New question',messages:[]});active[p]=id;result={conversationId:id,messages:[]};
    } else if(path==='/conversations')result={conversations:(conversations[paperId]||[]).map(c=>({...c,messageCount:c.messages.length}))};
    else if(path==='/conversations/active'){
      const body=req.postDataJSON(),p=body.paperId||'alpha';active[p]=body.conversationId;
      result={messages:conversations[p].find(c=>c.id===body.conversationId)?.messages||[],conversationId:body.conversationId};
    } else if(path.endsWith('/annotations'))result={annotations:[]};
    else if(path.endsWith('/activities'))result={activities:[]};
    await route.fulfill({json:result});
  });
  async function reply(index:number, status=200) {
    const call=chats[index],body=call.body;
    if(status!==200){await call.route.fulfill({status,json:{error:'Temporary model failure; retry is safe.'}});return;}
    const response={role:'assistant',content:`Answer to ${body.message}`};
    const c=conversations[body.paperId].find(c=>c.id===body.conversationId);
    c.messages.push({role:'user',content:body.message,...(body.metadata?{metadata:body.metadata}:{})},response);
    await call.route.fulfill({json:{message:response,conversationId:body.conversationId}});
  }
  return {papers,chats,reply,conversations};
}
const composer=(page:Page)=>page.getByLabel('向研究助手提问',{exact:true});
async function assistant(page:Page){
  const open=page.getByRole('button',{name:'打开悬浮助手',exact:true});
  await expect(open.or(composer(page))).toBeVisible();
  if(await open.isVisible())await open.click();
  await expect(composer(page)).toBeEnabled();
}
async function closeAssistant(page:Page){
  const close=page.getByRole('button',{name:'关闭助手',exact:true});
  if(await close.isVisible())await close.click();
}
async function library(page:Page){
  await closeAssistant(page);
  const menu=page.getByRole('button',{name:'展开导航',exact:true});
  const nav=page.getByRole('navigation');
  if(await menu.isVisible()&&!((await nav.getAttribute('class'))||'').includes('mobile-open'))await menu.click();
  await nav.getByRole('button',{name:'文库',exact:true}).click();
}
async function switchPaper(page:Page,id:string){
  await library(page);
  await page.locator('.paper-card-main').filter({hasText:`Draft paper ${id}`}).click();
  await assistant(page);
}
async function chooseHistory(page:Page,title:string){
  await page.getByRole('button',{name:'对话历史',exact:true}).click();
  await page.locator('.history-entry').filter({hasText:title}).click();
}
async function selectPdfQuote(page:Page,pageNumber:number,question:string){
  await closeAssistant(page);
  await page.getByRole('tab',{name:'论文',exact:true}).click();
  await page.getByLabel('PDF 页码',{exact:true}).fill(String(pageNumber));
  await page.getByLabel('PDF 页码',{exact:true}).press("Enter");
  const span=page.locator(`[data-pdf-page="${pageNumber}"] .pdf-text-layer span`).filter({hasText:`Selected evidence on page ${pageNumber}`}).first();
  const menu=page.getByRole('dialog',{name:'选中文字操作',exact:true});
  await expect(async()=>{
    await span.scrollIntoViewIfNeeded();
    await span.evaluate(element=>{
      element.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch'}));
      const range=document.createRange();range.selectNodeContents(element);
      const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      element.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'touch'}));
    });
    await expect(menu).toBeVisible({timeout:1000});
  }).toPass({timeout:8000});
  await menu.getByLabel('针对选中文字的问题',{exact:true}).fill(question);
  await menu.getByRole('button',{name:'询问助手',exact:true}).click();
  await expect(composer(page)).toHaveValue(question);
}

test('unsent text and selected PDF passage survive new selection sessions, history and reload',async({page})=>{
  await setup(page);await page.goto('/zh/?paper=alpha');await assistant(page);
  await composer(page).fill('Unsent established session draft');
  await selectPdfQuote(page,2,'Compare this selected evidence');
  await expect(page.locator('.selected-passage blockquote')).toContainText('Selected evidence on page 2');
  await chooseHistory(page,'Established alpha conversation');
  await expect(composer(page)).toHaveValue('Unsent established session draft');
  await expect(page.locator('.selected-passage')).toHaveCount(0);
  await page.getByRole('button',{name:'对话历史',exact:true}).click();
  const unsent=page.locator('.history-entry').filter({hasText:'Compare this selected evidence'});
  await expect(unsent).toContainText('草稿');await unsent.click();
  await expect(composer(page)).toHaveValue('Compare this selected evidence');
  await expect(page.locator('.selected-passage blockquote')).toContainText('Selected evidence on page 2');
  await page.getByRole('button',{name:'新对话',exact:true}).click();
  await expect(composer(page)).toHaveValue('');await expect(page.locator('.selected-passage')).toHaveCount(0);
  await chooseHistory(page,'Compare this selected evidence');
  await page.reload();await assistant(page);
  await expect(composer(page)).toHaveValue('Compare this selected evidence');
  await expect(page.locator('.selected-passage blockquote')).toContainText('Selected evidence on page 2');
  await expect(page.locator('.selected-passage .citation-link')).toContainText('p.2');
});

test('drafts are isolated by paper and an old successful response cannot clear another paper input',async({page})=>{
  const f=await setup(page);await page.goto('/zh/?paper=alpha');await assistant(page);
  await composer(page).fill('Alpha submitted question');
  await page.getByRole('button',{name:'发送问题',exact:true}).click();await expect.poll(()=>f.chats.length).toBe(1);
  await switchPaper(page,'beta');await expect(composer(page)).toHaveValue('');
  await composer(page).fill('Beta untouched draft');
  await f.reply(0);
  await expect(composer(page)).toHaveValue('Beta untouched draft');
  await expect(page.locator('.conversation')).not.toContainText('Answer to Alpha');
  await switchPaper(page,'alpha');await expect(composer(page)).toHaveValue('');
  await expect(page.locator('.conversation')).toContainText('Answer to Alpha submitted question');
  await composer(page).fill('Alpha separate draft');
  await switchPaper(page,'beta');await expect(composer(page)).toHaveValue('Beta untouched draft');
  await page.reload();await assistant(page);await expect(composer(page)).toHaveValue('Beta untouched draft');
  await switchPaper(page,'alpha');await expect(composer(page)).toHaveValue('Alpha separate draft');
});

test('failed sends preserve retryable drafts and successful older sends preserve newer edits',async({page})=>{
  const f=await setup(page);await page.goto('/zh/?paper=alpha');await assistant(page);
  await composer(page).fill('Retry this question');
  await page.getByRole('button',{name:'发送问题',exact:true}).click();await expect.poll(()=>f.chats.length).toBe(1);
  await f.reply(0,502);await expect(composer(page)).toHaveValue('Retry this question');
  await expect(page.getByRole('button',{name:'发送问题',exact:true})).toBeEnabled();
  await expect(page.locator('.conversation')).not.toContainText('Retry this question');
  await page.getByRole('button',{name:'发送问题',exact:true}).click();await expect.poll(()=>f.chats.length).toBe(2);
  await composer(page).fill('A newer question typed while waiting');
  await f.reply(1);
  await expect(page.locator('.conversation')).toContainText('Answer to Retry this question');
  await expect(composer(page)).toHaveValue('A newer question typed while waiting');
  expect(f.chats.map(c=>c.body.message)).toEqual(['Retry this question','Retry this question']);
  // An old failure on another paper also must not restore its text over this draft.
  await page.getByRole('button',{name:'发送问题',exact:true}).click();await expect.poll(()=>f.chats.length).toBe(3);
  await switchPaper(page,'beta');await composer(page).fill('Beta stays independent');await f.reply(2,502);
  await expect(composer(page)).toHaveValue('Beta stays independent');
  await expect(page.getByText('Temporary model failure; retry is safe.',{exact:true})).toHaveCount(0);
  await switchPaper(page,'alpha');await expect(composer(page)).toHaveValue('A newer question typed while waiting');
});

test('initial page deep link survives StrictMode and a late initial load cannot override later navigation',async({page})=>{
  const f=await setup(page);await page.goto('/zh/?paper=alpha&page=5');
  await expect(page.getByRole('tab',{name:'论文',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.getByLabel('PDF 页码',{exact:true})).toHaveValue('5');
  await expect(page.locator('[data-pdf-page="5"] canvas[data-rendered="true"]')).toBeVisible();
  await expect(page).toHaveURL(/paper=alpha&page=5/);
  let release:Route|undefined;
  await page.route('**/api/papers/alpha',route=>{release=route;});
  await page.goto('/zh/?paper=alpha&page=5');await expect.poll(()=>!!release).toBe(true);
  await library(page);
  await page.locator('.paper-card-main').filter({hasText:'Draft paper beta'}).click();
  await expect(page.getByRole('heading',{name:'Draft paper beta',exact:true})).toBeVisible();
  await release!.fulfill({json:{paper:f.papers[0]}});
  await expect(page).toHaveURL(/paper=beta$/);
  await expect(page.getByRole('heading',{name:'Draft paper beta',exact:true})).toBeVisible();
  await expect(page.getByRole('tab',{name:'摘要',exact:true})).toHaveAttribute('aria-selected','true');
});

test('PDF selection questions send structured page evidence and preserve its source link in history',async({page})=>{
  const f=await setup(page);await page.goto('/zh/?paper=alpha');await selectPdfQuote(page,5,'What is the evidence on this page?');
  await page.getByRole('button',{name:'发送问题',exact:true}).click();await expect.poll(()=>f.chats.length).toBe(1);
  expect(f.chats[0].body.metadata).toEqual({page:5,pages:[5],sourceScope:'pdf',quote:expect.stringContaining('Selected evidence on page 5')});
  await f.reply(0);await expect(page.locator('.message.user').getByRole('button',{name:'提问选文 · p.5',exact:true})).toBeVisible();
  await page.reload();await assistant(page);
  await expect(page.locator('.message.user').getByRole('button',{name:'提问选文 · p.5',exact:true})).toBeVisible();
  // The question context remains identifiable even when the model gives no citation.
  await page.locator('.message.user').getByRole('button',{name:'提问选文 · p.5',exact:true}).click();
  const close=page.getByRole('button',{name:'返回论文',exact:true});if(await close.isVisible())await close.click();
  await expect(page.getByLabel('PDF 页码',{exact:true})).toHaveValue('5');
  await expect(page.locator('.pdf-citation-status')).toContainText('已定位原文');
});

test('removing a selected passage explicitly prevents hidden conversation-context inheritance after reload',async({page})=>{
  const f=await setup(page);await page.goto('/zh/?paper=alpha');await selectPdfQuote(page,2,'Use the whole paper instead');
  await page.getByRole('button',{name:'移除选中原文',exact:true}).click();await page.reload();await assistant(page);
  await expect(page.locator('.selected-passage')).toHaveCount(0);await page.getByRole('button',{name:'发送问题',exact:true}).click();
  await expect.poll(()=>f.chats.length).toBe(1);expect(f.chats[0].body.metadata).toBeNull();await f.reply(0);
  await composer(page).fill('Continue without the removed selection');await page.getByRole('button',{name:'发送问题',exact:true}).click();
  await expect.poll(()=>f.chats.length).toBe(2);expect(f.chats[1].body.metadata).toBeNull();await f.reply(1);
});
