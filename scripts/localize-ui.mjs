#!/usr/bin/env node
// One-time, opt-in migration helper. It only wraps exact known interface strings;
// it never visits dynamic paper/model/user content. Review its diff before commit.
import ts from 'typescript';
import fs from 'node:fs';
const args = process.argv.slice(2);
const write = args.includes('--write');
const dictionarySource = fs.readFileSync(new URL('../src/locales.ts', import.meta.url), 'utf8');
const dictionary = ts.createSourceFile('locales.ts', dictionarySource, ts.ScriptTarget.Latest, true);
const known = new Set();
function keys(node) { if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name)) known.add(node.name.text); ts.forEachChild(node, keys); }
keys(dictionary);
for (const file of args.filter(arg => arg !== '--write')) {
  const source = fs.readFileSync(file, 'utf8');
  const root = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];
  function insideTranslation(node) {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === 't') return true;
    }
    return false;
  }
  function visit(node) {
    if (!insideTranslation(node)) {
      if (ts.isJsxText(node)) {
        const label = node.text.trim().replace(/\s+/g, ' ');
        if (known.has(label)) {
          const prefix = node.text.match(/^\s*/)?.[0] ?? '';
          const suffix = node.text.match(/\s*$/)?.[0] ?? '';
          edits.push([node.pos, node.end, `${prefix}{t(${JSON.stringify(label)})}${suffix}`]);
        }
      } else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && known.has(node.text)) {
        const call = `t(${JSON.stringify(node.text)})`;
        edits.push([node.getStart(root), node.end, ts.isJsxAttribute(node.parent) ? `{${call}}` : call]);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(root);
  let result = source;
  for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0])) result = result.slice(0, start) + replacement + result.slice(end);
  if (write) fs.writeFileSync(file, result);
  console.log(`${file}: ${edits.length} interface strings ${write ? 'wrapped' : 'available; use --write to apply'}`);
}
