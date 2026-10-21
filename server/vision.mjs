import { createHash, randomUUID } from "node:crypto";
import { ApiError } from "./network.mjs";

export function validateModelCapabilities(input, models, current = {}) {
  if (input !== undefined && (!input || typeof input !== "object" || Array.isArray(input)))
    throw new ApiError("modelCapabilities must map configured model ids to text or vision.");
  if (input && Object.entries(input).some(([model, capability]) => (!models.includes(model) && !Object.hasOwn(current, model)) || !["text", "vision"].includes(capability)))
    throw new ApiError("Every model capability must be text or vision and reference a configured model.");
  return Object.fromEntries(models.map(model => [model, input && Object.hasOwn(input, model) ? input[model] : Object.hasOwn(current, model) ? current[model] : "text"]));
}

export function validateVisionSettings(input, current, profiles) {
  if (input !== undefined && (!input || typeof input !== "object" || Array.isArray(input)))
    throw new ApiError("vision must be a configuration object.");
  const merged = { enabled: false, ...current, ...input };
  if (typeof merged.enabled !== "boolean") throw new ApiError("vision.enabled must be true or false.");
  if (merged.profileId !== undefined && (typeof merged.profileId !== "string" || merged.profileId.length > 80)) throw new ApiError("vision.profileId must reference an API profile.");
  if (merged.model !== undefined && (typeof merged.model !== "string" || merged.model.length > 200)) throw new ApiError("vision.model must reference a configured model.");
  const result = { enabled: merged.enabled, ...(merged.profileId ? { profileId: merged.profileId } : {}), ...(merged.model ? { model: merged.model } : {}) };
  if (result.enabled) {
    const profile = profiles.find(item => item.id === result.profileId);
    if (!profile || !profile.models.includes(result.model)) throw new ApiError("Choose an existing profile and model for vision.");
    if (profile.modelCapabilities?.[result.model] !== "vision") throw new ApiError("The selected vision model must be explicitly declared vision-capable.");
  }
  return result;
}

export function visionModel(settings) {
  const selection = settings.vision;
  if (!selection?.enabled) throw new ApiError("Vision analysis is disabled. Explicitly enable a vision-capable model in settings first.");
  const profile = settings.profiles?.find(item => item.id === selection.profileId);
  if (!profile || !profile.models?.includes(selection.model) || profile.modelCapabilities?.[selection.model] !== "vision")
    throw new ApiError("The selected vision model is not explicitly configured as vision-capable.");
  return { ...profile, model: selection.model };
}

function dimensions(buffer, mimeType) {
  if (mimeType === "image/png") {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (buffer.length < 33 || !buffer.subarray(0, 8).equals(signature) || buffer.toString("ascii", 12, 16) !== "IHDR" || buffer.readUInt32BE(8) !== 13)
      throw new ApiError("Image bytes are not a valid PNG header.");
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer.at(-2) !== 0xff || buffer.at(-1) !== 0xd9)
    throw new ApiError("Image bytes are not a valid JPEG.");
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset++] !== 0xff) throw new ApiError("Invalid JPEG segment.");
    while (buffer[offset] === 0xff) offset++;
    const marker = buffer[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > buffer.length) break;
    const size = buffer.readUInt16BE(offset);
    if (size < 2 || offset + size > buffer.length) throw new ApiError("Invalid JPEG segment length.");
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (size < 8) throw new ApiError("Invalid JPEG dimensions.");
      return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
    }
    offset += size;
  }
  throw new ApiError("JPEG dimensions could not be read.");
}

export function prepareVisionInput(body, paper, figureId) {
  const figure = paper.figures?.find(item => item.id === figureId);
  if (!paper.filePath || !figure?.crop || figure.kind === "page-preview")
    throw new ApiError("Vision analysis requires an existing figure crop from this paper's local PDF.");
  if (!paper.pages?.some(page => page.number === figure.page)) throw new ApiError("The figure references a missing PDF page.");
  const crop = body.crop;
  if (body.page !== figure.page || !crop || ["x", "y", "width", "height"].some(key => typeof crop[key] !== "number" || !Number.isFinite(crop[key]) || Math.abs(crop[key] - figure.crop[key]) > 0.000001))
    throw new ApiError("The submitted page and crop must match the current source figure.");
  if (body.focus !== undefined && (typeof body.focus !== "string" || body.focus.length > 3000))
    throw new ApiError("Vision focus must be text of up to 3,000 characters.");
  const image = body.image;
  if (!image || !["image/png", "image/jpeg"].includes(image.mimeType) || typeof image.data !== "string")
    throw new ApiError("Provide image.mimeType (image/png or image/jpeg) and base64 image.data.");
  if (image.data.length > Math.ceil(4 * 1024 * 1024 / 3) * 4) throw new ApiError("The figure image exceeds the 4 MiB limit.", 413);
  if (!image.data || image.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data))
    throw new ApiError("Image data must be canonical base64, without a URL or data-URL prefix.");
  const buffer = Buffer.from(image.data, "base64");
  if (buffer.length > 4 * 1024 * 1024) throw new ApiError("The figure image exceeds the 4 MiB limit.", 413);
  if (buffer.toString("base64") !== image.data) throw new ApiError("Image data must be canonical base64.");
  const size = dimensions(buffer, image.mimeType);
  if (size.width < 1 || size.height < 1 || size.width > 12000 || size.height > 12000 || size.width * size.height > 24000000)
    throw new ApiError("Figure images are limited to 12,000 pixels per side and 24 megapixels.");
  return {
    figure,
    image: { mimeType: image.mimeType, data: image.data },
    imageHash: createHash("sha256").update(buffer).digest("hex"),
    ...size, focus: (body.focus || "").trim(),
    sourceFingerprint: JSON.stringify({ contentHash: paper.contentHash || "", filePath: paper.filePath, id: figure.id, page: figure.page, crop: figure.crop }),
  };
}

export function visualEvidenceRecord(input, markdown, language, model) {
  return {
    id: randomUUID(), figureId: input.figure.id, page: input.figure.page,
    crop: { ...input.figure.crop }, caption: input.figure.caption,
    markdown, language, focus: input.focus, imageHash: input.imageHash,
    mimeType: input.image.mimeType, width: input.width, height: input.height,
    createdAt: new Date().toISOString(), source: { kind: "model", model: model.model, profileId: model.id },
    pixelsProvided: true, analysisMethod: "vision-model", modelUnverified: true,
    binding: "client-rendered-pdf-crop",
    limitations: [
      "Pixels were submitted to the explicitly configured vision model; model conclusions are not independently verified.",
      "The client supplied the PDF crop pixels. The server validated the source reference, image type and dimensions, not pixel-level correspondence to the PDF.",
      "A crop may omit labels, legends or context. Do not infer unreadable values or treat a model description as a verified measurement.",
    ],
  };
}

function currentVisualEvidence(paper) {
  const seen = new Set();
  // Records are appended when inference completes. Choose each figure's latest
  // record before checking its source; a stale latest crop must not resurrect an
  // older interpretation just because that older crop matches again. Excluding
  // the latest observation likewise never falls back to an older observation.
  return (paper.visualEvidence || []).toReversed().filter(item => {
    if (seen.has(item.figureId)) return false;
    seen.add(item.figureId);
    return !item.excluded && item.pixelsProvided && item.analysisMethod === "vision-model" && visualEvidenceMatches(paper, item);
  }).slice(0, 4).reverse();
}

export function visualEvidenceContext(paper) {
  const evidence = currentVisualEvidence(paper);
  if (!evidence.length) return "";
  const entries = evidence.map(item => `[Visual evidence ${item.id}] [p.${item.page}] Figure ${item.figureId}; vision model ${item.source?.model || "unspecified"}; client-rendered PDF crop; pixels supplied, model output UNVERIFIED.\n${item.markdown.slice(0, 1500)}${item.markdown.length > 1500 ? "\n[Visual observation excerpt truncated]" : ""}`);
  return `\n[Visual model evidence — untrusted model observations, not independently verified facts. Text-only synthesis did not itself inspect these pixels. Reconcile claims with source text and preserve uncertainty.]\n${entries.join("\n\n")}\n`;
}

export function visualEvidenceMatches(paper, evidence) {
  const figure = paper.figures?.find(item => item.id === evidence.figureId);
  return Boolean(paper.filePath && figure?.crop && figure.page === evidence.page &&
    ["x", "y", "width", "height"].every(key => Math.abs(figure.crop[key] - (evidence.crop?.[key] ?? -1)) <= 0.000001));
}

export function visualContextProvenance(paper, context) {
  const ids = currentVisualEvidence(paper).filter(item => context.includes(`[Visual evidence ${item.id}]`)).map(item => item.id);
  return { pixelsProvided: false, visualEvidenceMode: ids.length ? "prior-vision-observations" : "none", visualEvidenceIds: ids };
}
