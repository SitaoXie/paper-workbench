import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

let code=ts.transpileModule(await readFile(new URL('../src/reading-figures.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
for(const name of ['mdast-util-from-markdown','micromark-extension-math','mdast-util-math'])code=code.replaceAll(`from '${name}'`,`from '${import.meta.resolve(name)}'`);
const {sourceFigureLabel}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));

test('source figure labels preserve explicit identities and localize only actual source numbering',()=>{
  const label=(value,lang='en')=>sourceFigureLabel({page:5,...value},lang);
  assert.equal(label({label:'  Reviewed architecture  ',caption:'Figure 17. Different caption'}),'Reviewed architecture · p.5');
  assert.equal(label({label:'Table IV',caption:'Figure 17. Different caption'},'zh-CN'),'表 IV · p.5');
  assert.equal(label({caption:'Figure 4. Training curves.'}),'Figure 4 · p.5');
  assert.equal(label({caption:'Fig. S2: Controlled test.'},'zh-CN'),'图 S2 · p.5');
  assert.equal(label({caption:'Table A.1. Measured values.'}),'Table A.1 · p.5');
  assert.equal(label({caption:'图 2：模型结构。'}),'Figure 2 · p.5');
  assert.equal(label({caption:'表 3(a) 消融实验。'},'zh-CN'),'表 3 · p.5');
});

test('source figure labels never infer a number from IDs, later references, or ordinary prose',()=>{
  for(const caption of ['No numbered caption. Compare Figure 12.', 'Figure illustrates the architecture.', 'Figure mix analysis', 'Table shows results', 'Figure4text', '']){
    const figure={id:'figure-8',page:12,caption};
    assert.equal(sourceFigureLabel(figure,'en'),'Source figure · p.12');
    assert.equal(sourceFigureLabel(figure,'zh-CN'),'图表 · p.12');
  }
});
