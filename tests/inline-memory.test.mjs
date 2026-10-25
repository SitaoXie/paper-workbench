import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {validateAnnotation} from '../server/annotations.mjs';
const code=ts.transpileModule(readFileSync(new URL('../src/inline-memory.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {inlineMemoryKey,resolveTextAnchor,readInlineMemory,saveInlineMemory}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
const anchor={start:7,end:14,quote:'passage',before:'before ',after:' after'};
test('inline markers resolve unchanged or shifted text but reject changed and ambiguous sources',()=>{
 assert.deepEqual(resolveTextAnchor('before passage after',anchor),{start:7,end:14});
 assert.deepEqual(resolveTextAnchor('prefix before passage after',anchor),{start:14,end:21});
 assert.equal(resolveTextAnchor('before changed after',anchor),undefined);
 assert.equal(resolveTextAnchor('prefix before passage after and before passage after',anchor),undefined);
});
test('marker persistence isolates paper, version, language and scope; hidden markers retain results',()=>{
 const key=inlineMemoryKey('paper','reading','v1','zh');const entry={id:'result',anchor,text:'passage',result:'解释',kind:'explanation',language:'zh',hidden:true};
 assert.equal(saveInlineMemory(key,[entry]),true);assert.deepEqual(readInlineMemory(key),[entry]);
 for(const other of [inlineMemoryKey('other','reading','v1','zh'),inlineMemoryKey('paper','reading','v2','zh'),inlineMemoryKey('paper','reading','v1','en'),inlineMemoryKey('paper','abstract',undefined,'zh')])assert.deepEqual(readInlineMemory(other),[]);
 saveInlineMemory(key,Array.from({length:60},(_,i)=>({...entry,id:String(i)})));assert.equal(readInlineMemory(key).length,50);
 storage.set(key,'not json');assert.deepEqual(readInlineMemory(key),[]);
 const old=globalThis.localStorage;globalThis.localStorage={getItem:()=>{throw Error('blocked')},setItem:()=>{throw Error('full')}};assert.deepEqual(readInlineMemory(key),[]);assert.equal(saveInlineMemory(key,[entry]),false);globalThis.localStorage=old;
});
test('PDF hide/restore persists source anchors and body without deleting the note',()=>{
 const paper={id:'paper',filePath:'fixture.pdf',pages:[{number:1},{number:2}]};
 const segments=[{page:1,quote:'first',rects:[{x:.1,y:.2,width:.3,height:.02}]},{page:2,quote:'second',rects:[{x:.1,y:.2,width:.3,height:.02}]}];
 const original=validateAnnotation({kind:'translation',segments,body:'译文',language:'zh-CN'},paper);
 const hidden=validateAnnotation({markerHidden:true},paper,original);assert.equal(hidden.markerHidden,true);assert.equal(hidden.id,original.id);assert.equal(hidden.body,'译文');assert.deepEqual(hidden.segments,segments);
 assert.equal(validateAnnotation({markerHidden:false},paper,hidden).markerHidden,false);
 assert.throws(()=>validateAnnotation({markerHidden:'true'},paper,hidden),/boolean/);
});
