import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import * as prompts from '../shared/assistant-prompts.mjs';
const require=createRequire(import.meta.url);
for(const chinese of [true,false])test(`assistant prompt UI ${chinese?'Chinese':'English'}: read-only built-ins, editable customs, mode persistence and keyboard close`,async()=>{
 const dom=new JSDOM('<!doctype html><div id="root"></div>');globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 dom.window.HTMLElement.prototype.getBoundingClientRect=()=>({top:700,right:800});
 const requests=[];let settings={model:'vision',modelCapabilities:{vision:'vision'},assistant:{styleId:'balanced',pdfMode:'text',customStyles:[{id:'custom-mine',name:'Mine',prompt:'Examples please.'}]}};
 const exports={};const code=ts.transpileModule(readFileSync(new URL('../src/AssistantPreferences.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const root=createRoot(document.getElementById('root'));const render=()=>root.render(React.createElement(exports.default,{settings,chinese,onChange:value=>{settings=value;render();}}));
 vm.runInNewContext(code,{exports,window:dom.window,document:dom.window.document,crypto:globalThis.crypto,require:name=>name.endsWith('.css')?{}:name==='../shared/assistant-prompts.mjs'?prompts:name==='./types'?{api:async(_path,opts)=>{const body=JSON.parse(opts.body);requests.push(body);return {...settings,...body};}}:require(name)});
 try{
   await act(async()=>render());await act(async()=>document.querySelector('button').click());
   const panel=document.querySelector('.assistant-preferences-panel');assert.equal(panel.parentElement,document.body);assert.ok(document.querySelector('textarea').readOnly);
   const select=document.querySelector('select');await act(async()=>{select.value='concise';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});assert.equal(requests.at(-1).assistant.styleId,'concise');assert.equal(requests.at(-1).profiles,undefined);
   await act(async()=>{select.value='custom-mine';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
   const buttons=()=>[...document.querySelectorAll('.assistant-preferences-panel button')];
   await act(async()=>buttons().find(b=>b.textContent===(chinese?'编辑':'Edit')).click());assert.equal(document.querySelector('textarea').readOnly,false);assert.equal(document.querySelector('input').value,'Mine');
   await act(async()=>buttons().find(b=>b.textContent===(chinese?'取消':'Cancel')).click());
   const mode=document.querySelectorAll('select')[1];await act(async()=>{mode.value='images';mode.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});assert.equal(requests.at(-1).assistant.pdfMode,'images');
   await act(async()=>document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));assert.equal(document.querySelector('.assistant-preferences-panel'),null);
 }finally{await act(async()=>root.unmount());dom.window.close();delete globalThis.window;delete globalThis.document;delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});
