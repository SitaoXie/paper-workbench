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
for(const zh of [true,false])test(`overview image preferences: ${zh?'Chinese':'English'} selection, persistence and capability guidance`,async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const exports={};const code=ts.transpileModule(readFileSync(new URL('../src/ReportInputOptions.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,localStorage:dom.window.localStorage,require:name=>name==='./i18n'?{t:(cn,en)=>zh?cn:en}:require(name)});
 let imageBatchSize=exports.loadReportImageBatchSize(),value=exports.loadReportInputMode(),settings={model:'writer',modelCapabilities:{writer:'text'}};
 const root=createRoot(document.getElementById('root'));const render=()=>root.render(React.createElement(exports.ReportInputOptions,{settings,value,imageBatchSize,onImageBatchSizeChange:next=>{imageBatchSize=next;render();},hasPdf:true,disabled:false,onChange:mode=>{value=mode;render();},onConfigure:()=>{}}));
 try{
  assert.equal(imageBatchSize,0);assert.equal(value,'text-images');await act(async()=>render());
  assert.match(document.querySelector('[role=status]').textContent,zh?/纯文字层/:/only the text layer/);
  await act(async()=>{const select=document.querySelector('select');select.value='page-images';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  assert.equal(value,'page-images');assert.equal(exports.loadReportInputMode(),'page-images');
  exports.saveReportImageBatchSize(7);assert.equal(exports.loadReportImageBatchSize(),7);
  exports.saveReportImageBatchSize(-1);assert.equal(exports.loadReportImageBatchSize(),0);
  settings={...settings,vision:{enabled:true,profileId:'v',model:'reader'},profiles:[{id:'v',models:['reader'],modelCapabilities:{reader:'vision'},modelConfigured:true}]};
  await act(async()=>render());assert.match(document.querySelector('[role=status]').textContent,/reader/);
  settings={...settings,modelCapabilities:{writer:'vision'}};await act(async()=>render());
  assert.match(document.querySelector('[role=status]').textContent,zh?/直接看图/:/read images directly/);
 }finally{await act(async()=>root.unmount());dom.window.close();delete globalThis.window;delete globalThis.document;delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});
