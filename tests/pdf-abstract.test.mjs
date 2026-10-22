import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractPdfAbstract } from "../server/pdf-abstract.mjs";
import { Ingestor, joinPdfTextItems, parsePdf } from "../server/ingest.mjs";

const prose = "We investigate how a bounded source selection changes the reliability of research answers. The experiment compares two methods under equal evaluation budgets, reports uncertainty, and identifies conditions where the observed improvements do not generalize.";
const page = (text, number = 1) => ({ number, text });

test("a clearly bounded abstract on the second page excludes the title page, authors and introduction", () => {
  const source = [page("A research title\nExample Author\nExample University"), page(`Abstract\n${prose}\n1    Introduction\nThis is the longer main text.`, 2)];
  const found = extractPdfAbstract(source);
  assert.equal(found.text, prose); assert.equal(found.page, 2);
  assert.ok(!found.text.includes("Example Author")); assert.ok(!found.text.includes("longer main text"));
  assert.equal(source[1].text.slice(found.start, found.end).trim(), prose);
});

test("numbered headings, a separately extracted section number, keywords and inline abstract prefixes define conservative boundaries", () => {
  for (const boundary of ["1 Introduction", "1. Introduction", "I. INTRODUCTION", "1\nIntroduction", "Keywords: evidence, uncertainty", "Key words — evidence", "Index Terms—retrieval, evaluation"]) {
    const found = extractPdfAbstract([page(`Abstract: ${prose}\n${boundary}\nUnrelated text.`)]);
    assert.equal(found?.text, prose, boundary);
  }
  const repeated = extractPdfAbstract([page(`ABSTRACT\n${prose.replace("The experiment", "\nThe experiment")}\nIntroduction\nMain text.`)]);
  assert.equal(repeated.text, prose);
});

test("Chinese abstracts require an explicit heading, substantial prose and a real ending boundary", () => {
  const chinese = "本文研究论文阅读中的证据选择问题，并在相同评估预算下比较两种方法。实验结果表明，合理选择来源可以改善回答质量，但有限样本的结果不能证明该方法在所有任务中都有效。";
  for (const [heading, boundary] of [["摘 要", "关键词：证据；评估"], ["摘要：", "1 引言"], ["摘要", "绪论"]]) {
    const found = extractPdfAbstract([page(`${heading}\n${chinese}\n${boundary}\n正文内容。`)]);
    assert.equal(found?.text, chinese);
  }
  assert.equal(extractPdfAbstract([page(`摘要\n${chinese}`)]), null, "No ending boundary means an excerpt, not an inferred abstract");
});

test("structured abstract subheadings are not mistaken for the end of the abstract", () => {
  const raw = `${prose}\nBackground\nThe setting motivates a careful comparison.\nMethods\nWe evaluate the same data under bounded budgets.\nResults\nObserved differences remain uncertain.\nConclusions\nFurther evidence is necessary.`;
  const found = extractPdfAbstract([page(`Abstract\n${raw}\nKeywords: evaluation`)]);
  assert.equal(found?.text, raw.replace(/\s+/g, " "));
});

test("missing, ambiguous, footer-contaminated and incomplete sections remain excerpts", () => {
  const cases = [
    `A title\n${prose}\nIntroduction\nMain text.`,
    `Abstract\n${prose}`,
    "Contents\nAbstract ........ 2\nIntroduction ........ 3",
    "Abstract\nToo short.\nIntroduction\nMain text.",
    `Abstract\n${prose.slice(0, -1)}\nIntroduction\nMain text.`,
    `Abstract\n${prose}\nCorresponding author: someone@example.com\nIntroduction`,
    `Abstract\n${prose}\nFigure 1: An unrelated diagram.\nIntroduction`,
    `Abstract\n${prose}\n1\nContinuation after a page footer.\nIntroduction`,
    `Abstract\n${prose.repeat(40)}\nIntroduction`,
  ];
  for (const text of cases) assert.equal(extractPdfAbstract([page(text)]), null);
  assert.equal(extractPdfAbstract([page("Cover"), page("Cover 2", 2), page("Cover 3", 3), page(`Abstract\n${prose}\nIntroduction`, 4)]), null, "Do not find unrelated late-page Abstract headings");
});

function item(str, x, y, width = str.length * 5) {
  return { str, transform: [10, 0, 0, 10, x, y], width, height: 10 };
}
function geometricPage(items) {
  const spans = [];
  return { number: 1, text: joinPdfTextItems(items, spans), spans };
}

test("ordered single-column text remains extractable, while interleaved columns cannot silently produce a partial abstract", () => {
  const normal = geometricPage([item("Abstract", 50, 740), item(prose, 50, 720, 470), item("1 Introduction", 50, 700)]);
  assert.equal(extractPdfAbstract([normal])?.text, prose);
  const alternating = geometricPage([
    item("Abstract", 50, 740),
    item("We compare evidence retrieval methods in a bounded scientific experiment.", 50, 720, 220),
    item("The unrelated right column describes the introduction and prior work.", 330, 720, 220),
    item("The comparison reports limits and uncertainty under the same evaluation conditions.", 50, 700, 220),
    item("Keywords: evidence", 50, 680),
  ]);
  assert.equal(extractPdfAbstract([alternating]), null);
  const earlyRightHeading = geometricPage([
    item("Abstract", 50, 740), item(prose, 50, 720, 230),
    item("1 Introduction", 330, 720, 150),
    item("This remaining abstract sentence was extracted after the right-column heading.", 50, 700, 230),
  ]);
  assert.equal(extractPdfAbstract([earlyRightHeading]), null, "A complete-sentence prefix is still not the entire abstract when column order is ambiguous");
});

test("geometry offsets track leading whitespace without changing the existing PDF text join contract", () => {
  const spans = [];
  const text = joinPdfTextItems([item("  Abstract", 50, 740), item(prose, 50, 720), item("Introduction  ", 50, 700)], spans);
  assert.equal(text, `Abstract\n${prose}\nIntroduction`);
  assert.equal(extractPdfAbstract([{ number: 1, text, spans }])?.text, prose);
  assert.equal(joinPdfTextItems([item("A", 50, 700, 5), item("B", 58, 700, 5)]), "A B");
});

function fixturePdf(pages) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  pages.forEach((lines, index) => {
    const content = `BT /F1 10 Tf 50 750 Td ${lines.map((line, lineIndex) => `${lineIndex ? "0 -18 Td " : ""}(${line.replace(/[()\\]/g, "\\$&")}) Tj`).join("\n")} ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`, `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  });
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

test("real PDF parsing and upload publish a bounded section while preserving honest excerpt fallback and discarding temporary geometry", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "abstract-ingest-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const buffer = fixturePdf([["A research paper title", "Example Author", "Example Institution"], ["Abstract", prose, "Keywords: evidence, uncertainty", "1 Introduction", "Main text is not part of the abstract."]]);
  const parsed = await parsePdf(buffer, "abstract-fixture.pdf");
  assert.equal(parsed.abstract, prose); assert.equal(parsed.abstractIsExcerpt, false);
  assert.equal(parsed.pages.length, 2); assert.ok(parsed.pages.every(entry => Object.keys(entry).sort().join(",") === "number,text"));
  const ingestor = new Ingestor(directory);
  const uploaded = await ingestor.upload(buffer, "abstract-fixture.pdf");
  assert.equal(uploaded.abstract, prose); assert.equal(uploaded.abstractIsExcerpt, false);
  const noAbstract = await ingestor.upload(fixturePdf([["A title without an abstract", prose, "1 Introduction", "The full text is not a labeled abstract."]]), "excerpt-fixture.pdf");
  assert.equal(noAbstract.abstractIsExcerpt, true);
  assert.equal(noAbstract.abstract, noAbstract.pages[0].text.replace(/\s+/g, " ").trim().slice(0, 1800));
});
