import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const saved = new Map();
globalThis.sessionStorage = {getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value)};
const code=ts.transpileModule(readFileSync(new URL('../src/chat-scroll.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {saveChatScroll:save,readChatScroll:read,adoptChatScroll:adopt,removePaperChatScroll:remove,chatMessageAnchor:anchor,nearChatBottom:near}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const state=(top=700)=>({top,anchor:{key:'4-opaque',fraction:.35},following:false,unread:true,tail:'8-tail',count:9,updatedAt:Date.now()});
test('conversation positions isolate papers and adopt only an unsaved conversation without replacing existing history',()=>{
 const a=JSON.stringify(['alpha','same']),b=JSON.stringify(['beta','same']),pending=JSON.stringify(['alpha',null]);
 save(a,state());save(b,state(300));save(pending,state(99));adopt(pending,a);
 assert.equal(read(a).top,700);assert.equal(read(b).top,300);assert.equal(read(pending),undefined);
 save(pending,state(88));adopt(pending,JSON.stringify(['alpha','new']));assert.equal(read(JSON.stringify(['alpha','new'])).top,88);
 remove('alpha');assert.equal(read(a),undefined);assert.equal(read(b).top,300);
});
test('only bounded geometry is saved and private message text never enters anchors',()=>{
 const text='PRIVATE MESSAGE CONTENT';const id=anchor({role:'assistant',content:text},2);
 assert.match(id,/^2-[a-z0-9]+$/);assert.equal(id.includes(text),false);
 assert.notEqual(id,anchor({role:'assistant',content:text},3));
 for(let i=0;i<110;i++)save(`entry-${i}`,state(i));
 const entries=JSON.parse(saved.get('pw-chat-scroll-v1'));
 assert.equal(entries.length,100);assert.equal(read('entry-0'),undefined);assert.equal(read('entry-109').top,109);
 assert.equal(JSON.stringify(entries).includes(text),false);
 save('invalid',{...state(),top:NaN});assert.equal(read('invalid'),undefined);
});
test('bottom following has a bounded tolerance for short content and fractional pixel rounding',()=>{
 assert.equal(near(0,200,400),true);assert.equal(near(600,1000,400),true);
 assert.equal(near(540,1000,400),true);assert.equal(near(530,1000,400),false);
 assert.equal(near(599.5,1000,400),true);
});

test('streaming deltas update unread tracking without destabilizing message anchors',async()=>{
 const {chatProgressTail}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 const a={id:'stable',role:'assistant',content:'first',streaming:true},b={...a,content:'first and more'};
 assert.equal(anchor(a,0),anchor(b,0));assert.notEqual(chatProgressTail([a]),chatProgressTail([b]));
 assert.notEqual(chatProgressTail([a]),chatProgressTail([{...a,reasoning:[{text:'thinking'}]}]));
 assert.notEqual(chatProgressTail([a]),chatProgressTail([{...a,streaming:false}]));
});
