import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
let instance = 0;
async function moduleFile(file, storage = new Map()) {
  globalThis.localStorage = { getItem:key=>storage.get(key) ?? null, setItem:(key,value)=>storage.set(key,value) };
  const code = ts.transpileModule(fs.readFileSync(new URL('../src/'+file, import.meta.url), 'utf8'), { compilerOptions: { module:ts.ModuleKind.ESNext, target:ts.ScriptTarget.ES2022 } }).outputText;
  return import('data:text/javascript;base64,'+Buffer.from(code+`\n// instance ${++instance}`).toString('base64'));
}
test('reading positions bind paper, source and exact overview context without retaining prose',async()=>{
  const storage=new Map(),s=await moduleFile('reading-position.ts',storage);
  const source=s.pdfDocumentKey({localPdfUrl:'/paper.pdf',createdAt:'2026-01-01',pageCount:8});
  const pdf={page:4,fraction:.32,left:90,zoom:1.5};
  s.savePdfPosition('paper',source,pdf);s.saveReadingTab('paper',source,'paper');
  s.saveOverviewPosition('paper',source,{key:s.positionHash('v1 zh article'),versionId:'v1',language:'zh-CN',presentation:'article',scrollY:1800,anchor:{index:8,hash:s.positionHash('source paragraph'),offset:120}});
  s.saveOverviewPosition('paper',source,{key:s.positionHash('v1 en article'),versionId:'v1',language:'en',presentation:'article',scrollY:220});
  s.flushReadingPositions();
  const restored=await moduleFile('reading-position.ts',storage);
  assert.deepEqual(restored.readReadingPosition('paper',source).pdf,pdf);
  assert.equal(restored.readReadingPosition('paper',source).tab,'paper');
  assert.equal(restored.readReadingPosition('paper',source).overviews.length,2);
  assert.equal(restored.readReadingPosition('paper','different-source'),undefined);
  assert.equal(restored.readReadingPosition('another-paper',source),undefined);
  assert.ok(!storage.get('pw-reading-positions-v1').includes('source paragraph'));
  restored.savePdfPosition('paper','replacement-source',{...pdf,page:1});restored.flushReadingPositions();
  assert.equal(restored.readReadingPosition('paper','replacement-source').overviews.length,0);
});
test('position storage rejects invalid geometry and bounds papers and per-version contexts',async()=>{
  const storage=new Map(),s=await moduleFile('reading-position.ts',storage);
  for(const position of [{page:-1,fraction:0,left:0,zoom:null},{page:1,fraction:Infinity,left:0,zoom:null},{page:1,fraction:0,left:0,zoom:10}])s.savePdfPosition('invalid','source',position);
  assert.equal(s.readReadingPosition('invalid','source'),undefined);
  for(let i=0;i<110;i++)s.savePdfPosition(String(i),'source',{page:i+1,fraction:.2,left:0,zoom:null});
  for(let i=0;i<15;i++)s.saveOverviewPosition('109','source',{key:String(i),language:'zh-CN',presentation:'article',scrollY:i});
  s.flushReadingPositions();
  assert.equal(Object.keys(JSON.parse(storage.get('pw-reading-positions-v1'))).length,100);
  assert.equal(s.readReadingPosition('0','source'),undefined);
  assert.equal(s.readReadingPosition('109','source').overviews.length,8);
  assert.equal(s.readReadingPosition('109','source').overviews[0].key,'14');
  s.removeReadingPosition('109');s.savePdfPosition('109','source',{page:5,fraction:0,left:0,zoom:null});s.flushReadingPositions();assert.equal(s.readReadingPosition('109','source'),undefined);
});
test('library excerpts prefer valid content in the requested language and ignore stale translations',async()=>{
  const {paperExcerpt}=await moduleFile('paper-excerpt.ts');
  const paper={abstract:'Original English abstract.',createdAt:'2026-01-01',activeReadingId:'v1',readingVersions:[{id:'v1',createdAt:'2026-01-01',language:'zh-CN',markdown:'## 关键结论\n\n这是一份已有中文解读。',translations:{en:{language:'en',markdown:'## Summary\n\nA valid English overview.'}}}]};
  assert.deepEqual(paperExcerpt(paper,'zh'),{text:'这是一份已有中文解读。',language:'zh-CN',source:'reading'});
  assert.equal(paperExcerpt(paper,'en').text,'A valid English overview.');
  paper.translations={'zh-CN':{abstract:{language:'zh-CN',markdown:'已译原始摘要。'}}};
  assert.equal(paperExcerpt(paper,'zh-CN').text,'已译原始摘要。');
  paper.translations['zh-CN'].abstract.stale=true;
  assert.equal(paperExcerpt(paper,'zh-CN').text,'这是一份已有中文解读。');
  paper.readingVersions=[];
  assert.equal(paperExcerpt(paper,'zh-CN').text,'Original English abstract.');
  assert.equal(paperExcerpt(paper,'zh-CN').language,'en');
});
