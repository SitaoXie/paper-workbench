import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import('react-dom/client');const require=createRequire(import.meta.url);
const code=ts.transpileModule(readFileSync(new URL('../src/OnboardingCard.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
for(const zh of [true,false])test(`first-run guide has explicit no-API demo and separate import/model actions (${zh?'zh':'en'})`,async()=>{
 const exports={};vm.runInNewContext(code,{exports,window,document,require:name=>name.endsWith('.css')?{}:name==='./i18n'?{useLocale:()=>({t:(cn,en)=>zh?cn:en})}:require(name)});
 const calls=[];const root=createRoot(document.getElementById('root'));
 try{
  await act(async()=>root.render(React.createElement(exports.default,{onDemo:()=>calls.push('demo'),onImport:()=>calls.push('import'),onConfigure:()=>calls.push('model'),onDismiss:()=>calls.push('dismiss')})));
  assert.equal(document.querySelector('[role=dialog]'),null,'Onboarding is nonmodal');assert.equal(calls.length,0,'Rendering has no model or import side effects');
  assert.match(document.querySelector('.onboarding-demo').textContent,zh?/无需 API.*不调用模型/:/No API key.*No model calls/);
  await act(async()=>document.querySelector('.onboarding-demo').click());
  await act(async()=>document.querySelector('.onboarding-path:not(.onboarding-demo)').click());
  await act(async()=>document.querySelector('.onboarding-ai button').click());
  assert.deepEqual(calls,['demo','import','model']);
  assert.equal(exports.onboardingDismissed(),false);
  await act(async()=>document.querySelector('.onboarding-dismiss').click());assert.equal(exports.onboardingDismissed(),true);
  exports.reopenOnboarding();assert.equal(exports.onboardingDismissed(),false);
  assert.equal(window.localStorage.getItem('paper-workbench:onboarding:v1'),null);
 }finally{await act(async()=>root.unmount());}
});
test('guide remains dismissible with unavailable browser storage',()=>{
 const exports={};const restrictedWindow={get localStorage(){throw new Error('storage blocked');}};
 vm.runInNewContext(code,{exports,window:restrictedWindow,require:name=>name.endsWith('.css')?{}:name==='./i18n'?{useLocale:()=>({t:(_cn,en)=>en})}:require(name)});
 assert.equal(exports.onboardingDismissed(),false);assert.doesNotThrow(()=>exports.dismissOnboarding());assert.equal(exports.onboardingDismissed(),true);
 assert.doesNotThrow(()=>exports.reopenOnboarding());assert.equal(exports.onboardingDismissed(),false);
});
test.after(()=>{dom.window.close();delete globalThis.window;delete globalThis.document;delete globalThis.IS_REACT_ACT_ENVIRONMENT;});
