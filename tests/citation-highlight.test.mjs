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
function load(file,imports={},globals={}){
 const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,{exports,setTimeout,clearTimeout,require:name=>imports[name]||(name.startsWith('.')||name.endsWith('.css')||name.endsWith('?url')?{default:()=>null}:require(name)),...globals});return exports;
}
const helper=load('citation-highlight.ts');
function clock(){
 let time=0,id=0;const tasks=new Map();
 return {schedule(fn,delay){const n=++id;tasks.set(n,{fn,at:time+delay});return n;},cancel(n){tasks.delete(n);},advance(ms){time+=ms;for(const [n,task] of [...tasks])if(task.at<=time){tasks.delete(n);task.fn();}},callbacks(){return [...tasks.values()].map(x=>x.fn);}};
}
test('citation lifetime starts only when displayed and restarts after repaint or repeated navigation',()=>{
 const c=clock(),life=helper.citationHighlightLifetime(c.schedule,c.cancel);let expired=0;
 life.begin('click-1');c.advance(9000);assert.equal(expired,0);
 life.shown('click-1',()=>expired++);c.advance(5500);life.pause();c.advance(10000);assert.equal(expired,0);
 life.shown('click-1',()=>expired++);const stale=c.callbacks()[0];
 life.begin('click-2');life.shown('click-2',()=>expired++);stale();assert.equal(expired,0,'A queued expiry from the previous click must not clear the new highlight');
 c.advance(5999);assert.equal(expired,0);c.advance(1);assert.equal(expired,1);
 life.begin('click-3');life.shown('click-3',()=>expired++);life.dispose();c.advance(10000);assert.equal(expired,1);
});
test('a PDF repaint pauses expiry and waits for text from the correct zoom before highlighting',async()=>{
 const dom=new JSDOM('<!doctype html><div id="root"></div>');globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const c=clock(),life=helper.citationHighlightLifetime(c.schedule,c.cancel),tasks=[],located=[];let expired=0;
 const pdfPage={getViewport:({scale})=>({width:400*scale,height:600*scale,userUnit:1}),getTextContent:async()=>({items:[{str:'Exact source'}]}),getAnnotations:async()=>[],render:()=>{let resolve;const promise=new Promise(r=>resolve=r);tasks.push({resolve});return {promise,cancel(){}};}};
 class TextLayer {constructor({container}){this.container=container;this.textDivs=[];}async render(){this.container.appendChild(document.createElement('span'));}cancel(){}}
 const {RenderedPage}=load('PdfReader.tsx',{'./citation-highlight':helper,'pdfjs-dist':{GlobalWorkerOptions:{},TextLayer},'./pdf-search':{bindPdfTextLayerItems(){},highlightPdfSearchMatch(container){located.push(Number(container.dataset.renderScale));return {rects:[{x:.1,y:.1,width:.3,height:.02}],firstRect:{top:60,left:40,right:160,bottom:72,width:120,height:12}};}}},{window:dom.window,document:dom.window.document});
 const root=createRoot(document.getElementById('root')),match={key:'citation:1',page:1,ranges:[]};
 const props={document:{getPage:async()=>pdfPage},number:1,scale:1,width:400,height:600,active:true,language:'en',annotations:[],strokes:[],drawing:false,annotationColor:'yellow',paperColors:'original',onNavigate(){},onStroke(){},searchMatch:match,onSearchLocated(m,rect){if(rect)life.shown(m.key,()=>expired++);else life.pause();}};
 life.begin(match.key);
 try{
 await act(async()=>root.render(React.createElement(RenderedPage,props)));
 c.advance(10000);assert.equal(expired,0);assert.equal(located.length,0);
 await act(async()=>tasks[0].resolve());assert.deepEqual(located,[1]);assert.equal(document.querySelectorAll('.pdf-search-highlight').length,1);
 c.advance(5500);
 await act(async()=>root.render(React.createElement(RenderedPage,{...props,scale:2,width:800,height:1200})));
 assert.deepEqual(located,[1],'Old-scale text must not be measured during the new layout pass');
 assert.equal(document.querySelectorAll('.pdf-search-highlight').length,0);
 c.advance(12000);assert.equal(expired,0,'Slow rendering must not consume the visible highlight duration');
 await act(async()=>tasks[1].resolve());assert.deepEqual(located,[1,2]);
 c.advance(5999);assert.equal(expired,0);c.advance(1);assert.equal(expired,1);
 await act(async()=>root.render(React.createElement(RenderedPage,{...props,scale:2,searchMatch:null,citationTarget:true})));
 assert.equal(document.querySelector('[data-pdf-page]').dataset.citationTarget,'true');
 assert.equal(document.querySelectorAll('.pdf-search-highlight').length,0,'A page-only citation must not fabricate a passage');
 }finally{await act(async()=>root.unmount());dom.window.close();delete globalThis.window;delete globalThis.document;delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});
