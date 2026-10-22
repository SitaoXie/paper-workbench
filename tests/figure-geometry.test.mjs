import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const context={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/figure-geometry.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
const {boundedCrop,figureTextLines,proposeFigureCandidates}=context.exports;
const text=(str,x,y,width,height=.015)=>({text:str,x,y,width,height});
const image=(x,y,width,height)=>({kind:'image',x,y,width,height});
test('normalized candidate geometry rejects invalid regions and clamps source edges',()=>{
  for(const rect of [{x:NaN,y:0,width:1,height:1},{x:0,y:0,width:-1,height:.3},{x:1.1,y:0,width:.1,height:.1}])assert.equal(boundedCrop(rect),undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(boundedCrop({x:-.1,y:.3,width:.5,height:.9}))),{x:0,y:.3,width:.4,height:.7});
});
test('a caption associates two panels and their external titles, excluding nearby body text',()=>{
  const lines=[text('Scaled Dot-Product Attention',.15,.11,.27),text('Multi-Head Attention',.57,.11,.25),text('Figure 2: Two attention panels.',.1,.52,.8),text('This is a long body paragraph that must never be included in the figure region despite its nearby vertical position.',.1,.06,.8)];
  const [candidate]=proposeFigureCandidates(4,lines,[image(.15,.14,.28,.35),image(.57,.14,.28,.35)]);
  assert.equal(candidate.label,'Figure 2');assert.equal(candidate.warning,'review');
  assert.ok(candidate.crop.x<.15);assert.ok(candidate.crop.x+candidate.crop.width>.85);
  assert.ok(candidate.crop.y<.11&&candidate.crop.y>.09);assert.ok(candidate.crop.y+candidate.crop.height<.52);
});
test('caption references in prose are not figures and separate columns remain separate',()=>{
  const lines=[text('Fig. 7 shows a comparison in the next section.',.08,.1,.4),text('Figure 3. Left chart.',.08,.5,.38),text('Figure 4. Right chart.',.55,.5,.37)];
  assert.equal(figureTextLines(lines).length,3);
  const figures=proposeFigureCandidates(8,lines,[image(.09,.22,.35,.25),image(.56,.22,.34,.25)]);
  assert.equal(figures.length,2);assert.ok(figures[0].crop.x+figures[0].crop.width<.5);assert.ok(figures[1].crop.x>.5);
});
test('ambiguous small Form collections and whole-page images remain manual proposals',()=>{
  const label=text('Figure 4: A multi-panel attention diagram.',.1,.92,.8);
  const complex=proposeFigureCandidates(14,[label],Array.from({length:120},()=>({kind:'form',x:.2,y:.7,width:.03,height:.03})))[0];
  assert.equal(complex.warning,'complex-vectors');assert.equal(complex.crop,undefined);
  const full=proposeFigureCandidates(1,[text('Figure 1: Page-sized graphic.',.1,.99,.8,.01)],[image(0,0,1,.98)])[0];
  assert.equal(full.warning,'large-region');assert.equal(full.crop,undefined);
});
test('tables above vector content and Chinese captions are kept as reviewable candidates',()=>{
  const tables=proposeFigureCandidates(3,[text('Table I: Controlled comparison.',.1,.1,.8)],[{kind:'form',x:.15,y:.15,width:.7,height:.3}]);
  assert.equal(tables[0].kind,'table');assert.equal(tables[0].crop,undefined);assert.equal(tables[0].warning,'no-region');
  const chinese=proposeFigureCandidates(2,[text('图 2：残差结构',.2,.6,.6)],[])[0];
  assert.equal(chinese.label,'图 2');assert.equal(chinese.warning,'no-region');assert.equal(chinese.crop,undefined);
});

test('real Attention panels with unequal bottom edges remain together, including their separate titles',async()=>{
  const {figureCandidateCases:{attention4:c}}=await import('./fixtures/figure-candidate-cases.mjs');
  const [candidate]=proposeFigureCandidates(c.page,c.text,c.graphics,c.complexity);
  assert.equal(candidate.label,'Figure 2');assert.equal(candidate.warning,'review');
  for(const region of c.graphics){assert.ok(candidate.crop.x<region.x);assert.ok(candidate.crop.x+candidate.crop.width>region.x+region.width);assert.ok(candidate.crop.y<region.y);assert.ok(candidate.crop.y+candidate.crop.height>=region.y+region.height);}
  const titles=c.text.filter(t=>t.text==='Scaled Dot-Product Attention'||t.text==='Multi-Head Attention');assert.equal(titles.length,2);
  for(const title of titles){assert.ok(candidate.crop.x<title.x);assert.ok(candidate.crop.x+candidate.crop.width>title.x+title.width);assert.ok(candidate.crop.y<title.y);}
  assert.match(candidate.caption,/attention layers running in parallel\./);
});
test('raw operators expose complex attention diagrams even when only two Form bounds survive',async()=>{
  const {figureCandidateCases:{attention14:c}}=await import('./fixtures/figure-candidate-cases.mjs');
  assert.equal(c.graphics.length,2);assert.equal(c.complexity.forms,1016);
  const [candidate]=proposeFigureCandidates(c.page,c.text,c.graphics,c.complexity);
  assert.equal(candidate.label,'Figure 4');assert.equal(candidate.warning,'complex-vectors');assert.equal(candidate.crop,undefined);
  for(const complexity of [{clips:41},{paths:801},{unsupportedClip:true}]){
    const [ambiguous]=proposeFigureCandidates(1,[text('Figure 1: A source chart.',.1,.5,.8)],[image(.1,.1,.7,.35)],complexity);
    assert.equal(ambiguous.crop,undefined);assert.equal(ambiguous.warning,'complex-vectors');
  }
});
test('real ResNet captions continue down their own column without importing the other column',async()=>{
  const {figureCandidateCases:{resnet1:c}}=await import('./fixtures/figure-candidate-cases.mjs');
  const [candidate]=proposeFigureCandidates(c.page,c.text,c.graphics,c.complexity);
  assert.match(candidate.caption,/with 20-layer and 56-layer/);assert.match(candidate.caption,/on ImageNet is presented in Fig\. 4\./);
  assert.ok(!candidate.caption.includes('residual functions'));assert.equal(candidate.warning,'review');
});
test('a lower table caption cannot claim the next plot and a paragraph-start figure reference is not a new caption',async()=>{
  const {figureCandidateCases:{resnet5:c}}=await import('./fixtures/figure-candidate-cases.mjs');
  const found=proposeFigureCandidates(c.page,c.text,c.graphics,c.complexity);
  const table=found.find(c=>c.label==='Table 1'),plot=found.find(c=>c.label==='Figure 4');
  assert.ok(table&&plot);assert.equal(table.crop,undefined);assert.equal(table.warning,'no-region');
  assert.ok(plot.crop);assert.ok(plot.crop.y>.31,'Previous table caption continuation must not be added as a plot title');
  assert.equal(found.some(c=>c.label==='Fig. 4'),false);
});
