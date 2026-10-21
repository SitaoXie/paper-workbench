import express from "express";
import multer from "multer";
import path from "node:path";
import { existsSync } from "node:fs";
import { unlink, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  Store,
  publicPaper,
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
} from "./models.mjs";

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
    const shellNavigation = request.method === "GET" && request.path === "/" &&
      request.headers["sec-fetch-mode"] === "navigate" &&
      request.headers["sec-fetch-dest"] === "document";
    if (request.headers["sec-fetch-site"] === "cross-site" && !shellNavigation)
      return next(new ApiError("Cross-site requests are blocked.", 403));
    if (request.path.startsWith("/api/"))
      response.setHeader("Cache-Control", "no-store");
    next();
  });
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
  const createConversation = (paperId) => {
    const conversation = {
      id: randomUUID(),
      paperId,
      title: "New conversation",
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

  app.get("/api/health", (_request, response) =>
    response.json({
      status: "ok",
      version: "0.1.0",
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
      if (typeof body.favorite !== "boolean")
        throw new ApiError("favorite must be true or false.");
      paper.favorite = body.favorite;
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
  app.post(
    "/api/papers/:id/report",
    wrap(async (request, response) => {
      const paper = paperById(request.params.id);
      if (reportJobs.has(paper.id))
        throw new ApiError(
          "A report is already being generated for this paper.",
          409,
        );
      reportJobs.add(paper.id);
      try {
        const report = await generateReport(
          paper,
          { ...store.data.settings },
          {
            adversarial: request.body?.adversarial !== false,
            language: validateLanguage(request.body?.language),
            fetchImpl,
          },
        );
        if (!store.paper(paper.id))
          throw new ApiError(
            "The paper was deleted while its report was being generated.",
            409,
          );
        if (paper.report)
          paper.reportHistory = [...(paper.reportHistory || []), paper.report];
        paper.report = report;
        paper.figures ??= discoverFigures(paper);
        await store.save();
        response.json({ report, paper: publicPaper(paper) });
      } finally {
        reportJobs.delete(paper.id);
      }
    }),
  );
  app.post(
    "/api/papers/:id/translate",
    wrap(async (request, response) => {
      const paper = paperById(request.params.id);
      const { target, language: inputLanguage } = bodyOf(request);
      const language = validateLanguage(inputLanguage);
      const source = translationSource(paper, target);
      if (!source) throw new ApiError(`No ${target} exists to translate.`);
      const sourceUpdatedAt = sourceVersion(paper, target);
      const translation = await translateContent(
        source,
        language,
        { ...store.data.settings },
        { fetchImpl },
      );
      if (
        !store.paper(paper.id) ||
        sourceVersion(paper, target) !== sourceUpdatedAt ||
        translationSource(paper, target) !== source
      )
        throw new ApiError(
          "The source changed while translating. Retry against the current content.",
          409,
        );
      translation.sourceUpdatedAt = sourceUpdatedAt;
      translation.sourceHash = contentHash(source);
      paper.translations ||= {};
      paper.translations[language] ||= {};
      paper.translations[language][target] = translation;
      await store.save();
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
      const update = prepareInsights(bodyOf(request), paper);
      for (const target of ["report", "summary"]) {
        if (update[target] && paper[target])
          update[`${target}History`] = [
            ...(paper[`${target}History`] || []),
            paper[target],
          ];
      }
      Object.assign(paper, update);
      paper.figures ??= discoverFigures(paper);
      await store.save();
      response.json({ paper: publicPaper(paper) });
    }),
  );
  app.post(
    "/api/chats/import",
    wrap(async (request, response) => {
      const body = bodyOf(request);
      const paperId = validatePaperContext(body.paperId ?? null);
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
      conversation ||= createConversation(paperId);
      const createdAt = new Date().toISOString();
      const common = { paperId, conversationId: conversation.id, createdAt };
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
        { ...common, id: randomUUID(), role: "user", content: question },
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
    const conversation = activeConversation(paperId || null);
    response.json({
      messages: conversation ? conversationMessages(conversation.id) : [],
      conversationId: conversation?.id || null,
    });
  });
  app.post(
    "/api/chats/new",
    wrap(async (request, response) => {
      const paperId = validatePaperContext(bodyOf(request).paperId ?? null);
      const conversation = createConversation(paperId);
      await store.save();
      response
        .status(201)
        .json({ conversation, conversationId: conversation.id, messages: [] });
    }),
  );
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
      const { message, history } = bodyOf(request);
      const paperId = validatePaperContext(request.body.paperId ?? null);
      if (
        typeof message !== "string" ||
        !message.trim() ||
        message.length > 12000
      )
        throw new ApiError("Enter a question of up to 12,000 characters.");
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
      let conversation = activeConversation(paperId);
      if (!conversation) {
        conversation = createConversation(paperId);
        await store.save();
      }
      // Capture the active conversation before calling the provider. A concurrent
      // new-chat action must never attach this answer to the new empty conversation.
      const conversationId = conversation.id;
      const previous =
        history || conversationMessages(conversationId).slice(-12);
      const answer = await answerQuestion(
        papers,
        message.trim(),
        previous,
        { ...store.data.settings },
        { fetchImpl },
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
      };
      const assistantMessage = {
        id: randomUUID(),
        role: "assistant",
        content: answer.content,
        paperId,
        conversationId,
        createdAt: new Date().toISOString(),
        mode: answer.mode,
        sources: answer.sources,
      };
      store.data.chats.push(userMessage, assistantMessage);
      if (conversation.title === "New conversation")
        conversation.title = message.trim().slice(0, 80);
      conversation.updatedAt = assistantMessage.createdAt;
      await store.save();
      response.json({
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
