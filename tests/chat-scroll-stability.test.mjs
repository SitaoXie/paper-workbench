import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React,{act,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import * as reactMarkdown from 'react-markdown';
import * as remarkGfm from 'remark-gfm';
import * as remarkMath from 'remark-math';
import * as rehypeKatex from 'rehype-katex';
const require=createRequire(import.meta.url);
function load(file,overrides={},globals={}){
 const exports={};
 const source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,require:name=>name.endsWith('.css')?{}:overrides[name]||require(name),...globals});
 return exports;
}
function setup(){
 const dom=new JSDOM('<!doctype html><div id="root"></div>');
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const root=createRoot(document.getElementById('root'));
 return {dom,root,async close(){await act(async()=>root.unmount());dom.window.close();delete globalThis.window;delete globalThis.document;delete globalThis.IS_REACT_ACT_ENVIRONMENT;}};
}
test('parent scroll-state updates and streaming prose do not remount diagrams or reset their zoom',async()=>{
 const fixture=setup();let mounts=0,unmounts=0;
 function Diagram(){const [zoom,setZoom]=useState(100);useEffect(()=>{mounts++;return()=>unmounts++;},[]);return React.createElement('button',{onClick:()=>setZoom(zoom+25)},zoom+'%');}
 const passthrough={default:({children})=>children},plugin={default:()=>{}};
 const Mark=load('Markdown.tsx',{
  'react-markdown':reactMarkdown,'remark-gfm':remarkGfm,'remark-math':remarkMath,'rehype-katex':rehypeKatex,
  './CitationLink':passthrough,'./RecoverableFeature':passthrough,'./ReadingVisual':{default:Diagram},
  './remark-page-citations':plugin,'./remark-cjk-emphasis':plugin,'./paper-citation':{paperCitation:()=>null},
  './reading-sections':{},'./figure-captions':{},'./reading-figures':{},'./i18n':{t:(_zh,en)=>en},
 }).default;
 try{
  const source='## Explanation\n\n```mermaid\nflowchart LR\n A --> B\n```';
  await act(async()=>fixture.root.render(React.createElement(Mark,{onPage:()=>{}},source)));
  await act(async()=>document.querySelector('button').click());
  const original=document.querySelector('button');assert.equal(original.textContent,'125%');
  for(let i=0;i<8;i++)await act(async()=>fixture.root.render(React.createElement(Mark,{onPage:()=>{},onSource:()=>{}},source+'\n\nMore answer text '.repeat(i))));
  assert.equal(document.querySelector('button')===original,true,'Diagram DOM must survive parent updates');
  assert.equal(original.textContent,'125%');assert.equal(mounts,1);assert.equal(unmounts,0);
 }finally{await fixture.close();}
});
test('bottom following observes the transcript after recommendations and avoids fractional scroll feedback',async()=>{
 const fixture=setup(),saved=new Map(),observed=new Set();let resize,controller,top=0,height=1400,writes=0;
 const {useChatScroll}=load('useChatScroll.ts',{'./chat-scroll':{
  chatMessageAnchor:(m,i)=>m.id||String(i),chatProgressTail:ms=>ms.at(-1)?.content||'',
  nearChatBottom:(top,height,viewport)=>height-viewport-top<=64,
  readChatScroll:key=>saved.get(key),saveChatScroll:(key,value)=>saved.set(key,value),
 }},{ResizeObserver:class{constructor(callback){resize=callback;}observe(node){observed.add(node);}disconnect(){observed.clear();}}});
 const messages=[{id:'message',role:'assistant',content:'Answer'}];
 function Harness(){controller=useChatScroll('session',messages,false);return React.createElement('div',{
  ref:node=>{if(node){Object.defineProperties(node,{scrollHeight:{configurable:true,get:()=>height},clientHeight:{configurable:true,get:()=>400},scrollTop:{configurable:true,get:()=>top,set:value=>{writes++;top=value;}}});}controller.ref(node);},
  onScroll:controller.onScroll,
 },React.createElement('section',{id:'recommendations'},'Questions'),React.createElement('section',{id:'transcript'},'Answer'));}
 try{
  await act(async()=>fixture.root.render(React.createElement(Harness)));
  assert.ok(observed.has(document.getElementById('transcript')),'Messages resize must be observed even when recommendations precede them');
  assert.equal(top,1000);const before=writes;
  top=999.5;for(let i=0;i<10;i++)await act(async()=>resize());
  assert.equal(writes,before,'Sub-pixel differences must not cause scroll writes');
  height=1600;await act(async()=>resize());assert.equal(top,1200,'Late diagram growth follows the reader at the bottom');
  top=300;await act(async()=>controller.onScroll());assert.equal(controller.away,true);
  height=1800;await act(async()=>resize());assert.equal(top,300,'Content growth must not pull an away reader to the bottom');
 }finally{await fixture.close();}
});
