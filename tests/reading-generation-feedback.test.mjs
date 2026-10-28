import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
const require=createRequire(import.meta.url);
for(const zh of [true,false])test(`generation feedback ${zh?'Chinese':'English'}: real stage, indeterminate progress and confirmation gate`,async()=>{
 const dom=new JSDOM('<div id="root"></div>');
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 const exports={};let next,requests=0,confirmed=0,cancelled=0;
 const code=ts.transpileModule(readFileSync(new URL('../src/ReadingGenerationFeedback.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,document:dom.window.document,setTimeout:fn=>{next=fn;return 1;},clearTimeout:()=>{next=undefined;},setInterval:()=>1,clearInterval:()=>{},require:name=>name==='./i18n'?{t:(cn,en)=>zh?cn:en}:name==='./ComposerControls'?{ReasoningControl:()=>React.createElement('span',null,'Reasoning control')}:name==='./types'?{api:async()=>{requests++;if(requests===2)throw new Error('offline');return {running:true,stage:requests===1?'images':'edit',completed:3,total:14,text:'LIVE_REPORT_PREVIEW',reasoning:'DISPLAY_REASONING'};}}:require(name)});
 const root=createRoot(document.getElementById('root'));
 try{
  await act(async()=>root.render(React.createElement(exports.ReadingGenerationProgress,{paperId:'paper-a'})));
  assert.match(document.querySelector('[role=status]').textContent,/3 \/ 14/);
  assert.equal(document.querySelector('[role=progressbar]').hasAttribute('aria-valuenow'),false);assert.match(document.querySelector('.reading-stream-preview').textContent,/LIVE_REPORT_PREVIEW/);assert.match(document.querySelector('.reading-stream-reasoning').textContent,/DISPLAY_REASONING/);
  await act(async()=>next());assert.match(document.body.textContent,zh?/暂时无法获取进度/:/temporarily unavailable/);
  await act(async()=>next());assert.match(document.querySelector('[role=status]').textContent,zh?/最终解读/:/final overview/);
  await act(async()=>root.render(React.createElement(exports.InteractiveGenerationConfirm,{settings:{model:'fixture-model',activeProfileId:'one',profiles:[{id:'one',name:'Fixture',model:'fixture-model',models:['fixture-model','second-model']}]},onConfirm:selection=>{assert.equal(selection.model,'second-model');assert.equal(selection.profileId,'one');confirmed++;return true;},onCancel:()=>cancelled++})));
  assert.equal(next,undefined,'Progress polling stops when generation finishes');
  assert.equal(confirmed,0);assert.match(document.querySelector('dialog').textContent,/fixture-model/);
  await act(async()=>{const select=document.querySelector('dialog select');select.value=JSON.stringify(['one','second-model']);select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  assert.equal(confirmed,0,'Changing the model does not call the API before confirmation');
  await act(async()=>document.querySelector('dialog .soft-button').click());assert.equal(cancelled,1);assert.equal(confirmed,0);
  await act(async()=>document.querySelector('dialog').dispatchEvent(new dom.window.Event('cancel',{bubbles:true,cancelable:true})));assert.equal(cancelled,2);assert.equal(confirmed,0);
  await act(async()=>document.querySelector('dialog .primary-button').click());assert.equal(confirmed,1);
 }finally{await act(async()=>root.unmount());dom.window.close();delete globalThis.window;delete globalThis.document;delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});
