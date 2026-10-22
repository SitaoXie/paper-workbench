import test from "node:test";
import assert from "node:assert/strict";
import { fromMarkdown } from "mdast-util-from-markdown";
import { protectTranslationBindings, validateTranslationBindings } from "../server/translation-bindings.mjs";

function links(markdown) {
  const found = [];
  function visit(node) { if (node.type === "link") found.push({ url: node.url, title: node.title, text: node.children.map(child => child.value || "").join("") }); for (const child of node.children || []) visit(child); }
  visit(fromMarkdown(markdown)); return found;
}
const tokens = markdown => [...markdown.matchAll(/#pw-citation-[\w-]+/g)].map(match => match[0]);

test("source href/title are restored by construction while labels may translate, including quotes, slashes and entity-looking text", () => {
  const source = String.raw`[Limits](#page=42 "The \"quoted\" path uses \\ and &amp;quot;.") [Page only](#page=02)`;
  const protectedSource = protectTranslationBindings(source);
  assert.ok(!protectedSource.markdown.includes("quoted"));
  const output = protectedSource.markdown.replace("Limits", "范围限制").replace("Page only", "仅页码").replaceAll(")", ' "模型擅自添加的标题")');
  const restored = protectedSource.restore(output), expected = links(source);
  assert.deepEqual(links(restored).map(({ url, title }) => ({ url, title })), expected.map(({ url, title }) => ({ url, title })));
  assert.deepEqual(links(restored).map(link => link.text), ["范围限制", "仅页码"]);
  assert.ok(!restored.includes("模型擅自"));
  assert.ok(!restored.includes("#pw-citation-"));
});

test("reference definitions and repeated/full/collapsed/shortcut references receive independent protected occurrences", () => {
  const source = '[First][proof] [Second][PROOF] [proof][] [proof]\n\n[proof]: <#page=3> "Exact evidence."';
  const protectedSource = protectTranslationBindings(source);
  assert.equal(tokens(protectedSource.markdown).length, 4);
  assert.equal(new Set(tokens(protectedSource.markdown)).size, 4);
  const restored = protectedSource.restore(protectedSource.markdown.replace("First", "第一处").replace("Second", "第二处"));
  assert.equal(links(restored).length, 4);
  assert.ok(links(restored).every(link => link.url === "#page=3" && link.title === "Exact evidence."));
  const [one] = tokens(protectedSource.markdown);
  // The model may choose reference-link syntax too; binding is resolved before validation.
  const converted = protectedSource.markdown.replace(`[First](${one})`, "[第一处][preserved]") + `\n\n[preserved]: ${one} "untrusted replacement"`;
  assert.equal(links(protectedSource.restore(converted))[0].title, "Exact evidence.");
});

test("missing, duplicated, unknown, modified, code-hidden and invented local bindings fail explicitly", () => {
  const state = protectTranslationBindings('[claim](#page=2 "Original source.")');
  const [token] = tokens(state.markdown);
  for (const bad of [
    "Translated prose but no citation.", state.markdown + state.markdown,
    state.markdown + " [extra](#pw-citation-unknown)",
    state.markdown.replace(token, token + "-changed"),
    "`" + state.markdown + "`", "$" + state.markdown + "$",
    state.markdown + '[invented](#page=2 "Fake source.")',
    state.markdown + "\n\n" + token,
  ]) assert.throws(() => state.restore(bad), error => error.status === 502 && /No translated article was saved/.test(error.message), bad);
});

test("code/math, images and external URLs with page fragments are not reinterpreted as local citations", () => {
  const source = '`[code](#page=1 "literal")`\n\n```md\n[block](#page=2)\n```\n\n$[math](#page=3)$\n\n$$\n[formula](#page=4)\n$$\n\n![image](https://example.test/image.png "Image title") [web](https://example.test/paper#page=6 "External title")';
  const state = protectTranslationBindings(source);
  assert.equal(state.markdown, source);
  assert.equal(state.restore(source), source);
  assert.throws(() => state.restore(source + "\n[added](#page=5)"), /changed or lost/);
});

test("standalone figure marker multiplicity survives reflow without creating or dropping figure slots", () => {
  const source = "Paragraph.\n\n:::figure chart\n\nNext.\n\n:::figure diagram\n\n:::figure chart";
  const state = protectTranslationBindings(source);
  const translated = "更长的段落。\n\n附加解释。\n\n:::figure diagram\n\n:::figure chart\n\n:::figure chart";
  assert.equal(state.restore(translated), translated);
  for (const bad of [translated.replace(":::figure chart", ""), translated + "\n:::figure other", translated.replaceAll("chart", "new-id")])
    assert.throws(() => state.restore(bad), /figure marker/);
  assert.throws(() => protectTranslationBindings("No figure.").restore("正文。\n\n:::figure invented"), /figure marker/);
});

test("a local link definition shared with an image retains the image source without fetching or rewriting it", () => {
  const source = '[passage][shared] ![image][shared]\n\n[shared]: #page=2 "Original title"';
  const state = protectTranslationBindings(source);
  const result = state.restore(state.markdown);
  assert.ok(result.includes('![image][shared]'));
  assert.ok(result.includes('[shared]: #page=2 "Original title"'));
  assert.equal(links(result)[0].title, "Original title");
});

test("external translations preserve repeated source-language quote bindings while labels, paragraphs and reference syntax may change", () => {
  const source='原文 [限制][proof]。\n\n另一段 [proof]。\n\n[proof]: #page=2 "有限样本不能证明不可能。"\n\n:::figure chart';
  const translated='[Limits](#page=2 "有限样本不能证明不可能。")\n\nA reorganized paragraph. [Evidence](#page=2 "有限样本不能证明不可能。")\n\n:::figure chart';
  assert.equal(validateTranslationBindings(source,translated),translated);
  for(const bad of [translated.replace('#page=2','#page=3'),translated.replace('有限样本不能证明不可能。','Translated or invented source quote.'),translated.replace(':::figure chart',':::figure nonexistent'),translated+'\n\n:::figure chart'])
    assert.throws(()=>validateTranslationBindings(source,bad),error=>error.status===400);
});

test("code and math examples cannot replace actual figure slots, and sentinel results are never completed translations", () => {
  const source=':::figure chart\n\n```md\n:::figure example\n```\n\n$$\n:::figure formula\n$$';
  assert.equal(validateTranslationBindings(source,source),source);
  assert.throws(()=>validateTranslationBindings(source,'```md\n:::figure chart\n:::figure example\n```\n\n$$\n:::figure formula\n$$'),/figure marker/);
  for(const value of ['', ' ', 'null', '"null"', '`null`', 'undefined', '```json\nnull\n```']) {
    assert.throws(()=>validateTranslationBindings('Source.',value),error=>error.status===400);
    assert.throws(()=>protectTranslationBindings('Source.').restore(value),error=>error.status===502);
  }
  for(const value of ['R²', 'NaN', 'NULL hypothesis', '0', '$x < 1$', 'Transformer'])assert.equal(validateTranslationBindings('Source.',value),value);
});

test("plain page citations preserve page/range multiplicity across Chinese equivalents and prose reflow", () => {
  const source = "Claims [p.4], again [P 04], ranges [pp.6–8; p.10] and [p.12, 13].";
  const translated = "重排 [第 4 页]、[p.12]、[第13页]。\n\n再次 [p.4]，范围 [pp.6-8] 与 [第10页]。";
  assert.equal(validateTranslationBindings(source, translated), translated);
  assert.equal(protectTranslationBindings(source).restore(translated), translated);
  for (const bad of [translated.replace('[p.4]', '[p.5]'), translated.replace('[第 4 页]', ''), translated + ' [p.4]', translated.replace('6-8', '6-9'), translated.replace('[p.4]', '`[p.4]`'), translated.replace('[p.4]', '$[p.4]$'), translated.replace('[p.4]', '[p.4](https://example.test)')]) {
    assert.throws(() => validateTranslationBindings(source, bad), error => error.status === 400);
    assert.throws(() => protectTranslationBindings(source).restore(bad), error => error.status === 502);
  }
  assert.throws(() => validateTranslationBindings('No citation.', '译文 [第4页]'), /source citation/);
});

test("plain page lookalikes inside code, formulae, escaped text and existing links are not citation bindings", () => {
  const literal = '`[p.1]`\n\n```text\n[p.2]\n```\n\n$[p.3]$\n\n$$\n[p.4]\n$$\n\n\\[p.5] &#91;p.6] [p.7](https://example.test) ![p.8](image.png)';
  const changed = literal.replaceAll(/p\.[1-8]/g, 'p.9');
  assert.equal(validateTranslationBindings(literal, changed), changed);
  assert.throws(() => validateTranslationBindings(literal + ' Real [p.10].', changed), /source citation/);
  assert.equal(validateTranslationBindings('[p.0] [p.99999] [pp.8-6]', 'Invalid syntax examples may translate.'), 'Invalid syntax examples may translate.');
});

test("unrelated escaped symbols and entities cannot hide a later real page citation", () => {
  for (const prefix of [String.raw`A \* B`, 'A &amp; B', 'A &#38; B', 'A &#x26; B', 'A &NotEqualTilde; B', 'A &unknown; B']) {
    const source = `${prefix} reports evidence [p.4].`;
    const valid = `${prefix} 报告证据 [第4页]。`;
    assert.equal(validateTranslationBindings(source, valid), valid);
    assert.equal(protectTranslationBindings(source).restore(valid), valid);
    for (const bad of [valid.replace('第4页', '第6页'), valid.replace('[第4页]', ''), valid + ' [p.6]', valid + ' [p.4]']) {
      assert.throws(() => validateTranslationBindings(source, bad), error => error.status === 400, bad);
      assert.throws(() => protectTranslationBindings(source).restore(bad), error => error.status === 502, bad);
    }
  }
});

test("escaped citation literals coexist with bound citations and Markdown container prefixes", () => {
  const source = String.raw`Literal \[p.4], &#91;p.4], [p.4\] and [p&#46;4]; real [p.4], after a slash \\[p.6].`;
  const valid = String.raw`字面 \[p.9], &#91;p.9], [p.9\] and [p&#46;9]; 实际 [第4页]，斜杠后 \\[第6页]。`;
  assert.equal(validateTranslationBindings(source, valid), valid);
  assert.throws(() => validateTranslationBindings(source, valid.replace('[第4页]', '')), /source citation/);
  assert.throws(() => validateTranslationBindings(source, valid.replace('\\[p.9]', '[p.9]')), /source citation/);
  for (const [before, after] of [
    ['> A &amp; B\n> evidence [p.4].', '> 甲 &amp; 乙\n> 证据 [第4页]。'],
    ['- A \\* B\n  evidence [p.4].', '- 甲 \\* 乙\n  证据 [第4页]。'],
    ['A &amp; B\r\nevidence [p.4].', '甲 &amp; 乙\r\n证据 [第4页]。'],
  ]) {
    assert.equal(validateTranslationBindings(before, after), after);
    assert.throws(() => validateTranslationBindings(before, after.replace('第4页', '第6页')), /source citation/);
  }
});
