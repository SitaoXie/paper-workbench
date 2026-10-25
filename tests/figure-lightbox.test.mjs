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
test('source lightbox ignores scrollbar resize feedback and keeps the old canvas until the next zoom finishes',async()=>{
 const dom=new JSDOM('<!doctype html><div id="root"></div>');
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.HTMLElement=dom.window.HTMLElement;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 let clientWidth=1000;const callbacks=[],renders=[];
 for(const [key,get] of Object.entries({offsetWidth:()=>1000,offsetHeight:()=>600,clientWidth:()=>clientWidth,clientHeight:()=>600,scrollWidth:()=>1300,scrollHeight:()=>800}))Object.defineProperty(dom.window.HTMLElement.prototype,key,{configurable:true,get});
 const pdfPage={getViewport:({scale})=>({width:800*scale,height:450*scale}),render:options=>{let resolve;const promise=new Promise(r=>resolve=r);const task={promise,cancel(){task.cancelled=true;},resolve,canvas:options.canvas};renders.push(task);return task;}};
 const pdf={numPages:1,getPage:async()=>pdfPage};
 const exports={};const code=ts.transpileModule(readFileSync(new URL('../src/PdfFigure.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,HTMLCanvasElement:dom.window.HTMLCanvasElement,setTimeout,clearTimeout,ResizeObserver:class {constructor(callback){callbacks.push(callback);}observe(){}disconnect(){}},require:name=>name==='./i18n'?{useLocale:()=>({locale:'zh',t:(zh)=>zh})}:name==='pdfjs-dist'?{GlobalWorkerOptions:{},getDocument:()=>({promise:Promise.resolve(pdf),destroy:async()=>{}})}:name.endsWith('?url')?{default:'worker'}:name.endsWith('.css')?{}:require(name)});
 const root=createRoot(document.getElementById('root'));
 try{
 await act(async()=>root.render(React.createElement(exports.FigureLightbox,{url:'fixture.pdf',page:1,caption:'Caption',onClose(){}})));
 assert.equal(renders.length,1);
 await act(async()=>renders[0].resolve());
 const old=document.querySelector('canvas');assert.equal(old.dataset.rendered,'true');
 await act(async()=>document.querySelector('[aria-label="放大图表"]').click());
 assert.equal(renders.length,2);assert.equal(document.querySelector('canvas'),old,'Keep visible image while drawing next zoom offscreen');
 for(const next of [985,1000,985,1000]){clientWidth=next;await act(async()=>callbacks.forEach(fn=>fn()));}
 assert.equal(renders.length,2,'Scrollbar appearance must not schedule more PDF renders');
 await act(async()=>renders[1].resolve());const enlarged=document.querySelector('canvas');assert.notEqual(enlarged,old);assert.equal(old.width,0);
 assert.ok(Number.parseFloat(enlarged.style.width)>Number.parseFloat(old.style.width));
 await act(async()=>document.querySelector('[aria-label="图表适应窗口"]').click());
 assert.equal(document.querySelector('canvas'),enlarged);
 await act(async()=>renders[2].resolve());assert.equal(document.querySelector('[role="status"]'),null);
 }finally{await act(async()=>root.unmount());dom.window.close();delete globalThis.window;delete globalThis.document;delete globalThis.HTMLElement;delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});
