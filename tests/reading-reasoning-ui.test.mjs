import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import * as reasoning from '../shared/model-reasoning.mjs';
import {validateSettings,generateReport} from '../server/models.mjs';
import {defaultSettings} from '../server/storage.mjs';
const require=createRequire(import.meta.url);
for(const zh of [true,false])test(`reading confirmation ${zh?'zh':'en'} keeps effort local until confirmation and sends it to report transport`,async()=>{
 const dom=new JSDOM('<div id="root"></div>');globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 const {createRoot}=await import('react-dom/client');
 const root=createRoot(document.getElementById('root'));const writes=[];let confirmed=0,cancelled=0,sent;
 let settings=validateSettings({profiles:[{id:'fixture',name:'Fixture',model:'model',models:['model'],baseUrl:'https://fixture.example/v1',apiKey:'fixture',modelReasoning:{model:{protocol:'openai-effort',levels:['low','high'],value:'default'}}}],activeProfileId:'fixture'},defaultSettings);
 const cache={};
 function load(file){if(cache[file])return cache[file];const exports={};cache[file]=exports;
  const code=ts.transpileModule(readFileSync(new URL(`../src/${file}.tsx`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,document,window,crypto:globalThis.crypto,setTimeout,clearTimeout,setInterval,clearInterval,require:name=>name.endsWith('.css')?{}:name==='./ComposerControls'?load('ComposerControls'):name==='./i18n'?{t:(cn,en)=>zh?cn:en||cn,useLocale:()=>({t:(cn,en)=>zh?cn:en||cn})}:name==='../shared/model-reasoning.mjs'?reasoning:name==='./model-selection'?{useModelSelection:()=>({pending:false}),writeWorkspaceSettings:async(load,done)=>{done(await load());return {ok:true};},selectWorkspaceModel:()=>{throw Error('Local draft must not select a workspace model');}}:name==='./types'?{api:async(route,options)=>{writes.push(JSON.parse(options.body));return settings;}}:require(name)});return exports;
 }
 const Component=load('ReadingGenerationFeedback').InteractiveGenerationConfirm;
 try{
  await act(async()=>root.render(React.createElement(Component,{settings,onCancel:()=>cancelled++,onConfirm:async selection=>{confirmed++;settings=validateSettings({activeProfileId:selection.profileId,model:selection.model,modelReasoning:selection.modelReasoning},settings);await generateReport({id:'paper',title:'Paper',authors:[],abstract:'Original source.',text:'Source.'},settings,{adversarial:false,fetchImpl:async(_,options)=>{sent=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{message:{content:'Complete report.'},finish_reason:'stop'}]}));}});return true;}})));
  assert.ok(document.querySelector('input[type=range]'));await act(async()=>document.querySelector('.composer-reasoning-scale button:last-child').click());
  assert.equal(writes.length,0);assert.equal(confirmed,0);assert.equal(settings.modelReasoning.model.value,'default');
  await act(async()=>document.querySelector('dialog .soft-button').click());assert.equal(cancelled,1);assert.equal(settings.modelReasoning.model.value,'default');
  await act(async()=>document.querySelector('dialog .primary-button').click());assert.equal(confirmed,1);assert.equal(settings.modelReasoning.model.value,'high');assert.equal(sent.reasoning_effort,'high');assert.equal(sent.stream,true);
 }finally{await act(async()=>root.unmount());dom.window.close();delete globalThis.window;delete globalThis.document;delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});
