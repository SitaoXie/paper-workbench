import {test,expect,type Page} from '@playwright/test';

const fixedLimitations=[
 'Pixels were submitted to the explicitly configured vision model; model conclusions are not independently verified.',
 'The client supplied the PDF crop pixels. The server validated the source reference, image type and dimensions, not pixel-level correspondence to the PDF.',
 'A crop may omit labels, legends or context. Do not infer unreadable values or treat a model description as a verified measurement.',
];
const originalLimitation='The green trace may be occluded. Confirm with the source.';
const longFigureId='12345678-1234-4234-8234-123456789abc';

async function fixture(page:Page,options:{locale?:'en'|'zh';readability?:boolean}={}) {
  const renderer=await page.context().newPage();
  await renderer.setContent('<h1>Source figure</h1><svg width="400" height="220"><rect x="20" y="30" width="100" height="150" fill="#914158"/></svg><p>Figure 1. Original source caption.</p>');
  const pdf=await renderer.pdf({format:'A4'});await renderer.close();
  const figure={id:options.readability?longFigureId:'figure-1',page:1,caption:'Figure 1. Original source caption.',crop:{x:.01,y:.01,width:.7,height:.35}};
  const base:any={figureId:figure.id,page:1,crop:figure.crop,caption:figure.caption,markdown:'Model observation needs source comparison.',language:'en',imageHash:'1234567890abcdef1234567890abcdef',mimeType:'image/png',width:900,height:500,createdAt:'2026-10-22T00:00:00Z',source:{kind:'model',model:'vision-test',profileId:'vision-profile'},pixelsProvided:true,analysisMethod:'vision-model',modelUnverified:true,binding:'client-rendered-pdf-crop',limitations:options.readability?[...fixedLimitations,originalLimitation,fixedLimitations[0]+' Extra model note.']:[]};
  // Equal timestamps deliberately exercise append order, not unstable date sorting.
  const old={...base,id:'historical',excluded:false};
  const pending={...base,id:'pending',excluded:true};
  const stale={...base,id:'stale',figureId:'figure-2',caption:options.readability?'Unnumbered original source crop.':base.caption,excluded:true,stale:true,sourceRevisionChanged:true};
  const figures=options.readability?[figure,{...figure,id:'explicit-label',label:'Reviewed architecture',caption:'Figure 9. Later source caption.'},{...figure,id:'unnumbered',caption:'A source plot without a number.'}]:[figure];
  const paper:any={id:'vision-review',title:'Visual observation review',authors:[],source:'pdf',createdAt:base.createdAt,abstract:'Source figures remain separate from model observations.',text:'Original source text.',tags:[],pageCount:1,localPdfUrl:'/vision-review.pdf',figures,visualEvidence:[old,pending,stale]};
  const profile={id:'vision-profile',name:'Vision fixture',provider:'openai',baseUrl:'https://example.org/v1',model:'vision-test',models:['vision-test'],modelCapabilities:{'vision-test':'vision'},apiKeyConfigured:true,modelConfigured:true};
  const writes:any[]=[];let finish:undefined|(()=>Promise<void>);
  await page.route('**/vision-review.pdf',route=>route.fulfill({contentType:'application/pdf',body:pdf}));
  await page.route('**/api/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname.slice(4);let response:any={};
    if(req.method()!=='GET')writes.push({path,method:req.method(),body:req.postDataJSON()});
    if(path==='/settings')response={...profile,profiles:[profile],activeProfileId:profile.id,vision:{enabled:true,profileId:profile.id,model:'vision-test'}};
    else if(path==='/papers')response={papers:[paper]};
    else if(path===`/papers/${paper.id}`)response={paper};
    else if(path==='/chats')response={messages:[],conversationId:null};
    else if(path.endsWith('/annotations'))response={annotations:[]};
    else if(path.endsWith('/analyze')){
      finish=async()=>{const evidence={...base,id:'new-analysis',excluded:true,markdown:'Fresh analysis, still unverified.'};paper.visualEvidence.push(evidence);await route.fulfill({json:{evidence,paper}});};return;
    } else if(path.includes('/visual-evidence/')){paper.visualEvidence.find((item:any)=>item.id===path.split('/').at(-1)).excluded=req.postDataJSON().excluded;response={paper};}
    await route.fulfill({json:response});
  });
  await page.goto(`/${options.locale||'en'}/?paper=`+paper.id);
  const tools=page.locator('.vision-tools');await tools.locator(':scope > summary').click();
  return {tools,writes,paper,finish:async()=>{await expect.poll(()=>!!finish).toBe(true);await finish!();}};
}

test('only the latest source-matching observation can be included; comparison makes no model call',async({page})=>{
 const {tools,writes}=await fixture(page);
 const old=tools.locator('[data-evidence-id="historical"]');await old.locator(':scope > summary').click();
 await expect(old.locator('.vision-use-badge')).toHaveText('Historical');await expect(old.locator('.vision-use-status')).toContainText('A newer analysis exists.');await expect(old.getByRole('button',{name:/future readings/})).toHaveCount(0);
 const stale=tools.locator('[data-evidence-id="stale"]');await stale.locator(':scope > summary').click();await expect(stale.getByRole('button',{name:/future readings/})).toHaveCount(0);await expect(stale.locator('.vision-source-comparison')).toHaveCount(0);
 const pending=tools.locator('[data-evidence-id="pending"]');await pending.locator(':scope > summary').click();await expect(pending.locator('.vision-use-badge')).toHaveText('Not included');
 await pending.locator('.vision-source-comparison > summary').click();await expect(pending.locator('.pdf-source-figure')).toBeVisible();await expect(pending.locator('figcaption')).toContainText('Original source caption.');
 expect(writes).toEqual([]);
 await pending.getByRole('button',{name:'Use in future readings',exact:true}).click();await expect(pending.locator('.vision-use-badge')).toHaveText('Included · Unverified');await expect(pending.locator('.vision-use-status')).toContainText('still unverified');
 await pending.getByRole('button',{name:'Exclude from future readings',exact:true}).click();await expect(pending.locator('.vision-use-badge')).toHaveText('Not included');
 expect(writes.map(write=>({method:write.method,body:write.body}))).toEqual([{method:'PATCH',body:{excluded:false}},{method:'PATCH',body:{excluded:true}}]);
});

test('completed analysis is revealed without reopening a panel closed during the request',async({page})=>{
 const {tools,writes,finish}=await fixture(page);
 await tools.getByRole('button',{name:'Analyze this figure',exact:true}).click();await expect.poll(()=>writes.length).toBe(1);
 await tools.locator(':scope > summary').click();await expect(tools).not.toHaveAttribute('open','');
 await finish();await expect(tools.locator('[data-evidence-id="new-analysis"]')).toBeAttached();await expect(tools).not.toHaveAttribute('open','');
 await tools.locator(':scope > summary').click();const result=tools.locator('[data-evidence-id="new-analysis"]');await expect(result).toHaveAttribute('open','');await expect(result.locator('.vision-markdown')).toBeInViewport();await expect(result.locator('.vision-use-badge')).toHaveText('Not included');
 await expect(result.getByRole('button',{name:'Use in future readings',exact:true})).toBeVisible();
 expect(writes).toHaveLength(1);expect(writes[0].path).toMatch(/\/analyze$/);
});

for(const locale of ['zh','en'] as const)test(`${locale}: source labels and append sequence identify observations; only known system limitations are localized`,async({page})=>{
 const {tools,writes,paper}=await fixture(page,{locale,readability:true});
 const before=JSON.stringify(paper.visualEvidence),zh=locale==='zh';
 await expect(tools.locator('.vision-request select option')).toHaveText([`${zh?'图':'Figure'} 1 · p.1`,'Reviewed architecture · p.1',`${zh?'图表':'Source figure'} · p.1`]);
 const pending=tools.locator('[data-evidence-id="pending"]'),old=tools.locator('[data-evidence-id="historical"]'),stale=tools.locator('[data-evidence-id="stale"]');
 await expect(pending.locator(':scope > summary')).toContainText(`${zh?'图':'Figure'} 1 · p.1`);
 await expect(pending.locator(':scope > summary')).not.toContainText(longFigureId);
 await expect(stale.locator(':scope > summary')).toContainText(`${zh?'图表':'Source figure'} · p.1`);
 await expect(pending.locator('.vision-result-time')).toContainText(`${zh?'记录':'Record'} 2`);
 await expect(old.locator('.vision-result-time')).toContainText(`${zh?'记录':'Record'} 1`);
 await expect(pending.locator('time')).toHaveAttribute('datetime','2026-10-22T00:00:00Z');
 await expect(pending.locator('time')).toContainText(/\d{2}:\d{2}:\d{2}/);
 await pending.locator(':scope > summary').click();await pending.locator('.vision-limitations > summary').click();
 await expect(pending.locator('.vision-source-id')).toContainText(longFigureId);
 const limits=pending.locator('.vision-limitations li');await expect(limits).toHaveCount(5);
 if(zh){
  await expect(limits.nth(0)).toContainText('模型结论未经独立核验');
  await expect(limits.nth(1)).toContainText('但未逐像素核验它与 PDF 是否一致');
  await expect(limits.nth(2)).toContainText('不要推测无法读清的数值');
 }else for(let i=0;i<fixedLimitations.length;i++)await expect(limits.nth(i)).toHaveText(fixedLimitations[i]);
 await expect(limits.nth(3)).toHaveText(`${zh?'原文说明：':'Original note: '}${originalLimitation}`);
 await expect(limits.nth(4)).toHaveText(`${zh?'原文说明：':'Original note: '}${fixedLimitations[0]} Extra model note.`);
 await expect(pending.locator('.vision-markdown')).toHaveText('Model observation needs source comparison.');
 expect(JSON.stringify(paper.visualEvidence)).toBe(before);expect(writes).toEqual([]);
});
