import { ApiError } from "./network.mjs";
import { validateLanguage } from "./models.mjs";
import { contentHash } from "./storage.mjs";

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
  if (body.summary !== undefined)
    update.summary = contentEntry(body.summary, source);
  if (body.report !== undefined)
    update.report = contentEntry(body.report, source);
  if (body.figures !== undefined)
    update.figures = validateFigures(body.figures, paper, source);
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
        !["abstract", "report", "summary"].includes(translation.target)
      )
        throw new ApiError(
          "Translation target must be abstract, report, or summary.",
        );
      if (!translationSource({ ...paper, ...update }, translation.target))
        throw new ApiError(`No ${translation.target} exists to translate.`);
      const entry = contentEntry(translation, source);
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
