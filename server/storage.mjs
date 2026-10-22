import { mkdir, readFile, writeFile, rename, chmod } from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { readingState, readingDerivationRevision } from "./reading.mjs";
import { currentVisualEvidence, visualEvidenceMatches } from "./vision.mjs";
import { usableInteractiveTranslation, INTERACTIVE_TRANSLATION_INCOMPLETE } from "./interactive.mjs";
import { captionSources, usableFigureCaptions, CAPTION_TRANSLATION_INCOMPLETE } from "./captions.mjs";
import { usableTranslationBindings } from "./translation-bindings.mjs";

export const defaultSettings = {
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  apiKey: "",
  extraBody: {},
  contextChars: 44000,
  maxOutputTokens: 4096,
  requestTimeoutSeconds: 90,
};

// Keep the active profile mirrored at top level for older clients and callers.
export function normalizeProfiles(settings = defaultSettings) {
  const { profiles: existing, activeProfileId, vision, ...legacy } = settings;
  const profiles =
    Array.isArray(existing) && existing.length
      ? existing
      : [
          {
            ...defaultSettings,
            ...legacy,
            id: "default",
            name: "Default API",
            models: [legacy.model || defaultSettings.model],
          },
        ];
  for (const profile of profiles) {
    profile.modelCapabilities = Object.fromEntries((profile.models || [profile.model]).map(model => [model, profile.modelCapabilities?.[model] === "vision" ? "vision" : "text"]));
    profile.requestTimeoutSeconds ??= defaultSettings.requestTimeoutSeconds;
  }
  const active =
    profiles.find((profile) => profile.id === activeProfileId) || profiles[0];
  return { ...active, profiles, activeProfileId: active.id, vision: vision || { enabled: false } };
}

export class Store {
  constructor(directory) {
    this.directory = directory;
    this.file = path.join(directory, "store.json");
    this.queue = Promise.resolve();
  }
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    try {
      this.data = JSON.parse(await readFile(this.file, "utf8"));
      if (!Array.isArray(this.data.papers) || !Array.isArray(this.data.chats))
        throw new Error("Invalid data schema");
      this.data.settings = normalizeProfiles({
        ...defaultSettings,
        ...this.data.settings,
      });
      if (!Array.isArray(this.data.conversations)) {
        this.data.conversations = [];
        this.data.activeConversations = {};
        const groups = new Map();
        for (const message of this.data.chats) {
          const key = message.paperId ? `paper:${message.paperId}` : "global";
          let conversation = groups.get(key);
          if (!conversation) {
            conversation = {
              id: randomUUID(),
              paperId: message.paperId || null,
              title: message.content.slice(0, 80),
              createdAt: message.createdAt || new Date().toISOString(),
              updatedAt: message.createdAt || new Date().toISOString(),
            };
            groups.set(key, conversation);
            this.data.conversations.push(conversation);
            this.data.activeConversations[key] = conversation.id;
          }
          message.conversationId = conversation.id;
          conversation.updatedAt = message.createdAt || conversation.updatedAt;
        }
        this.data.version = 2;
        await this.save();
      }
      this.data.activeConversations ||= {};
      this.data.annotations ||= [];
      this.data.activities ||= [];
      for (const conversation of this.data.conversations) conversation.kind ||= "question";
    } catch (error) {
      if (error.code !== "ENOENT")
        throw new Error(
          "Cannot read local data store. Preserve store.json and restore a valid backup.",
        );
      this.data = {
        version: 2,
        papers: [],
        chats: [],
        conversations: [],
        activeConversations: {},
        annotations: [],
        activities: [],
        settings: normalizeProfiles(defaultSettings),
      };
      await this.save();
    }
    return this;
  }
  save() {
    // Capture each snapshot before queuing; serialized atomic renames prevent torn JSON.
    const snapshot = JSON.stringify(this.data, null, 2);
    this.queue = this.queue
      .catch(() => {})
      .then(async () => {
        const temporary = `${this.file}.${randomUUID()}.tmp`;
        await writeFile(temporary, snapshot, { mode: 0o600 });
        await rename(temporary, this.file);
      });
    return this.queue;
  }
  paper(id) {
    return this.data.papers.find((paper) => paper.id === id);
  }
  publicSettings() {
    const sanitize = (profile) => {
      const { apiKey, profiles: _profiles, ...settings } = profile;
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(
        new URL(settings.baseUrl).hostname,
      );
      return {
        ...settings,
        apiKeyConfigured: Boolean(apiKey),
        modelConfigured: Boolean(apiKey) || local,
      };
    };
    return {
      ...sanitize(this.data.settings),
      profiles: this.data.settings.profiles.map(sanitize),
    };
  }
}

export function discoverFigures(paper) {
  if (!paper.filePath || !paper.pages?.length) return [];
  const seen = new Set();
  const figures = [];
  for (const page of paper.pages) {
    // Only caption-like line starts count. Prose such as "Figure 2 illustrates"
    // is a reference to another page, not evidence that this page holds a figure.
    const captions = page.text.matchAll(
      /^[ \t]*(?:Figure|Fig\.|图)[ \t]*([A-Z]?\d+(?:\.\d+)?)[ \t]*[:：.][ \t]*([^\r\n]{4,350})/gim,
    );
    for (const match of captions) {
      const number = match[1].toLowerCase();
      if (seen.has(number)) continue;
      seen.add(number);
      figures.push({
        id: `source-figure-${number.replaceAll(".", "-")}`,
        page: page.number,
        caption: match[0].trim(),
        kind: "page-preview",
        source: { kind: "extracted" },
      });
      if (figures.length === 6) return figures;
    }
  }
  return figures;
}

export function contentHash(text) {
  return createHash("sha256")
    .update(text || "")
    .digest("hex");
}

/** Filter invalid legacy display blocks without mutating or discarding stored history. */
export function publicReadingTranslation(translation, original, { language, pageCount, figures = [] } = {}) {
  if (!translation || !original) return translation;
  const result = { ...translation };
  // Preserve historical bytes, but never offer a broken quote/figure binding
  // or a sentinel response as a completed translated article.
  if (typeof original.markdown === "string" && !usableTranslationBindings(original.markdown, translation.markdown))
    result.stale = true;
  const boundFigures = original.figures || figures;
  if (original.interactive) {
    if (usableInteractiveTranslation(translation.interactive, original.interactive, {
      language, pageCount, figures: boundFigures,
    })) {
      delete result.interactiveTranslationError;
    } else {
      delete result.interactive;
      result.interactiveTranslationError = typeof translation.interactiveTranslationError === "string"
        ? translation.interactiveTranslationError.slice(0, 1000) : INTERACTIVE_TRANSLATION_INCOMPLETE;
    }
  }
  if (captionSources(boundFigures).length) {
    if (usableFigureCaptions(translation, boundFigures, { language })) delete result.captionTranslationError;
    else {
      delete result.figureCaptions;
      delete result.figureCaptionsSourceHash;
      result.captionTranslationError = typeof translation.captionTranslationError === "string"
        ? translation.captionTranslationError.slice(0, 1000) : CAPTION_TRANSLATION_INCOMPLETE;
    }
  } else {
    delete result.figureCaptions;
    delete result.figureCaptionsSourceHash;
    delete result.captionTranslationError;
  }
  return result;
}

export function publicPaper(paper, full = true) {
  const { filePath, ...result } = paper;
  Object.assign(result, readingState(paper));
  result.readingVersions = result.readingVersions.map(version => ({ ...version,
    figures: version.figures || paper.figures || [],
    derivationRevision: readingDerivationRevision(paper, version),
    translations: Object.fromEntries(Object.entries(version.translations || {}).map(([language, translation]) => [
      language, publicReadingTranslation(translation, version, { language, pageCount: paper.pages?.length, figures: paper.figures }),
    ])),
  }));
  if (paper.visualEvidence) {
    // Determine eligibility before a consumer narrows the paper to some pages.
    // A later excluded/stale observation must still supersede an older one.
    const eligible = new Set(currentVisualEvidence(paper));
    result.visualEvidence = paper.visualEvidence.map(evidence => ({
      ...evidence, stale: !visualEvidenceMatches(paper, evidence),
      eligibleForContext: eligible.has(evidence),
    }));
  }
  if (filePath) {
    result.hasPdf = true;
    result.localPdfUrl = `/api/papers/${encodeURIComponent(paper.id)}/file`;
    // Recompute old automatic candidates after parser improvements; preserve
    // manually supplied/agent crops and deliberate empty figure arrays.
    result.figures =
      paper.figures?.length &&
      paper.figures.every((figure) => figure.source?.kind === "extracted")
        ? discoverFigures(paper)
        : (paper.figures ?? discoverFigures(paper));
  }
  if (paper.translations) {
    result.translations = Object.fromEntries(
      Object.entries(paper.translations).map(([language, targets]) => [
        language,
        Object.fromEntries(
          Object.entries(targets).map(([target, translation]) => {
            const source =
              target === "abstract" ? paper.abstract : paper[target]?.markdown;
            const updatedAt =
              target === "abstract"
                ? paper.createdAt
                : paper[target]?.createdAt;
            return [
              target,
              {
                ...publicReadingTranslation(translation, paper[target], { language, pageCount: paper.pages?.length, figures: paper.figures }),
                stale: Boolean(translation.stale) || !usableTranslationBindings(source, translation.markdown) || (translation.sourceHash
                  ? translation.sourceHash !== contentHash(source)
                  : translation.sourceUpdatedAt !== updatedAt),
              },
            ];
          }),
        ),
      ]),
    );
  }
  if (!full) {
    delete result.text;
    delete result.pages;
  }
  return result;
}
