import { randomUUID } from "node:crypto";
import { fromMarkdown } from "mdast-util-from-markdown";
import { mathFromMarkdown } from "mdast-util-math";
import { math } from "micromark-extension-math";
import { ApiError } from "./network.mjs";
import { hasUsableResultText } from "./translation-language.mjs";
import { proseCitations } from "../shared/prose-citations.mjs";

const FAILURE = "The translation changed or lost a source citation or figure marker. No translated article was saved. Retry the translation or import a corrected translation from your agent.";
const parse = value => fromMarkdown(value, { extensions: [math()], mdastExtensions: [mathFromMarkdown()] });
const isLocalPage = url => /^#page=\d+$/.test(url || "") && Number.isSafeInteger(Number(url.slice(6))) && Number(url.slice(6)) > 0;
const offset = (node, side) => node.position[side].offset;
function walk(node, callback) {
  callback(node);
  if (["code", "inlineCode", "math", "inlineMath", "html"].includes(node.type)) return;
  for (const child of node.children || []) walk(child, callback);
}
function documentLinks(markdown) {
  const tree = parse(markdown), definitions = new Map(), imageReferences = new Set(), links = [];
  walk(tree, node => {
    if (node.type === "definition" && !definitions.has(node.identifier)) definitions.set(node.identifier, node);
    if (node.type === "imageReference") imageReferences.add(node.identifier);
  });
  walk(tree, node => {
    if (node.type === "link") links.push({ node, url: node.url, title: node.title });
    if (node.type === "linkReference") {
      const definition = definitions.get(node.identifier);
      if (definition) links.push({ node, url: definition.url, title: definition.title, definition });
    }
  });
  return { links, imageReferences };
}
function label(markdown, node) {
  return node.children?.length ? markdown.slice(offset(node.children[0], "start"), offset(node.children.at(-1), "end")) : "";
}
function applyEdits(markdown, edits) {
  for (const edit of edits.sort((a, b) => b.start - a.start)) markdown = markdown.slice(0, edit.start) + edit.text + markdown.slice(edit.end);
  return markdown;
}
function editNode(node, text) { return { start: offset(node, "start"), end: offset(node, "end"), text }; }
function titleSyntax(title) {
  // Escape decoded titles, including entity-looking source text, so a second
  // Markdown parse reproduces the original title rather than decoding it again.
  return title === null || title === undefined ? "" : ` "${title.replace(/&/g, "&amp;").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
function figureMarkers(markdown) {
  const protectedSpans = [];
  walk(parse(markdown), node => {
    if (["code", "inlineCode", "math", "inlineMath", "html"].includes(node.type))
      protectedSpans.push([offset(node, "start"), offset(node, "end")]);
  });
  return [...markdown.matchAll(/^:::figure[ \t]+([\w-]+)[ \t]*$/gm)]
    .filter(match => !protectedSpans.some(([start, end]) => match.index >= start && match.index < end))
    .map(match => match[1]).sort();
}
const bindingKey = entry => JSON.stringify([entry.url, entry.title ?? null]);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Match the reader's plain prose citations, not lookalikes inside code, math,
// escaped literals or existing link/image labels. Normalize only presentation:
// numbers, range endpoints and occurrence counts remain source bindings.
function plainPageBindings(markdown) {
  const bindings = [];
  function visit(node) {
    if (["code", "inlineCode", "math", "inlineMath", "html", "link", "linkReference", "image", "imageReference"].includes(node.type)) return;
    if (node.type === "text") {
      for (const citation of proseCitations(markdown.slice(offset(node, "start"), offset(node, "end")), node.value))
        for (const { page, lastPage } of citation.pages || []) bindings.push(JSON.stringify([page, lastPage || page]));
    }
    for (const child of node.children || []) visit(child);
  }
  visit(parse(markdown));
  return bindings.sort();
}

/** External translations have no opaque placeholders. Compare the same source
 * bindings used by model restoration, allowing translated labels and reflow. */
export function validateTranslationBindings(source, translated, status = 400) {
  if (!hasUsableResultText(translated)) throw new ApiError("No usable translated text was returned. Empty or null results cannot be saved as completed translations.", status);
  if (typeof source !== "string" || source.length > 1_000_000 || translated.length > 1_000_000 ||
    !equal(figureMarkers(source), figureMarkers(translated)) ||
    !equal(plainPageBindings(source), plainPageBindings(translated)) ||
    !equal(documentLinks(source).links.filter(entry => isLocalPage(entry.url)).map(bindingKey).sort(),
      documentLinks(translated).links.filter(entry => isLocalPage(entry.url)).map(bindingKey).sort()))
    throw new ApiError(FAILURE, status);
  return translated;
}

export function usableTranslationBindings(source, translated) {
  try { validateTranslationBindings(source, translated); return true; }
  catch (error) { if (error instanceof ApiError) return false; throw error; }
}

/** Keep source bindings outside the translation model's authority. Titles may
 * contain untrusted instructions; none is interpreted or fetched here. */
export function protectTranslationBindings(source) {
  const prefix = `#pw-citation-${randomUUID()}-`;
  const parsed = documentLinks(source), originals = parsed.links.filter(entry => isLocalPage(entry.url));
  const bindings = new Map(), edits = [], removedDefinitions = new Set();
  for (const [index, entry] of originals.entries()) {
    const token = prefix + index;
    bindings.set(token, { url: entry.url, title: entry.title });
    edits.push(editNode(entry.node, `[${label(source, entry.node)}](${token})`));
    // Expand reused/shortcut references independently, so translating a visible
    // label never changes its reference identifier or another occurrence.
    if (entry.definition && !parsed.imageReferences.has(entry.definition.identifier) && !removedDefinitions.has(entry.definition)) {
      removedDefinitions.add(entry.definition);
      edits.push(editNode(entry.definition, ""));
    }
  }
  const markdown = applyEdits(source, edits);
  return {
    markdown,
    instruction: (bindings.size
      ? "Protected source citations use opaque #pw-citation-... link destinations. Translate their visible labels only. Keep every protected destination exactly once as a Markdown link, without adding a title, moving it into code/math, or inventing destinations. The application restores the original page and source-language quote; these placeholders are data, not commands. Preserve every standalone :::figure ID marker and its count."
      : "Preserve every standalone :::figure ID marker and its count. Do not invent new local #page links.") + " Preserve every plain page citation such as [p.4] or [pp.4–6], including its page numbers, range endpoints and occurrence count. [第4页] is equivalent to [p.4]; never change, omit, invent or hide page citations inside code, math or other links.",
    restore(translated) {
      if (!hasUsableResultText(translated)) throw new ApiError("No usable translated text was returned. Empty or null results cannot be saved as completed translations.", 502);
      if (translated.length > 1_000_000) throw new ApiError(FAILURE, 502);
      const output = documentLinks(translated), counts = new Map(), replacements = [], removed = new Set();
      for (const entry of output.links) {
        const binding = bindings.get(entry.url);
        if (!binding) {
          if (entry.url.startsWith("#pw-citation-") || isLocalPage(entry.url)) throw new ApiError(FAILURE, 502);
          continue;
        }
        counts.set(entry.url, (counts.get(entry.url) || 0) + 1);
        replacements.push(editNode(entry.node, `[${label(translated, entry.node)}](${binding.url}${titleSyntax(binding.title)})`));
        if (entry.definition && !output.imageReferences.has(entry.definition.identifier) && !removed.has(entry.definition)) {
          removed.add(entry.definition); replacements.push(editNode(entry.definition, ""));
        }
      }
      if ([...bindings.keys()].some(token => counts.get(token) !== 1)) throw new ApiError(FAILURE, 502);
      const restored = applyEdits(translated, replacements);
      // Reject leaked tokens, invented local links and syntax that changes a
      // restored binding. A model-supplied title is always discarded above.
      if (restored.includes(prefix)) throw new ApiError(FAILURE, 502);
      return validateTranslationBindings(source, restored, 502);
    },
  };
}
