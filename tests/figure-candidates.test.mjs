import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {figureGroupPdf} from './fixtures/figure-group-pdf.mjs';
const transpile=name=>ts.transpileModule(fs.readFileSync(new URL(`../src/${name}.ts`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const geometry={exports:{}};vm.runInNewContext(transpile('figure-geometry'),geometry);
const context={exports:{},setTimeout,DOMException,require:name=>name==='pdfjs-dist'?pdfjs:geometry.exports};
vm.runInNewContext(transpile('figure-candidates'),context);
const {inspectFigureCandidates}=context.exports;
const ordinary=object=>JSON.parse(JSON.stringify(object));

async function fromPdf(t,options){const task=pdfjs.getDocument({data:new Uint8Array(figureGroupPdf(options)),useSystemFonts:true});t.after(()=>task.destroy());const doc=await task.promise;return inspectFigureCandidates(await doc.getPage(1));}
test('real PDF transparency-group transforms apply once and preserve complete source geometry',async t=>{
  const {candidates}=await fromPdf(t);assert.equal(candidates.length,1);
  const {crop,warning}=candidates[0];assert.equal(warning,'review');
  // The rendered blue rectangle occupies x=.2,y=.4,w=.4,h=.3.
  assert.ok(crop.x<.2&&crop.x>.18);assert.ok(crop.y<.4&&crop.y>.38);
  assert.ok(crop.x+crop.width>.6);assert.ok(crop.y+crop.height>.7);
});
test('source-page user units scale caption widths and graphics consistently; rotated pages never fabricate an unrotated crop',async t=>{
  const one=await fromPdf(t,{userUnit:1}),two=await fromPdf(t,{userUnit:2});
  assert.deepEqual(ordinary(one),ordinary(two));
  const rotated=await fromPdf(t,{rotation:90});assert.ok(rotated.candidates.every(candidate=>!candidate.crop));
});
test('unhandled clipping cannot present an unclipped image rectangle as an ordinary candidate',async()=>{
  const {OPS}=pdfjs;
  const page={pageNumber:1,getViewport:()=>({width:100,height:100,transform:[1,0,0,1,0,0]}),getTextContent:async()=>({items:[{str:'Figure 1: Clipped pixels.',width:70,transform:[10,0,0,-10,10,60],height:10}]})};
  const clipped={fnArray:[OPS.save,OPS.transform,OPS.constructPath,OPS.clip,OPS.endPath,OPS.paintImageXObject,OPS.restore],argsArray:[null,[60,0,0,40,10,5],[[OPS.rectangle],[0,0,.2,.2],null],null,null,['img',1,1],null]};
  const [candidate]=(await inspectFigureCandidates({...page,getOperatorList:async()=>clipped})).candidates;
  assert.equal(candidate.crop,undefined);assert.equal(candidate.warning,'complex-vectors');
});
test('Form bounding-box clips restrict nested image candidates to the displayed source extent',async()=>{
  const {OPS}=pdfjs;
  const page={pageNumber:1,getViewport:()=>({width:100,height:100,transform:[1,0,0,1,0,0]}),getTextContent:async()=>({items:[{str:'Figure 1: Source clipping.',width:60,transform:[8,0,0,-8,10,55],height:8}]}),getOperatorList:async()=>({fnArray:[OPS.paintFormXObjectBegin,OPS.transform,OPS.paintImageXObject,OPS.paintFormXObjectEnd],argsArray:[[[1,0,0,1,10,10],[0,0,30,30]],[60,0,0,60,0,0],['img',1,1],null]})};
  const [candidate]=(await inspectFigureCandidates(page)).candidates;
  assert.equal(candidate.warning,'review');assert.ok(candidate.crop.x+candidate.crop.width<.42);assert.ok(candidate.crop.y+candidate.crop.height<.42);
});
test('a cancelled page scan never publishes late candidates or proceeds to operators',async()=>{
  const controller=new AbortController();let requested=0;
  const page={getViewport:()=>({width:100,height:100,transform:[1,0,0,1,0,0]}),getTextContent:async()=>{controller.abort();return{items:[]};},getOperatorList:async()=>{requested++;return{fnArray:[],argsArray:[]};}};
  await assert.rejects(inspectFigureCandidates(page,controller.signal),error=>error.name==='AbortError');assert.equal(requested,0);
});
