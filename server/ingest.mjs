import { createHash, randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { XMLParser } from "fast-xml-parser";
import * as cheerio from "cheerio";
import { ApiError, secureDownload } from "./network.mjs";
import { extractPdfAbstract } from "./pdf-abstract.mjs";
import { metadataNames } from './paper-metadata.mjs';

const institutionMetadata = $ => metadataNames($('meta[name="citation_author_institution"],meta[name="citation_affiliation"]')
  .map((_, node) => $(node).attr('content')).get());

const clean = (value) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim();
const array = (value) =>
  value == null ? [] : Array.isArray(value) ? value : [value];
const MAX_TEXT = 750000;

export function arxivId(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (
    ![
      "arxiv.org",
      "www.arxiv.org",
      "export.arxiv.org",
      "alphaxiv.org",
      "www.alphaxiv.org",
    ].includes(url.hostname.toLowerCase())
  )
    return null;
  const candidate = url.pathname
    .replace(/^\/(?:abs|pdf|html|overview)\//, "")
    .replace(/\.pdf$/, "")
    .replace(/\/$/, "");
  return /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/i.test(
    candidate,
  )
    ? candidate
    : null;
}

export function parseArxivFeed(xml) {
  let parsed;
  try {
    parsed = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
    }).parse(xml);
  } catch {
    throw new ApiError(
      "arXiv returned an unreadable response. Please try again.",
      502,
    );
  }
  return array(parsed.feed?.entry)
    .map((entry) => {
      const identifier = arxivId(String(entry.id || ""));
      if (!identifier || !entry.title) return null;
      return {
        id: `arxiv:${identifier}`,
        arxivId: identifier,
        title: clean(entry.title),
        authors: array(entry.author)
          .map((author) => clean(author.name))
          .filter(Boolean),
        institutions: metadataNames(array(entry.author).flatMap(author => array(author['arxiv:affiliation'])
          .map(value => typeof value === 'string' ? value : value?.['#text']))),
        abstract: clean(entry.summary),
        url: `https://arxiv.org/abs/${identifier}`,
        pdfUrl: `https://arxiv.org/pdf/${identifier}`,
        source: "arxiv",
        publishedAt: entry.published || null,
        tags: array(entry.category)
          .map((category) => category["@_term"])
          .filter(Boolean),
        favorite: false,
        remote: true,
      };
    })
    .filter(Boolean);
}

export async function searchArxiv(query, download = secureDownload) {
  const url = new URL("https://export.arxiv.org/api/query");
  // Quoting the whole query prevents accidentally treating user prose as API operators.
  url.searchParams.set("search_query", `all:"${query.replace(/["\\]/g, " ")}"`);
  url.searchParams.set("start", "0");
  url.searchParams.set("max_results", "15");
  url.searchParams.set("sortBy", "relevance");
  const result = await download(url.href, { maxBytes: 3 * 1024 * 1024 });
  return parseArxivFeed(result.buffer.toString("utf8"));
}

// PDF text spans may be complete lines, words, or individual glyphs. Preserve
// source order, infer word boundaries from real spacing, and tolerate baseline
// rounding differences instead of adding a space between every PDF.js item.
export function joinPdfTextItems(items, spans) {
  let text = "";
  let previous;
  const geometry = (item) => {
    const t = item.transform;
    if (!Array.isArray(t) || t.length < 6 || !t.every(Number.isFinite))
      return null;
    const size = Math.hypot(t[0], t[1]) || Math.abs(item.height) || 10;
    return { x: t[4], y: t[5], ux: t[0] / size, uy: t[1] / size, size };
  };
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    if (!item.str) {
      if (item.hasEOL && previous) previous.hasEOL = true;
      continue;
    }
    const current = geometry(item);
    let separator = "";
    if (previous) {
      const prior = previous.geometry;
      if (previous.hasEOL) separator = "\n";
      else if (prior && current) {
        const dx = current.x - prior.x,
          dy = current.y - prior.y;
        const along = dx * prior.ux + dy * prior.uy;
        const across = Math.abs(-dx * prior.uy + dy * prior.ux);
        const tolerance = Math.max(
          0.75,
          Math.min(prior.size, current.size) * 0.15,
        );
        const direction = previous.dir === "rtl" ? -1 : 1;
        if (across > tolerance || along * direction < -tolerance)
          separator = "\n";
        else if (Number.isFinite(previous.width)) {
          const gap = along * direction - Math.abs(previous.width);
          if (gap > Math.max(0.8, Math.min(prior.size, current.size) * 0.15))
            separator = " ";
        } else separator = " ";
      } else separator = " ";
      if (separator === " " && (/\s$/.test(text) || /^\s/.test(item.str)))
        separator = "";
    }
    text += separator;
    if (spans) spans.push({ start: text.length, end: text.length + item.str.length, text: item.str, geometry: current, width: item.width });
    text += item.str;
    previous = {
      geometry: current,
      width: item.width,
      hasEOL: item.hasEOL,
      dir: item.dir,
    };
  }
  if (spans) {
    const leading = text.length - text.trimStart().length;
    for (const span of spans) { span.start -= leading; span.end -= leading; }
  }
  return text.trim();
}

export async function parsePdf(buffer, filename = "paper.pdf") {
  if (!buffer.subarray(0, 1024).includes(Buffer.from("%PDF-")))
    throw new ApiError("The uploaded file is not a valid PDF.");
  const pages = [];
  let parsed;
  try {
    // PDF.js in pdf-parse 1.x assumes a zero-offset byte array. Node pooled
    // Buffers can have a nonzero byteOffset and otherwise produce bad XRef errors.
    parsed = await pdfParse(new Uint8Array(buffer), {
      max: 250,
      pagerender: async (page) => {
        const content = await page.getTextContent({
          normalizeWhitespace: true,
          disableCombineTextItems: false,
        });
        const number = page.pageNumber || pages.length + 1;
        const spans = number <= 3 ? [] : undefined;
        const text = joinPdfTextItems(content.items, spans);
        pages.push({ number, text, ...(spans ? { spans } : {}) });
        return text;
      },
    });
  } catch {
    throw new ApiError(
      "Unable to extract this PDF. It may be encrypted, damaged, or unsupported.",
    );
  }
  const text = pages
    .map((page) => `[p.${page.number}]\n${page.text}`)
    .join("\n\n")
    .slice(0, MAX_TEXT);
  if (text.replace(/\[p\.\d+\]/g, "").replace(/\s/g, "").length < 40)
    throw new ApiError(
      "This PDF has no usable text layer (it may be scanned). Run OCR first, then upload the searchable PDF.",
    );
  const infoTitle = clean(parsed.info?.Title);
  const abstract = extractPdfAbstract(pages);
  return {
    title:
      infoTitle && !/^untitled$|^microsoft word/i.test(infoTitle)
        ? infoTitle
        : filename.replace(/\.pdf$/i, "").replace(/[_-]/g, " "),
    text,
    pages: pages.map((page) => ({ number: page.number, text: page.text.slice(0, 50000) })),
    abstract: abstract?.text || clean(pages[0]?.text).slice(0, 1800),
    abstractIsExcerpt: !abstract,
    pageCount: parsed.numpages,
    extractionTruncated:
      parsed.numpages > 250 ||
      pages.reduce((sum, page) => sum + page.text.length, 0) > MAX_TEXT,
  };
}

export class Ingestor {
  constructor(directory, download = secureDownload) {
    this.directory = directory;
    this.download = download;
  }
  async savePdf(buffer, id) {
    await mkdir(path.join(this.directory, "pdfs"), {
      recursive: true,
      mode: 0o700,
    });
    const filePath = path.join("pdfs", `${id}.pdf`);
    await writeFile(path.join(this.directory, filePath), buffer, {
      mode: 0o600,
    });
    return filePath;
  }
  base() {
    return {
      id: randomUUID(),
      title: "",
      authors: [],
      institutions: [],
      abstract: "",
      text: "",
      url: "",
      pdfUrl: "",
      source: "web",
      tags: [],
      favorite: false,
      createdAt: new Date().toISOString(),
    };
  }
  async upload(buffer, name) {
    const parsed = await parsePdf(buffer, name);
    const sourcePdfRevision = createHash("sha256").update(buffer).digest("hex");
    const paper = {
      ...this.base(),
      ...parsed,
      source: "pdf",
      contentHash: sourcePdfRevision,
      sourcePdfRevision,
      pdfRevision: sourcePdfRevision,
    };
    paper.filePath = await this.savePdf(buffer, paper.id);
    return paper;
  }
  async importUrl(input) {
    let url;
    try {
      url = new URL(input);
    } catch {
      throw new ApiError("Enter a valid URL.");
    }
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new ApiError(
        "Only HTTP(S) URLs without credentials are supported.",
      );
    const identifier = arxivId(input);
    if (identifier) return this.importArxiv(identifier);
    const result = await this.download(url.href);
    if (result.buffer.subarray(0, 1024).includes(Buffer.from("%PDF-"))) {
      const paper = await this.upload(
        result.buffer,
        path.basename(new URL(result.url || url.href).pathname) || "paper.pdf",
      );
      return {
        ...paper,
        url: url.href,
        pdfUrl: result.url || url.href,
        source: "pdf",
      };
    }
    if (
      result.contentType &&
      !/text\/html|application\/xhtml|text\/plain/i.test(result.contentType)
    )
      throw new ApiError("This URL does not return a webpage or a PDF.");
    const $ = cheerio.load(result.buffer.toString("utf8"));
    const meta = (key) =>
      $(`meta[name="${key}"],meta[property="${key}"]`).first().attr("content");
    const title =
      clean(
        meta("citation_title") ||
          meta("og:title") ||
          $("title").text() ||
          $("h1").first().text(),
      ) || url.hostname;
    const authors = $('meta[name="citation_author"]')
      .map((_, node) => clean($(node).attr("content")))
      .get();
    const abstract = clean(
      meta("description") ||
        meta("og:description") ||
        $(".abstract").first().text(),
    );
    $(
      "script,style,noscript,nav,footer,header,iframe,form,button,svg",
    ).remove();
    const main = $("article").first().length
      ? $("article").first()
      : $("main").first().length
        ? $("main").first()
        : $("body");
    const text = main
      .text()
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n/g, "\n\n")
      .trim()
      .slice(0, MAX_TEXT);
    if (text.length < 80)
      throw new ApiError(
        "The page has no readable article text. Try its direct PDF URL; pages requiring login or JavaScript may not be readable.",
      );
    return {
      ...this.base(),
      title,
      authors,
      institutions: institutionMetadata($),
      abstract: abstract || clean(text).slice(0, 1800),
      abstractIsExcerpt: !abstract,
      text,
      url: result.url || url.href,
      source: "web",
      publishedAt: meta("citation_publication_date") || null,
    };
  }
  async importArxiv(identifier) {
    let metadata;
    try {
      const result = await this.download(
        `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(identifier)}`,
        { maxBytes: 3 * 1024 * 1024 },
      );
      metadata = parseArxivFeed(result.buffer.toString("utf8"))[0];
    } catch {
      /* arXiv API availability varies; its abstract page is an independent fallback. */
    }
    if (!metadata) {
      const result = await this.download(
        `https://arxiv.org/abs/${identifier}`,
        { maxBytes: 5 * 1024 * 1024 },
      );
      const $ = cheerio.load(result.buffer.toString("utf8"));
      const title = clean(
        $('meta[name="citation_title"]').attr("content") ||
          $("h1.title")
            .text()
            .replace(/^Title:\s*/, ""),
      );
      const abstract = clean(
        $("blockquote.abstract")
          .text()
          .replace(/^Abstract:\s*/, "") ||
          $('meta[name="description"]').attr("content"),
      );
      if (!title || !abstract)
        throw new ApiError(
          "Could not retrieve this arXiv paper. Verify its identifier and try again.",
          502,
        );
      metadata = {
        title,
        abstract,
        authors: $('meta[name="citation_author"]')
          .map((_, el) => $(el).attr("content"))
          .get(),
        institutions: institutionMetadata($),
        tags: [],
        arxivId: identifier,
        url: `https://arxiv.org/abs/${identifier}`,
        pdfUrl: `https://arxiv.org/pdf/${identifier}`,
        publishedAt: $('meta[name="citation_date"]').attr("content") || null,
        source: "arxiv",
      };
    }
    const paper = {
      ...this.base(),
      ...metadata,
      id: randomUUID(),
      text: metadata.abstract,
      remote: false,
    };
    try {
      const result = await this.download(paper.pdfUrl);
      const parsed = await parsePdf(result.buffer, `${identifier}.pdf`);
      const sourcePdfRevision = createHash("sha256").update(result.buffer).digest("hex");
      Object.assign(paper, {
        text: parsed.text,
        pages: parsed.pages,
        pageCount: parsed.pageCount,
        extractionTruncated: parsed.extractionTruncated,
        sourcePdfRevision,
        pdfRevision: sourcePdfRevision,
      });
      paper.filePath = await this.savePdf(result.buffer, paper.id);
    } catch (error) {
      paper.ingestionWarnings = [
        `Only metadata and abstract are available. Full-text PDF could not be read: ${error.message}`,
      ];
      paper.metadataOnly = true;
    }
    return paper;
  }
}
