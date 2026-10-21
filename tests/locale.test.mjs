import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);

function loadLocale({ pathname = "/", hostname = "localhost", stored = null, storageFails = false } = {}) {
  const compile = name => ts.transpileModule(fs.readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dictionary = { exports: {} };
  vm.runInNewContext(compile("locales.ts"), dictionary);
  const context = {
    exports: {},
    require: name => name === "./locales" ? dictionary.exports : require(name),
    window: {
      location: { pathname, hostname },
      localStorage: { getItem: () => { if (storageFails) throw new Error("Storage unavailable"); return stored; } },
    },
  };
  vm.runInNewContext(compile("i18n.tsx"), context);
  return context.exports;
}

test("explicit language paths override subdomains and saved locale, without matching unrelated paths", () => {
  const { resolveLocale } = loadLocale();
  assert.equal(resolveLocale("/en/", "zh.example.com", "zh"), "en");
  assert.equal(resolveLocale("/zh/library", "en.example.com", "en"), "zh");
  assert.equal(resolveLocale("/EN", "localhost", "zh"), "en");
  assert.equal(resolveLocale("/english/", "localhost", "zh"), "zh");
  assert.equal(resolveLocale("/enough/", "en.example.com", "zh"), "en");
  assert.equal(resolveLocale("/", "zh.example.com", "en"), "zh");
  assert.equal(resolveLocale("/", "example.com", "en"), "en");
});

test("interface translation selects English but preserves unknown source text", () => {
  const { t, getLocale } = loadLocale({ pathname: "/en/" });
  assert.equal(getLocale(), "en");
  assert.equal(t("模型设置"), "Model settings");
  assert.equal(t("专门的标签", "Specific label"), "Specific label");
  assert.equal(t("用户自己的笔记"), "用户自己的笔记");
});

test("Chinese remains available and URL selection works when browser storage is disabled", () => {
  assert.equal(loadLocale({ pathname: "/zh/", stored: "en" }).t("模型设置", "Model settings"), "模型设置");
  assert.equal(loadLocale({ pathname: "/en/", storageFails: true }).getLocale(), "en");
  assert.equal(loadLocale({ storageFails: true }).getLocale(), "zh");
});
