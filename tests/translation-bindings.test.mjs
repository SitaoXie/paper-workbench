import test from "node:test";
import assert from "node:assert/strict";
import { fromMarkdown } from "mdast-util-from-markdown";
import { protectTranslationBindings } from "../server/translation-bindings.mjs";

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
