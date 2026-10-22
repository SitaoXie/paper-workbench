import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

test('interactive reading exports the selected translated version with offline crops and safe keyboard interaction', async ({ page, context }, testInfo) => {
  const source = await context.newPage();
  await source.setContent('<h1>Source evidence</h1><p>Replication is necessary.</p><section style="break-before:page"><h2>Figure 1</h2><svg width="400" height="200"><rect x="20" y="60" width="100" height="130" fill="#944359"/><rect x="170" y="25" width="100" height="165" fill="#617fa8"/></svg></section>');
  const pdf = await source.pdf({ format: 'A4' });
  await source.close();
  const figures = [{ id: 'source-figure', page: 2, caption: 'Measured outcomes', crop: { x: .01, y: .01, width: .7, height: .3 } }];
  const blocks = [
    { id: 'concept', type: 'concept', title: 'Evidence in this version', text: 'A measured effect needs replication. <img src="https://attack.invalid/x" onerror="window.__injected=true"> remains inert text.', citations: [{ page: 1 }] },
    { id: 'figure', type: 'figure', figureId: 'source-figure', explanation: 'Two measured groups, within the stated conditions.', citations: [{ page: 2 }] },
    { id: 'question', type: 'question', question: 'Does this prove universal generalization?', answer: 'No. Independent replication is still needed.', explanation: '</details><script>window.__injected=true</script>', citations: [{ page: 2 }] },
  ];
  const latest: any = { derivedFromReadingId:'original-article',articleSource:{kind:'agent',agent:'Original reading agent'},source:{kind:'agent',agent:'Interactive companion agent'}, id: 'interactive-latest', style: 'deep', format: 'interactive', language: 'zh-CN', markdown: '## 原始解读\n原文版本保留。', mode: 'agent', createdAt: '2026-10-22T08:00:00Z', figures, interactive: { schemaVersion: 1, blocks: [{ ...blocks[0], title: '原始概念', text: '原始中文概念。' }] }, translations: { en: { language: 'en', markdown: '## Complete translated reading\nThis is the cached English text for the selected version.', interactive: { schemaVersion: 1, blocks } } } };
  const older = { id: 'interactive-older', style: 'quick', format: 'interactive', language: 'en', markdown: '## Prior complete reading\nThis is the earlier version.', mode: 'agent', createdAt: '2026-10-21T08:00:00Z', figures: [], interactive: { schemaVersion: 1, blocks: [{ ...blocks[0], id: 'prior-concept', title: 'Prior version concept', text: 'Earlier evidence remains available.' }] } };
  const paper: any = { id: 'interactive-fixture', title: 'Offline evidence </title><script>window.__injected=true</script>', authors: [], source: 'pdf', createdAt: latest.createdAt, abstract: 'Evidence requires replication.', text: 'Evidence requires replication.', tags: [], pageCount: 2, url: 'https://papers.example.org/paper?token=secret-export-token&q=evidence', localPdfUrl: '/interactive-source.pdf', figures, readingVersions: [latest, older], activeReadingId: latest.id, apiKey: 'fake-private-api-key', localPath: '/Users/private-user/papers' };
  const writes: string[] = [];
  await page.route('**/interactive-source.pdf', route => route.fulfill({ contentType: 'application/pdf', body: pdf }));
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname.slice(4);
    let response: any = {};
    if (req.method() !== 'GET') writes.push(path);
    if (path === '/settings') response = { provider: 'openai', baseUrl: 'https://example.org/v1', model: 'test', apiKeyConfigured: false, modelConfigured: false };
    else if (path === '/papers') response = { papers: [paper] };
    else if (path === `/papers/${paper.id}`) { if (req.method() === 'PATCH') Object.assign(paper, req.postDataJSON()); response = { paper }; }
    else if (path === '/chats') response = { messages: [], conversationId: null };
    else if (path.endsWith('/annotations')) response = { annotations: [] };
    else if (path.endsWith('/activities')) response = { activities: [] };
    await route.fulfill({ json: response });
  });
  await page.goto('/en/?paper=' + paper.id);
  const interactive = page.getByTestId('interactive-reading');
  await expect(interactive).toContainText('Evidence in this version');
  await expect(interactive).not.toContainText('原始概念');
  const summary = interactive.locator('.interactive-question summary');
  const answer = interactive.getByText('No. Independent replication is still needed.', { exact: true });
  await expect(answer).toBeHidden();
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(answer).toBeVisible();
  await page.keyboard.press('Space');
  await expect(answer).toBeHidden();
  await expect(page.getByLabel('Reading version', { exact: true })).toHaveValue(latest.id);
  await page.getByLabel('Version details',{exact:true}).click();
  const attribution=page.locator('.reading-version-detail-body');
  await expect(attribution).toContainText('Original article');await expect(attribution).toContainText('Original reading agent');
  await expect(attribution).toContainText('Interactive companion');await expect(attribution).toContainText('Interactive companion agent');
  await page.getByLabel('Version details',{exact:true}).press('Escape');
  const latestDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download offline website', exact: true }).click();
  const latestDownload = await latestDownloadPromise;
  const savedPath = testInfo.outputPath('interactive-current-en.html');
  await latestDownload.saveAs(savedPath);
  const html = await readFile(savedPath, 'utf8');
  expect(html).toContain('cached English text for the selected version');
  expect(html).toContain('Evidence in this version');
  expect(html).toContain('Reading version: interactive-latest');
  expect(html).toContain('Original article: Original reading agent');expect(html).toContain('Interactive companion: Interactive companion agent');
  expect(html).not.toContain('原始中文概念');
  expect(html).not.toContain('Prior version concept');
  expect(html).toContain('data:image/png;base64,');
  expect(html).not.toMatch(/<script\b/i);
  for (const privateValue of ['secret-export-token', 'fake-private-api-key', '/Users/private-user']) expect(html).not.toContain(privateValue);
  await page.getByRole('group',{name:'View format',exact:true}).getByRole('button',{name:'Article',exact:true}).click();
  const articleDownloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Download offline website',exact:true}).click();
  const articleHtml=await readFile((await(await articleDownloadPromise).path())!,'utf8');
  expect(articleHtml).toContain('Original article: Original reading agent');expect(articleHtml).toContain('Interactive companion: Interactive companion agent');
  expect(articleHtml).toContain('cached English text for the selected version');
  await page.getByLabel('Reading version', { exact: true }).selectOption(older.id);
  await expect(interactive).toContainText('Prior version concept');
  const priorDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download offline website', exact: true }).click();
  const priorDownload = await priorDownloadPromise;
  const priorHtml = await readFile((await priorDownload.path())!, 'utf8');
  expect(priorHtml).toContain('Reading version: interactive-older');
  expect(priorHtml).toContain('Prior complete reading');
  expect(priorHtml).not.toContain('cached English text');
  expect(writes.some(path => path.endsWith('/translate') || path === '/chat')).toBeFalsy();

  await context.setOffline(true);
  const offline = await context.newPage();
  const external: string[] = [];
  offline.on('request', req => { if (/^https?:/.test(req.url())) external.push(req.url()); });
  await offline.goto(pathToFileURL(savedPath).href);
  expect(await offline.evaluate(() => (window as any).__injected)).toBeUndefined();
  await expect(offline.locator('img')).toHaveCount(1);
  expect(await offline.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 200 && img.naturalHeight > 100)).toBeTruthy();
  const offlineAnswer = offline.locator('.self-check details').getByText('No. Independent replication is still needed.', { exact: true });
  await expect(offlineAnswer).toBeHidden();
  await offline.locator('.self-check summary').focus();
  await offline.keyboard.press('Enter');
  await expect(offlineAnswer).toBeVisible();
  await offline.keyboard.press('Space');
  await expect(offlineAnswer).toBeHidden();
  expect(await offline.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await offline.emulateMedia({ media: 'print' });
  await expect(offline.locator('.self-check .print-only')).toBeVisible();
  expect(external).toEqual([]);
});

test('a saved article retries only interactive conversion and preserves the original version', async ({ page }) => {
  const original = { id: 'saved-article', style: 'critical', focus: 'Check the stated limitations', format: 'article', language: 'en', markdown: '## Saved article\nThe completed article and its limitations remain intact.', mode: 'model', createdAt: '2026-10-22T08:00:00Z', interactiveGenerationError: 'Interactive generation did not complete. The finished article was saved; retry conversion.' };
  const converted = { ...original, id: 'converted-interactive', format: 'interactive', createdAt: '2026-10-22T08:01:00Z', derivedFromReadingId: original.id, interactiveGenerationError: undefined, interactive: { schemaVersion: 1, blocks: [{ id: 'converted-concept', type: 'concept', title: 'The same reading, now interactive', text: 'The original limitations remain unchanged.', citations: [] }] } };
  const paper: any = { id: 'conversion-recovery', title: 'Recover an interactive reading', authors: [], source: 'web', createdAt: original.createdAt, abstract: 'Measured results have stated limits.', text: 'Source evidence.', tags: [], readingVersions: [original], activeReadingId: original.id };
  const reports: any[] = [];
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname.slice(4);
    let response: any = {};
    if (path === '/settings') response = { provider: 'openai', baseUrl: 'https://example.org/v1', model: 'fixture-model', apiKeyConfigured: true, modelConfigured: true };
    else if (path === '/papers') response = { papers: [paper] };
    else if (path === `/papers/${paper.id}`) { if (req.method() === 'PATCH') Object.assign(paper, req.postDataJSON()); response = { paper }; }
    else if (path === `/papers/${paper.id}/report`) {
      expect(req.method()).toBe('POST');
      reports.push(req.postDataJSON());
      paper.readingVersions = [original, converted];
      paper.activeReadingId = converted.id;
      response = { paper, readingVersion: converted };
    } else if (path === '/chats') response = { messages: [], conversationId: null };
    else if (path.endsWith('/annotations')) response = { annotations: [] };
    await route.fulfill({ json: response });
  });
  await page.goto('/en/?paper=' + paper.id);
  await expect(page.locator('.reading-prose')).toContainText('The completed article and its limitations remain intact.');
  await expect(page.getByRole('status').filter({ hasText: 'The article was saved, but the interactive version did not finish.' })).toBeVisible();
  expect(reports).toEqual([]);
  await page.getByRole('button', { name: 'Create an interactive version from this reading', exact: true }).click();
  await expect(page.getByTestId('interactive-reading')).toContainText('The same reading, now interactive');
  expect(reports).toEqual([{ readingId: original.id, format: 'interactive' }]);
  await expect(page.getByLabel('Reading version', { exact: true })).toHaveValue(converted.id);
  await expect(page.getByRole('status').filter({ hasText: 'The article was saved, but the interactive version did not finish.' })).toHaveCount(0);
  await page.getByLabel('Reading version', { exact: true }).selectOption(original.id);
  await expect(page.locator('.reading-prose')).toContainText('The completed article and its limitations remain intact.');
  await expect(page.getByTestId('interactive-reading')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create an interactive version from this reading', exact: true })).toBeVisible();
  await page.getByLabel('Reading version', { exact: true }).selectOption(converted.id);
  await expect(page.getByTestId('interactive-reading')).toContainText('The original limitations remain unchanged.');
  expect(reports).toHaveLength(1);
});

test('partial interactive translations keep the valid article and retry only the missing cards', async ({page}) => {
  const originalInteractive={schemaVersion:1,blocks:[{id:'concept',type:'concept',title:'原始中文卡片',text:'不能把未翻译的中文卡片显示为英文。',citations:[]}]};
  const translatedMarkdown='## Preserved English article\nThe correct article translation must stay available throughout the retry.';
  const partial={language:'en',markdown:translatedMarkdown,interactive:originalInteractive,interactiveTranslationError:'Interactive cards did not pass language validation.'};
  const reading:any={id:'partial-interactive',style:'deep',format:'interactive',language:'zh-CN',markdown:'## 原始文章\n源文章内容保持不变。',mode:'model',createdAt:'2026-10-22T00:00:00Z',interactive:originalInteractive,translations:{en:partial}};
  const alternate={id:'other-partial-version',style:'quick',language:'en',markdown:'Another existing reading.',mode:'model',createdAt:'2026-10-21T00:00:00Z'};
  const paper:any={id:'partial-translation-paper',title:'Partial translation recovery',authors:[],source:'web',createdAt:reading.createdAt,abstract:'Evidence fidelity.',text:'Source evidence.',tags:[],readingVersions:[reading,alternate],activeReadingId:reading.id};
  const translations:{body:any,route:any}[]=[];
  await page.route('**/api/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname.slice(4);let response:any={};
    if(path==='/settings') response={provider:'openai',baseUrl:'https://example.org/v1',model:'translation-model',apiKeyConfigured:true,modelConfigured:true};
    else if(path==='/papers') response={papers:[paper]};
    else if(path===`/papers/${paper.id}`) {if(req.method()==='PATCH')Object.assign(paper,req.postDataJSON());response={paper};}
    else if(path===`/papers/${paper.id}/translate`) {
      translations.push({body:req.postDataJSON(),route});
      if(translations.length===1) {reading.translations.en={...partial,interactive:undefined};response={paper};}
      else return;
    } else if(path==='/chats') response={messages:[],conversationId:null};
    else if(path.endsWith('/annotations')) response={annotations:[]};
    await route.fulfill({json:response});
  });
  await page.goto('/en/?paper='+paper.id);
  const prose=page.locator('.reading-prose');
  await expect(prose).toContainText('The correct article translation must stay available');
  await expect(page.getByTestId('interactive-reading')).toHaveCount(0);
  await expect(prose).not.toContainText('原始中文卡片');
  await expect(page.getByRole('status').filter({hasText:'The article translation is saved.'})).toBeVisible();
  await expect(page.getByRole('group',{name:'View format'}).getByRole('button',{name:'Article',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('group',{name:'View format'}).getByRole('button',{name:'Interactive',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Download offline website',exact:true})).toBeEnabled();
  expect(translations).toHaveLength(0);
  await page.getByRole('button',{name:'Retry interactive translation',exact:true}).click();
  await expect.poll(()=>translations.length).toBe(1);
  await expect(page.getByRole('button',{name:'Retry interactive translation',exact:true})).toBeEnabled();
  await expect(prose).toContainText('The correct article translation must stay available');
  await expect(page.getByTestId('interactive-reading')).toHaveCount(0);
  await page.getByRole('button',{name:'Retry interactive translation',exact:true}).click();
  await expect.poll(()=>translations.length).toBe(2);
  await expect(page.getByRole('button',{name:'Translating interactive cards…',exact:true})).toBeDisabled();
  await expect(prose).toContainText('The correct article translation must stay available');
  const translatedInteractive={schemaVersion:1,blocks:[{id:'concept',type:'concept',title:'Translated evidence card',text:'The English article was reused while only these cards were translated.',citations:[]}]};
  reading.translations.en={language:'en',markdown:translatedMarkdown,interactive:translatedInteractive};
  await translations[1].route.fulfill({json:{paper}});
  await expect(page.getByTestId('interactive-reading')).toContainText('Translated evidence card');
  await expect(page.getByTestId('interactive-reading')).not.toContainText('原始中文卡片');
  await expect(page.getByRole('status').filter({hasText:'The article translation is saved.'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Retry interactive translation',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Download offline website',exact:true})).toBeEnabled();
  await page.getByRole('group',{name:'View format'}).getByRole('button',{name:'Article',exact:true}).click();
  await expect(prose).toContainText('The correct article translation must stay available');
  expect(translations.map(request=>request.body)).toEqual([{target:'reading',readingId:reading.id,language:'en'},{target:'reading',readingId:reading.id,language:'en'}]);
  // A later source validation can retract cards. An old completed memory job
  // must not restore the rejected cards over that authoritative public state.
  reading.translations.en={...partial,interactive:undefined};
  await page.getByLabel('Reading version',{exact:true}).selectOption(alternate.id);
  await expect(prose).toContainText('Another existing reading.');
  await page.getByLabel('Reading version',{exact:true}).selectOption(reading.id);
  await expect(prose).toContainText('The correct article translation must stay available');
  await expect(page.getByTestId('interactive-reading')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Retry interactive translation',exact:true})).toBeVisible();
  expect(translations).toHaveLength(2);
});

test('article copy and offline export retain translated captions in place, source pages, equations and code without private runtime dependencies',async({page,context},info)=>{
  const source=await context.newPage();await source.setContent('<h1>Source graph</h1><svg width="420" height="190"><rect x="40" y="40" width="130" height="100" fill="#748db0"/><text x="40" y="175">Measured result</text></svg>');
  const pdf=await source.pdf({format:'A4'});await source.close();
  const figures=[{id:'measured',page:1,caption:'原图中测量结果的中文说明。',crop:{x:.02,y:.04,width:.8,height:.28}}];
  const markdown='## Evidence before the figure\n\nThe controlled result is limited to the measured condition. [Result](#page=1 "Measured result")\n:::figure measured\n\n## Interpretation after the figure\n\n$x^2+1$ and\n\n$$\n\\frac{a}{b}=2\n$$\n\n| Condition | Value |\n|---|---|\n| Trial | 2 |\n\n```md\n:::figure measured\n```\n\n![Do not fetch external media](https://attack.invalid/image.png)\n\n[Invalid destination](javascript:alert(1))';
  const version={id:'portable-article',language:'zh-CN',style:'deep',mode:'agent',createdAt:'2026-10-22T01:00:00Z',markdown:'原始解读保留。',figures,source:{agent:'Fixture agent'},translations:{en:{language:'en',markdown,figureCaptions:{measured:'Measured outcomes under the stated condition.'}}}};
  const paper={id:'portable-paper',title:'Portable source reading',authors:[],source:'pdf',createdAt:version.createdAt,pageCount:1,abstract:'Source evidence.',text:'Source evidence.',tags:[],url:'https://arxiv.org/abs/1706.03762',pdfUrl:'https://arxiv.org/pdf/1706.03762',localPdfUrl:'/portable-source.pdf',figures,readingVersions:[version],activeReadingId:version.id,apiKey:'private-fixture-key',localPath:'/Users/private-fixture'};
  await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{(window as any).__copiedArticle=text;}}}));
  await page.route('**/portable-source.pdf',r=>r.fulfill({body:pdf,contentType:'application/pdf'}));
  await page.route('**/api/**',async r=>{const path=new URL(r.request().url()).pathname.slice(4);const data=path==='/settings'?{modelConfigured:false,apiKeyConfigured:false}:path==='/papers'?{papers:[paper]}:path===`/papers/${paper.id}`?{paper}:path==='/chats'?{messages:[],conversationId:null}:path.endsWith('/annotations')?{annotations:[]}:{};await r.fulfill({json:data});});
  await page.goto(`/en/?paper=${paper.id}`);
  await expect(page.locator('.reading-prose figure')).toHaveCount(1);
  await expect(page.locator('.reading-prose code').filter({hasText:':::figure measured'})).toHaveCount(1);
  await page.getByRole('button',{name:'Copy overview',exact:true}).click();
  const copied=await page.evaluate(()=>(window as any).__copiedArticle);
  expect(copied).toContain('Measured outcomes under the stated condition.');
  expect(copied).toContain('https://arxiv.org/pdf/1706.03762#page=1');
  expect(copied).toContain('```md\n:::figure measured\n```');
  expect(copied.match(/:::figure measured/g)).toHaveLength(1);
  const mdPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Download overview',exact:true}).click();
  const md=await mdPromise;expect(await readFile((await md.path())!,'utf8')).toBe(copied);
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Download offline website',exact:true}).click();
  const download=await downloadPromise,path=info.outputPath('article-en.html');await download.saveAs(path);
  const html=await readFile(path,'utf8');
  for(const value of ['private-fixture-key','/Users/private-fixture','/portable-source.pdf','javascript:alert','src="https://attack'])expect(html).not.toContain(value);
  expect(html).toContain('Reading version: portable-article');expect(html).toContain('data:image/png;base64,');
  await context.setOffline(true);const offline=await context.newPage();const requests:string[]=[];offline.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  await offline.goto(pathToFileURL(path).href);
  await expect(offline.locator('figure')).toHaveCount(1);await expect(offline.locator('figcaption')).toContainText('Measured outcomes under the stated condition.');
  await expect(offline.locator('math')).toHaveCount(2);await expect(offline.locator('table')).toHaveCount(1);
  expect(await offline.locator('figure img').evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>200)).toBeTruthy();
  expect(await offline.locator('figure').evaluate(el=>!!(el.compareDocumentPosition([...document.querySelectorAll('h2')].find(h=>h.textContent==='Interpretation after the figure')!)&Node.DOCUMENT_POSITION_FOLLOWING))).toBeTruthy();
  await expect(offline.getByRole('link',{name:'Result',exact:true})).toHaveAttribute('href','https://arxiv.org/pdf/1706.03762#page=1');
  expect(await offline.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
  await offline.screenshot({path:info.outputPath('article-offline.png'),fullPage:true});expect(requests).toEqual([]);
});
