import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {validateDiagram,parseChart} from '../shared/reading-visuals.mjs';
const require=createRequire(import.meta.url);
function component(file,overrides={}){const exports={};const code=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(code,{exports,require:name=>name.endsWith('.css')?{}:overrides[name]||require(name)});return exports.default;}
test('diagrams permit explanatory graphs but reject executable configuration, HTML, links and oversized graphs',()=>{
 const valid='flowchart LR\n A["Input image"] --> B["Visible patches"]\n B --> C["Decoder"]';assert.equal(validateDiagram(valid),valid);
 for(const input of ['flowchart LR\nclick A "https://example.org"','flowchart LR\n%%{init: {securityLevel:"loose"}}%%','flowchart LR\nA["<img src=x>"]','flowchart LR\nstyle A fill:url(x)','flowchart LR\nA@{img:"x"}','---\nconfig: bad\n---\nflowchart LR',valid+'\n'.repeat(181)])assert.throws(()=>validateDiagram(input));
});
test('chart contract preserves exact numbers, labels, source and units without coercion',()=>{
 const data={type:'bar',title:'Accuracy',unit:'%',source:'Table 1, p.4',data:[{label:'A',value:84.9},{label:'B',value:85}]};assert.deepEqual(parseChart(JSON.stringify(data)),data);
 for(const input of [{...data,unit:''},{...data,source:''},{...data,type:'script'},{...data,data:[{label:'A',value:'84.9'}]},{...data,data:[{label:'A',value:1e30}]},{...data,data:[data.data[0],data.data[0]]}])assert.throws(()=>parseChart(JSON.stringify(input)));
 assert.throws(()=>parseChart('{"type":"bar"}'));
});
test('charts render accessible values and source as escaped text in both languages',()=>{
 for(const chinese of [true,false]){const Visual=component('../src/ReadingVisual.tsx',{'./DiagramViewport':{},'./i18n':{t:(zh,en)=>chinese?zh:en},'../shared/reading-visuals.mjs':{parseChart,validateDiagram}});
 const html=renderToStaticMarkup(React.createElement(Visual,{kind:'chart',source:JSON.stringify({type:'bar',title:'<script>test</script>',unit:'%',source:'p.4',data:[{label:'A',value:84.9},{label:'B',value:85}]})}));
 assert.ok(!html.includes('<script>'));assert.match(html,/84\.9/);assert.match(html,/<table>/);assert.match(html,/<svg/);assert.match(html,/p\.4/);assert.match(html,chinese?/AI 辅助绘制/:/AI-generated visual/);}
});
test('empty retrieval block is omitted while failed retrieval remains visible',()=>{
 const Evidence=component('../src/AgentEvidence.tsx');const base={version:1,steps:[],modelCalls:1,initialSources:[{title:'Paper',paperId:'a'}]};
 assert.equal(renderToStaticMarkup(React.createElement(Evidence,{evidence:base,chinese:true})), '');
 const html=renderToStaticMarkup(React.createElement(Evidence,{evidence:{...base,steps:[{tool:'search_papers',ok:false,error:'Unavailable',references:[]}]},chinese:false}));assert.match(html,/Unavailable/);assert.match(html,/Retrieval/);
});

test('bundled Mermaid parser accepts the supported bilingual mechanism diagrams',async()=>{
 const {JSDOM}=await import('jsdom');const dom=new JSDOM('<!doctype html><body></body>');
 globalThis.window=dom.window;globalThis.document=dom.window.document;
 try{const {default:mermaid}=await import('mermaid');mermaid.initialize({startOnLoad:false,securityLevel:'strict',htmlLabels:false});
 for(const graph of ['flowchart LR\n A["可见图块"] --> B["编码器"]\n B --> C["解码器"]','sequenceDiagram\n participant R as Reader\n participant A as Agent\n R->>A: Explain the evidence\n A-->>R: Source-grounded answer']){validateDiagram(graph);assert.ok((await mermaid.parse(graph)).diagramType);}
 }finally{dom.window.close();delete globalThis.window;delete globalThis.document;}
});
