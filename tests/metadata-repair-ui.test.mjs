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
const code=ts.transpileModule(readFileSync(new URL('../src/MetadataRepair.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
for(const zh of [true,false])test(`metadata review ${zh?'Chinese':'English'} requires confirmation, applies selected fields and supports undo`,async()=>{
 const dom=new JSDOM('<div id="root"></div>');globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 const calls=[],updates=[],exports={};let closed=0;
 const paper={id:'fixture',title:'Paper <title>',authors:[],abstract:'old excerpt',abstractIsExcerpt:true};
 const proposal={proposalId:'proposal',paperId:'fixture',metadata:{authors:['Jane Doe'],institutions:['Example University'],abstract:'Original abstract source.'},before:{authors:[],institutions:[],abstract:'old excerpt',abstractIsExcerpt:true},evidence:{modelCalls:1},warnings:[]};
 vm.runInNewContext(code,{exports,AbortController,require:name=>name==='./i18n'?{useLocale:()=>({t:(cn,en)=>zh?cn:en})}:name==='./metadata-repair.css'?{}:name==='./ReadingGenerationFeedback'?{InteractiveGenerationConfirm:props=>React.createElement('button',{onClick:()=>props.onConfirm({profileId:'vision',model:'model'})},'Confirm')}:name==='./types'?{api:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});if(url.endsWith('/extract'))return proposal;if(url.endsWith('/apply'))return {paper:{...paper,authors:['Jane Doe']},changeId:'change'};return {paper};}}:require(name)});
 const root=createRoot(document.getElementById('root'));try{
  await act(async()=>root.render(React.createElement(exports.MetadataRepair,{papers:[paper],settings:{},onUpdated:p=>updates.push(p),onClose:()=>closed++})));
  assert.equal(calls.length,0);await act(async()=>document.querySelector('button').click());assert.equal(calls.length,1);assert.equal(updates.length,0);
  assert.match(document.querySelector('dialog').textContent,/Jane Doe/);assert.equal(document.querySelector('h3').textContent,'Paper <title>');assert.equal(document.querySelector('script'),null);assert.match(document.querySelector('.metadata-source-link').href,/paper=fixture&tab=paper&page=1/);
  const checkbox=document.querySelectorAll('input')[1];await act(async()=>checkbox.click());await act(async()=>document.querySelector('footer button').click());assert.deepEqual(calls[1].body.fields,['authors','abstract']);assert.equal(updates.length,1);
  await act(async()=>document.querySelector('.metadata-saved button').click());assert.match(calls[2].url,/undo$/);assert.equal(updates.length,2);await act(async()=>document.querySelector('header button').click());assert.equal(closed,1);
 }finally{await act(async()=>root.unmount());dom.window.close();delete globalThis.window;delete globalThis.document;delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});
