import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const context={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/paper-citation.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
const {paperCitation}=context.exports;
const plain=x=>JSON.parse(JSON.stringify(x));
test('local PDF citations accept a bounded optional source quote and never execute external or malformed fragments',()=>{
 assert.deepEqual(plain(paperCitation('#page=42',' A source sentence. ')),{page:42,quote:'A source sentence.'});
 assert.deepEqual(plain(paperCitation('#page=2','x'.repeat(501))),{page:2});
 for(const href of ['https://example.org/#page=2','#page=0','#page=-2','#page=1&quote=anything','#page=1e3','#page=2.5','#page=NaN','javascript:alert(1)','/paper#page=2',undefined]) assert.equal(paperCitation(href,'source'),undefined);
});
