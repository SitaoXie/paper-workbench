import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
const compiled = ts.transpileModule(fs.readFileSync(new URL('../src/remark-cjk-emphasis.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { default: cjkEmphasis } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
function parse(source, fix = true) {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
  if (fix) processor.use(cjkEmphasis);
  return processor.runSync(processor.parse(source), source);
}
function nodes(tree, type) { return [tree, ...(tree.children || []).flatMap(child => nodes(child))].filter(node => !type || node.type === type); }

test('CJK punctuation-adjacent emphasis becomes semantic strong without added spaces or altered evidence', () => {
  const source = '结论是：**策略概率的重新分配，已经足以解释跨任务迁移。**作者比较模型。\n\n其中有 **487 个（12.7%）**使用未出现的路线。\n\n中文**（重点）**后文。';
  const tree = parse(source);
  assert.deepEqual(nodes(tree, 'strong').map(node => node.children[0].value), ['策略概率的重新分配，已经足以解释跨任务迁移。', '487 个（12.7%）', '（重点）']);
  assert.equal(nodes(tree, 'text').map(node => node.value).join(''), source.replaceAll('**', '').replaceAll('\n', ''));
  assert.equal(nodes(parse(source, false), 'strong').length, 0);
});

test('escaped delimiters, inline and fenced code, math and ordinary English keep their original AST semantics', () => {
  const cases = [
    String.raw`保留\*\*中文。\*\*后文`,
    '`**487 个（12.7%）**使用`',
    '```text\n**中文。**后文\n```',
    '$\\text{**中文。**后文}$',
    '$$\n\\text{**中文。**后文}\n$$',
    'English **clear evidence** remains bold, and 中文**普通重点**正常。',
    'English **trailing punctuation.**adjacent stays CommonMark text.',
    '文字***复杂强调。***后文',
    '中文 **\n跨行内容。**后文',
    '中文 [**链接文本。**后文](https://example.org) 与 ![**替代文字。**后文](https://example.org/image.png)',
  ];
  for (const source of cases) assert.deepEqual(parse(source), parse(source, false), source);
});

const citationCode = ts.transpileModule(fs.readFileSync(new URL('../src/remark-page-citations.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const resolvedCitationCode = citationCode.replace('../shared/prose-citations.mjs', new URL('../shared/prose-citations.mjs', import.meta.url).href);
const { default: pageCitations } = await import('data:text/javascript;base64,' + Buffer.from(resolvedCitationCode).toString('base64'));
function citations(source, fix = true) {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
  if (fix) processor.use(pageCitations);
  return processor.runSync(processor.parse(source), source);
}
test('page navigation accepts compact, grouped, ranged and Chinese model citations', () => {
  const tree = citations('Evidence [p35], [p. 10], [p2,p10] and [pp.3–p.5] supports **this [p 6]**. 最后[第 7 页]。');
  assert.deepEqual(nodes(tree, 'link').map(node => [node.url, node.children[0].value]), [
    ['#page=35','p.35'], ['#page=10','p.10'], ['#page=2','p.2'], ['#page=10','p.10'], ['#page=3','p.3–5'], ['#page=6','p.6'], ['#page=7','p.7'],
  ]);
});
test('citation parsing leaves code, math, existing links, escaped and malformed references unchanged', () => {
  for (const source of [String.raw`Literal \[p35]`, '`[p35]`', '```text\n[p35]\n```', '$[p35]$', '[p35](https://example.org)', '![p35](image.png)', 'Footnote [35] and [p0] [p4-2] [p35, bad] [p2/3]']) {
    assert.deepEqual(citations(source), citations(source, false), source);
  }
});

test('CJK emphasis and page citations compose in the same paragraph without leaving raw delimiters',()=>{
  const source='结论是：**策略概率的重新分配，已经足以解释跨任务迁移。**作者比较模型。[p.2]\n\n其中有 **487 个（12.7%）**使用未出现的路线。[p6]';
  const processor=unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(cjkEmphasis).use(pageCitations);
  const tree=processor.runSync(processor.parse(source),source);
  assert.deepEqual(nodes(tree,'strong').map(node=>node.children[0].value),['策略概率的重新分配，已经足以解释跨任务迁移。','487 个（12.7%）']);
  assert.deepEqual(nodes(tree,'link').map(node=>node.url),['#page=2','#page=6']);
  assert.equal(nodes(tree,'text').some(node=>node.value.includes('**')),false);
});

test('abstract and source-text citations are local navigation only in prose',()=>{
  const tree=citations('Compare [Abstract], [Source text], [原始摘要] and [来源正文]. Then [p.4].');
  assert.deepEqual(nodes(tree,'link').map(node=>node.url),['#source=abstract','#source=text','#source=abstract','#source=text','#page=4']);
  for(const source of [String.raw`Literal \[Abstract]`, '`[Source text]`', '```text\n[Abstract]\n```', '$[Abstract]$', '[Abstract](https://example.org)', '![Source text](figure.png)', '[Abstractness] [source text added]'])assert.deepEqual(citations(source),citations(source,false),source);
});

test('unrelated escapes and entities preserve later page/source navigation and visible prose', () => {
  const source = String.raw`A \* B &amp; C &#x26; D &NotEqualTilde; E: literal \[p.4] and &#91;p.4]; actual [p.4], [第6页], [Abstract] and [来源正文].`;
  const tree = citations(source);
  assert.deepEqual(nodes(tree, 'link').map(node => node.url), ['#page=4', '#page=6', '#source=abstract', '#source=text']);
  assert.equal(nodes(tree, 'text').map(node => node.value).join(''), 'A * B & C & D ≂̸ E: literal [p.4] and [p.4]; actual p.4, p.6, Abstract and 来源正文.');
  const slash = citations(String.raw`Literal \[Abstract] and [p.9\]; actual \\[p.4].`);
  assert.deepEqual(nodes(slash, 'link').map(node => node.url), ['#page=4']);
  assert.equal(nodes(slash, 'text').map(node => node.value).join(''), 'Literal [Abstract] and [p.9]; actual \\p.4.');
});

test('citation offsets remain correct in multiline containers and table cells after decoding', () => {
  for (const source of ['> A &amp; B\n> evidence [p.4].', '- A \\* B\n  evidence [p.4].', 'A &amp; B\r\nevidence [p.4].', '| Evidence |\n| --- |\n| A \\| B &amp; C [p.4] |']) {
    const tree = citations(source);
    assert.deepEqual(nodes(tree, 'link').map(node => node.url), ['#page=4'], source);
    assert.equal(nodes(tree, 'text').map(node => node.value).join(''), nodes(citations(source, false), 'text').map(node => node.value).join('').replace('[p.4]', 'p.4'), source);
  }
});
