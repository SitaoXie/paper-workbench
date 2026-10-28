import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import * as reasoning from '../shared/model-reasoning.mjs';
import {validateSettings} from '../server/models.mjs';
import {defaultSettings} from '../server/storage.mjs';
const dom=new JSDOM('<div id="root"></div>');globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import('react-dom/client');const require=createRequire(import.meta.url);
const code=ts.transpileModule(readFileSync(new URL('../src/ComposerControls.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
for(const zh of [true,false])test(`composer ${zh?'Chinese':'English'} unified attachment/model menu and persisted reasoning slider`,async()=>{
 const exports={},requests=[];let images=0,pdfs=0,mode='api';
 let settings=validateSettings({profiles:[{id:'one',name:'Fixture',baseUrl:'http://localhost:9999/v1',model:'model',models:['model','model-low','model-high']}],activeProfileId:'one'},defaultSettings);
 settings.profiles[0].modelConfigured=true;
 const root=createRoot(document.getElementById('root'));const saved=value=>{settings=value;settings.profiles[0].modelConfigured=true;render();};
 const request=async body=>{requests.push(body);return validateSettings(body,settings);};
 const render=()=>root.render(React.createElement(React.Fragment,null,React.createElement(exports.ComposerAttachments,{disabled:false,onImage:()=>images++,onPdf:()=>pdfs++}),React.createElement(exports.AssistantModelMenu,{settings,onSettings:saved,mode,onMode:value=>{mode=value;render();},allowAgent:true,disabled:false,onConfigure:()=>{}})));
 vm.runInNewContext(code,{exports,window,document,require:name=>name.endsWith('.css')?{}:name==='./i18n'?{useLocale:()=>({t:(cn,en)=>zh?cn:en})}:name==='../shared/model-reasoning.mjs'?reasoning:name==='./types'?{api:async(_path,options)=>request(JSON.parse(options.body))}:name==='./model-selection'?{useModelSelection:()=>({pending:false,error:''}),selectWorkspaceModel:async(activeProfileId,model,onChange)=>{onChange(await request({activeProfileId,model}));return true;},writeWorkspaceSettings:async(load,onChange)=>{onChange(await load());return {ok:true};}}:require(name)});
 const click=async selector=>act(async()=>document.querySelector(selector).click());
 try{
  await act(async()=>render());await click('.composer-attach');assert.equal(document.querySelectorAll('.composer-attachments button').length,2);
  await click('.composer-attachments button');assert.equal(images,1);assert.equal(pdfs,0);assert.equal(document.querySelector('.composer-attachments'),null);
  await click('.composer-attach');await click('.composer-attachments button:last-child');assert.equal(pdfs,1);assert.equal(requests.length,0);
  await click('.composer-model-trigger');assert.equal(document.querySelectorAll('.composer-model-options button').length,3);assert.doesNotMatch(document.querySelector('.composer-model-panel').textContent,/extractive|本地原文检索/);
  const slider=document.querySelector('input[type=range]');
  await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(slider,'2');slider.dispatchEvent(new window.Event('input',{bubbles:true}));});
  assert.equal(requests.length,0,'Dragging previews the level before release');
  await act(async()=>slider.dispatchEvent(new window.Event('pointerup',{bubbles:true})));assert.equal(settings.model,'model-high');assert.equal(requests.length,1);
  await click('.composer-subscription-choice');assert.equal(mode,'agent');assert.equal(requests.length,2);assert.deepEqual(requests.at(-1),{assistant:{answerMode:'agent'}},'Subscription choice only saves a preference');assert.match(document.querySelector('.composer-model-trigger').textContent,/Codex/);
  await click('.composer-model-trigger');await click('.composer-model-options button');assert.equal(mode,'api');assert.equal(settings.model,'model');
  await click('.composer-model-trigger');await act(async()=>document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));assert.equal(document.querySelector('.composer-model-panel'),null);
 }finally{await act(async()=>root.unmount());}
});
test.after(()=>{dom.window.close();delete globalThis.window;delete globalThis.document;delete globalThis.IS_REACT_ACT_ENVIRONMENT;});
