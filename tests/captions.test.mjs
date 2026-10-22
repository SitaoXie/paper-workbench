import test from "node:test";
import assert from "node:assert/strict";
import { captionSources, figureCaptionsSourceHash, validateFigureCaptions, usableFigureCaptions, translateFigureCaptions } from "../server/captions.mjs";
import { assertUniqueJsonKeys } from "../server/json.mjs";

const figures = [
  { id: "chart", page: 2, crop: { x: .1, y: .2, width: .6, height: .3 }, caption: "Figure 1. Measured outcomes and uncertainty." },
  { id: "diagram", page: 3, caption: "GPT-4.1 / ViT-L" },
];
const captions = { chart: "图1：测量结果及其不确定性。", diagram: "GPT-4.1 / ViT-L" };
const output = JSON.stringify(Object.entries(captions).map(([id, caption]) => ({ id, caption })));

test("caption hashes bind figure identity, caption and source geometry without depending on display order", () => {
  const hash = figureCaptionsSourceHash(figures);
  assert.equal(figureCaptionsSourceHash([...figures].reverse()), hash);
  for (const modify of [x => x[0].caption += " Changed.", x => x[0].page++, x => x[0].crop.x += .1, x => x[0].id = "different"])
  { const changed = structuredClone(figures); modify(changed); assert.notEqual(figureCaptionsSourceHash(changed), hash); }
  assert.deepEqual(captionSources([...figures, { id: "empty", caption: "  " }]).map(x => x.id), ["chart", "diagram"]);
  assert.deepEqual(validateFigureCaptions(captions, figures), captions);
  assert.equal(usableFigureCaptions({ figureCaptions: captions, figureCaptionsSourceHash: hash }, figures), true);
  assert.equal(usableFigureCaptions({ figureCaptions: captions }, figures), false);
});

test("caption maps reject unknown, missing, inherited, non-text and overlong values without prototype mutation", () => {
  for (const value of [null, [], {}, { chart: "Only one" }, { ...captions, extra: "Unknown" }, { ...captions, chart: null }, { ...captions, chart: "x".repeat(6001) }, Object.create(captions), JSON.parse('{"chart":"text","__proto__":"unexpected"}')])
    assert.throws(() => validateFigureCaptions(value, figures));
  const reservedSource = [{ id: "__proto__", page: 1, caption: "A bound source." }];
  const safe = validateFigureCaptions(JSON.parse('{"__proto__":"A string, not an object prototype."}'), reservedSource);
  assert.equal(Object.getPrototypeOf(safe), Object.prototype);
  assert.equal(Object.hasOwn(safe, "__proto__"), true);
  assert.equal({}.polluted, undefined);
});

test("caption translation sends text only, repairs at most once, and rejects duplicate IDs and geometry", async () => {
  for (const invalid of ["null", '{"unfinished":', '[{"id":"chart","caption":"one"},{"id":"chart","caption":"two"}]', '[{"id":"chart","caption":"text","crop":{}},{"id":"diagram","caption":"text"}]', '[{"id":"chart","id":"diagram","caption":"text"}]']) {
    const calls = [];
    const result = await translateFigureCaptions({ figures, language: "zh-CN", callModel: async prompt => {
      calls.push(prompt); return calls.length === 1 ? invalid : output;
    } });
    assert.deepEqual(result, captions);
    assert.equal(calls.length, 2);
    assert.match(calls[1], /only repair attempt/);
    assert.ok(!calls[0].includes('"page":2'));
    assert.ok(!calls[0].includes('"x":0.1'));
    let attempts = 0;
    await assert.rejects(() => translateFigureCaptions({ figures, language: "zh-CN", callModel: async () => { attempts++; return invalid; } }), error => error.status === 502);
    assert.equal(attempts, 2);
  }
  let calls = 0;
  assert.deepEqual(await translateFigureCaptions({ figures: [], language: "en", callModel: async () => { calls++; } }), {});
  assert.equal(calls, 0);
});

test("substantial untranslated caption prose triggers one repair while technical labels, numbers and formulas remain allowed", async () => {
  const original = "图 9：以优化器步数衡量的尺度行为。两条定律均拟合至第 200 步，并外推至第 350 步；其定性模式与按 GPU-hours 拟合的结果相同。";
  const sources = [{ id: "steps", caption: original }, { id: "terms", caption: "GPT-4.1 / ViT-L · 200 → 350 · $R^2 > 0.99$" }];
  const bad = { steps: original, terms: sources[1].caption };
  const good = { steps: "Figure 9: Scaling measured in optimizer steps. Both laws are fitted through step 200 and extrapolated to step 350, preserving the qualitative pattern of GPU-hours fits.", terms: sources[1].caption };
  const encode = values => JSON.stringify(Object.entries(values).map(([id, caption]) => ({ id, caption })));
  assert.throws(() => validateFigureCaptions(bad, sources, { language: "en" }), /untranslated/);
  assert.deepEqual(validateFigureCaptions(good, sources, { language: "en-US" }), good);
  assert.equal(usableFigureCaptions({ language: "en", figureCaptions: bad, figureCaptionsSourceHash: figureCaptionsSourceHash(sources) }, sources), false);
  const calls = [];
  assert.deepEqual(await translateFigureCaptions({ figures: sources, language: "en", callModel: async prompt => { calls.push(prompt); return encode(calls.length === 1 ? bad : good); } }), good);
  assert.equal(calls.length, 2); assert.match(calls[1], /untranslated/);
  assert.match(calls[0], /qualifier attached to the same statistic/);
  let failures = 0;
  await assert.rejects(() => translateFigureCaptions({ figures: sources, language: "en", callModel: async () => { failures++; return encode(bad); } }), error => error.status === 502 && /untranslated/.test(error.message));
  assert.equal(failures, 2);
  const english = "Both models are evaluated on the same independent samples under controlled conditions with repeated measurements and an explicit uncertainty interval.";
  assert.throws(() => validateFigureCaptions({ chart: english }, [{ id: "chart", caption: english }], { language: "zh-CN" }), /untranslated/);
  assert.deepEqual(validateFigureCaptions({ terms: sources[1].caption }, [sources[1]], { language: "zh-CN" }), { terms: sources[1].caption });
});

test("duplicate JSON names including escaped aliases cannot silently overwrite an imported caption", () => {
  assertUniqueJsonKeys('{"text":"braces { } and escaped \\"quotes\\"","nested":[{"id":"a"},{"id":"b"}]}');
  for (const source of ['{"chart":"first","chart":"last"}', '{"chart":"first","ch\\u0061rt":"last"}', '[{"fields":{"title":1,"title":2}}]'])
    assert.throws(() => assertUniqueJsonKeys(source), /must not repeat/);
});
