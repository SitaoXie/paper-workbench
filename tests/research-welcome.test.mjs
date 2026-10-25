import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(locale) {
  const exports = {};
  const source = fs.readFileSync(new URL('../src/ResearchWelcome.tsx', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: name => name === './i18n' ? { useLocale: () => ({ t: (zh, en) => locale === 'en' ? en : zh }) } : require(name) });
  return exports.default;
}
function buttons(node) {
  if (!node || typeof node !== 'object') return [];
  const children = [node.props?.children].flat(Infinity);
  return [...(node.type === 'button' ? [node] : []), ...children.flatMap(buttons)];
}

for (const locale of ['zh', 'en']) {
  test(`research starters prepare editable library-scoped questions in ${locale}, without an automatic send`, () => {
    const Welcome = load(locale), questions = [];
    const view = Welcome({ hasPapers: true, disabled: false, onQuestion: value => questions.push(value), onImport: () => assert.fail('unexpected import') });
    const html = renderToStaticMarkup(view);
    assert.equal(questions.length, 0);
    assert.equal(buttons(view).length, 3);
    for (const button of buttons(view)) { assert.equal(button.props.type, 'button'); button.props.onClick(); }
    assert.equal(new Set(questions).size, 3);
    for (const question of questions) assert.match(question, locale === 'zh' ? /文库/ : /my library/);
    assert.doesNotMatch(html, /这篇论文|this paper|<br/);
    if (locale === 'en') assert.doesNotMatch(html, /[\u4e00-\u9fff]/);
    assert.match(html, /<h1>/);
    const busy = Welcome({ hasPapers: true, disabled: true, onQuestion: () => {}, onImport: () => {} });
    assert.ok(buttons(busy).every(button => button.props.disabled));
  });
  test(`empty library offers import instead of questions without evidence in ${locale}`, () => {
    let imported = 0;
    const view = load(locale)({ hasPapers: false, disabled: false, onQuestion: () => assert.fail('no source'), onImport: () => imported++ });
    assert.equal(buttons(view).length, 1);
    assert.match(renderToStaticMarkup(view), locale === 'zh' ? /导入第一篇论文/ : /Import your first paper/);
    buttons(view)[0].props.onClick(); assert.equal(imported, 1);
  });
}

test('literal interface labels across every workspace have English translations', () => {
  const context = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/locales.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
  const missing = [];
  for (const file of fs.readdirSync(new URL('../src/', import.meta.url)).filter(file => file.endsWith('.tsx'))) {
    const source = ts.createSourceFile(file, fs.readFileSync(new URL('../src/' + file, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(source) === 't' && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
        const text = node.arguments[0].text;
        if (/[\u4e00-\u9fff]/.test(text) && !context.exports.english[text]) missing.push(`${file}: ${text}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.deepEqual(missing, []);
});
