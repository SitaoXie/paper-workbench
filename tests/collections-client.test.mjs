import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url),cache=new Map();
function load(filename){
 filename=path.resolve(filename);if(cache.has(filename))return cache.get(filename).exports;
 const module={exports:{}};cache.set(filename,module);
 const source=fs.readFileSync(filename,'utf8');const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const localRequire=id=>{if(id.endsWith('.css'))return{};if(!id.startsWith('.'))return require(id);const base=path.resolve(path.dirname(filename),id),file=[base,base+'.ts',base+'.tsx'].find(f=>fs.existsSync(f));return load(file);};
 new Function('require','module','exports',js)(localRequire,module,module.exports);return module.exports;
}
const {collectionPapers,collectionTotal,collectionPath,filterCollectionPapers,collectionName}=load('src/collections.ts');
const folders=[{id:'root',name:'Course',kind:'custom',parentId:null,paperIds:['a']},{id:'child',name:'Topic',kind:'custom',parentId:'root',paperIds:['a','b']},{id:'reading',name:'reading',status:'reading',kind:'status',parentId:null,paperIds:['c']}];
const papers=[{id:'a',title:'Residual learning',authors:['Researcher A'],tags:['Vision'],createdAt:'2026-01-01'},{id:'b',title:'Attention',authors:['Researcher B'],tags:['Language'],createdAt:'2026-01-03'},{id:'c',title:'Contrastive learning',authors:[],tags:['Vision'],createdAt:'2026-01-02'}];
test('folder paths, recursive counts and direct membership have distinct semantics; reading status does not file a paper',()=>{
 assert.deepEqual(collectionPath(folders,'child').map(f=>f.id),['root','child']);assert.equal(collectionTotal(folders,'root'),2);
 assert.deepEqual(collectionPapers(papers,folders,'root').map(p=>p.id),['a']);assert.deepEqual(collectionPapers(papers,folders,'unfiled').map(p=>p.id),['c']);assert.equal(collectionPapers(papers,folders,'all'),papers);
 assert.deepEqual(collectionPapers(papers,folders,'removed'),[]);
});
test('labels and search narrow a folder without mutating papers or memberships; sort is stable',()=>{
 const before=JSON.stringify({folders,papers});const scope=collectionPapers(papers,folders,'child');
 assert.deepEqual(filterCollectionPapers(scope,'researcher a','Vision','recent').map(p=>p.id),['a']);assert.deepEqual(filterCollectionPapers(scope,'','Vision','title').map(p=>p.id),['a']);
 assert.deepEqual(filterCollectionPapers(scope,'','','recent').map(p=>p.id),['b','a']);assert.deepEqual(filterCollectionPapers(scope,'','','title').map(p=>p.id),['b','a']);assert.equal(JSON.stringify({folders,papers}),before);
});
test('library and paper folder controls render in both languages without translating user folder names',()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');const {default:Library,PaperFolderButton}=load('src/LibraryWorkspace.tsx');
 const previous=global.window;
 try{for(const locale of ['zh','en']){global.window={location:{pathname:'/'+locale,hostname:'localhost'},localStorage:{getItem:()=>null}};
  const markup=renderToStaticMarkup(React.createElement(Library,{papers,onOpen(){},onFavorite(){},onImport(){}}));
  assert.match(markup,locale==='zh'?/文库文件夹/:/Library folders/);assert.match(markup,locale==='zh'?/未归档/:/Unfiled/);assert.match(markup,locale==='zh'?/新建文件夹/:/New folder/);
  const control=renderToStaticMarkup(React.createElement(PaperFolderButton,{paperId:'a'}));assert.match(control,locale==='zh'?/整理到文件夹/:/Organize into folders/);
  assert.equal(collectionName(folders[0]),'Course');assert.equal(collectionName(folders[2]),locale==='zh'?'在读':'Reading');
 }}finally{if(previous===undefined)delete global.window;else global.window=previous;}
});
test('sample library keeps folder navigation but exposes no editable memberships',()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');const {default:Library,PaperFolderButton}=load('src/LibraryWorkspace.tsx');
 const previous=global.window;
 try{
  global.window={location:{pathname:'/en/',hostname:'localhost',href:'http://localhost/en/?demo=1'},localStorage:{getItem:()=>null}};
  const markup=renderToStaticMarkup(React.createElement(Library,{papers,onOpen(){},onFavorite(){},onImport(){}}));
  assert.match(markup,/All papers/);assert.match(markup,/Library folders/);
  assert.doesNotMatch(markup,/collection-paper-actions|Remove bookmark|Add to folder|Import papers/);
  assert.equal(renderToStaticMarkup(React.createElement(PaperFolderButton,{paperId:'a'})),'');
  assert.match(markup,/class="collection-new" disabled=""/);
 }finally{if(previous===undefined)delete global.window;else global.window=previous;}
});
