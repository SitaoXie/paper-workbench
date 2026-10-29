import { decodeString } from "micromark-util-decode-string";

// Decode CommonMark escapes/entities while retaining their exact source spans.
// One transformed symbol must not hide unrelated citations in the same node.
function decodedSpans(raw) {
  const spans = [], chunks = [];
  let rawCursor = 0, decodedCursor = 0;
  function append(start, end, value) {
    if (start === end) return;
    spans.push({ start: decodedCursor, end: decodedCursor + value.length, rawStart: start, rawEnd: end, literal: raw.slice(start, end) === value });
    chunks.push(value); decodedCursor += value.length;
  }
  for (const match of raw.matchAll(/\\[!-/:-@[-`{-~]|&(?:#(?:\d{1,7}|x[\da-f]{1,6})|[\da-z]{1,31});/gi)) {
    append(rawCursor, match.index, raw.slice(rawCursor, match.index));
    append(match.index, match.index + match[0].length, decodeString(match[0]));
    rawCursor = match.index + match[0].length;
  }
  append(rawCursor, raw.length, raw.slice(rawCursor));
  return { value: chunks.join(""), spans };
}

/** Recognize literal source citation syntax within an already parsed prose
 * text node. decodedValue is the AST text: container prefixes (e.g. > on later
 * blockquote lines) can occur in the raw span but not in this displayed value.
 * Escaped/entity-created brackets stay literal; other escapes do not affect
 * nearby citations. Callers exclude code, math, link and image nodes. */
export function proseCitations(raw, decodedValue, sourceSpans = false) {
  const decoded = decodedSpans(raw), value = decodedValue ?? decoded.value;
  const result = [];
  let spanIndex = 0, valueCursor = 0;
  for (const match of decoded.value.matchAll(/\[((?:pp?\.?\s*\d)[^\]\n]{0,100}|第\s*\d{1,4}\s*页|Abstract|Source text|原始摘要|摘要|来源正文|来源文本)\]/gi)) {
    const start = value.indexOf(match[0], valueCursor);
    if (start < 0) continue;
    valueCursor = start + match[0].length;
    while (decoded.spans[spanIndex]?.end <= match.index) spanIndex++;
    const first = decoded.spans[spanIndex];
    let lastIndex = spanIndex;
    const end = match.index + match[0].length;
    while (decoded.spans[lastIndex]?.end < end) lastIndex++;
    const last = decoded.spans[lastIndex];
    const rawStart = first.literal ? first.rawStart + match.index - first.start : first.rawStart;
    const rawEnd = last.literal ? last.rawStart + end - last.start : last.rawEnd;
    if (raw.slice(rawStart, rawEnd) !== match[0]) continue;
    const sourceTarget = /^(?:Abstract|原始摘要|摘要)$/i.test(match[1]) ? "abstract"
      : /^(?:Source text|来源正文|来源文本)$/i.test(match[1]) ? "text" : undefined;
    const common = { start, end: valueCursor, label: match[1], ...(sourceSpans ? { rawStart, rawEnd } : {}) };
    if (sourceTarget) { result.push({ ...common, sourceTarget }); continue; }
    const parts = match[1].replace(/^第\s*(\d+)\s*页$/, "p.$1").split(/\s*[,;，、]\s*/);
    if (parts.length > 12) continue;
    const pages = parts.map(part => /^(?:pp?\.?\s*)?(\d{1,4})(?:\s*[-–—]\s*(?:pp?\.?\s*)?(\d{1,4}))?$/i.exec(part));
    if (pages.some(page => !page || Number(page[1]) < 1 || (page[2] && Number(page[2]) < Number(page[1])))) continue;
    result.push({ ...common, pages: pages.map(page => ({ page: Number(page[1]), ...(page[2] ? { lastPage: Number(page[2]) } : {}) })) });
  }
  return result;
}
