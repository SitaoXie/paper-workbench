import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL("../src/pdf-selection-text.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, context);
const { repairPdfSelectionText: repair } = context.exports;

test("PDF copy repairs an ordinary wrapped word only with an independent page spelling", () => {
  assert.equal(repair("learn-\ning residual functions", "Deep learning. We learn-\ning residual functions."), "learning residual functions");
  assert.equal(repair("LEARN-\nING", "learning"), "LEARNING");
  assert.equal(repair("learn-\ning", "meta-learning learners"), "learn-\ning", "A substring inside another word/compound is not independent evidence");
  assert.equal(repair("learn-\ning", "learning2 pre_learning"), "learn-\ning", "An identifier fragment is not an independent word");
  assert.equal(repair("learn-\ning", "We learn-\ning from samples."), "learn-\ning", "The wrapped occurrence cannot be its own evidence");
  assert.equal(repair("learn- ing", "learning"), "learn- ing", "A horizontal space is not a layout line break");
});

test("PDF copy preserves compounds, competing hyphenated spellings and arithmetic", () => {
  assert.equal(repair("state-of-\nthe-art", "stateoftheart"), "state-of-\nthe-art");
  assert.equal(repair("co-\noperate", "cooperate and co-operate"), "co-\noperate");
  assert.equal(repair("co-\noperate", "cooperate and co\u2010operate"), "co-\noperate");
  assert.equal(repair("re-\nform", "reform; re-form"), "re-\nform");
  assert.equal(repair("state-of-the-art x-\ny 10-\n60 co\u2011\noperate", "xy cooperate"), "state-of-the-art x-\ny 10-\n60 co\u2011\noperate");
  assert.equal(repair("中文-\n段落", "中文段落"), "中文-\n段落");
});

test("explicit soft hyphens need no lexical guess and surrounding content stays unchanged", () => {
  assert.equal(repair("learn\u00ad\ning residual functions", ""), "learning residual functions");
  assert.equal(repair("co\u00adoperate and $x-y$", ""), "cooperate and $x-y$");
  assert.equal(repair("state-of-\u00ad\nthe-art", ""), "state-of-the-art");
  assert.equal(repair("learn-\ning\nNo further evidence.", "An unrelated page."), "learn-\ning\nNo further evidence.");
});
