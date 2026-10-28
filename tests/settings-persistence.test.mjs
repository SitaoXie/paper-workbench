import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server/index.mjs';
import {Store} from '../server/storage.mjs';
const profiles=[
 {id:'first',name:'First',provider:'openai',baseUrl:'https://first.example/v1',apiKey:'fixture-secret-first',model:'visual',models:['visual','text'],modelCapabilities:{visual:'vision',text:'text'}},
 {id:'second',name:'Second',provider:'openai',baseUrl:'https://second.example/v1',apiKey:'fixture-secret-second',model:'other',models:['other']},
];
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'pw-persistence-'));
 const app=await createApp({dataDir:directory});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});});
 const request=async(body)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/settings`,body?{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});return {status:response.status,data:await response.json()};};
 await request({profiles,activeProfileId:'first'});
 return {request,store:app.locals.store,directory};
}
test('settings persist removals, restore models/capabilities and connections without exposing archived keys',async t=>{
 const {request,store,directory}=await fixture(t);
 let result=await request({profiles:[{...profiles[0],apiKey:undefined,model:'text',models:['text']}]});
 assert.equal(result.status,200);assert.deepEqual(result.data.profiles[0].models,['text']);
 assert.deepEqual(result.data.profiles[0].disabledModels,[{model:'visual',capability:'vision'}]);
 assert.equal(result.data.disabledProfiles.find(p=>p.id==='second').id,'second');assert.equal(result.data.disabledProfiles.find(p=>p.id==='second').apiKeyConfigured,true);
 assert.doesNotMatch(JSON.stringify(result.data),/fixture-secret|"apiKey":/);
 const reopened=new Store(directory);await reopened.init();assert.equal(reopened.data.settings.disabledProfiles.find(p=>p.id==='second').apiKey,'fixture-secret-second');
 assert.equal(reopened.data.settings.profiles[0].disabledModels[0].model,'visual');
 result=await request({restoreModel:{profileId:'first',model:'visual'}});
 assert.equal(result.status,200);assert.equal(result.data.profiles[0].modelCapabilities.visual,'vision');assert.deepEqual(result.data.profiles[0].disabledModels,[]);
 result=await request({restoreProfileId:'second'});assert.equal(result.status,200);assert.equal(result.data.profiles.length,2);assert.ok(!result.data.disabledProfiles.some(p=>p.id==='second'));
 assert.equal(store.data.settings.profiles[1].apiKey,'fixture-secret-second');assert.doesNotMatch(JSON.stringify(result.data),/fixture-secret/);
 assert.equal((await request({restoreProfileId:'missing'})).status,404);
 assert.equal((await request({restoreModel:{profileId:'first',model:'missing'}})).status,404);
});
test('manual re-add restores archived capability; moving connection clears archived model declarations and credentials',async t=>{
 const {request,store}=await fixture(t);
 const entry={...profiles[0],apiKey:undefined,model:'text',models:['text']};
 await request({profiles:[entry]});
 let result=await request({profiles:[{...entry,models:['text','visual'],modelCapabilities:undefined}]});
 assert.equal(result.data.modelCapabilities.visual,'vision');assert.deepEqual(result.data.disabledModels,[]);
 await request({profiles:[entry]});
 result=await request({profiles:[{...entry,baseUrl:'https://different.example/v1',modelCapabilities:undefined}]});
 assert.equal(result.data.apiKeyConfigured,false);assert.deepEqual(result.data.disabledModels,[]);assert.equal(store.data.settings.apiKey,'');
});
test('failed settings save rolls back, queued sidebar patches preserve both model and preferences across restart',async t=>{
 const {request,store,directory}=await fixture(t);const save=store.save.bind(store);
 store.save=async()=>{throw new Error('fixture disk failure');};
 assert.equal((await request({activeProfileId:'first',model:'text'})).status,500);
 assert.equal((await request()).data.model,'visual');
 let release,entered;const started=new Promise(r=>entered=r);const gate=new Promise(r=>release=r);let calls=0;
 store.save=async()=>{if(++calls===1){entered();await gate;}await save();};
 const first=request({activeProfileId:'second',model:'other'});await started;
 const second=request({assistant:{styleId:'concise',pdfMode:'images',webSearch:true,answerMode:'agent'}});release();
 const results=await Promise.all([first,second]);assert.ok(results.every(r=>r.status===200));
 const reopened=new Store(directory);await reopened.init();
 assert.equal(reopened.data.settings.model,'other');assert.equal(reopened.data.settings.assistant.styleId,'concise');assert.equal(reopened.data.settings.assistant.pdfMode,'images');assert.equal(reopened.data.settings.assistant.webSearch,true);assert.equal(reopened.data.settings.assistant.answerMode,'agent');
 assert.equal((await request({assistant:{webSearch:'yes'}})).status,400);
 assert.equal((await request({assistant:{webSearch:false}})).data.assistant.webSearch,false);
});
