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
