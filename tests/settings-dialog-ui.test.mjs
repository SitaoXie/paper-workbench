import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {validateSettings} from '../server/models.mjs';
import {defaultSettings} from '../server/storage.mjs';
import * as limits from '../shared/model-limits.mjs';
const dom=new JSDOM('<div id="root"></div>');
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import('react-dom/client');
const require=createRequire(import.meta.url);
const code=ts.transpileModule(readFileSync(new URL('../src/SettingsDialog.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
for(const zh of [true,false])test(`settings ${zh?'Chinese':'English'} removes active model, saves fallback and restores vision declaration`,async()=>{
 let settings=validateSettings({profiles:[{id:'one',name:'One',provider:'openai',baseUrl:'http://localhost:9999/v1',model:'visual',models:['visual','text'],modelCapabilities:{visual:'vision'}}],activeProfileId:'one'},defaultSettings);
 const requests=[],exports={};
 const root=createRoot(document.getElementById('root'));
 const render=()=>root.render(React.createElement(exports.default,{current:settings,onClose:()=>{},onSaved:value=>{settings=value;render();}}));
 vm.runInNewContext(code,{exports,window,document,crypto:globalThis.crypto,require:name=>name.endsWith('.css')?{}:name==='./i18n'?{t:(cn,en)=>zh?cn:en||cn,useLocale:()=>({})}:name==='../shared/model-limits.mjs'?limits:name==='./model-selection'?{useModelSelection:()=>({pending:false}),writeWorkspaceSettings:async(load,callback)=>{try{callback(await load());return {ok:true};}catch(error){return {ok:false,error:error.message};}}}:name==='./types'?{api:async(route,opts)=>{const body=JSON.parse(opts.body);requests.push(body);return validateSettings(body,settings);}}:require(name)});
 try{
  await act(async()=>render());
  const textarea=document.querySelector('#models-list');assert.ok(textarea);
  await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(textarea,'text');textarea.dispatchEvent(new window.Event('input',{bubbles:true}));});
  assert.equal(document.querySelector('#model').value,'text');assert.equal(requests.length,0,'Editing the form does not send paid requests or save implicitly');
  await act(async()=>document.querySelector('.settings-actions .primary-button').click());
  assert.deepEqual(requests.at(-1).profiles[0].models,['text']);assert.equal(settings.model,'text');assert.equal(settings.disabledModels[0].model,'visual');
  const restore=[...document.querySelectorAll('.settings-disabled-list button')].find(b=>b.parentElement.textContent.includes('visual'));
  await act(async()=>restore.click());
  assert.equal(settings.modelCapabilities.visual,'vision');assert.deepEqual(settings.disabledModels,[]);
  assert.ok(requests.at(-1).restoreModel);assert.match(document.querySelector('.form-success').textContent,zh?/已恢复/:/Restored/);
 }finally{await act(async()=>root.unmount());}
});
test.after(()=>{dom.window.close();delete globalThis.window;delete globalThis.document;delete globalThis.IS_REACT_ACT_ENVIRONMENT;});
