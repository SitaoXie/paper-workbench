import { test, expect, type Page } from '@playwright/test';

async function fixture(page:Page){
  const renderer=await page.context().newPage();
  await renderer.setContent(`<style>body{font:18px Georgia;margin:40px}section{break-before:page}</style>${Array.from({length:6},(_,i)=>`<${i?'section':'div'}><h1>Resume page ${i+1}</h1>${'<p>The evidence preserves controlled assumptions and comparison groups.</p>'.repeat(10)}</${i?'section':'div'}>`).join('')}`);
  const pdf=await renderer.pdf({format:'A4'});await renderer.close();
  const reading=(id:string)=>Array.from({length:14},(_,i)=>`## ${id} 解读段落 ${i+1}\n\n${'比较受控实验的证据，关注方法的假设与泛化边界。'.repeat(16)}`).join('\n\n');
  const papers:any[]=['甲','乙'].map((label,i)=>({id:i?'resume-b':'resume-a',title:`继续阅读论文${label}`,authors:[],source:'pdf',createdAt:'2026-10-22T00:00:00Z',abstract:'Original English abstract that should be replaced by an available Chinese overview.',url:'https://example.org/paper',tags:[],pageCount:6,localPdfUrl:'/resume-source.pdf',activeReadingId:'version1',readingVersions:[{id:'version1',style:'deep',format:'article',language:'zh-CN',markdown:reading(label),mode:'agent',createdAt:'2026-10-22T00:00:00Z',translations:{en:{language:'en',markdown:'## English reading\n\nEnglish content must not inherit a Chinese paragraph location.'}}},{id:'version2',style:'quick',language:'zh-CN',markdown:'## 另一版本\n\n较短的内容不应该使用旧版本的位置。',mode:'agent',createdAt:'2026-10-21T00:00:00Z'}]}));
  await page.route('**/resume-source.pdf',route=>route.fulfill({contentType:'application/pdf',body:pdf}));
  await page.route('**/api/**',async route=>{
    if(new URL(route.request().url()).pathname==='/api/collections'){await route.fulfill({json:{collections:[]}});return;}
    const req=route.request(),path=new URL(req.url()).pathname.slice(4);let result:any={};
    if(path==='/settings')result={provider:'openai',baseUrl:'',model:'',modelConfigured:false,apiKeyConfigured:false};
    else if(path==='/papers')result={papers};
    else if(/^\/papers\/[^/]+$/.test(path)){
      const paper=papers.find(p=>p.id===path.split('/')[2]);
      if(req.method()==='PATCH')Object.assign(paper,req.postDataJSON());result={paper};
    }else if(path==='/chats')result={messages:[],conversationId:null};
    else if(path.endsWith('/annotations'))result={annotations:[]};
    else if(path.endsWith('/activities'))result={activities:[]};
    await route.fulfill({json:result});
  });
  return {papers};
}
async function library(page:Page){
  const menu=page.getByRole('button',{name:/^(展开导航|Open navigation)$/});
  const nav=page.getByRole('navigation');
  if(await menu.isVisible()&&!((await nav.getAttribute('class'))||'').includes('mobile-open'))await menu.click();
  await nav.getByRole('button',{name:/^(文库|Library)$/}).click();
}
async function openCard(page:Page,label:string){await page.locator('.collection-paper-open').filter({hasText:`继续阅读论文${label}`}).click();}
async function pdfPosition(page:Page){
  return page.getByLabel('连续滚动论文页面',{exact:true}).evaluate(element=>{
    const number=Number((document.querySelector('[aria-label="PDF 页码"]') as HTMLInputElement).value);
    const sheet=element.querySelector<HTMLElement>(`[data-pdf-page="${number}"]`)!;
    return {page:number,top:element.scrollTop,left:element.scrollLeft,fraction:(element.scrollTop-sheet.offsetTop)/sheet.offsetHeight};
  });
}
async function scrollOverview(page:Page,title:string){
  const heading=page.getByRole('heading',{name:title,exact:true});
  // A user input cancels delayed layout settling before the intentional scroll.
  await page.locator('.paper-summary').dispatchEvent('pointerdown');
  await heading.scrollIntoViewIfNeeded();
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(200);
  return heading.evaluate(element=>element.getBoundingClientRect().top);
}

test('library re-entry restores PDF page, zoom and within-page position while explicit page links take priority',async({page})=>{
  await fixture(page);await page.goto('/zh/?paper=resume-a');
  await page.getByRole('tab',{name:'论文',exact:true}).click();
  await page.getByLabel('PDF 页码',{exact:true}).fill('3');
  await page.getByLabel('PDF 页码',{exact:true}).press("Enter");
  await page.getByRole('button',{name:'放大 PDF',exact:true}).click();
  await expect(page.locator('[data-pdf-page="3"] canvas[data-rendered="true"]')).toBeVisible();
  const zoom=await page.getByLabel('PDF 缩放比例',{exact:true}).textContent();
  await page.getByLabel('连续滚动论文页面',{exact:true}).evaluate(element=>{element.scrollTop+=150;element.scrollLeft=60;element.dispatchEvent(new Event('scroll'));});
  await expect(page.getByLabel('PDF 页码',{exact:true})).toHaveValue('3');
  const before=await pdfPosition(page);
  await library(page);await openCard(page,'乙');await page.getByRole('tab',{name:'论文',exact:true}).click();
  await page.getByLabel('PDF 页码',{exact:true}).fill('2');
  await page.getByLabel('PDF 页码',{exact:true}).press("Enter");
  await library(page);await openCard(page,'甲');
  await expect(page.getByRole('tab',{name:'论文',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.getByLabel('PDF 缩放比例',{exact:true})).toHaveText(zoom!);
  await expect(page.getByLabel('PDF 页码',{exact:true})).toHaveValue('3');
  await expect.poll(async()=>(await pdfPosition(page)).fraction).toBeCloseTo(before.fraction,2);
  await expect.poll(async()=>(await pdfPosition(page)).left).toBeCloseTo(before.left,0);
  expect(new URL(page.url()).searchParams.get('paper')).toBe('resume-a');
  await page.reload();
  await expect(page.getByLabel('PDF 页码',{exact:true})).toHaveValue('3');
  await expect.poll(async()=>(await pdfPosition(page)).fraction).toBeCloseTo(before.fraction,2);
  await page.goto('/zh/?paper=resume-a&page=5');
  await expect(page.getByLabel('PDF 页码',{exact:true})).toHaveValue('5');
  await expect(page.getByLabel('PDF 缩放比例',{exact:true})).toHaveText(zoom!);
  await expect.poll(async()=>(await pdfPosition(page)).fraction).toBeCloseTo(0,2);
  await page.getByLabel('PDF 页码',{exact:true}).fill('4');
  await page.getByLabel('PDF 页码',{exact:true}).press("Enter");
  expect(new URL(page.url()).searchParams.get('paper')).toBe('resume-a');expect(new URL(page.url()).searchParams.get('page')).toBe('5');
});

test('overview positions are per paper and reset when version, language or source content differs',async({page})=>{
  const f=await fixture(page);await page.goto('/zh/?paper=resume-a');
  const topA=await scrollOverview(page,'甲 解读段落 7');
  await library(page);await openCard(page,'乙');
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBe(0);
  await scrollOverview(page,'乙 解读段落 4');
  await library(page);await openCard(page,'甲');
  const heading=page.getByRole('heading',{name:'甲 解读段落 7',exact:true});
  await expect.poll(()=>heading.evaluate(element=>element.getBoundingClientRect().top)).toBeCloseTo(topA,0);
  await page.reload();
  await expect.poll(()=>heading.evaluate(element=>element.getBoundingClientRect().top)).toBeCloseTo(topA,0);
  // A new language uses a distinct content context; no model is configured or requested.
  await page.getByLabel('阅读语言',{exact:true}).selectOption('en');
  await expect(page.getByRole('heading',{name:'English reading',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBe(0);
  await page.getByLabel('Reading version',{exact:true}).selectOption('version2');
  await expect(page.getByRole('heading',{name:'另一版本',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBe(0);
  await page.getByLabel('Reading version',{exact:true}).selectOption('version1');
  await page.getByLabel('Reading language',{exact:true}).selectOption('zh-CN');
  await scrollOverview(page,'甲 解读段落 9');
  await library(page);
  f.papers[0].readingVersions[0].markdown='## 同版本内容已更新\n\n新内容不会套用旧段落偏移。';
  await openCard(page,'甲');
  await expect(page.getByRole('heading',{name:'同版本内容已更新',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBe(0);
});

test('opening a library paper uses cached Chinese and English overviews without generation',async({page})=>{
  await fixture(page);await page.goto('/zh/');await library(page);
  await page.locator('.collection-paper-open').filter({hasText:'继续阅读论文甲'}).click();
  await expect(page.locator('.reading-prose')).toContainText('比较受控实验的证据');
  await expect(page.locator('.reading-prose')).not.toContainText('Original English abstract');
  await page.getByLabel('阅读语言',{exact:true}).selectOption('en');
  await expect(page.locator('.reading-prose')).toContainText('English content must not inherit');
  await expect(page.getByLabel('Reading language',{exact:true})).toHaveValue('en');
});

test('consecutive source detours retain the newest overview position after scrolling again',async({page})=>{
  const f=await fixture(page);
  const figure={id:'resume-figure',page:2,caption:'Controlled evidence in the source PDF.',crop:{x:.05,y:.1,width:.8,height:.3}};
  f.papers[0].figures=[figure];f.papers[0].readingVersions[0].figures=[figure];
  f.papers[0].readingVersions[0].markdown=f.papers[0].readingVersions[0].markdown.replace('## 甲 解读段落 3',':::figure resume-figure\n\n## 甲 解读段落 3');
  await page.goto('/zh/?paper=resume-a');
  const source=page.getByRole('button',{name:'在论文中查看第 2 页图表',exact:true});
  await page.locator('.paper-summary').dispatchEvent('pointerdown');
  await source.scrollIntoViewIfNeeded();
  await expect(page.locator('.reading-prose canvas[data-rendered="true"]')).toBeVisible();
  const first=await page.evaluate(()=>window.scrollY);
  await source.click();
  await page.getByRole('button',{name:'返回摘要阅读位置',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeCloseTo(first,0);
  const bounds=(await source.boundingBox())!;
  // Keep the button below the sticky toolbar. Coordinates avoid a locator's
  // implicit scroll-into-view changing the position we intend to preserve.
  await page.mouse.move(Math.min(600,page.viewportSize()!.width/2),Math.min(600,page.viewportSize()!.height/2));
  const delta=Math.max(40,Math.min(100,bounds.y-150));
  await page.mouse.wheel(0,delta);
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(first+30);
  const second=await page.evaluate(()=>window.scrollY);
  const secondBounds=(await source.boundingBox())!;
  await page.mouse.click(secondBounds.x+secondBounds.width/2,secondBounds.y+secondBounds.height/2);
  await page.getByRole('button',{name:'返回摘要阅读位置',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeCloseTo(second,0);
  await expect.poll(()=>source.evaluate(element=>element.getBoundingClientRect().top)).toBeCloseTo(secondBounds.y,0);
  // Also cover a jump during layout settling without a preceding pointer event.
  await page.evaluate(()=>window.scrollBy({top:35,behavior:'instant'}));
  const third=await page.evaluate(()=>window.scrollY);
  await source.dispatchEvent('click');
  await page.getByRole('tab',{name:'摘要',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeCloseTo(third,0);
});
