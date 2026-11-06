import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
function moduleAt(path,overrides={}) {const source=readFileSync(new URL(path,import.meta.url),'utf8');const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;const exports={};vm.runInNewContext(code,{exports,require:name=>name.endsWith('.css')?{}:overrides[name]||require(name)});return exports;}
const {applyChatEvent,completedChat}=moduleAt('../src/chat-stream.ts',{'../shared/sse.mjs':{},'./workspace-mode':{apiUrl:p=>'/api'+p}});
test('round transitions replace provisional text, retain each reasoning round, and never reuse failed previews as history',()=>{
 let message={role:'assistant',content:'',streaming:true};
 message=applyChatEvent(message,{type:'reasoning',round:1,delta:'search first'});
 message=applyChatEvent(message,{type:'text',round:1,delta:'tool preface'});
 message=applyChatEvent(message,{type:'round',round:2});assert.equal(message.content,'');assert.equal(message.reasoning[0].text,'search first');
 message=applyChatEvent(message,{type:'reasoning',round:2,delta:'now answer'});message=applyChatEvent(message,{type:'text',round:2,delta:'grounded answer'});
 assert.equal(message.reasoning.length,2);assert.equal(message.content,'grounded answer');
 const history=completedChat([{id:'saved',role:'assistant',content:'old'},{role:'user',content:'retry'},{...message,streaming:false,streamError:'failed'}]);assert.equal(history.length,1);assert.equal(history[0].id,'saved');
});
test('thinking panel is initially expanded while streaming and collapsed for saved answers; text is escaped in both languages',()=>{
 for(const chinese of [true,false]){const Panel=moduleAt('../src/ReasoningPanel.tsx',{'./i18n':{t:(zh,en)=>chinese?zh:en}}).default;
  for(const streaming of [true,false]){const html=renderToStaticMarkup(React.createElement(Panel,{message:{streaming,reasoning:[{round:1,text:'<script>bad</script>'}]}}));
   assert.equal(/<details[^>]* open=""/.test(html),streaming);assert.ok(!html.includes('<script>'));assert.match(html,chinese?(streaming?/思考中/:/思考已完成/):(streaming?/Thinking/:/Thinking complete/));}
  assert.equal(renderToStaticMarkup(React.createElement(Panel,{message:{content:'answer'}})),'');}
});
