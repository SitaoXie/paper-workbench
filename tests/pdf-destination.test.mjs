import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const context={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/pdf-destination.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
const {resolvePdfDestination}=context.exports;
const plain=value=>JSON.parse(JSON.stringify(value));
function source(rotation=0){return {numPages:3,getPageIndex:async ref=>ref.num-1,getDestination:async()=>[{num:2},{name:'XYZ'},60,400,null],getPage:async()=>({view:[0,0,600,800],getViewport:()=>({width:rotation?800:600,height:rotation?600:800,rotation,convertToViewportPoint:(x,y)=>rotation?[y,x]:[x,800-y]})})};}
test('PDF named XYZ and FitH destinations retain the within-page location',async()=>{
  assert.deepEqual(plain(await resolvePdfDestination(source(),'section')),{page:2,x:.1,y:.5});
  assert.deepEqual(plain(await resolvePdfDestination(source(),[0,{name:'FitH'},200])),{page:1,y:.75});
  assert.deepEqual(plain(await resolvePdfDestination(source(),[2,{name:'Fit'}])),{page:3});
  assert.deepEqual(plain(await resolvePdfDestination(source(),[1,{name:'XYZ'},null,400,null])),{page:2,y:.5});
});
test('rotated PDF coordinates and FitR convert through the rendered page viewport',async()=>{
  assert.deepEqual(plain(await resolvePdfDestination(source(90),[0,{name:'XYZ'},60,400,null])),{page:1,x:.5,y:.1});
  assert.deepEqual(plain(await resolvePdfDestination(source(),[0,{name:'FitR'},60,50,500,600])),{page:1,x:.1,y:.25});
});
test('invalid page destinations do not silently jump to page one; extreme coordinates clamp safely',async()=>{
  for(const destination of [null,[],[-1,{name:'Fit'}],[3,{name:'Fit'}],[.5,{name:'XYZ'},10,20]]) assert.equal(await resolvePdfDestination(source(),destination),undefined);
  assert.deepEqual(plain(await resolvePdfDestination(source(),[0,{name:'XYZ'},-500,900])),{page:1,x:0,y:0});
});
