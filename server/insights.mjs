import { ApiError } from "./network.mjs";
import { validateLanguage } from "./models.mjs";
import { contentHash } from "./storage.mjs";
import { readingState, readingFormat } from "./reading.mjs";
import { validateInteractive, validateInteractiveTranslation } from "./interactive.mjs";
import { validateFigureCaptions, figureCaptionsSourceHash } from "./captions.mjs";

export function validateAgentSource(source) {
  if (
    !source ||
    typeof source !== "object" ||
    Array.isArray(source) ||
    typeof source.agent !== "string" ||
    !source.agent.trim() ||
    source.agent.length > 100
  )
    throw new ApiError(
      "source.agent must identify the external agent (up to 100 characters).",
    );
  if (
    source.model !== undefined &&
    (typeof source.model !== "string" ||
      !source.model.trim() ||
      source.model.length > 200)
  )
    throw new ApiError(
      "source.model must be a model identifier of up to 200 characters.",
    );
  return {
    kind: "agent",
    agent: source.agent.trim(),
    ...(source.model ? { model: source.model.trim() } : {}),
  };
}

export function validateMarkdown(value, label = "markdown", max = 200000) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new ApiError(
      `${label} must contain between 1 and ${max.toLocaleString("en-US")} characters.`,
    );
  // Image evidence is rendered only from the imported PDF. Raw HTML is never executed.
  if (
    /!\[[^\]]*\]\s*\(|!\[[^\]]*\]\s*\[|<\s*(?:img|iframe|script|object|embed)\b/i.test(
      value,
    )
  )
    throw new ApiError(
      "Use figures with local PDF page/crop references instead of embedded images or HTML.",
    );
  return value.trim();
}

function contentEntry(entry, source) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry))
    throw new ApiError("Content must be an object with markdown and language.");
  return {
    markdown: validateMarkdown(entry.markdown),
    language: validateLanguage(entry.language),
    createdAt: new Date().toISOString(),
    mode: "agent",
    stages: [],
    source,
  };
}

export function validateFigures(figures, paper, source) {
  if (!Array.isArray(figures) || figures.length > 30)
    throw new ApiError(
      "figures must be an array of at most 30 PDF references.",
    );
  if (figures.length && !paper.filePath)
    throw new ApiError("Figure references require a locally imported PDF.");
  const ids = new Set();
  return figures.map((figure, index) => {
    if (
      !figure ||
      typeof figure !== "object" ||
      !Number.isInteger(figure.page) ||
      !paper.pages?.some((page) => page.number === figure.page)
    )
      throw new ApiError("Each figure must reference an existing PDF page.");
    if (
      typeof figure.caption !== "string" ||
      !figure.caption.trim() ||
      figure.caption.length > 3000
    )
      throw new ApiError(
        "Each figure needs a caption of up to 3,000 characters.",
      );
    const id = figure.id ?? `figure-${index + 1}`;
    if (
      typeof id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(id) ||
      ids.has(id)
    )
      throw new ApiError("Figure ids must be unique identifiers.");
    ids.add(id);
    let crop;
    if (figure.crop !== undefined) {
      const c = figure.crop;
      if (
        !c ||
        typeof c !== "object" ||
        ["x", "y", "width", "height"].some(
          (key) => typeof c[key] !== "number" || !Number.isFinite(c[key]),
        ) ||
        c.x < 0 ||
        c.y < 0 ||
        c.width <= 0 ||
        c.height <= 0 ||
        c.x + c.width > 1.000001 ||
        c.y + c.height > 1.000001
      )
        throw new ApiError(
          "Figure crop must be a normalized rectangle within the PDF page (x, y, width, height).",
        );
      crop = { x: c.x, y: c.y, width: c.width, height: c.height };
    }
    return {
      id,
      page: figure.page,
      caption: figure.caption.trim(),
      ...(crop ? { crop } : {}),
      source,
      kind: crop ? "figure-crop" : "page-preview",
    };
  });
}

export function prepareInsights(body, paper) {
  const source = validateAgentSource(body.source);
  const update = {};
  if (body.figures !== undefined)
    update.figures = validateFigures(body.figures, paper, source);
  const figureContext = { pageCount: paper.pages?.length, figures: update.figures || paper.figures || [] };
  if (body.interactive !== undefined && (body.summary === undefined) === (body.report === undefined))
    throw new ApiError("Top-level interactive content requires exactly one summary or report.");
  if (body.format !== undefined) readingFormat(body.format);
  for (const target of ["summary", "report"]) {
    if (body[target] === undefined) continue;
    const input = body[target];
    const entry = contentEntry(input, source);
    const interactive = input.interactive ?? body.interactive;
    entry.format = readingFormat(input.format ?? body.format ?? (interactive === undefined ? "article" : "interactive"));
    if (entry.format === "interactive") entry.interactive = validateInteractive(interactive, figureContext);
    else if (interactive !== undefined) throw new ApiError("Interactive blocks require the interactive reading format.");
    update[target] = entry;
  }
  if (body.translations !== undefined) {
    if (
      !Array.isArray(body.translations) ||
      !body.translations.length ||
      body.translations.length > 30
    )
      throw new ApiError(
        "translations must contain between 1 and 30 translations.",
      );
    update.translations = JSON.parse(JSON.stringify(paper.translations || {}));
    for (const translation of body.translations) {
      if (
        !translation ||
        !["abstract", "report", "summary", "reading"].includes(translation.target)
      )
        throw new ApiError(
          "Translation target must be abstract, report, summary, or reading.",
        );
      if (translation.target === "reading") {
        const state = readingState(paper);
        update.readingVersions ||= JSON.parse(JSON.stringify(state.readingVersions));
        const version = update.readingVersions.find((item) => item.id === (translation.readingId || state.activeReadingId));
        if (!version) throw new ApiError("Reading version not found in this paper.", 404);
        const language = validateLanguage(translation.language);
        const sourceHash = contentHash(version.markdown);
        const previous = version.translations?.[language];
        let entry;
        if (translation.markdown === undefined && translation.figureCaptions !== undefined) {
          const reusable = typeof previous?.markdown === "string" && previous.markdown.trim() && previous.markdown.trim().toLowerCase() !== "null" && !previous.stale &&
            (previous.sourceHash ? previous.sourceHash === sourceHash : previous.sourceUpdatedAt === version.createdAt);
          if (reusable) entry = { ...previous };
          else if (language === validateLanguage(version.language || "en")) entry = {
            markdown: version.markdown, language, createdAt: version.createdAt,
            ...(version.mode ? { mode: version.mode } : {}), ...(version.source ? { source: version.source } : {}),
            ...(version.interactive ? { interactive: version.interactive } : {}),
          };
          else throw new ApiError("Caption-only import requires an existing valid translated article or the original reading language.");
        } else entry = contentEntry(translation, source);
        if (translation.interactive !== undefined) {
          if (!version.interactive) throw new ApiError("This reading version has no interactive content to translate.");
          entry.interactive = validateInteractiveTranslation(translation.interactive, version.interactive, {
            pageCount: paper.pages?.length, figures: version.figures || paper.figures || [], language: entry.language,
          });
        }
        if (translation.figureCaptions !== undefined) {
          const figures = version.figures || paper.figures || [];
          entry.figureCaptions = validateFigureCaptions(translation.figureCaptions, figures, { language: entry.language });
          entry.figureCaptionsSourceHash = figureCaptionsSourceHash(figures);
          delete entry.captionTranslationError;
        }
        version.translations ||= {};
        version.translations[entry.language] = { ...entry, sourceUpdatedAt: version.createdAt, sourceHash };
        continue;
      }
      if (!translationSource({ ...paper, ...update }, translation.target))
        throw new ApiError(`No ${translation.target} exists to translate.`);
      const entry = contentEntry(translation, source);
      if (translation.figureCaptions !== undefined)
        throw new ApiError("figureCaptions requires target reading and its bound reading version.");
      if (translation.interactive !== undefined) {
        const original = update[translation.target] || paper[translation.target];
        if (!original?.interactive) throw new ApiError("The translation source has no interactive content.");
        entry.interactive = validateInteractiveTranslation(translation.interactive, original.interactive, {
          pageCount: paper.pages?.length, figures: original.figures || figureContext.figures, language: entry.language,
        });
      }
      const version = sourceVersion(
        { ...paper, ...update },
        translation.target,
      );
      update.translations[entry.language] ||= {};
      update.translations[entry.language][translation.target] = {
        ...entry,
        sourceUpdatedAt: version,
        sourceHash: contentHash(
          translationSource({ ...paper, ...update }, translation.target),
        ),
      };
    }
  }
  if (!Object.keys(update).length)
    throw new ApiError(
      "Provide summary, report, translations, or figures to import.",
    );
  return update;
}

export function translationSource(paper, target) {
  if (!["abstract", "report", "summary"].includes(target))
    throw new ApiError(
      "Translation target must be abstract, report, or summary.",
    );
  return target === "abstract" ? paper.abstract : paper[target]?.markdown;
}
export function sourceVersion(paper, target) {
  return target === "abstract" ? paper.createdAt : paper[target]?.createdAt;
}
