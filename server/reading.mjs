import { createHash, randomUUID } from "node:crypto";
import { ApiError } from "./network.mjs";

const hash = (value) => createHash("sha256").update(value || "").digest("hex");
const clone = (value) => JSON.parse(JSON.stringify(value));

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

/** The fixed original, not a translation or the active reader's presentation. */
export function readingDerivationSource(paper, version) {
  return {
    markdown: version.markdown,
    language: version.language || "en",
    style: version.style || "deep",
    ...(version.focus !== undefined ? { focus: version.focus } : {}),
    ...(version.title !== undefined ? { title: version.title } : {}),
    figures: clone(version.figures || paper.figures || []),
    ...(version.figuresRevision ? { figuresRevision: version.figuresRevision } : {}),
    ...(version.pdfRevision || paper.sourcePdfRevision || paper.contentHash || paper.pdfRevision ? { pdfRevision: version.pdfRevision || paper.sourcePdfRevision || paper.contentHash || paper.pdfRevision } : {}),
  };
}

/** A comparison token for derivation, not proof of the scientific content. */
export function readingDerivationRevision(paper, version) {
  return hash(stableJson({ paperId: paper.id, readingId: version.id,
    source: readingDerivationSource(paper, version), createdAt: version.createdAt,
    attribution: version.articleSource || version.source || null,
    sourcePdfRevision: paper.sourcePdfRevision || paper.contentHash || null,
    currentPdfRevision: paper.pdfRevision || null, pageCount: paper.pages?.length || 0,
  }));
}

export function readingFormat(value = "article") {
  if (!["article", "interactive"].includes(value))
    throw new ApiError("Reading format must be article or interactive.");
  return value;
}

export function readingPreferences(input = {}, fallback = "deep") {
  const style = input.style ?? fallback;
  if (!["quick", "deep", "critical"].includes(style))
    throw new ApiError("Reading style must be quick, deep, or critical.");
  if (input.focus !== undefined && (typeof input.focus !== "string" || input.focus.length > 3000))
    throw new ApiError("Reading focus must be text of up to 3,000 characters.");
  return { style, focus: (input.focus || "").trim() };
}

function legacyId(target, entry) {
  return entry.readingId || `legacy-${target}-${hash(`${entry.createdAt || ""}\n${entry.markdown}`).slice(0, 24)}`;
}

function entryTranslations(paper, target, entry) {
  return Object.fromEntries(Object.entries(paper.translations || {}).flatMap(([language, targets]) => {
    const translation = targets[target];
    if (!translation || (translation.sourceHash ? translation.sourceHash !== hash(entry.markdown) : translation.sourceUpdatedAt !== entry.createdAt)) return [];
    return [[language, clone(translation)]];
  }));
}

// Reading versions are additive. Old summary/report fields remain available to
// older clients; migration derives stable ids without changing their content.
export function readingState(paper) {
  const versions = (paper.readingVersions || []).map((version) => ({ ...version }));
  const ids = new Set(versions.map((version) => version.id));
  for (const target of ["report", "summary"]) {
    for (const entry of [...(paper[`${target}History`] || []), paper[target]].filter(Boolean)) {
      if (typeof entry.markdown !== "string" || !entry.markdown.trim()) continue;
      const id = legacyId(target, entry);
      if (ids.has(id)) continue;
      ids.add(id);
      versions.push({
        ...clone(entry), id,
        language: entry.language || "en",
        style: entry.style || (target === "summary" ? "quick" : "deep"),
        format: entry.format || (entry.interactive ? "interactive" : "article"),
        title: entry.title || (target === "summary" ? "Summary" : "Reading report"),
        createdAt: entry.createdAt || paper.createdAt,
        figures: clone(entry.figures || paper.figures || []),
        translations: entryTranslations(paper, target, entry),
        legacyTarget: target,
      });
    }
  }
  versions.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  const preferred = paper.summary || paper.report;
  const preferredId = preferred ? legacyId(paper.summary ? "summary" : "report", preferred) : null;
  const activeReadingId = ids.has(paper.activeReadingId) ? paper.activeReadingId
    : ids.has(preferredId) ? preferredId : versions.at(-1)?.id || null;
  return { readingVersions: versions, activeReadingId };
}

export function materializeReadingVersions(paper) {
  Object.assign(paper, readingState(paper));
  return paper.readingVersions;
}

export function appendReadingVersion(paper, entry, options = {}) {
  materializeReadingVersions(paper);
  const preferences = readingPreferences(options, options.target === "summary" ? "quick" : "deep");
  const id = randomUUID();
  entry.readingId = id;
  const version = {
    ...clone(entry), id, ...preferences,
    format: readingFormat(entry.format || (entry.interactive ? "interactive" : "article")),
    title: options.title || ({ quick: "Quick overview", deep: "Deep reading", critical: "Critical review" })[preferences.style],
    figures: clone(options.figures || paper.figures || []),
    translations: {},
    ...(options.target ? { legacyTarget: options.target } : {}),
  };
  // The entry may already be attached to its legacy field. Remove its derived
  // mirror so a single generation appears once in the unified reader.
  paper.readingVersions = paper.readingVersions.filter((existing) =>
    !(existing.id.startsWith("legacy-") && existing.legacyTarget === options.target &&
      existing.createdAt === entry.createdAt && existing.markdown === entry.markdown));
  paper.readingVersions.push(version);
  paper.activeReadingId = id;
  return version;
}

export function syncReadingTranslations(paper) {
  materializeReadingVersions(paper);
  for (const target of ["summary", "report"]) {
    const entry = paper[target];
    if (!entry) continue;
    const version = paper.readingVersions.find((item) => item.id === legacyId(target, entry));
    if (version) {
      version.translations ||= {};
      for (const [language, translation] of Object.entries(entryTranslations(paper, target, entry))) {
        const current = version.translations[language];
        // A legacy compatibility field must not overwrite a newer translation
        // imported directly into this immutable reading revision.
        if (!current || (translation.createdAt || "") > (current.createdAt || ""))
          version.translations[language] = translation;
      }
    }
  }
}
