import {test,expect,type Page} from '@playwright/test';
const summary={createdAt:'2026-01-02T03:04:00Z',papers:3,pdfs:2,readings:6,notes:4,conversations:2,messages:7,folders:1,images:1,bytes:1000};
async function setup(page:Page,lang='zh',failRestore=false){
 let confirmations=0,exports=0;
 await page.route('**/api/**',async route=>{
  const req=route.request(),p=new URL(req.url()).pathname;let json:any={};
  if(p==='/api/settings')json={provider:'openai',model:'fixture',apiKeyConfigured:false,activeProfileId:'default',profiles:[{id:'default',name:'Fixture',provider:'openai',models:['fixture'],model:'fixture',baseUrl:'https://example.org/v1',apiKeyConfigured:false}]};
  else if(p==='/api/papers')json={papers:[]};else if(p==='/api/collections')json={collections:[]};
  else if(p==='/api/workspace/restore/preview'){await route.fulfill({json:{token:'preview-fixture',summary,expiresInSeconds:900}});return;}
  else if(p==='/api/workspace/restore'){confirmations++;expect(req.postDataJSON()).toEqual({token:'preview-fixture',confirm:true});await route.fulfill({status:failRestore?500:200,json:failRestore?{error:'Disk is full. Free space and retry.'}:summary});return;}
  else if(p==='/api/workspace/backup'){exports++;await route.fulfill({status:200,contentType:'application/gzip',body:Buffer.from('fixture backup download')});return;}
  await route.fulfill({json});
 });
 await page.goto(`/${lang}/?view=library`);
 const toggle=page.getByRole('button',{name:lang==='zh'?'展开导航':'Expand navigation',exact:true});if(await toggle.isVisible())await toggle.click();
 await page.getByRole('navigation').getByRole('button',{name:lang==='zh'?'备份':'Backup',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:lang==='zh'?'备份与恢复':'Backup & restore'});await expect(dialog).toBeVisible();return{dialog,confirmations:()=>confirmations,exports:()=>exports};
}
for(const lang of ['zh','en'])test(`backup preview requires explicit confirmation, ${lang}`,async({page})=>{
 const f=await setup(page,lang);
 await f.dialog.locator('input[type=file]').setInputFiles({name:'example.paperwork',mimeType:'application/gzip',buffer:Buffer.from('fixture')});
 await expect(f.dialog.getByRole('heading',{name:lang==='zh'?'备份预览':'Backup preview'})).toBeVisible();expect(f.confirmations()).toBe(0);await page.screenshot({path:test.info().outputPath(`backup-${lang}.png`),fullPage:false});
 const confirm=f.dialog.getByRole('button',{name:lang==='zh'?'确认恢复':'Confirm restore',exact:true});await expect(confirm).toBeDisabled();await f.dialog.getByRole('checkbox').check();await expect(confirm).toBeEnabled();await confirm.click();
 await expect(f.dialog.getByRole('heading',{name:lang==='zh'?'恢复完成':'Restore complete'})).toBeVisible();expect(f.confirmations()).toBe(1);
 expect(await f.dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await f.dialog.getByRole('button',{name:lang==='zh'?'完成':'Done',exact:true}).click();await expect(f.dialog).toHaveCount(0);
});
test('backup export downloads locally and a failed restore keeps preview available to retry',async({page})=>{
 const f=await setup(page,'en',true);const download=page.waitForEvent('download');await f.dialog.getByRole('button',{name:'Download backup'}).click();expect((await download).suggestedFilename()).toMatch(/\.paperwork$/);expect(f.exports()).toBe(1);
 await f.dialog.locator('input[type=file]').setInputFiles({name:'example.paperwork',mimeType:'application/gzip',buffer:Buffer.from('fixture')});await f.dialog.getByRole('checkbox').check();await f.dialog.getByRole('button',{name:'Confirm restore',exact:true}).click();await expect(f.dialog.getByRole('alert')).toContainText('Disk is full');await expect(f.dialog.getByRole('button',{name:'Confirm restore',exact:true})).toBeEnabled();await expect(f.dialog.getByRole('heading',{name:'Backup preview'})).toBeVisible();expect(f.confirmations()).toBe(1);
});
