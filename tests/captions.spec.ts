import { test, expect, type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

async function setup(page: Page, cached: boolean) {
  const renderer=await page.context().newPage();
  await renderer.setContent('<h1>Source evidence</h1><svg width="400" height="220"><rect x="20" y="25" width="120" height="160" fill="#914158"/><text x="180" y="90" font-size="22">Source axes</text></svg>');
  const pdf=await renderer.pdf({format:'A4'});await renderer.close();
  const figure={id:'fig-main',page:1,caption:'Original PDF caption: measured groups.',crop:{x:.01,y:.01,width:.75,height:.32}};
  const originalInteractive={schemaVersion:1,blocks:[{id:'figure-block',type:'figure',figureId:figure.id,explanation:'固定解读中的图表解释。',citations:[{page:1}]}]};
  const englishInteractive={schemaVersion:1,blocks:[{id:'figure-block',type:'figure',figureId:figure.id,explanation:'The fixed interpretation of this figure.',citations:[{page:1}]}]};
  const reading:any={id:'caption-version',style:'deep',format:'interactive',language:'zh-CN',markdown:'## 已完成的中文解读\n\n正文不会因补译图注而改变。\n\n:::figure fig-main',mode:'model',createdAt:'2026-10-22T00:00:00Z',figures:[figure],interactive:originalInteractive,translations:{}};
  const zhCaption='中文图注：实验中的测量组。',enCaption='English caption: groups measured in the experiment.';
  if(cached)reading.translations={
    'zh-CN':{language:'zh-CN',markdown:reading.markdown,interactive:originalInteractive,figureCaptions:{[figure.id]:zhCaption}},
    en:{language:'en',markdown:'## Finished English reading\n\nThe article stays intact.\n\n:::figure fig-main',interactive:englishInteractive,figureCaptions:{[figure.id]:enCaption}},
  };
  const paper:any={id:'caption-paper',title:'Caption language fixture',authors:[],source:'pdf',createdAt:reading.createdAt,abstract:'Measured evidence.',text:'Source text.',tags:[],pageCount:1,localPdfUrl:'/caption-source.pdf',figures:[figure],readingVersions:[reading],activeReadingId:reading.id};
  const requests:{body:any,route:Route}[]=[];
  await page.route('**/caption-source.pdf',route=>route.fulfill({contentType:'application/pdf',body:pdf}));
  await page.route('**/api/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname.slice(4);let response:any={};
    if(path===`/papers/${paper.id}/translate`){requests.push({body:req.postDataJSON(),route});return;}
    if(path==='/settings')response={provider:'openai',baseUrl:'https://example.org/v1',model:'caption-model',apiKeyConfigured:true,modelConfigured:true};
    else if(path==='/papers')response={papers:[paper]};
    else if(path===`/papers/${paper.id}`){if(req.method()==='PATCH')Object.assign(paper,req.postDataJSON());response={paper};}
    else if(path==='/chats')response={messages:[],conversationId:null};
    else if(path.endsWith('/annotations'))response={annotations:[]};
    await route.fulfill({json:response});
  });
  return {paper,reading,figure,requests,zhCaption,enCaption};
}

test('cached figure captions follow the selected language in article, interactive, lightbox and offline export',async({page,context},info)=>{
  const fixture=await setup(page,true);
  await page.goto('/zh/?paper='+fixture.paper.id);
  let sourceFigure=page.locator('.reading-prose .pdf-source-figure');
  await expect(sourceFigure.locator('figcaption')).toContainText(fixture.zhCaption);
  await expect(sourceFigure.locator('figcaption')).not.toContainText('原文图注');
  await page.getByRole('group',{name:'查看方式',exact:true}).getByRole('button',{name:'文章',exact:true}).click();
  await expect(sourceFigure.locator('figcaption')).toContainText(fixture.zhCaption);
  await expect(sourceFigure.locator('canvas[data-rendered="true"]')).toBeVisible();
  await sourceFigure.getByRole('button',{name:'放大第 1 页图表',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'论文原图 · 第 1 页',exact:true}).locator('footer')).toHaveText(fixture.zhCaption);
  await page.getByRole('button',{name:'关闭图表',exact:true}).click();
  await page.getByLabel('阅读语言',{exact:true}).selectOption('en');
  await expect(sourceFigure.locator('figcaption')).toContainText(fixture.enCaption);
  await expect(sourceFigure.locator('figcaption')).not.toContainText(fixture.figure.caption);
  await page.getByRole('group',{name:'View format',exact:true}).getByRole('button',{name:'Interactive',exact:true}).click();
  await expect(page.getByTestId('interactive-reading')).toContainText('The fixed interpretation');
  await expect(sourceFigure.locator('figcaption')).toContainText(fixture.enCaption);
  await expect(sourceFigure.locator('canvas[data-rendered="true"]')).toHaveAttribute('aria-label',fixture.enCaption);
  await sourceFigure.getByRole('button',{name:'Enlarge figure on page 1',exact:true}).click();
  const lightbox=page.getByRole('dialog',{name:'Source figure · Page 1',exact:true});
  await expect(lightbox.locator('footer')).toHaveText(fixture.enCaption);
  await expect(lightbox.locator('canvas[data-rendered="true"]')).toHaveAttribute('aria-label',fixture.enCaption);
  await page.getByRole('button',{name:'Close figure',exact:true}).click();
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download offline website',exact:true}).click();
  const download=await downloadPromise,path=info.outputPath('english-captions.html');await download.saveAs(path);
  const html=await readFile(path,'utf8');
  expect(html).toContain(fixture.enCaption);expect(html).not.toContain(fixture.zhCaption);expect(html).not.toContain(fixture.figure.caption);
  expect(html).toContain('data:image/png;base64,');expect(fixture.requests).toHaveLength(0);
  await context.setOffline(true);
  const offline=await context.newPage();await offline.goto(pathToFileURL(path).href);
  await expect(offline.locator('figcaption')).toHaveText(fixture.enCaption+' · p.1');
  await expect(offline.locator('img')).toHaveAttribute('alt',fixture.enCaption);
  expect(await offline.locator('img').evaluate((image:HTMLImageElement)=>image.complete&&image.naturalWidth>100)).toBeTruthy();
});

test('legacy captions supplement the current language once, retain source pixels, and recover after a partial failure',async({page},info)=>{
  const fixture=await setup(page,false);
  await page.goto('/zh/?paper='+fixture.paper.id);
  await page.getByRole('group',{name:'查看方式',exact:true}).getByRole('button',{name:'文章',exact:true}).click();
  const figure=page.locator('.reading-prose .pdf-source-figure');
  await expect(figure.locator('figcaption')).toContainText(fixture.figure.caption);
  await expect(figure.locator('figcaption')).toContainText('原文图注');
  await expect(figure.locator('canvas[data-rendered="true"]')).toBeVisible();
  const sourcePixels=await figure.locator('canvas').evaluate((canvas:HTMLCanvasElement)=>canvas.toDataURL());
  await figure.getByRole('button',{name:'放大第 1 页图表',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'论文原图 · 第 1 页',exact:true}).locator('footer')).toContainText('原文图注');
  await page.getByRole('button',{name:'关闭图表',exact:true}).click();
  expect(fixture.requests).toHaveLength(0);
  const originalDownloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'下载离线网页',exact:true}).click();
  const originalDownload=await originalDownloadPromise;
  const originalHtml=await readFile((await originalDownload.path())!,'utf8');
  expect(originalHtml).toContain(fixture.figure.caption);expect(originalHtml).toContain('原文图注');
  await page.getByRole('button',{name:'补译图注',exact:true}).click();
  await expect.poll(()=>fixture.requests.length).toBe(1);
  expect(fixture.requests[0].body).toEqual({target:'reading',readingId:fixture.reading.id,language:'zh-CN'});
  fixture.reading.translations['zh-CN']={language:'zh-CN',markdown:fixture.reading.markdown,interactive:fixture.reading.interactive,captionTranslationError:'Caption translation did not finish.'};
  await fixture.requests[0].route.fulfill({json:{paper:fixture.paper}});
  await expect(page.getByRole('button',{name:'重试图注翻译',exact:true})).toBeEnabled();
  await expect(page.getByRole('status').filter({hasText:'图注翻译未完成。'})).toBeVisible();
  await expect(page.locator('.reading-prose')).toContainText('正文不会因补译图注而改变。');
  await expect(figure.locator('figcaption')).toContainText('原文图注');
  await page.getByRole('button',{name:'重试图注翻译',exact:true}).click();
  await expect.poll(()=>fixture.requests.length).toBe(2);
  await expect(page.getByRole('button',{name:'正在翻译图注…',exact:true})).toBeDisabled();
  await figure.getByRole('button',{name:'在论文中查看第 1 页图表',exact:true}).click();
  await page.getByRole('tab',{name:'摘要',exact:true}).click();
  await expect(page.getByRole('button',{name:'正在翻译图注…',exact:true})).toBeDisabled();
  expect(fixture.requests).toHaveLength(2);
  fixture.reading.translations['zh-CN']={language:'zh-CN',markdown:fixture.reading.markdown,interactive:fixture.reading.interactive,figureCaptions:{[fixture.figure.id]:fixture.zhCaption}};
  await fixture.requests[1].route.fulfill({json:{paper:fixture.paper}});
  await expect(figure.locator('figcaption')).toContainText(fixture.zhCaption);
  await expect(figure.locator('figcaption')).not.toContainText('原文图注');
  await expect(page.getByRole('button',{name:'补译图注',exact:true})).toHaveCount(0);
  await page.getByRole('group',{name:'查看方式',exact:true}).getByRole('button',{name:'文章',exact:true}).click();
  await expect(figure.locator('canvas[data-rendered="true"]')).toHaveAttribute('aria-label',fixture.zhCaption);
  expect(await figure.locator('canvas').evaluate((canvas:HTMLCanvasElement)=>canvas.toDataURL())).toBe(sourcePixels);
  await expect(page.locator('.reading-prose')).toContainText('正文不会因补译图注而改变。');
  expect(fixture.figure).toMatchObject({caption:'Original PDF caption: measured groups.',page:1,crop:{x:.01,y:.01,width:.75,height:.32}});
  expect(fixture.requests).toHaveLength(2);
  await page.screenshot({path:info.outputPath('translated-captions.png'),fullPage:true});
});

test('a language change while the overview is hidden waits until visible before translating',async({page})=>{
  const fixture=await setup(page,false);
  await page.goto('/zh/?paper='+fixture.paper.id);
  await page.getByRole('tab',{name:'论文',exact:true}).click();
  await expect(page.locator('.reading-overview')).toBeHidden();
  // Change the controlled parent language while its overview is kept mounted.
  // This represents an app-level language change, not an interaction with the
  // hidden reading tools themselves.
  await page.getByLabel('阅读语言',{exact:true}).selectOption('en',{force:true});
  await expect(page.locator('.reading-overview .translation-missing').getByRole('button',{name:'Translate this version',exact:true,includeHidden:true})).toHaveCount(1);
  expect(fixture.requests).toHaveLength(0);
  await page.getByRole('tab',{name:'Overview',exact:true}).click();
  await expect.poll(()=>fixture.requests.length).toBe(1);
  expect(fixture.requests[0].body).toEqual({target:'reading',readingId:fixture.reading.id,language:'en'});
  fixture.reading.translations.en={language:'en',markdown:'## Visible English reading\n\n:::figure fig-main',interactive:{schemaVersion:1,blocks:[{id:'figure-block',type:'figure',figureId:fixture.figure.id,explanation:'English figure interpretation.',citations:[{page:1}]}]},figureCaptions:{[fixture.figure.id]:fixture.enCaption}};
  await fixture.requests[0].route.fulfill({json:{paper:fixture.paper}});
  await expect(page.locator('.reading-prose figcaption')).toContainText(fixture.enCaption);
  expect(fixture.requests).toHaveLength(1);
});
