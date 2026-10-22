import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
let slotsCode=ts.transpileModule(fs.readFileSync(new URL('../src/reading-figures.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
for(const dependency of ['mdast-util-from-markdown','micromark-extension-math','mdast-util-math'])slotsCode=slotsCode.replaceAll(`from '${dependency}'`,`from '${import.meta.resolve(dependency)}'`);
const slotsUrl='data:text/javascript;base64,'+Buffer.from(slotsCode).toString('base64');
const {readingFigureSlots}=await import(slotsUrl);
let code=ts.transpileModule(fs.readFileSync(new URL('../src/portable-answer.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
for(const dependency of ['mdast-util-from-markdown','micromark-extension-math','mdast-util-math'])code=code.replaceAll(`from '${dependency}'`,`from '${import.meta.resolve(dependency)}'`);
code=code.replace("from './reading-figures'",`from '${slotsUrl}'`);
const {portableAnswerMarkdown:copy,publicSourceUrl,portableReadingMarkdown}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const paper={title:'A study of uncertainty',url:'https://arxiv.org/abs/1706.03762',pdfUrl:'https://arxiv.org/pdf/1706.03762'};
test('copied answers bind semantic, reference-style and compact page citations while preserving source quotes and math',()=>{
 const input='**Evidence** [bounds](#page=42 "A source sentence.") and [pp.3–p.5, p.7].\n\n$x=[p.4]$ and `[p.9]` stay unchanged.\n\n[Alternative][source]\n\n[source]: <#page=8> "Exact source quote."';
 const output=copy(input,paper,'en');
 assert.match(output,/\[bounds\]\(https:\/\/arxiv.org\/pdf\/1706.03762#page=42 "A source sentence\."\)/);
 assert.match(output,/\[p.3–5\]\(<https:\/\/arxiv.org\/pdf\/1706.03762#page=3>\), \[p.7\]/);
 assert.ok(output.includes('$x=[p.4]$ and `[p.9]` stay unchanged.'));
 assert.ok(output.includes('[source]: <https://arxiv.org/pdf/1706.03762#page=8> "Exact source quote."'));
 assert.ok(output.includes('Paper: A study of uncertainty'));assert.ok(output.includes('Source: <https://arxiv.org/abs/1706.03762>'));
});
test('local and credential-bearing sources never export private addresses and keep explicit page locations',()=>{
 const input='[**Measured** evidence](#page=4 "Quote") [Other][src]\n\n[src]: #page=5';
 const output=copy(input,{title:'Local study',url:'file:///Users/private/paper.pdf',pdfUrl:'http://127.0.0.1:4318/api/file/x'},'zh');
 assert.ok(output.includes('Measured evidence (p.4)'));assert.ok(output.includes('Other (p.5)'));
 assert.ok(output.includes('本地文档'));assert.doesNotMatch(output,/127\.0\.0\.1|Users|#page=/);
 for(const url of ['http://localhost/x','https://paper.local/x','https://10.0.0.1/x','https://[::1]/x','https://user:pass@example.org/x','https://example.org/x?access_token=secret','https://example.org/x?apiKey=secret'])assert.equal(publicSourceUrl(url),undefined,url);
 assert.equal(copy('Raw answer without a paper',undefined),'Raw answer without a paper');
});
test('copy does not rewrite unrelated links, escaped page text, code or equations',()=>{
 const input='[external](https://example.org/#page=9) ![image](#page=3) \\[p.4] `(#page=4)`\n\n```md\n[p.8]\n```\n\n$$\n[p.10]\n$$';
 assert.ok(copy(input,paper).startsWith(input));
});

test('portable overview replaces actual figure slots with displayed captions and public source pages, leaving code examples intact',()=>{
 const markdown='## Evidence\n\n:::figure result\n\nA conclusion.\n\n```md\n:::figure example\n```\n\n:::figure unavailable';
 const output=portableReadingMarkdown(markdown,paper,'zh-CN',[{id:'result',page:5,caption:'Translated **caption** [untrusted](https://example.org).',captionIsOriginal:true}]);
 assert.ok(output.includes('> Translated \\*\\*caption\\*\\* \\[untrusted\\](https://example.org). · 原文图注'));
 assert.ok(output.includes('[p.5](<https://arxiv.org/pdf/1706.03762#page=5>)'));
 assert.ok(output.includes('```md\n:::figure example\n```'));
 assert.ok(output.includes('未找到对应原图'));
 assert.ok(!output.includes(':::figure result'));
 assert.ok(output.indexOf('Translated')<output.indexOf('A conclusion.'));
});

test('figure directives in fenced and indented code, math and raw HTML are not rendered as source evidence',()=>{
 const content=':::figure real\n\n```text\n:::figure example\n```\n\n    :::figure code\n\n$$\n:::figure equation\n$$\n\n<div>\n:::figure html\n</div>\n\n:::figure final';
 assert.deepEqual(readingFigureSlots(content).map(slot=>slot.id),['real','final']);
 for(const slot of readingFigureSlots(content))assert.equal(content.slice(slot.start,slot.end),`:::figure ${slot.id}`);
});
