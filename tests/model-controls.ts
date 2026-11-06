import {expect,type Page} from '@playwright/test';

/** Exercise the current unified picker, including its asynchronous save. */
export async function chooseAnswerMode(page:Page,mode:'api'|'agent',model='fixture-model'){
 const trigger=page.getByRole('button',{name:/^(选择模型或订阅助手|Choose model or subscription assistant)$/});
 await trigger.click();
 const menu=page.getByRole('dialog',{name:/^(模型与订阅助手|Models and subscription assistant)$/});
 await menu.getByRole('button',{name:mode==='agent'?/Codex \/ Claude/:model,exact:mode==='api'}).click();
 await expect(menu).toHaveCount(0);await expect(trigger).toContainText(mode==='agent'?'Codex / Claude':model);
}

/** Network-free answer fixture: the UI must use API mode, while the isolated
 * backend's deterministic extractive generator supplies answers and persists
 * real conversations. This does not test an upstream provider implementation. */
export async function localAnswerFixture(page:Page){
 const profile={id:'e2e',name:'Offline answer fixture',provider:'openai',baseUrl:'https://example.invalid/v1',model:'fixture-model',models:['fixture-model'],modelConfigured:true,apiKeyConfigured:false};
 let settings:any={...profile,activeProfileId:'e2e',profiles:[profile],assistant:{answerMode:'api'}};
 await page.route('**/api/settings',async route=>{if(route.request().method()==='PUT')settings={...settings,...route.request().postDataJSON()};await route.fulfill({json:settings});});
 await page.route('**/api/chat',async route=>{
  const body=route.request().postDataJSON();expect(body.processing).toBe('api');
  const response=await route.fetch({postData:{...body,processing:'extractive'}});
  await route.fulfill({response});
 });
}
