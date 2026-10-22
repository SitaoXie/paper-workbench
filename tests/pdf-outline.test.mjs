import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { outlinePdf, longOutlineTitle } from './fixtures/outline-pdf.mjs';
const compile = file => ts.transpileModule(fs.readFileSync(new URL('../src/'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const uri = code => 'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const destination = uri(compile('pdf-destination.ts'));
const {loadPdfOutline,currentOutlineNode} = await import(uri(compile('pdf-outline.ts').replace(/from ['"]\.\/pdf-destination['"]/,`from '${destination}'`)));
const require=createRequire(import.meta.url), pdfjs=require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js');
async function realPdf(options){
  const actual=await pdfjs.getDocument({data:new Uint8Array(outlinePdf(options))});
  // The existing parser's PDF.js version takes a numeric viewport scale. Adapt
  // that signature to today's proxy without mocking destinations or geometry.
  const document={numPages:actual.numPages,getOutline:()=>actual.getOutline(),getPageLabels:()=>actual.getPageLabels(),getDestination:value=>actual.getDestination(value),getPageIndex:ref=>actual.getPageIndex(ref),getPage:async number=>{
    const page=await actual.getPage(number);return {view:page.view,getViewport:({scale})=>page.getViewport(scale)};
  }};
  return {document,destroy:()=>actual.destroy()};
}
test('real embedded outline resolves hierarchy, named coordinates and source/printed page numbers',async()=>{
  const pdf=await realPdf();
  try{
    const data=await loadPdfOutline(pdf.document);
    assert.equal(data.nodes.length,3);assert.equal(data.flat.length,4);
    assert.equal(data.nodes[1].title,longOutlineTitle);
    assert.deepEqual(data.nodes[1].target,{page:2,x:50/600,y:300/800});
    assert.deepEqual(data.nodes[1].children[0].target,{page:2,x:50/600,y:500/800});
    assert.deepEqual(data.nodes[2].target,{page:3,y:200/800});
    assert.equal(data.nodes[0].pageLabel,'i');assert.equal(data.nodes[1].pageLabel,'1');
    assert.equal(currentOutlineNode(data,2).id,'1');assert.equal(currentOutlineNode(data,2,'1.0').id,'1.0');
    assert.equal(currentOutlineNode(data,3,'1.0').id,'2');
  }finally{await pdf.destroy();}
});
test('outline caching is scoped to PDF identity and empty PDFs do not invent a heading',async()=>{
  const first=await realPdf(),empty=await realPdf({outline:false});
  try{
    const one=loadPdfOutline(first.document),two=loadPdfOutline(first.document);
    assert.equal(one,two);assert.equal((await one).nodes[0].title,'Introduction');
    assert.deepEqual(await loadPdfOutline(empty.document),{nodes:[],flat:[],truncated:false});
    assert.equal((await loadPdfOutline(first.document)).nodes.length,3);
  }finally{await first.destroy();await empty.destroy();}
});
test('a slow earlier PDF cannot contaminate another PDF cache, and unreadable outlines can retry',async()=>{
  let release,attempts=0;
  const slow={getOutline:()=>new Promise(resolve=>{release=resolve;}),getPageLabels:async()=>null};
  const delayed=loadPdfOutline(slow);
  const next={getOutline:async()=>[{title:'Next document',items:[]}],getPageLabels:async()=>null};
  assert.equal((await loadPdfOutline(next)).nodes[0].title,'Next document');
  release([{title:'Earlier document',items:[]}]);await delayed;
  assert.equal((await loadPdfOutline(next)).nodes[0].title,'Next document');
  const retry={getOutline:async()=>{if(++attempts===1)throw Error('Unreadable');return [];},getPageLabels:async()=>null};
  await assert.rejects(loadPdfOutline(retry),/Unreadable/);assert.equal((await loadPdfOutline(retry)).flat.length,0);assert.equal(attempts,2);
});
test('invalid destinations remain visibly unavailable and oversized trees are explicitly bounded',async()=>{
  const malformed={numPages:1,getOutline:async()=>[{title:'External source',url:'https://example.org',dest:null,items:[]},{title:'Bad page',dest:[8,{name:'Fit'}],items:[]}],getPageLabels:async()=>null};
  const data=await loadPdfOutline(malformed);assert.equal(data.nodes[0].external,true);assert.equal(data.nodes[0].target,undefined);assert.equal(data.nodes[1].target,undefined);
  const many={getOutline:async()=>Array.from({length:2005},(_,i)=>({title:'Section '+i,items:[]})),getPageLabels:async()=>null};
  const bounded=await loadPdfOutline(many);assert.equal(bounded.flat.length,2000);assert.equal(bounded.truncated,true);
});
