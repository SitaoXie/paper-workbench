import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
let code=ts.transpileModule(readFileSync(new URL('../src/reading-sections.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
for(const name of ['mdast-util-from-markdown','micromark-extension-math','mdast-util-math']) code=code.replaceAll(`from '${name}'`,`from '${import.meta.resolve(name)}'`);
const {readingSections:sections,compatibleSectionStructure:compatible,readingSectionId:id,parseReadingSectionLocation:parse,readingSectionUrl:url}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('section extraction preserves whole-document offsets across figures and excludes quoted/code headings',()=>{
  const markdown='# Overview\n\n## **Evidence** and $x_1$\n\n:::figure real-source\n\n### Local `method`\n\n> ## Quoted example\n\n```md\n## Not a section\n```\n\nResults\n-------\n';
  const result=sections(markdown);
  assert.deepEqual(result.map(s=>[s.index,s.depth,s.title]),[[1,1,'Overview'],[2,2,'Evidence and x_1'],[3,3,'Local method'],[4,2,'Results']]);
  assert.equal(markdown.slice(result[2].offset,result[2].offset+3),'###');
  assert.equal(result[3].offset,markdown.indexOf('Results'));
});
test('language mapping uses complete depth structure, not translated title text',()=>{
  const zh=sections('## 结论\n### 局限\n## 更多证据'), en=sections('## Findings\n### Limits\n## Further evidence');
  assert.equal(compatible(zh,en),true);
  assert.equal(compatible(zh,sections('## Findings\n## Limits\n## Further evidence')),false);
  assert.equal(compatible(zh,en.slice(0,2)),false);assert.equal(compatible([],[]),false);
  assert.equal(id('version-a',2),id('version-a',en[1].index));
  assert.notEqual(id('version-a',2),id('version-b',2));
});
test('runtime links pin paper and version without PDF page conflicts or arbitrary query data',()=>{
  const result=url('http://localhost:4320/en/?paper=old&page=9&unrelated=value#other','paper-a','version-b',3);
  const parsed=new URL(result);
  assert.equal(parsed.origin,'http://localhost:4320');assert.equal(parsed.pathname,'/en/');
  assert.equal(parsed.search,'?paper=paper-a');
  assert.deepEqual(parse(result,'paper-a'),{readingId:'version-b',section:3});
  assert.equal(parse(result,'paper-b'),undefined);
  assert.deepEqual(parse(url(result,'paper-a','version-b',0)),{readingId:'version-b',section:0});
  for(const hash of ['#reading=x&section=-1','#reading=x&section=1&section=2','#reading=x&section=0x10','#reading=x&section=1.5','#reading=../x&section=1','#page=2','#reading=x&section=100000'])assert.equal(parse('http://localhost/zh/?paper=p'+hash),undefined,hash);
});
