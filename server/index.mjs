import express from "express";
import packageMetadata from "../package.json" with { type: "json" };
import multer from "multer";
import path from "node:path";
import { existsSync } from "node:fs";
import { unlink, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  Store,
  publicPaper,
  publicReadingTranslation,
  discoverFigures,
  contentHash,
} from "./storage.mjs";
import { ApiError, secureDownload } from "./network.mjs";
import { Ingestor, arxivId, searchArxiv } from "./ingest.mjs";
import {
  validateSettings,
  callModel,
  generateReport,
  answerQuestion,
  canUseModel,
  validateLanguage,
  translateContent,
  assistPassage,
  validateAssistResult,
  analyzeFigure,
} from "./models.mjs";
import { visionModel, prepareVisionInput, visualEvidenceRecord, assertVisualEvidenceIncludable } from "./vision.mjs";
import { readingPreferences, readingFormat, readingState, materializeReadingVersions, appendReadingVersion, syncReadingTranslations } from "./reading.mjs";
import { prepareDerivedInteractive } from "./reading-derived.mjs";
import { generateInteractiveReading, translateInteractiveReading, usableInteractiveTranslation, interactiveTranslationFailure } from "./interactive.mjs";
import { validateAnnotation, validatePage, annotationMarkdown } from "./annotations.mjs";
import { readStoredPdf } from "./stored-pdf.mjs";
import { annotatedPdfDisposition } from "./download-name.mjs";
import { annotationSourceState, annotationSourceFingerprint, validateAnnotationSourceAcceptance, prepareAnnotationSourceAcceptance } from "./annotation-source.mjs";
import { figureCaptionsSourceHash, usableFigureCaptions, translateFigureCaptions, captionTranslationFailure } from "./captions.mjs";
import { usableTranslationBindings } from "./translation-bindings.mjs";
import { selectionPageBinding } from "./source-selection.mjs";
import { existingTaskActivity, validateAgentTaskId } from "./activity-task.mjs";
import { assertUniqueJsonKeys } from "./json.mjs";
import { currentFigures, figuresRevision, getFigureCollection, prepareFigureChange, pdfRevision, bindPdfRevision } from "./figures.mjs";

import {
  prepareInsights,
  translationSource,
  sourceVersion,
  validateAgentSource,
  validateMarkdown,
} from "./insights.mjs";

const wrap = (handler) => (request, response, next) =>
  Promise.resolve(handler(request, response, next)).catch(next);
const localHost = (value) =>
  ["localhost", "127.0.0.1", "[::1]"].includes(value);
const searchText = (paper) =>
  `${paper.title} ${paper.authors.join(" ")} ${paper.abstract} ${paper.tags.join(" ")}`.toLowerCase();

export async function createApp({
  dataDir = process.env.DATA_DIR || path.resolve(".local-data"),
  download = secureDownload,
  fetchImpl,
} = {}) {
  const store = await new Store(path.resolve(dataDir)).init();
  const ingestor = new Ingestor(store.directory, download);
  const app = express();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 2 },
  });
  const reportJobs = new Set();
  const translationJobs = new Map();
  const reusableTranslation = (entry, sourceHash, updatedAt, source) => entry &&
    usableTranslationBindings(source, entry.markdown) && !entry.stale &&
    (entry.sourceHash ? entry.sourceHash === sourceHash : Boolean(updatedAt) && entry.sourceUpdatedAt === updatedAt);
  const coalesceTranslation = async (key, work) => {
    if (translationJobs.has(key)) return translationJobs.get(key);
    const job = Promise.resolve().then(work);
    translationJobs.set(key, job);
    try { return await job; }
    finally { if (translationJobs.get(key) === job) translationJobs.delete(key); }
  };
  const assistJobs = new Set();
  const visionJobs = new Set();
  let visionRequests = [];
  let assistRequests = [];
  const searchCache = new Map();
  app.disable("x-powered-by");
  app.locals.store = store;
  app.use((request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Frame-Options", "DENY");
    let host;
    try {
      host = new URL(`http://${request.headers.host}`);
    } catch {
      return next(new ApiError("Invalid request host.", 403));
    }
    if (!localHost(host.hostname))
      return next(new ApiError("Only local hostnames are allowed.", 403));
    if (request.headers.origin) {
      let origin;
      try {
        origin = new URL(request.headers.origin);
      } catch {
        return next(new ApiError("Untrusted request origin.", 403));
      }
      if (
        !localHost(origin.hostname) ||
        !["http:", "https:"].includes(origin.protocol) ||
        ![host.port, "5173", "4318"].includes(origin.port)
      )
        return next(new ApiError("Untrusted request origin.", 403));
    }
    // A link may open the application shell from another site. API/data fetches
    // remain same-site only; navigation permission never grants API access.
    const shellNavigation = request.method === "GET" && /^\/(?:en\/?|zh\/?)?$/.test(request.path) &&
      request.headers["sec-fetch-mode"] === "navigate" &&
      request.headers["sec-fetch-dest"] === "document";
    if (request.headers["sec-fetch-site"] === "cross-site" && !shellNavigation)
      return next(new ApiError("Cross-site requests are blocked.", 403));
    if (request.path.startsWith("/api/"))
      response.setHeader("Cache-Control", "no-store");
    next();
  });
  // Only this local source-bound image route accepts a larger JSON payload.
  app.use("/api/papers/:id/figures/:figureId/analyze", express.json({ limit: "6mb" }));
  app.use("/api/papers/:id/insights", express.json({ limit: "256kb", verify: (_request, _response, buffer) => assertUniqueJsonKeys(buffer.toString("utf8")) }));
  app.use(express.json({ limit: "256kb" }));
  const paperById = (id) => {
    const paper = store.paper(id);
    if (!paper)
      throw new ApiError(
        "Paper not found. Import it into your library first.",
        404,
      );
    return paper;
  };
  const bodyOf = (request) => {
    if (
      !request.body ||
      typeof request.body !== "object" ||
      Array.isArray(request.body)
    )
      throw new ApiError("A JSON object request body is required.");
    return request.body;
  };
  const conversationKey = (paperId) =>
    paperId ? `paper:${paperId}` : "global";
  const conversationMessages = (id) =>
    store.data.chats
      .filter((message) => message.conversationId === id)
      .slice(-100);
  const activeConversation = (paperId) =>
    store.data.conversations.find(
      (conversation) =>
        conversation.id ===
          store.data.activeConversations[conversationKey(paperId)] &&
        conversation.paperId === paperId,
    );
  const createConversation = (paperId, metadata) => {
    const conversation = {
      id: randomUUID(),
      paperId,
      title: "New conversation",
      kind: "question",
      ...(metadata ? { metadata } : {}),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.data.conversations.unshift(conversation);
    store.data.activeConversations[conversationKey(paperId)] = conversation.id;
    return conversation;
  };
  const validatePaperContext = (paperId) => {
    if (paperId !== null && typeof paperId !== "string")
      throw new ApiError("paperId must be a string.");
    if (paperId) paperById(paperId);
    return paperId || null;
  };
  const questionMetadata = (body, paperId) => {
    if (body.kind !== undefined && body.kind !== "question") throw new ApiError("Conversation kind must be question.");
    if (body.metadata === undefined) return undefined;
    if (!paperId || !body.metadata || typeof body.metadata !== "object" || Array.isArray(body.metadata))
      throw new ApiError("Question metadata requires a paper context.");
    const { quote, sourceScope, readingId } = body.metadata;
    const paper = paperById(paperId);
    const result = {};
    if (quote !== undefined) result.quote = validateMarkdown(quote, "quote", 12000);
    if (sourceScope !== undefined) {
      if (!["pdf", "source-text", "reading", "abstract"].includes(sourceScope))
        throw new ApiError("Question sourceScope must be pdf, source-text, reading, or abstract.");
      if (sourceScope !== "pdf" && (body.metadata.page !== undefined || body.metadata.pages !== undefined))
        throw new ApiError("Non-PDF question selections must not claim page or pages.");
      if (sourceScope === "pdf" && !paper.filePath)
        throw new ApiError("A PDF selection requires a locally imported PDF.");
      if (sourceScope === "source-text" && paper.filePath)
        throw new ApiError("Select PDF passages using the pdf source scope.");
      if (sourceScope === "abstract" && !paper.abstract)
        throw new ApiError("No abstract exists for this paper.");
      if (sourceScope === "reading") {
        if (typeof readingId !== "string" || !readingState(paper).readingVersions.some(version => version.id === readingId))
          throw new ApiError("Reading version not found in this paper.", 404);
        result.readingId = readingId;
      }
      result.sourceScope = sourceScope;
    }
    if (readingId !== undefined && sourceScope !== "reading")
      throw new ApiError("readingId is only valid for a reading selection.");
    Object.assign(result, selectionPageBinding(body.metadata, paper));
    if (result.quote === undefined && result.page === undefined)
      throw new ApiError("Question metadata needs quote, page or pages.");
    return result;
  };

  app.get("/api/health", (_request, response) =>
    response.json({
      status: "ok",
      version: packageMetadata.version,
      modelConfigured: canUseModel(store.data.settings),
      paperCount: store.data.papers.length,
    }),
  );
  app.get(
    "/api/agent-skill",
    wrap(async (_request, response) => {
      const skillDirectory = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../skills/paper-workbench",
      );
      let skill, reference;
      try {
        [skill, reference] = await Promise.all([
          readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
          readFile(
            path.join(skillDirectory, "references/agent-import.md"),
            "utf8",
          ),
        ]);
      } catch {
        throw new ApiError("The agent skill bundle is unavailable.", 404);
      }
      response.type("text/markdown");
      response.setHeader(
        "Content-Disposition",
        'attachment; filename="SKILL.md"',
      );
      const standalone = skill.replaceAll(
        "[references/agent-import.md](references/agent-import.md)",
        "the embedded protocol below（见下面内嵌协议）",
      );
      response.send(
        `${standalone}\n\n---\n\n## Embedded agent import protocol\n\n${reference}`,
      );
    }),
  );
  app.get("/api/settings", (_request, response) =>
    response.json(store.publicSettings()),
  );
  app.put(
    "/api/settings",
    wrap(async (request, response) => {
      store.data.settings = validateSettings(
        bodyOf(request),
        store.data.settings,
      );
      await store.save();
      response.json(store.publicSettings());
    }),
  );
  app.post(
    "/api/settings/test",
    wrap(async (request, response) => {
      const settings = validateSettings(
        request.body || {},
        store.data.settings,
      );
      const content = await callModel(
        settings,
        [
          {
            role: "user",
            content: "Reply with exactly: Connection successful",
          },
        ],
        { fetchImpl, maxTokens: 30 },
      );
      response.json({ ok: true, message: content, model: settings.model });
    }),
  );

  app.get("/api/papers", (_request, response) =>
    response.json({
      papers: store.data.papers.map((paper) => publicPaper(paper, false)),
    }),
  );
  app.get("/api/papers/:id", (request, response, next) => {
    try {
      response.json({ paper: publicPaper(paperById(request.params.id)) });
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/papers/:id/file", (request, response, next) => {
    try {
      const paper = paperById(request.params.id);
      if (!paper.filePath)
        throw new ApiError("No local PDF is available for this paper.", 404);
      response.setHeader("Content-Type", "application/pdf");
      response.setHeader("X-Frame-Options", "SAMEORIGIN");
      response.setHeader("Content-Disposition", 'inline; filename="paper.pdf"');
      response.sendFile(
        paper.filePath,
        { root: store.directory, dotfiles: "deny" },
        (error) => {
          if (error && !response.headersSent)
            next(new ApiError("The stored PDF could not be found.", 404));
        },
      );
    } catch (error) {
      next(error);
    }
  });
  app.post(
    "/api/import",
    wrap(async (request, response) => {
      const { url } = bodyOf(request);
      if (typeof url !== "string" || !url.trim() || url.length > 4096)
        throw new ApiError("A URL of up to 4096 characters is required.");
      const input = url.trim();
      const id = arxivId(input);
      const existing = store.data.papers.find((paper) =>
        id ? paper.arxivId === id : paper.url === input,
      );
      if (existing)
        return response.json({ paper: publicPaper(existing), existing: true });
      const paper = await ingestor.importUrl(input);
      // Recheck after the network operation to prevent duplicate concurrent imports.
      const duplicate = store.data.papers.find((item) =>
        paper.arxivId ? item.arxivId === paper.arxivId : item.url === paper.url,
      );
      if (duplicate) {
        if (paper.filePath)
          await unlink(path.join(store.directory, paper.filePath)).catch(
            () => {},
          );
        return response.json({ paper: publicPaper(duplicate), existing: true });
      }
      store.data.papers.unshift(paper);
      await store.save();
      response.status(201).json({ paper: publicPaper(paper) });
    }),
  );
  app.post(
    "/api/upload",
    upload.single("file"),
    wrap(async (request, response) => {
      if (!request.file) throw new ApiError("Choose a PDF file to upload.");
      const paper = await ingestor.upload(
        request.file.buffer,
        path.basename(request.file.originalname),
      );
      const duplicate = store.data.papers.find(
        (item) => item.contentHash === paper.contentHash,
      );
      if (duplicate) {
        await unlink(path.join(store.directory, paper.filePath)).catch(
          () => {},
        );
        return response.json({ paper: publicPaper(duplicate), existing: true });
      }
      store.data.papers.unshift(paper);
      await store.save();
      response.status(201).json({ paper: publicPaper(paper) });
    }),
  );
  app.patch(
    "/api/papers/:id",
    wrap(async (request, response) => {
      const paper = paperById(request.params.id);
      const body = bodyOf(request);
      if (!("favorite" in body) && !("activeReadingId" in body))
        throw new ApiError("Provide favorite or activeReadingId.");
      if ("favorite" in body && typeof body.favorite !== "boolean") throw new ApiError("favorite must be true or false.");
      if ("activeReadingId" in body && !readingState(paper).readingVersions.some((version) => version.id === body.activeReadingId))
        throw new ApiError("Reading version not found in this paper.", 404);
      if ("favorite" in body) paper.favorite = body.favorite;
      if ("activeReadingId" in body) paper.activeReadingId = body.activeReadingId;
      await store.save();
      response.json({ paper: publicPaper(paper) });
    }),
  );
  app.delete(
    "/api/papers/:id",
    wrap(async (request, response) => {
      const paper = paperById(request.params.id);
      store.data.papers = store.data.papers.filter(
        (item) => item.id !== paper.id,
      );
      store.data.chats = store.data.chats.filter(
        (item) => item.paperId !== paper.id,
      );
      store.data.conversations = store.data.conversations.filter(
        (item) => item.paperId !== paper.id,
      );
      store.data.annotations = store.data.annotations.filter((item) => item.paperId !== paper.id);
      store.data.activities = store.data.activities.filter((item) => item.paperId !== paper.id);
      delete store.data.activeConversations[conversationKey(paper.id)];
      await store.save();
      if (paper.filePath)
        await unlink(path.join(store.directory, paper.filePath)).catch(
          () => {},
        );
      response.json({ ok: true });
    }),
  );
  app.get(
    "/api/search",
    wrap(async (request, response) => {
      const query =
        typeof request.query.q === "string" ? request.query.q.trim() : "";
      const source = request.query.source || "all";
      if (!["all", "local", "arxiv"].includes(source))
        throw new ApiError("Search source must be all, local, or arxiv.");
      if (!query) return response.json({ papers: [], warnings: [] });
      if (query.length > 300)
        throw new ApiError("Search query is limited to 300 characters.");
      const words = query.toLowerCase().split(/\s+/);
      const local = store.data.papers
        .filter((paper) =>
          words.every((word) => searchText(paper).includes(word)),
        )
        .map((paper) => publicPaper(paper, false));
      if (source === "local")
        return response.json({ papers: local, warnings: [] });
      let remote;
      const warnings = [];
      try {
        const cached = searchCache.get(query);
        if (cached && Date.now() - cached.time < 60000) remote = cached.papers;
        else {
          remote = await searchArxiv(query, download);
          if (searchCache.size > 100) searchCache.clear();
          searchCache.set(query, { time: Date.now(), papers: remote });
        }
      } catch (error) {
        if (source === "arxiv") throw error;
        remote = [];
        warnings.push(
          `arXiv search is unavailable: ${error.message} Local library results are shown.`,
        );
      }
      const seen = new Set(local.map((paper) => paper.arxivId || paper.url));
      const papers =
        source === "all"
          ? [
              ...local,
              ...remote.filter(
                (paper) => !seen.has(paper.arxivId || paper.url),
              ),
            ]
          : remote;
      response.json({ papers, warnings });
    }),
  );
  app.get("/api/papers/:id/figures", wrap(async (request, response) => {
    const paper = paperById(request.params.id);
    const collection = await getFigureCollection(paper, store.directory);
    if (store.paper(paper.id) !== paper) throw new ApiError("The paper changed while its figures were being read. Reload it before reviewing figures.", 409);
    response.json(collection);
  }));
  const saveFigure = wrap(async (request, response) => {
    const paper = paperById(request.params.id);
    const body = bodyOf(request);
    const collection = await getFigureCollection(paper, store.directory);
    if (store.paper(paper.id) !== paper) throw new ApiError("The paper changed while its figure was being saved. Reload it before reviewing figures.", 409);
    const change = prepareFigureChange(paper, body, { pdfRevision: collection.pdfRevision, figureId: request.params.figureId });
    // No await between live-revision validation and assignment. A competing
    // request with the same old revision must now conflict, even during save().
    materializeReadingVersions(paper);
    bindPdfRevision(paper, change.pdfRevision);
    paper.figures = change.figures;
    const result = structuredClone({ paper: publicPaper(paper), ...change });
    await store.save();
    response.status(request.params.figureId ? 200 : 201).json(result);
  });
  app.post("/api/papers/:id/figures", saveFigure);
  app.patch("/api/papers/:id/figures/:figureId", saveFigure);

  app.post("/api/papers/:id/figures/:figureId/analyze", wrap(async (request, response) => {
    const paper = paperById(request.params.id);
    const body = bodyOf(request);
    const selected = visionModel(store.data.settings);
    // Validate before hashing or reserving a request, then bind the actual PDF
    // bytes after taking the per-paper lock. Client hashes never supply trust.
    prepareVisionInput(body, paper, request.params.figureId);
    const language = validateLanguage(body.language);
    if (visionJobs.has(paper.id)) throw new ApiError("A figure analysis is already running for this paper.", 409);
    visionRequests = visionRequests.filter(time => Date.now() - time < 60000);
    if (visionJobs.size >= 2 || visionRequests.length >= 12) throw new ApiError("Too many figure analysis requests. Please retry shortly.", 429);
    visionJobs.add(paper.id);
    visionRequests.push(Date.now());
    try {
      const revision = await pdfRevision(paper, store.directory);
      if (store.paper(paper.id) !== paper) throw new ApiError("The paper changed while preparing figure analysis.", 409);
      bindPdfRevision(paper, revision);
      const input = prepareVisionInput(body, paper, request.params.figureId);
      if (input.figure.source?.pdfRevision && input.figure.source.pdfRevision !== revision)
        throw new ApiError("The source PDF changed since this crop was reviewed. Review and save the current crop before analyzing it.", 409);
      const markdown = validateMarkdown(await analyzeFigure(paper, input, language, selected, { fetchImpl }), "Visual analysis", 50000);
      const current = store.paper(paper.id);
      if (!current) throw new ApiError("The paper was deleted while analyzing the figure.", 409);
      const completedRevision = await pdfRevision(current, store.directory);
      if (store.paper(paper.id) !== current) throw new ApiError("The paper changed while analyzing the figure.", 409);
      bindPdfRevision(current, completedRevision);
      // If an agent corrected the crop during inference, do not attach the old
      // image interpretation to a newly positioned figure with the same id.
      let fingerprint;
      try { fingerprint = prepareVisionInput(body, current, request.params.figureId).sourceFingerprint; }
      catch { throw new ApiError("The source figure changed while it was being analyzed. Retry using the current crop.", 409); }
      if (fingerprint !== input.sourceFingerprint) throw new ApiError("The source figure changed while it was being analyzed.", 409);
      const evidence = visualEvidenceRecord(input, markdown, language, selected);
      paper.visualEvidence ||= [];
      paper.visualEvidence.push(evidence);
      await store.save();
      response.json({ evidence, paper: publicPaper(paper) });
    } finally { visionJobs.delete(paper.id); }
  }));
  app.patch("/api/papers/:id/visual-evidence/:evidenceId", wrap(async (request, response) => {
    const paper = paperById(request.params.id);
    const evidence = paper.visualEvidence?.find(item => item.id === request.params.evidenceId);
    if (!evidence) throw new ApiError("Visual evidence not found in this paper.", 404);
    const body = bodyOf(request);
    if (typeof body.excluded !== "boolean" || Object.keys(body).some(key => key !== "excluded"))
      throw new ApiError("Provide only excluded as a boolean.");
    if (!body.excluded) {
      assertVisualEvidenceIncludable(paper, evidence);
      const revision = await pdfRevision(paper, store.directory);
      if (store.paper(paper.id) !== paper || !paper.visualEvidence?.includes(evidence))
        throw new ApiError("The paper or observation changed while checking its source. Reload before choosing visual evidence.", 409);
      bindPdfRevision(paper, revision);
      try {
        // Recheck the latest observation and crop after the asynchronous read.
        assertVisualEvidenceIncludable(paper, evidence);
      } catch (error) {
        // Persist a newly discovered byte mismatch so later context selection
        // also withdraws stale legacy observations. No interpretation is changed.
        await store.save();
        throw error;
      }
    }
    evidence.excluded = body.excluded;
    evidence.updatedAt = new Date().toISOString();
    await store.save();
    response.json({ evidence, paper: publicPaper(paper) });
  }));

  app.get("/api/papers/:id/annotations", wrap(async (request, response) => {
    const paper = paperById(request.params.id);
    const includeDeleted = request.query.includeDeleted === "true";
    response.json({ annotations: store.data.annotations.filter((item) => item.paperId === paper.id && (includeDeleted || !item.deletedAt)) });
  }));
  app.post("/api/papers/:id/annotations", wrap(async (request, response) => {
    const paper = paperById(request.params.id);
    const annotation = validateAnnotation(bodyOf(request), paper);
    store.data.annotations.push(annotation);
    await store.save();
    response.status(201).json({ annotation });
  }));
  app.patch("/api/papers/:id/annotations/:annotationId", wrap(async (request, response) => {
    const paper = paperById(request.params.id);
    const index = store.data.annotations.findIndex((item) => item.paperId === paper.id && item.id === request.params.annotationId);
    if (index < 0) throw new ApiError("Annotation not found in this paper.", 404);
    const annotation = validateAnnotation(bodyOf(request), paper, store.data.annotations[index]);
    store.data.annotations[index] = annotation;
    await store.save();
    response.json({ annotation });
  }));
  app.delete("/api/papers/:id/annotations/:annotationId", wrap(async (request, response) => {
    const paper = paperById(request.params.id);
    const annotation = store.data.annotations.find((item) => item.paperId === paper.id && item.id === request.params.annotationId);
    if (!annotation) throw new ApiError("Annotation not found in this paper.", 404);
    annotation.deletedAt ||= new Date().toISOString();
    annotation.updatedAt = annotation.deletedAt;
    await store.save();
    response.json({ ok: true, annotation });
  }));
  const annotationPdfSource = wrap(async (request, response) => {
    const paper = paperById(request.params.id);
    const accepting = request.method === "POST";
    const body = accepting ? bodyOf(request) : undefined;
    if (accepting) validateAnnotationSourceAcceptance(body);
    if (!paper.filePath) return response.status(404).json({ code: "pdf_source_missing", error: "Import a source PDF before reviewing its annotation export binding." });
    const fingerprint = annotationSourceFingerprint(paper);
    let bytes;
    try { bytes = await readStoredPdf(paper, store.directory); }
    catch { return response.status(409).json({ code: "pdf_source_unavailable", error: "The stored PDF is unavailable. Reimport the source before reviewing its annotation export binding." }); }
    if (store.paper(paper.id) !== paper || fingerprint !== annotationSourceFingerprint(paper))
      return response.status(409).json({ code: "pdf_source_binding_changed", error: "The paper or its source choice changed during this request. Reload its status before continuing." });
    const pdfRevision = contentHash(bytes);
    if (accepting) {
      // No await between checking the live binding and assigning it: concurrent
      // requests cannot overwrite the first accepted choice or its timestamp.
      paper.annotationExportBinding = prepareAnnotationSourceAcceptance(paper, body, pdfRevision);
      const state = annotationSourceState(paper, pdfRevision);
      await store.save();
      return response.status(201).json(state);
    }
    response.json(annotationSourceState(paper, pdfRevision));
  });
  app.get("/api/papers/:id/annotations/pdf-source", annotationPdfSource);
  app.post("/api/papers/:id/annotations/pdf-source", annotationPdfSource);

  app.get("/api/papers/:id/annotations/export", wrap(async (request, response) => {
    const paper = paperById(request.params.id);
    const format = request.query.format || "markdown";
    if (!["markdown", "json", "pdf"].includes(format)) throw new ApiError("Export format must be markdown, json or pdf.");
    const annotations = structuredClone(store.data.annotations.filter((item) => item.paperId === paper.id && !item.deletedAt));
    if (format === "pdf") {
      if (!paper.filePath) return response.status(404).json({code: "pdf_source_missing", error: "Import a source PDF before exporting an annotated copy."});
      let pdfBytes;
      try { pdfBytes = await readStoredPdf(paper, store.directory); }
      catch { return response.status(409).json({code: "pdf_source_unavailable", error: "The stored PDF is unavailable. Reimport the source before exporting annotations."}); }
      // A figure/vision review may update pdfRevision to describe the current
      // file; that must not rebind older annotation positions to different bytes.
      const sourceState = annotationSourceState(paper, contentHash(pdfBytes));
      if (sourceState.bindingStatus === "unbound") return response.status(409).json({code: "pdf_source_unbound", error: "This older import has no original PDF fingerprint. Review the current PDF and explicitly accept it for annotation export, or keep the Markdown or JSON export. This does not verify historical annotation locations."});
      if (sourceState.bindingStatus === "changed") return response.status(409).json({code: "pdf_source_changed", error: "The source PDF changed. Review the annotation locations before exporting."});
      const { exportAnnotatedPdf, AnnotationPdfGeometryError, AnnotationPdfExportError } = await import("./annotation-pdf.mjs");
      let result;
      try { result = await exportAnnotatedPdf({pdfBytes, annotations, paperId: paper.id}); }
      catch (error) {
        if (error instanceof AnnotationPdfGeometryError || error instanceof AnnotationPdfExportError) return response.status(422).json({code: error.code, error: error.message});
        throw error;
      }
      response.setHeader("Content-Disposition", annotatedPdfDisposition(paper.title));
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Annotation-Count", String(result.annotationCount));
      response.setHeader("X-Annotation-Page-Comments", String(result.warnings.filter(item => item.code === "annotation_page_comment").length));
      response.setHeader("X-Annotation-Source-Binding", sourceState.bindingStatus);
      response.type("application/pdf").send(Buffer.from(result.bytes));
      return;
    }
    response.setHeader("Content-Disposition", `attachment; filename="paper-notes.${format === "json" ? "json" : "md"}"`);
    if (format === "json") response.json({ version: 1, paper: { id: paper.id, title: paper.title, url: paper.url }, annotations });
    else response.type("text/markdown").send(annotationMarkdown(paper, annotations));
  }));

  const passageRequest = (body, paper) => {
    if (!["translation", "explanation"].includes(body.kind)) throw new ApiError("Assist kind must be translation or explanation.");
    const text = body.text ?? body.quote;
    validateMarkdown(text, "Selected text", 12000);
    const common = {
      kind: body.kind,
      text,
      language: validateLanguage(body.language),
    };
    if (body.text !== undefined && body.quote !== undefined) {
      validateMarkdown(body.quote, "quote", 12000);
      if (body.quote !== common.text) throw new ApiError("text and quote must describe the same selected passage.");
    }
    const sourceScope = body.sourceScope ?? (paper.filePath ? "pdf" : "source-text");
    if (!["pdf", "source-text", "reading", "abstract"].includes(sourceScope))
      throw new ApiError("sourceScope must be pdf, source-text, reading, or abstract.");
    if (body.readingId !== undefined && sourceScope !== "reading")
      throw new ApiError("readingId is only valid for a reading selection.");
    if (sourceScope === "reading" || sourceScope === "abstract") {
      if (body.page !== undefined || body.pages !== undefined) throw new ApiError("Overview and abstract selections must not claim a PDF page anchor.");
      if (sourceScope === "reading") {
        if (typeof body.readingId !== "string" || !readingState(paper).readingVersions.some(version => version.id === body.readingId))
          throw new ApiError("Reading version not found in this paper.", 404);
        return { ...common, sourceScope, readingId: body.readingId };
      }
      if (!paper.abstract) throw new ApiError("No abstract exists for this paper.");
      return { ...common, sourceScope };
    }
    if (sourceScope === "pdf" && !paper.filePath) throw new ApiError("A PDF selection requires a locally imported PDF.");
    if (sourceScope === "source-text" && paper.filePath) throw new ApiError("Select PDF passages using the pdf source scope and their actual page.");
    if (sourceScope === "source-text" && body.pages !== undefined) throw new ApiError("Source-text selections must not claim PDF pages.");
    return { ...common, sourceScope, ...selectionPageBinding(body, paper, { defaultPage: 1 }) };
  };
  app.get("/api/papers/:id/activities", wrap(async (request, response) => {
    const paper = paperById(request.params.id);
    const kind = request.query.kind;
    if (kind && !["translation", "explanation"].includes(kind)) throw new ApiError("Activity kind must be translation or explanation.");
    const agentTaskId = request.query.agentTaskId === undefined ? undefined : validateAgentTaskId(request.query.agentTaskId);
    response.json({ activities: store.data.activities.filter((item) => item.paperId === paper.id && (!kind || item.kind === kind) && (!agentTaskId || item.agentTaskId === agentTaskId)).toReversed() });
  }));
  app.post("/api/papers/:id/activities", wrap(async (request, response) => {
    const paper = paperById(request.params.id);
    const body = bodyOf(request);
    if (body.paperId !== undefined && body.paperId !== paper.id)
      throw new ApiError("Activity paperId must match the requested paper.");
    const passage = passageRequest(body, paper);
    const agentTaskId = body.agentTaskId === undefined ? undefined : validateAgentTaskId(body.agentTaskId);
    const source = body.source ? validateAgentSource(body.source) : { kind: "local" };
    const result = {
      text: validateMarkdown(validateAssistResult(typeof body.result === "string" ? body.result : body.result?.text, 400), "result", 50000),
      kind: passage.kind, language: passage.language, source, createdAt: new Date().toISOString(),
    };
    const activity = { id: randomUUID(), paperId: paper.id, ...passage, ...(agentTaskId ? { agentTaskId } : {}), quote: passage.text, result, source, createdAt: result.createdAt };
    const existing = existingTaskActivity(store.data.activities, activity);
    if (existing) {
      // Also ensure durability if an earlier import's response/save was lost.
      await store.save();
      response.json({ activity: existing, reused: true });
      return;
    }
    store.data.activities.push(activity);
    await store.save();
    response.status(201).json({ activity });
  }));
  app.post("/api/papers/:id/assist", wrap(async (request, response) => {
    const paper = paperById(request.params.id);
    const passage = passageRequest(bodyOf(request), paper);
    if (assistJobs.has(paper.id)) throw new ApiError("A passage request is already running for this paper.", 409);
    assistRequests = assistRequests.filter((time) => Date.now() - time < 60000);
    if (assistJobs.size >= 3 || assistRequests.length >= 30) throw new ApiError("Too many passage requests. Please retry shortly.", 429);
    assistJobs.add(paper.id);
    assistRequests.push(Date.now());
    try {
      const result = await assistPassage(paper, passage, { ...store.data.settings }, { fetchImpl });
      if (!store.paper(paper.id)) throw new ApiError("The paper was deleted while processing the passage.", 409);
      result.text = validateMarkdown(result.text, "result", 50000);
      const activity = { id: randomUUID(), paperId: paper.id, ...passage, quote: passage.text, result, source: result.source, createdAt: result.createdAt };
      store.data.activities.push(activity);
      await store.save();
      response.json({ result, activity });
    } finally { assistJobs.delete(paper.id); }
  }));

  app.post(
    "/api/papers/:id/report",
    wrap(async (request, response) => {
      const paper = paperById(request.params.id);
      const body = request.body || {};
      const format = readingFormat(body.format);
      let original;
      if (body.readingId !== undefined) {
        if (format !== "interactive") throw new ApiError("An existing reading can only be converted to interactive format.");
        original = readingState(paper).readingVersions.find(version => version.id === body.readingId);
        if (!original) throw new ApiError("Reading version not found in this paper.", 404);
      }
      const preferences = readingPreferences(original || body);
      const settings = { ...store.data.settings };
      if (format === "interactive" && !canUseModel(settings))
        throw new ApiError("Configure a model API or import an interactive reading from your external agent first.");
      if (reportJobs.has(paper.id))
        throw new ApiError(
          "A report is already being generated for this paper.",
          409,
        );
      // All paid stages and the final saved version share one immutable source
      // snapshot. A reviewed figure may change in the live library meanwhile.
      const sourcePaper = structuredClone(paper);
      sourcePaper.figures = currentFigures(sourcePaper);
      original = original ? structuredClone(original) : undefined;
      const readingFigures = structuredClone(original?.figures || sourcePaper.figures);
      const sourceFiguresRevision = original?.figuresRevision || figuresRevision({ ...sourcePaper, figures: readingFigures });
      reportJobs.add(paper.id);
      try {
        if (sourcePaper.filePath) {
          const revision = await pdfRevision(sourcePaper, store.directory);
          if (store.paper(paper.id) !== paper) throw new ApiError("The paper changed while preparing its report.", 409);
          bindPdfRevision(sourcePaper, revision);
          bindPdfRevision(paper, revision);
          // Explicitly obsolete crops are not eligible for a new synthesis.
          // Archived version conversion still keeps its own immutable figures.
          if (!original) {
            sourcePaper.figures = sourcePaper.figures.filter(figure => !figure.source?.pdfRevision || figure.source.pdfRevision === revision);
            readingFigures.splice(0, readingFigures.length, ...structuredClone(sourcePaper.figures));
          }
        }
        const report = original ? {
          markdown: original.markdown, language: original.language || "en", ...preferences,
          mode: "model-interactive", createdAt: new Date().toISOString(), stages: [],
          source: { kind: "model", model: settings.model },
          ...(original.articleSource || original.source ? { articleSource: original.articleSource || original.source } : {}),
          derivedFromReadingId: original.id,
          figures: readingFigures,
        } : await generateReport(
          sourcePaper,
          settings,
          {
            adversarial: body.adversarial !== false,
            language: validateLanguage(body.language),
            ...preferences,
            fetchImpl,
          },
        );
        report.figures = readingFigures;
        report.figuresRevision = original ? sourceFiguresRevision : figuresRevision(sourcePaper);
        if (sourcePaper.pdfRevision) report.pdfRevision = original?.pdfRevision || sourcePaper.pdfRevision;
        report.markdown = validateMarkdown(report.markdown);
        report.format = format;
        if (format === "interactive") {
          try {
            report.interactive = await generateInteractiveReading({
              markdown: report.markdown, language: report.language, ...preferences,
              figures: readingFigures, pageCount: sourcePaper.pages?.length,
              callModel: (prompt) => callModel(settings, [{ role: "user", content: prompt }], { fetchImpl, maxTokens: settings.maxOutputTokens || 4096 }),
            });
          } catch (error) {
            // A conversion failure must not append a duplicate article. A fresh
            // generation, however, already completed a valuable article: retain
            // it transparently without presenting failed structure as success.
            if (original || !(error instanceof ApiError)) throw error;
            report.format = "article";
            report.requestedFormat = "interactive";
            report.interactiveGenerationError = "Interactive generation did not complete. The finished article was saved; retry conversion to create the interactive version.";
          }
        }
        if (!store.paper(paper.id))
          throw new ApiError(
            "The paper was deleted while its report was being generated.",
            409,
          );
        materializeReadingVersions(paper);
        if (paper.report)
          paper.reportHistory = [...(paper.reportHistory || []), paper.report];
        paper.report = report;
        const readingVersion = appendReadingVersion(paper, report, { ...preferences, target: "report", figures: readingFigures, ...(original ? { title: original.title } : {}) });
        await store.save();
        const published = publicPaper(paper);
        response.json({ report, readingVersion: published.readingVersions.find(version => version.id === readingVersion.id), paper: published });
      } finally {
        reportJobs.delete(paper.id);
      }
    }),
  );
  app.post(
    "/api/papers/:id/translate",
    wrap(async (request, response) => {
      const paper = paperById(request.params.id);
      const { target, language: inputLanguage, readingId } = bodyOf(request);
      const language = validateLanguage(inputLanguage);
      if (target === "reading") {
        const state = readingState(paper);
        const version = state.readingVersions.find((item) => item.id === (readingId || state.activeReadingId));
        if (!version) throw new ApiError("Reading version not found in this paper.", 404);
        const sourceHash = contentHash(version.markdown);
        const cached = version.translations?.[language];
        const translationOptions = { language, pageCount: paper.pages?.length, figures: version.figures || paper.figures };
        const captionsHash = figureCaptionsSourceHash(translationOptions.figures);
        const sameLanguage = validateLanguage(version.language || "en") === language;
        const article = reusableTranslation(cached, sourceHash, version.createdAt, version.markdown) ? cached : sameLanguage ? {
          markdown: version.markdown, language, createdAt: version.createdAt,
          sourceHash, sourceUpdatedAt: version.createdAt,
          ...(version.mode ? { mode: version.mode } : {}), ...(version.source ? { source: version.source } : {}),
          ...(version.interactive ? { interactive: version.interactive } : {}),
        } : undefined;
        const completeInteractive = !version.interactive || usableInteractiveTranslation(article?.interactive, version.interactive, translationOptions);
        const completeCaptions = usableFigureCaptions(article, translationOptions.figures, { language });
        if (article && completeInteractive && completeCaptions)
          return response.json({ translation: publicReadingTranslation(article, version, translationOptions), paper: publicPaper(paper) });
        const key = JSON.stringify([paper.id, "reading", version.id, language, sourceHash, captionsHash]);
        const translation = await coalesceTranslation(key, async () => {
          const settings = { ...store.data.settings };
          const cachedFingerprint = contentHash(JSON.stringify(cached || null));
          const translated = article ? { ...article } : await translateContent(version.markdown, language, settings, { fetchImpl });
          if (version.interactive && !completeInteractive && sameLanguage) {
            translated.interactive = version.interactive;
            delete translated.interactiveTranslationError;
          } else if (version.interactive && !completeInteractive) {
            try {
              translated.interactive = await translateInteractiveReading({
                interactive: version.interactive, ...translationOptions,
                callModel: (prompt) => callModel(settings, [{ role: "user", content: prompt }], { fetchImpl, maxTokens: settings.maxOutputTokens || 4096 }),
              });
              delete translated.interactiveTranslationError;
            } catch (error) {
              if (!(error instanceof ApiError)) throw error;
              // Keep a successful article and any prior raw blocks. Invalid
              // display blocks are hidden by publicReadingTranslation, while
              // another request can retry just this bounded conversion.
              translated.interactiveTranslationError = interactiveTranslationFailure(error);
            }
          }
          if (!completeCaptions) {
            try {
              translated.figureCaptions = await translateFigureCaptions({ ...translationOptions,
                callModel: prompt => callModel(settings, [{ role: "user", content: prompt }], { fetchImpl, maxTokens: settings.maxOutputTokens || 4096 }),
              });
              translated.figureCaptionsSourceHash = captionsHash;
              delete translated.captionTranslationError;
            } catch (error) {
              if (!(error instanceof ApiError)) throw error;
              translated.captionTranslationError = captionTranslationFailure(error);
            }
          }
          if (!store.paper(paper.id)) throw new ApiError("The paper was deleted while translating.", 409);
          const saved = materializeReadingVersions(paper).find((item) => item.id === version.id);
          if (!saved || contentHash(saved.markdown) !== sourceHash || figureCaptionsSourceHash(saved.figures || paper.figures) !== captionsHash)
            throw new ApiError("Reading version or source captions changed while translating.", 409);
          // An external agent may have published a translation while the model
          // was running. Preserve that valid result instead of overwriting it.
          const current = saved.translations?.[language];
          if (reusableTranslation(current, sourceHash, saved.createdAt, saved.markdown) && contentHash(JSON.stringify(current)) !== cachedFingerprint) return current;
          Object.assign(translated, { sourceHash, sourceUpdatedAt: saved.createdAt });
          saved.translations ||= {};
          saved.translations[language] = translated;
          await store.save();
          return translated;
        });
        return response.json({ translation: publicReadingTranslation(translation, version, translationOptions), paper: publicPaper(paper) });
      }
      const source = translationSource(paper, target);
      if (!source) throw new ApiError(`No ${target} exists to translate.`);
      const sourceUpdatedAt = sourceVersion(paper, target);
      const sourceHash = contentHash(source);
      const cached = paper.translations?.[language]?.[target];
      if (reusableTranslation(cached, sourceHash, sourceUpdatedAt, source))
        return response.json({ translation: cached, paper: publicPaper(paper) });
      const key = JSON.stringify([paper.id, target, language, sourceHash, sourceUpdatedAt]);
      const translation = await coalesceTranslation(key, async () => {
        const translated = await translateContent(source, language, { ...store.data.settings }, { fetchImpl });
        if (!store.paper(paper.id) || sourceVersion(paper, target) !== sourceUpdatedAt || translationSource(paper, target) !== source)
          throw new ApiError("The source changed while translating. Retry against the current content.", 409);
        const current = paper.translations?.[language]?.[target];
        if (reusableTranslation(current, sourceHash, sourceUpdatedAt, source)) return current;
        Object.assign(translated, { sourceUpdatedAt, sourceHash });
        paper.translations ||= {};
        paper.translations[language] ||= {};
        paper.translations[language][target] = translated;
        syncReadingTranslations(paper);
        await store.save();
        return translated;
      });
      response.json({ translation, paper: publicPaper(paper) });
    }),
  );
  app.put(
    "/api/papers/:id/insights",
    wrap(async (request, response) => {
      const paper = paperById(request.params.id);
      if (reportJobs.has(paper.id))
        throw new ApiError(
          "A report is being generated. Wait before importing replacement content.",
          409,
        );
      const body = bodyOf(request);
      if (Object.hasOwn(body, "derivedInteractive")) {
        const result = prepareDerivedInteractive(body, paper);
        // Preserve the reader's effective selection, including a legacy default.
        // No await separates revision/idempotency validation and the insertion.
        materializeReadingVersions(paper);
        if (!result.reused) paper.readingVersions.push(result.readingVersion);
        await store.save();
        const published = publicPaper(paper);
        return response.json({paper: published, readingVersion: published.readingVersions.find(version => version.id === result.readingVersion.id), reused: result.reused});
      }
      const preferences = readingPreferences(body, body.summary && !body.report ? "quick" : "deep");
      const update = prepareInsights(body, paper);
      materializeReadingVersions(paper);
      for (const target of ["report", "summary"]) {
        if (update[target] && paper[target])
          update[`${target}History`] = [
            ...(paper[`${target}History`] || []),
            paper[target],
          ];
      }
      Object.assign(paper, update);
      paper.figures ??= discoverFigures(paper);
      for (const target of ["report", "summary"]) {
        if (update[target]) appendReadingVersion(paper, update[target], {
          ...preferences, target,
          ...(body.style === undefined ? { style: target === "summary" ? "quick" : "deep" } : {}),
        });
      }
      syncReadingTranslations(paper);
      await store.save();
      response.json({ paper: publicPaper(paper) });
    }),
  );
  app.post(
    "/api/chats/import",
    wrap(async (request, response) => {
      const body = bodyOf(request);
      const agentTaskId = body.agentTaskId === undefined ? undefined : validateAgentTaskId(body.agentTaskId);
      const paperId = validatePaperContext(body.paperId ?? null);
      const suppressBoundSelection = body.metadata === null;
      let metadata = questionMetadata(suppressBoundSelection ? { ...body, metadata: undefined } : body, paperId);
      const source = validateAgentSource(body.source);
      const question = validateMarkdown(body.question, "question", 12000);
      const answer = validateMarkdown(body.answer, "answer", 200000);
      let conversation = body.conversationId
        ? store.data.conversations.find(
            (item) =>
              item.id === body.conversationId && item.paperId === paperId,
          )
        : activeConversation(paperId);
      if (body.conversationId && !conversation)
        throw new ApiError(
          "Conversation not found in this paper context.",
          404,
        );
      if (!suppressBoundSelection && metadata === undefined && paperId && conversation?.metadata)
        metadata = questionMetadata({ metadata: conversation.metadata }, paperId);
      conversation ||= createConversation(paperId, metadata);
      const createdAt = new Date().toISOString();
      const common = { paperId, conversationId: conversation.id, createdAt, ...(agentTaskId ? { agentTaskId } : {}) };
      const sources = paperId
        ? [
            {
              id: paperId,
              title: paperById(paperId).title,
              url: paperById(paperId).url,
            },
          ]
        : [];
      const message = {
        ...common,
        id: randomUUID(),
        role: "assistant",
        content: answer,
        mode: "agent",
        source,
        sources,
      };
      store.data.chats.push(
        { ...common, id: randomUUID(), role: "user", content: question, ...(metadata ? { metadata } : {}) },
        message,
      );
      if (conversation.title === "New conversation")
        conversation.title = question.slice(0, 80);
      conversation.updatedAt = createdAt;
      await store.save();
      response.json({
        message,
        sources,
        mode: "agent",
        conversationId: conversation.id,
      });
    }),
  );
  app.get("/api/chats", (request, response) => {
    const paperId =
      typeof request.query.paperId === "string" ? request.query.paperId : null;
    const requestedId = request.query.conversationId;
    if (requestedId !== undefined && (typeof requestedId !== "string" || !requestedId.trim()))
      throw new ApiError("conversationId must be a nonempty string.");
    const conversation = requestedId
      ? store.data.conversations.find((item) => item.id === requestedId && item.paperId === (paperId || null))
      : activeConversation(paperId || null);
    if (requestedId && !conversation)
      throw new ApiError("Conversation not found in this paper context.", 404);
    response.json({
      conversation: conversation || null,
      messages: conversation ? conversationMessages(conversation.id) : [],
      conversationId: conversation?.id || null,
    });
  });
  app.post(
    "/api/chats/new",
    wrap(async (request, response) => {
      const body = bodyOf(request);
      const paperId = validatePaperContext(body.paperId ?? null);
      const metadata = questionMetadata(body, paperId);
      const conversation = createConversation(paperId, metadata);
      await store.save();
      response
        .status(201)
        .json({ conversation, conversationId: conversation.id, messages: [] });
    }),
  );
  app.post("/api/conversations/:conversationId/branch", wrap(async (request, response) => {
    const body = bodyOf(request);
    if (Object.keys(body).some(key => !["paperId", "messageId", "action"].includes(key)))
      throw new ApiError("A branch accepts only paperId, messageId and action.");
    if (!Object.hasOwn(body, "paperId") || (body.paperId !== null && (typeof body.paperId !== "string" || !body.paperId.trim())))
      throw new ApiError("A branch requires paperId, or explicit null for a general research conversation.");
    const paperId = validatePaperContext(body.paperId);
    if (typeof body.messageId !== "string" || !body.messageId.trim() || body.messageId.length > 128)
      throw new ApiError("messageId must identify a saved user message.");
    const action = body.action ?? "edit";
    if (!["edit", "retry"].includes(action)) throw new ApiError("Branch action must be edit or retry.");
    const parent = store.data.conversations.find(item => item.id === request.params.conversationId && item.paperId === paperId);
    if (!parent) throw new ApiError("Conversation not found in this paper context.", 404);
    // Do not use the last-100 display window: the branch's history is the full
    // immutable prefix before the target question, never its answer or future.
    const original = store.data.chats.filter(message => message.conversationId === parent.id);
    const targetIndex = original.findIndex(message => message.id === body.messageId && (message.paperId ?? null) === paperId);
    if (targetIndex < 0) throw new ApiError("Message not found in this conversation and paper context.", 404);
    const target = original[targetIndex];
    if (target.role !== "user") throw new ApiError("Choose a saved user question to edit or retry.");
    const prefix = original.slice(0, targetIndex);
    if (prefix.some(message => (message.paperId ?? null) !== paperId || !["user", "assistant"].includes(message.role) || typeof message.content !== "string"))
      throw new ApiError("This conversation contains inconsistent historical records and cannot be branched safely.", 409);
    const metadata = target.metadata == null ? undefined : questionMetadata({ metadata: target.metadata }, paperId);
    const now = new Date().toISOString();
    const copies = prefix.map((message, index) => ({
      ...structuredClone(message), id: randomUUID(), paperId,
      branchSource: { conversationId: parent.id, ...(typeof message.id === "string" ? { messageId: message.id } : {}), messageIndex: index, copiedAt: now },
    }));
    const conversation = createConversation(paperId, metadata);
    conversation.source = { kind: "branch", conversationId: parent.id, messageId: target.id, action, createdAt: now };
    for (const message of copies) message.conversationId = conversation.id;
    store.data.chats.push(...copies);
    await store.save();
    const hasQuestionText = typeof target.questionText === "string" && target.questionText.trim() && target.questionText.length <= 12000;
    response.status(201).json({
      conversation, conversationId: conversation.id, messages: copies,
      draft: { message: hasQuestionText ? target.questionText : target.content, metadata: metadata || null, verbatim: !hasQuestionText },
    });
  }));
  app.get("/api/conversations", (request, response) => {
    const paperId =
      typeof request.query.paperId === "string" && request.query.paperId
        ? request.query.paperId
        : null;
    const conversations = store.data.conversations
      .filter((conversation) => conversation.paperId === paperId)
      .map((conversation) => ({
        ...conversation,
        messageCount: store.data.chats.filter(
          (message) => message.conversationId === conversation.id,
        ).length,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    response.json({
      conversations,
      activeConversationId: activeConversation(paperId)?.id || null,
    });
  });
  app.put(
    "/api/conversations/active",
    wrap(async (request, response) => {
      const body = bodyOf(request);
      const paperId = validatePaperContext(body.paperId ?? null);
      const conversation = store.data.conversations.find(
        (item) => item.id === body.conversationId && item.paperId === paperId,
      );
      if (!conversation)
        throw new ApiError(
          "Conversation not found in this paper context.",
          404,
        );
      store.data.activeConversations[conversationKey(paperId)] =
        conversation.id;
      await store.save();
      response.json({
        conversation,
        conversationId: conversation.id,
        messages: conversationMessages(conversation.id),
      });
    }),
  );
  app.post(
    "/api/chat",
    wrap(async (request, response) => {
      const { message, history, processing } = bodyOf(request);
      if (processing !== undefined && !["api", "extractive"].includes(processing))
        throw new ApiError("processing must be api or extractive; omit it for the compatible automatic behavior.");
      const settings = { ...store.data.settings };
      if (processing === "api" && !canUseModel(settings))
        throw Object.assign(new ApiError("API answering is not configured. Use your Codex / Claude subscription session, configure a model API, or explicitly choose local source retrieval.", 409), { code: "chat_model_unconfigured" });
      const paperId = validatePaperContext(request.body.paperId ?? null);
      const suppressBoundSelection = request.body.metadata === null;
      let metadata = questionMetadata(suppressBoundSelection ? { ...request.body, metadata: undefined } : request.body, paperId);
      if (
        typeof message !== "string" ||
        !message.trim() ||
        message.length > 12000
      )
        throw new ApiError("Enter a question of up to 12,000 characters.");
      const questionText = request.body.questionText;
      if (questionText !== undefined && (typeof questionText !== "string" || !questionText.trim() || questionText.length > 12000))
        throw new ApiError("questionText must contain the original question text, up to 12,000 characters.");
      if (
        history !== undefined &&
        (!Array.isArray(history) ||
          history.some(
            (item) =>
              !item ||
              !["user", "assistant"].includes(item.role) ||
              typeof item.content !== "string" ||
              item.content.length > 20000,
          ))
      )
        throw new ApiError(
          "History must contain user/assistant messages with text content.",
        );
      const papers = paperId
        ? [paperById(paperId)]
        : store.data.papers.slice(0, 8);
      let conversation = request.body.conversationId
        ? store.data.conversations.find((item) => item.id === request.body.conversationId && item.paperId === paperId)
        : activeConversation(paperId);
      if (request.body.conversationId && !conversation) throw new ApiError("Conversation not found in this paper context.", 404);
      // A passage-bound session keeps its explicitly saved source context on
      // follow-ups. Never infer a page from prose or borrow another session's
      // selection. Explicit request metadata always takes precedence.
      if (!suppressBoundSelection && metadata === undefined && paperId && conversation?.metadata)
        metadata = questionMetadata({ metadata: conversation.metadata }, paperId);
      if (!conversation) {
        conversation = createConversation(paperId, metadata);
        await store.save();
      }
      // Capture the active conversation before calling the provider. A concurrent
      // new-chat action must never attach this answer to the new empty conversation.
      const conversationId = conversation.id;
      // Caller-supplied history is untrusted text, never an authority for stored
      // vision provenance or source verification. Only saved records may carry
      // the server's source metadata into history preparation.
      const previous = history
        ? history.map(({ role, content }) => ({ role, content }))
        : conversationMessages(conversationId);
      const answer = await answerQuestion(
        papers,
        message.trim(),
        previous,
        settings,
        { fetchImpl, metadata, forceExtractive: processing === "extractive" },
      );
      if (paperId && !store.paper(paperId))
        throw new ApiError(
          "The paper was deleted while answering this question.",
          409,
        );
      const userMessage = {
        id: randomUUID(),
        role: "user",
        content: message.trim(),
        paperId,
        conversationId,
        createdAt: new Date().toISOString(),
        ...(metadata ? { metadata } : {}),
        ...(questionText === undefined ? {} : { questionText }),
      };
      const assistantMessage = {
        id: randomUUID(),
        role: "assistant",
        content: answer.content,
        paperId,
        conversationId,
        createdAt: new Date().toISOString(),
        mode: answer.mode,
        ...(answer.source ? { source: answer.source } : {}),
        sources: answer.sources,
      };
      store.data.chats.push(userMessage, assistantMessage);
      if (conversation.title === "New conversation")
        conversation.title = message.trim().slice(0, 80);
      conversation.updatedAt = assistantMessage.createdAt;
      await store.save();
      response.json({
        userMessage,
        message: assistantMessage,
        sources: answer.sources,
        mode: answer.mode,
        conversationId,
      });
    }),
  );
  app.use("/api", (_request, _response, next) =>
    next(new ApiError("API route not found.", 404)),
  );
  const dist = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../dist",
  );
  app.use(express.static(dist, { dotfiles: "deny" }));
  app.use((request, response, next) => {
    if (request.method === "GET" && existsSync(path.join(dist, "index.html")))
      response.sendFile(path.join(dist, "index.html"));
    else
      next(
        new ApiError(
          "Page not found. Start the frontend dev server, or build the app before using production mode.",
          404,
        ),
      );
  });
  app.use((error, _request, response, _next) => {
    if (response.headersSent) return;
    if (error instanceof multer.MulterError)
      return response
        .status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400)
        .json({
          error:
            error.code === "LIMIT_FILE_SIZE"
              ? "PDF upload exceeds the 25 MB limit."
              : "Upload one PDF in the file field.",
        });
    if (error.type === "entity.parse.failed")
      return response.status(400).json({ error: "Invalid JSON request body." });
    if (error.type === "entity.too.large")
      return response.status(413).json({ error: "Request body is too large." });
    response.status(error.status || 500).json({
      ...(error instanceof ApiError && ["selection_no_translatable_text", "selection_model_unconfigured", "chat_model_unconfigured", "pdf_source_binding_invalid", "pdf_source_acceptance_invalid", "pdf_source_changed", "pdf_source_already_bound"].includes(error.code) ? { code: error.code } : {}),
      error:
        error instanceof ApiError
          ? error.message
          : "An unexpected server error occurred. Please retry.",
    });
  });
  return app;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.PORT || 4318);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be a valid port number.");
  const app = await createApp();
  const server = app.listen(port, "127.0.0.1", () =>
    console.log(`Paper Workbench available at http://127.0.0.1:${port}`),
  );
  server.requestTimeout = 300000;
  server.on("error", (error) => {
    console.error(
      `Server could not start (${error.code || "unknown error"}). Check that the port is available.`,
    );
    process.exitCode = 1;
  });
}
