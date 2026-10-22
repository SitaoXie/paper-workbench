import { test, expect, type Page } from '@playwright/test';
import katex from 'katex';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

// Serve the actual TypeScript helper as browser JavaScript so this DOM test
// works with both the Vite development server and the built, dist-only server.
const helperSource=ts.transpileModule(readFileSync(new URL('../src/selection-text.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;

const inline = katex.renderToString('E=mc^2');
const display = katex.renderToString('\\frac{a}{b}=\\sqrt{x}', { displayMode: true });

async function fixture(page: Page, html: string) {
  await page.route('**/src/selection-text.ts',route=>route.fulfill({contentType:'text/javascript',body:helperSource}));
  await page.route('**/selection-extractor-fixture', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><style>.hidden{display:none}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden}pre{white-space:pre}</style></head><body><main id="reading">${html}</main><p id="outside">Other native selection.</p></body></html>` }));
  await page.goto('/selection-extractor-fixture');
}
async function whole(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/selection-text.ts'; const { rangeToReadingText } = await import(path);
    const root = document.querySelector('#reading')!, range = document.createRange(); range.selectNodeContents(root);
    return rangeToReadingText(range, root);
  });
}

test('range extraction emits each inline and display formula once while retaining prose boundaries', async ({ page }) => {
  await fixture(page, `<h2>Evidence<a class="reading-heading-link" href="#chapter" aria-label="Link to section">#</a></h2><p>Before ${inline} after.</p>${display}<p>Next paragraph.</p>`);
  expect(await whole(page)).toEqual({ hasMath: true, text: 'Evidence\n\nBefore $E=mc^2$ after.\n\n$$\n\\frac{a}{b}=\\sqrt{x}\n$$\n\nNext paragraph.' });
});

test('partial formula selections are atomic without changing native range endpoints or surrounding words', async ({ page }) => {
  await fixture(page, `<p>Unselected prefix. Before ${inline} after. Unselected suffix.</p>`);
  const result = await page.evaluate(async () => {
    const path = '/src/selection-text.ts'; const { rangeToReadingText } = await import(path);
    const root = document.querySelector('#reading')!, formula = root.querySelector('.katex-html')!;
    const text = document.createTreeWalker(formula, NodeFilter.SHOW_TEXT).nextNode()!;
    const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 1);
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    const before = selection.toString(), start = range.startContainer, end = range.endContainer;
    const value = rangeToReadingText(range, root);
    return { value, before, after: selection.toString(), same: range.startContainer === start && range.endContainer === end && range.startOffset === 0 && range.endOffset === 1, ranges: selection.rangeCount };
  });
  expect(result.value).toEqual({ text: '$E=mc^2$', hasMath: true });
  expect(result.after).toBe(result.before); expect(result.same).toBe(true); expect(result.ranges).toBe(1);
  const clipped = await page.evaluate(async () => {
    const path = '/src/selection-text.ts'; const { rangeToReadingText } = await import(path);
    const root = document.querySelector('#reading')!, p = root.querySelector('p')!, range = document.createRange();
    range.setStart(p.firstChild!, 'Unselected prefix. '.length); range.setEnd(p.lastChild!, ' after.'.length);
    return rangeToReadingText(range, root);
  });
  expect(clipped).toEqual({ text: 'Before $E=mc^2$ after.', hasMath: true });
});

test('touching a formula boundary does not include an unselected formula', async ({ page }) => {
  await fixture(page, `<p>Before ${inline} after.</p>`);
  const result = await page.evaluate(async () => {
    const path = '/src/selection-text.ts'; const { rangeToReadingText } = await import(path);
    const root = document.querySelector('#reading')!, p = root.querySelector('p')!, formula = p.querySelector('.katex')!, range = document.createRange();
    range.setStart(p.firstChild!, 0); range.setEndBefore(formula); const before = rangeToReadingText(range, root);
    range.setStartAfter(formula); range.setEnd(p.lastChild!, p.lastChild!.textContent!.length); const after = rangeToReadingText(range, root);
    return { before, after };
  });
  expect(result).toEqual({ before: { text: 'Before ', hasMath: false }, after: { text: ' after.', hasMath: false } });
});

test('tables, line breaks and literal code remain meaningful beside formulas', async ({ page }) => {
  await fixture(page, `<p>One<br>two ${inline}.</p><table><thead><tr><th>Case</th><th>Result</th></tr></thead><tbody><tr><td>A</td><td>${inline}</td></tr><tr><td>B</td><td>Second result</td></tr></tbody></table><pre><code>  if (x &lt; 2) {\n    value = "$literal$";\n\n\n  }</code></pre><p>Inline <code> a  b </code> stays literal.</p><ul><li>First item</li><li>Second item</li></ul>`);
  expect(await whole(page)).toEqual({ hasMath: true, text: 'One\ntwo $E=mc^2$.\n\nCase\tResult\nA\t$E=mc^2$\nB\tSecond result\n\n  if (x < 2) {\n    value = "$literal$";\n\n\n  }\n\nInline  a  b  stays literal.\n\nFirst item\nSecond item' });
});

test('hidden content and control labels are omitted, while visible citation text stays', async ({ page }) => {
  await fixture(page, `<p>Visible <span hidden>HIDDEN</span><span aria-hidden="true">ARIA</span><span class="hidden">CSS</span><span class="sr-only">SCREEN_READER_ONLY</span>${inline}${inline.replace('class="katex"','class="katex" hidden')}<svg><title>ICON_LABEL</title></svg> <button class="citation-link">p.2</button>.</p><details><summary>Check</summary><p>CLOSED_ANSWER</p></details><p>Last.</p>`);
  expect(await whole(page)).toEqual({ hasMath: true, text: 'Visible $E=mc^2$ p.2.\n\nCheck\n\nLast.' });
});

test('final extraction length remains complete for the caller selection limit', async ({ page }) => {
  const tex = 'x'.repeat(12501);
  await fixture(page, `<p><span class="katex"><span class="katex-mathml"><math><semantics><mi>x</mi><annotation encoding="application/x-tex">${tex}</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">x</span></span></p>`);
  const result = await whole(page); expect(result.hasMath).toBe(true); expect(result.text).toBe(`$${tex}$`); expect(result.text.length).toBe(12503);
});

test('ranges outside the reading surface and collapsed ranges remain native', async ({ page }) => {
  await fixture(page, `<p>Reading ${inline}.</p>`);
  const result = await page.evaluate(async () => {
    const path = '/src/selection-text.ts'; const { rangeToReadingText } = await import(path);
    const root = document.querySelector('#reading')!, outside = document.querySelector('#outside')!, range = document.createRange();
    range.selectNodeContents(outside); const foreign = rangeToReadingText(range, root);
    range.selectNodeContents(root); range.collapse(true); const collapsed = rangeToReadingText(range, root);
    range.setStart(root.querySelector('p')!.firstChild!, 0); range.setEnd(outside.firstChild!, 4); const crossing = rangeToReadingText(range, root);
    return { foreign, collapsed, crossing };
  });
  expect(result).toEqual({ foreign: undefined, collapsed: undefined, crossing: undefined });
});
