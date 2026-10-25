import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
const require=createRequire(import.meta.url);
function load(dom){
 const exports={};
 const code=ts.transpileModule(readFileSync(new URL('../src/DiagramViewport.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,DOMParser:dom.window.DOMParser,ResizeObserver:class {observe(){} disconnect(){}},require:name=>name==='./i18n'?{t:(zh,en)=>en}:require(name)});
 return exports;
}
test('wide and tall SVG viewBoxes control frame geometry without a fixed blank region',()=>{
 const dom=new JSDOM('');const {diagramSize,diagramLayout,clampDiagramScale,zoomedScroll}=load(dom);
 const wide=diagramSize('<svg viewBox="-8 -8 1800 72" width="100%" style="max-width:1800px"></svg>');
 assert.equal(wide.width,1800);assert.equal(wide.height,72);
 assert.equal(diagramLayout(wide,480,1).viewportHeight,92);
 assert.equal(diagramLayout(wide,480,480/1800).viewportHeight,20);
 assert.equal(diagramLayout({width:400,height:2400},480,1).viewportHeight,420);
 assert.equal(diagramLayout(wide,480,2).width,3600);
 assert.equal(clampDiagramScale(10),4);assert.equal(clampDiagramScale(.001),.1);
 assert.equal(zoomedScroll(300,200,1,2),800);
 dom.window.close();
});
test('zoom controls change actual SVG dimensions, fit/reset and wheel/keyboard preserve sandboxing',async()=>{
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost'});
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const descriptor=Object.getOwnPropertyDescriptor(dom.window.HTMLElement.prototype,'clientWidth');
 Object.defineProperty(dom.window.HTMLElement.prototype,'clientWidth',{configurable:true,get(){return 480;}});
 const {default:Viewport}=load(dom);const root=createRoot(document.getElementById('root'));
 try{
 await act(async()=>root.render(React.createElement(Viewport,{svg:'<svg viewBox="0 0 1800 72"></svg>',size:{width:1800,height:72}})));
 const frame=document.querySelector('iframe'),surface=document.querySelector('[role="region"]');
 assert.equal(frame.style.width,'1800px');assert.equal(frame.style.height,'72px');assert.equal(surface.style.height,'92px');
 const doc=frame.getAttribute('srcdoc');
 assert.equal(frame.getAttribute('sandbox'),'');assert.match(doc,/default-src 'none'/);assert.ok(!doc.includes('<script'));
 const click=async label=>act(async()=>document.querySelector('[aria-label="'+label+'"]').click());
 await click('Zoom in');assert.equal(frame.style.width,'2250px');assert.equal(frame.getAttribute('srcdoc'),doc,'Zoom does not reload diagram source');
 await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Fit width').click());
 assert.equal(frame.style.width,'480px');assert.equal(surface.style.height,'20px');
 await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='1:1').click());
 assert.equal(frame.style.width,'1800px');assert.equal(surface.scrollLeft,0);
 await act(async()=>surface.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'+',bubbles:true,cancelable:true})));
 assert.equal(frame.style.width,'2250px');
 await act(async()=>surface.dispatchEvent(new dom.window.WheelEvent('wheel',{ctrlKey:true,deltaY:-40,clientX:100,bubbles:true,cancelable:true})));
 assert.ok(Number.parseFloat(frame.style.width)>2250);
 // Native horizontal-scroll dimensions are supplied here; jsdom does not lay out.
 Object.defineProperties(surface,{scrollWidth:{configurable:true,value:4000},scrollHeight:{configurable:true,value:72},clientHeight:{configurable:true,value:92}});
 surface.scrollLeft=0;
 await act(async()=>surface.dispatchEvent(new dom.window.WheelEvent('wheel',{deltaY:80,bubbles:true,cancelable:true})));
 assert.equal(surface.scrollLeft,80);
 let captured=false;
 surface.setPointerCapture=()=>{captured=true;};surface.hasPointerCapture=()=>captured;surface.releasePointerCapture=()=>{captured=false;};
 const pointer=async(type,props)=>act(async()=>{const event=new dom.window.Event(type,{bubbles:true});Object.assign(event,{pointerId:1,pointerType:'mouse',button:0,...props});surface.dispatchEvent(event);});
 await pointer('pointerdown',{clientX:200,clientY:100});
 await pointer('pointermove',{clientX:120,clientY:70});
 assert.equal(surface.scrollLeft,160);assert.ok(surface.classList.contains('is-dragging'));
 await pointer('pointerup',{});assert.equal(captured,false);assert.ok(!surface.classList.contains('is-dragging'));
 await pointer('pointerdown',{pointerType:'touch',clientX:200,clientY:100});assert.equal(captured,false,'Touch swipes retain native scrolling');
 }finally{
 await act(async()=>root.unmount());if(descriptor)Object.defineProperty(dom.window.HTMLElement.prototype,'clientWidth',descriptor);
 dom.window.close();delete globalThis.window;delete globalThis.document;delete globalThis.IS_REACT_ACT_ENVIRONMENT;
 }
});
