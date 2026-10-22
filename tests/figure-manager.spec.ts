import {test,expect,type Page,type APIRequestContext} from '@playwright/test';

async function source(page:Page,request:APIRequestContext,label:string,withTable=false){
 const renderer=await page.context().newPage();await renderer.setContent(`<html><head><title>Figure review ${label}</title></head><body style="margin:42px;font:16px Georgia"><h1>Figure review ${label}</h1><p>Source review needs complete axes and panel labels.</p>${withTable?'<p>Table 1: Controlled architecture settings.</p><table><tr><th>Layer</th><th>Baseline</th></tr><tr><td>Width</td><td>64</td></tr></table>':''}<svg width="460" height="210"><rect x="12" y="20" width="430" height="170" fill="#5897ca"/><text x="40" y="90">Controlled evidence</text></svg><p>Figure 1: A controlled synthetic result.</p><div style="height:350px"></div><p>Source page footer remains readable.</p></body></html>`);const buffer=await renderer.pdf({format:'A4'});await renderer.close();const response=await request.post('/api/upload',{multipart:{file:{name:'figure-review.pdf',mimeType:'application/pdf',buffer}}});expect(response.ok(),await response.text()).toBeTruthy();return (await response.json()).paper;
}
async function openManager(page:Page,paperId:string){
 await page.goto('/en/?paper='+paperId);const close=page.getByRole('button',{name:'Close assistant',exact:true});if(await close.isVisible())await close.click();await page.getByRole('tab',{name:'Paper',exact:true}).click();await page.getByRole('button',{name:'Reading tools',exact:true}).click();await page.getByRole('button',{name:'Review figure crops',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Review paper figures',exact:true});await expect(dialog).toBeVisible();await expect(dialog.getByRole('img',{name:'Original PDF page 1',exact:true})).toBeVisible();return dialog;
}
async function setCrop(page:Page,crop={x:10,y:15,width:75,height:30}){for(const [key,label] of [['x','left'],['y','top'],['width','width'],['height','height']] as const){await page.getByLabel(`Crop ${label} percent`,{exact:true}).fill(String(crop[key]));}}

test('figure review saves a checked source crop without a model and retains unsaved work on close',async({page,request},info)=>{
 const paper=await source(page,request,`manual ${info.project.name}`);const dialog=await openManager(page,paper.id);
 await expect(dialog.locator('.figure-crop-editor')).toHaveCSS('touch-action','pan-y');
 await dialog.getByRole('button',{name:'Manual crop',exact:true}).click();await expect(dialog.locator('.figure-crop-editor')).toHaveCSS('touch-action','none');
 await setCrop(page);await dialog.getByLabel('Source caption',{exact:true}).fill('Figure 1: A controlled synthetic result, including every panel.');await dialog.getByLabel('Figure label',{exact:true}).fill('Figure 1');
 await expect(dialog.getByRole('button',{name:'Save figure',exact:true})).toBeDisabled();
 await dialog.getByRole('button',{name:'Close figure review',exact:true}).click();
 await page.getByRole('button',{name:'Reading tools',exact:true}).click();await page.getByRole('button',{name:'Review figure crops',exact:true}).click();
 await expect(dialog.getByLabel('Source caption',{exact:true})).toContainText('including every panel');await expect(dialog.getByLabel('Crop left percent',{exact:true})).toHaveValue('10');
 await dialog.getByLabel('I checked the full crop and source caption',{exact:true}).check();await dialog.getByRole('button',{name:'Save figure',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Saved.');
 const response=await request.get(`/api/papers/${paper.id}/figures`);const collection=await response.json();const figure=collection.figures.find((f:any)=>f.caption.includes('including every panel'));expect(figure).toBeTruthy();expect(figure.crop).toEqual({x:.1,y:.15,width:.75,height:.3});expect(figure.source.reviewed).toBe(true);expect(figure.source.method).toBe('manual');
 await expect(dialog.getByRole('button',{name:'Save changes',exact:true})).toBeDisabled();
 const input=dialog.getByLabel('Figure source page',{exact:true});await input.fill('999');await input.press('Escape');await expect(dialog).toBeVisible();await expect(input).toHaveValue('1');
});

test('reopened clean figures refresh from the collection while an old dirty draft requires explicit reconciliation',async({page,request},info)=>{
 const paper=await source(page,request,`conflict ${info.project.name}`);let collection=await (await request.get(`/api/papers/${paper.id}/figures`)).json();
 const created=await request.post(`/api/papers/${paper.id}/figures`,{data:{pdfRevision:collection.pdfRevision,expectedFiguresRevision:collection.figuresRevision,figure:{page:1,caption:'Reviewed source caption',crop:{x:.1,y:.15,width:.7,height:.3},label:'Reviewed chart'},source:{method:'manual',reviewed:true}}});expect(created.ok()).toBeTruthy();let record=await created.json();const id=record.figure.id;
 let dialog=await openManager(page,paper.id);await dialog.getByText(/Saved figures \(/).click();await dialog.getByRole('button',{name:/^Reviewed chart/}).click();await expect(dialog.getByLabel('Crop left percent',{exact:true})).toHaveValue('10');await dialog.getByRole('button',{name:'Close figure review',exact:true}).click();
 async function external(caption:string,x:number){const current=await(await request.get(`/api/papers/${paper.id}/figures`)).json();const result=await request.patch(`/api/papers/${paper.id}/figures/${id}`,{data:{pdfRevision:current.pdfRevision,expectedFiguresRevision:current.figuresRevision,figure:{caption,crop:{x,y:.15,width:.7,height:.3}},source:{method:'manual',reviewed:true}}});expect(result.ok()).toBeTruthy();return result.json();}
 await external('Updated in another editor',.18);
 await page.getByRole('button',{name:'Reading tools',exact:true}).click();await page.getByRole('button',{name:'Review figure crops',exact:true}).click();await expect(dialog.getByLabel('Source caption',{exact:true})).toHaveValue('Updated in another editor');await expect(dialog.getByLabel('Crop left percent',{exact:true})).toHaveValue('18');
 await dialog.getByLabel('Source caption',{exact:true}).fill('My unsaved caption');await dialog.getByRole('button',{name:'Close figure review',exact:true}).click();await external('A newer external caption',.22);
 await page.getByRole('button',{name:'Reading tools',exact:true}).click();await page.getByRole('button',{name:'Review figure crops',exact:true}).click();await expect(dialog.getByLabel('Source caption',{exact:true})).toHaveValue('My unsaved caption');await expect(dialog.getByRole('button',{name:'Load latest figures',exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Save changes',exact:true})).toBeDisabled();await dialog.getByRole('button',{name:'Load latest figures',exact:true}).click();await expect(dialog.getByLabel('I checked the full crop and source caption',{exact:true})).not.toBeChecked();await expect(dialog.getByLabel('Source caption',{exact:true})).toHaveValue('My unsaved caption');
});

test('blocked tab storage leaves a recoverable in-page draft and explains the reload limit',async({page,request},info)=>{
 const paper=await source(page,request,`storage ${info.project.name}`);await page.addInitScript(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(this===sessionStorage&&key.startsWith('pw-figure-drafts:'))throw new DOMException('Storage full','QuotaExceededError');return original.call(this,key,value);};});const dialog=await openManager(page,paper.id);await dialog.getByLabel('Source caption',{exact:true}).fill('Keep this draft even if tab storage is blocked.');await expect(dialog).toContainText('reloading or closing the tab loses edits');await dialog.getByRole('button',{name:'Close figure review',exact:true}).click();await page.getByRole('button',{name:'Reading tools',exact:true}).click();await page.getByRole('button',{name:'Review figure crops',exact:true}).click();await expect(dialog.getByLabel('Source caption',{exact:true})).toHaveValue('Keep this draft even if tab storage is blocked.');
});


test('selecting a saved crop brings its source region into view after scrolling away',async({page,request},info)=>{
 const paper=await source(page,request,`navigate ${info.project.name}`);const current=await(await request.get(`/api/papers/${paper.id}/figures`)).json();
 const saved=await request.post(`/api/papers/${paper.id}/figures`,{data:{pdfRevision:current.pdfRevision,expectedFiguresRevision:current.figuresRevision,figure:{page:1,caption:'Source region at the top of this page',crop:{x:.1,y:.12,width:.7,height:.2},label:'Return target'},source:{method:'manual',reviewed:true}}});expect(saved.ok()).toBeTruthy();
 const dialog=await openManager(page,paper.id);await dialog.locator('.figure-source-scroll').evaluate(el=>{el.scrollTop=el.scrollHeight;});await dialog.getByText(/Saved figures \(/).click();await dialog.getByRole('button',{name:/^Return target/}).click();
 await expect.poll(async()=>dialog.locator('.figure-source-scroll').evaluate(el=>{const canvas=el.querySelector('canvas')!;return canvas.getBoundingClientRect().top+canvas.getBoundingClientRect().height*.12-el.getBoundingClientRect().top;})).toBeGreaterThanOrEqual(0);
 await expect.poll(async()=>dialog.locator('.figure-source-scroll').evaluate(el=>{const canvas=el.querySelector('canvas')!;return canvas.getBoundingClientRect().top+canvas.getBoundingClientRect().height*.12-el.getBoundingClientRect().top;})).toBeLessThan(80);
});

test('manual drawing retains the selected table caption while new crop preserves it as a draft',async({page,request},info)=>{
 const paper=await source(page,request,`manual-candidate ${info.project.name}`,true);const dialog=await openManager(page,paper.id);await dialog.getByRole('button',{name:'Scan page',exact:true}).click();const candidates=dialog.getByLabel('Choose a figure candidate',{exact:true});const option=candidates.locator('option').filter({hasText:'Table 1'});await expect(option).toHaveCount(1);const key=await option.getAttribute('value');await candidates.selectOption(key!);
 const caption=dialog.getByLabel('Source caption',{exact:true}),label=dialog.getByLabel('Figure label',{exact:true});await expect(caption).toContainText('Controlled architecture settings');const text=await caption.inputValue();const title=await label.inputValue();
 await dialog.getByRole('button',{name:'Manual crop',exact:true}).click();await expect(caption).toHaveValue(text);await expect(label).toHaveValue(title);await expect(candidates).toHaveValue(key!);await setCrop(page);await caption.fill(text+' Checked source.');
 await dialog.getByRole('button',{name:'New crop',exact:true}).click();await expect(caption).toHaveValue('');await dialog.getByText('Unsaved drafts',{exact:true}).click();await dialog.getByRole('button',{name:new RegExp('^'+title)}).click();await expect(caption).toHaveValue(text+' Checked source.');await expect(dialog.getByLabel('Crop left percent',{exact:true})).toHaveValue('10');
});
