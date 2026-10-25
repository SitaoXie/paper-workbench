import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {validateChatImages,chatImagePath} from '../server/chat-images.mjs';
function inputModule(overrides={}){
 const exports={};const code=ts.transpileModule(readFileSync(new URL('../src/chat-images.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,crypto:{randomUUID:()=> 'fixture-image'},...overrides});return exports;
}
test('clipboard image files work across files/items browser formats without duplicate images or intercepting text',()=>{
 const {clipboardImageFiles}=inputModule(),png={type:'image/png',name:'clipboard.png'},pdf={type:'application/pdf',name:'paper.pdf'};
 const item={kind:'file',type:png.type,getAsFile:()=>png};
 assert.deepEqual([...clipboardImageFiles({files:[png,pdf],items:[item]})],[png]);
 assert.deepEqual([...clipboardImageFiles({files:[],items:[item]})],[png]);
 assert.equal(clipboardImageFiles({files:[],items:[{kind:'string',type:'text/plain'}]}).length,0);
 assert.equal(clipboardImageFiles({files:[pdf],items:[]}).length,0);
});
test('image preparation bounds dimensions, preserves preview pixels and closes bitmap resources',async()=>{
 let closed=false,drawn=false;
 const canvas={getContext:()=>({drawImage:()=>{drawn=true;}}),toDataURL:()=> 'data:image/png;base64,ZmFrZQ=='};
 const {readChatImage}=inputModule({document:{createElement:()=>canvas},createImageBitmap:async()=>({width:6000,height:4000,close:()=>{closed=true;}})});
 const image=await readChatImage({type:'image/png',size:123,name:'screenshot.png'});
 assert.equal(canvas.width,3000);assert.equal(canvas.height,2000);assert.equal(image.mimeType,'image/png');assert.equal(image.data,'ZmFrZQ==');assert.ok(closed&&drawn);
 await assert.rejects(readChatImage({type:'image/svg+xml',size:1}));
});
test('chat attachments reject excessive counts, non-images and unsafe file references',()=>{
 assert.throws(()=>validateChatImages(Array(5).fill({})));
 assert.throws(()=>validateChatImages([{mimeType:'image/svg+xml',data:'ZmFrZQ=='}]));
 assert.throws(()=>validateChatImages([{mimeType:'image/png',data:'https://example.com/image.png'}]));
 assert.throws(()=>chatImagePath('/tmp',{id:'../secret',mimeType:'image/png'}));
 assert.throws(()=>chatImagePath('/tmp',{id:'0'.repeat(64),mimeType:'text/html'}));
});
