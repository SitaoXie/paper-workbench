import test from "node:test";
import assert from "node:assert/strict";
import { annotationMarkdown } from "../server/annotations.mjs";

const annotation = { kind: "highlight", page: 42, quote: "Finite sampling has limits.", body: "Check the confidence bound.", createdAt: "2026-01-01T00:00:00Z", tags: ["uncertainty"] };
test("portable Markdown notes include the original paper, authors and an actual PDF page URL", () => {
  const output = annotationMarkdown({ title: "Sampling study", authors: ["Example Author"], source: "arxiv", url: "https://arxiv.org/abs/2601.00001", pdfUrl: "https://arxiv.org/pdf/2601.00001#old", pages: [{ number: 42 }], filePath: "/private/user/library/file.pdf" }, [annotation]);
  assert.match(output, /Authors: Example Author/);
  assert.ok(output.includes("[Original paper](<https://arxiv.org/abs/2601.00001>)"));
  assert.ok(output.includes("[p.42](<https://arxiv.org/pdf/2601.00001#page=42>)"));
  assert.match(output, /one-based PDF page indexes/);
  assert.ok(!output.includes("/private/")); assert.ok(!output.includes("#old"));
});
test("local PDF notes retain a clear page fallback without leaking filesystem paths or manufacturing a public URL", () => {
  const output = annotationMarkdown({ title: "Local study", source: "pdf", filePath: "/private/user/library/file.pdf", pages: [{ number: 42 }] }, [annotation]);
  assert.match(output, /no portable public source URL/); assert.match(output, /\[p\.42\] \(open this page in your original document\)/);
  assert.ok(!output.includes("/private/")); assert.ok(!output.includes("http")); assert.ok(!output.includes("file:"));
});
test("web exports link source text while unsafe, private and credential-bearing URLs are never emitted", () => {
  const output = annotationMarkdown({ title: "A web source", source: "web", url: "https://example.com/paper?edition=2" }, [{ ...annotation, page: 1 }]);
  assert.ok(output.includes("[Source text](<https://example.com/paper?edition=2>)"));
  for (const url of ["javascript:alert(1)", "file:///private/user/paper.pdf", "http://127.0.0.1:4318/secret", "https://user:password@example.com/paper", "https://example.com/paper?access_token=PRIVATE_TOKEN"]) {
    const notes = annotationMarkdown({ title: "Safe export", url, pdfUrl: url, pages: [{ number: 42 }] }, [annotation]);
    assert.ok(!notes.includes(url)); assert.ok(!notes.includes("PRIVATE_TOKEN")); assert.match(notes, /no portable public source URL/);
  }
});
