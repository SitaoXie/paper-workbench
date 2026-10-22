import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const title = "How Reinforcement Learning Reshapes Reasoning";
const fullText =
  "FULL-TEXT-EVIDENCE: The controlled experiment measures coverage over repeated samples. Independent evaluation finds both transfer and forgetting. This paragraph belongs to the full paper and is not included in its abstract.";
const seed = {
  id: "ui-paper",
  title,
  authors: ["A. Researcher", "B. Scientist"],
  abstract:
    "We study how reinforcement learning changes reasoning strategies, transfer and coverage. ".repeat(
      8,
    ),
  text: fullText,
  url: "https://example.org/paper",
  source: "web",
  createdAt: "2026-10-03T00:00:00Z",
  publishedAt: "2026-10-03T00:00:00Z",
  tags: ["cs.LG", "reasoning"],
  favorite: false,
};

async function nav(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "展开导航", exact: true });
  const rail = page.getByRole("navigation");
  if (
    (await menu.isVisible()) &&
    !(await rail.getAttribute("class"))?.includes("mobile-open")
  )
    await menu.click();
  const target = rail.getByRole("button", { name, exact: true });
  await expect(target).toBeInViewport();
  await target.click();
}
async function assertFits(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBeTruthy();
}
async function mockAPI(page: Page) {
  let papers: any[] = [structuredClone(seed)];
  const initialProfile = {
    id: "default",
    name: "Test connection",
    provider: "openai",
    baseUrl: "https://api.example.org/v1",
    model: "test-model",
    models: ["test-model", "test-reasoning"],
    apiKeyConfigured: false,
  };
  let settings: any = {
    ...initialProfile,
    activeProfileId: "default",
    profiles: [initialProfile],
  };
  const chats = new Map<string, any[]>();
  const conversations = new Map<string, any>();
  const activeConversations = new Map<string, string>();
  const activities: any[] = [];
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname.replace("/api", ""),
      method = req.method();
    const body =
      method === "POST" || method === "PUT" || method === "PATCH"
        ? (() => {
            try {
              return req.postDataJSON();
            } catch {
              return {};
            }
          })()
        : {};
    let result: any;
    if (path === "/settings" && method === "GET") result = settings;
    else if (path === "/settings" && method === "PUT") {
      const profiles = (body.profiles || settings.profiles).map(
        (profile: any) => {
          const previous = settings.profiles.find(
            (p: any) => p.id === profile.id,
          );
          const clean = {
            ...profile,
            apiKeyConfigured: profile.clearApiKey
              ? false
              : !!profile.apiKey || !!previous?.apiKeyConfigured,
          };
          delete clean.apiKey;
          delete clean.clearApiKey;
          return clean;
        },
      );
      const activeProfileId = body.activeProfileId || settings.activeProfileId;
      const active =
        profiles.find((p: any) => p.id === activeProfileId) || profiles[0];
      if (body.model) active.model = body.model;
      settings = {
        ...active,
        activeProfileId,
        profiles,
        modelConfigured: !!active.apiKeyConfigured,
      };
      result = settings;
    } else if (path === "/settings/test") result = { ok: true };
    else if (path === "/papers" && method === "GET")
      result = { papers: papers.map(({ text, ...rest }) => rest) };
    else if (path === "/import" || path === "/upload") {
      const p = {
        ...structuredClone(seed),
        id: "imported-paper",
        title: "Imported research paper",
        url: body.url || "",
        source: path === "/upload" ? "upload" : "web",
      };
      papers.push(p);
      result = { paper: p };
    } else if (path === "/search")
      result = {
        papers: papers.filter((p) =>
          p.title
            .toLowerCase()
            .includes((url.searchParams.get("q") || "").toLowerCase()),
        ),
      };
    else if (/^\/papers\/[^/]+\/annotations$/.test(path)) result = { annotations: [] };
    else if (/^\/papers\/[^/]+\/activities$/.test(path)) result = { activities };
    else if (/^\/papers\/[^/]+\/assist$/.test(path)) {
      const resultText = body.kind === "translation" ? "独立试验确认了观测趋势，并明确指出局限。" : "The passage describes independent replication while acknowledging limits.";
      const activity = { id: `activity-${activities.length + 1}`, kind: body.kind, page: body.page, quote: body.text, text: resultText, createdAt: new Date().toISOString() };
      activities.push(activity);
      result = { result: { text: resultText, source: { kind: "model", model: "test-model" } }, activity };
    } else if (path === "/chats/new") {
      const conversationId = `conversation-${conversations.size + 1}`;
      conversations.set(conversationId, { id: conversationId, paperId: body.paperId, kind: body.kind || "question", metadata: body.metadata, title: "New conversation", messageCount: 0 });
      activeConversations.set(body.paperId || "general", conversationId);
      chats.set(body.paperId || "general", []);
      result = { conversationId, messages: [] };
    } else if (path === "/conversations") result = { conversations: [...conversations.values()] };
    else if (path === "/chats")
      result = {
        messages: chats.get(url.searchParams.get("paperId") || "general") || [],
        conversationId: activeConversations.get(url.searchParams.get("paperId") || "general") || null,
      };
    else if (path === "/chat") {
      const message = {
        role: "assistant",
        content:
          "The evidence suggests **strategy reweighting**. [Source](https://example.org/paper)",
      };
      chats.set(body.paperId || "general", [
        ...(body.history || []),
        { role: "user", content: body.message },
        message,
      ]);
      result = { message, conversationId: activeConversations.get(body.paperId || "general") || null };
    } else if (/^\/papers\/[^/]+\/report$/.test(path)) {
      const p = papers.find((p) => p.id === path.split("/")[2]);
      p.report = {
        markdown:
          "# Research report\n\n## Contribution\nStrategy reweighting changes coverage.\n\n## Limits\nVerify the original evidence.\n\n[Source](https://example.org/paper)",
        mode: settings.apiKeyConfigured ? "adversarial" : "extractive",
        createdAt: "2026-10-22T00:00:00Z",
      };
      result = { paper: p, report: p.report };
    } else if (/^\/papers\/[^/]+$/.test(path)) {
      const p = papers.find((p) => p.id === path.split("/")[2]);
      if (method === "PATCH") Object.assign(p, body);
      result = { paper: p };
    } else {
      await route.fulfill({
        status: 404,
        json: { error: `Unmocked request: ${method} ${path}` },
      });
      return;
    }
    await route.fulfill({ json: result });
  });
}

test.describe("Repeatable UI acceptance", () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page);
    await page.goto("/");
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  });
  test("navigation, search, empty results, theme and model settings", async ({
    page,
  }, info) => {
    await assertFits(page);
    await page.screenshot({ path: info.outputPath("home.png") });
    await page.getByLabel("搜索论文或粘贴网址").fill("nonexistent paper");
    await page.getByLabel("搜索论文或粘贴网址").press("Enter");
    await expect(page.getByText("还没有找到相关论文")).toBeVisible();
    await page.getByRole("button", { name: "清除搜索" }).click();
    await nav(page, "文库");
    await expect(
      page.getByRole("heading", { name: "我的文库", exact: true }),
    ).toBeVisible();
    await nav(page, "收藏");
    await expect(page.getByText("把值得记住的论文留在这里")).toBeVisible();
    await nav(page, "模型");
    const dialog = page.getByRole("dialog", { name: "模型与 API" });
    await expect(dialog).toBeVisible();
    await assertFits(page);
    await page.screenshot({ path: info.outputPath("settings.png") });
    await dialog.getByLabel("API 协议").selectOption("anthropic");
    await expect(dialog.getByLabel("API Base URL")).toHaveValue(
      "https://api.anthropic.com",
    );
    await dialog
      .getByLabel("预填模型列表")
      .fill("test-model\ntest-reasoning\ntest-fast");
    await dialog.getByLabel("模型名称").fill("test-model");
    await dialog.locator(".advanced-settings summary").click();
    await dialog.getByLabel("单次模型请求超时（秒）", { exact: true }).fill("240");
    await dialog.getByLabel("API Key", { exact: true }).fill("fake-e2e-key");
    await dialog.getByRole("button", { name: "测试连接" }).click();
    await expect(dialog.getByText("连接成功，模型已响应。")).toBeVisible();
    const saveRequest = page.waitForRequest(
      (r) => r.url().endsWith("/api/settings") && r.method() === "PUT",
    );
    await dialog.getByRole("button", { name: "保存配置" }).click();
    const savedBody = (await saveRequest).postDataJSON();
    expect(savedBody.profiles[0]).toMatchObject({
      provider: "anthropic",
      model: "test-model",
      models: ["test-model", "test-reasoning", "test-fast"],
      apiKey: "fake-e2e-key",
      requestTimeoutSeconds: 240,
    });
    await expect(dialog.getByText("配置已保存")).toBeVisible();
    await expect(dialog.locator("#api-key")).toHaveValue("");
    await expect(dialog.getByText("已配置", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "添加连接" }).click();
    await dialog.getByLabel("连接名称").fill("Second connection");
    await dialog.getByLabel("模型名称").fill("other-model");
    await dialog.getByLabel("预填模型列表").fill("other-model\nother-fast");
    await dialog.getByRole("button", { name: "保存配置" }).click();
    await expect(dialog.getByText("配置已保存")).toBeVisible();
    await dialog.getByRole("button", { name: /Test connection/ }).click();
    await expect(dialog.getByLabel("预填模型列表")).toHaveValue(
      "test-model\ntest-reasoning\ntest-fast",
    );
    await expect(dialog.getByText("已配置", { exact: true })).toBeVisible();
    await expect(dialog.locator("#api-key")).toHaveValue("");
    await dialog.getByRole("button", { name: "关闭模型设置" }).click();
    const menu = page.getByRole("button", { name: "展开导航" });
    if (
      (await menu.isVisible()) &&
      (await page.getByRole("button", { name: "切换深色主题" }).boundingBox())!
        .x < 0
    )
      await menu.click();
    await page.getByRole("button", { name: "切换深色主题" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await nav(page, "研究助手");
    await expect(page.getByLabel("向研究助手提问")).toBeVisible();
    await page.getByLabel("向研究助手提问").fill("Compare the evidence");
    await page.getByRole("button", { name: "发送问题" }).click();
    await expect(
      page.getByText("strategy reweighting", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("research-dark.png"),
      fullPage: true,
    });
    await assertFits(page);
  });
  test("keyless local model enables AI and displays adversarial review stages", async ({
    page,
  }) => {
    await page.route("**/api/settings", (route) =>
      route.fulfill({
        json: {
          provider: "openai",
          baseUrl: "http://localhost:11434/v1",
          model: "local-model",
          apiKeyConfigured: false,
          modelConfigured: true,
        },
      }),
    );
    await page.route("**/api/papers/ui-paper/report", (route) =>
      route.fulfill({
        json: {
          paper: {
            ...seed,
            report: {
              mode: "model-adversarial",
              createdAt: "2026-10-22T00:00:00Z",
              markdown: "# Reviewed report\nEvidence is limited.",
              stages: [
                {
                  role: "researcher",
                  content: "Initial evidence-based draft.",
                },
                {
                  role: "skeptic",
                  content: "The sample is too small for generalization.",
                },
                { role: "editor", content: "Reviewed report." },
              ],
            },
          },
        },
      }),
    );
    await page.reload();
    await page.getByText(title, { exact: true }).click();
    await page.getByRole("radio", { name: /深入研读/ }).click();
    await page.getByLabel("解读侧重点").fill("Check uncertainty and limitations.");
    const generation = page.waitForRequest(request => request.url().endsWith("/api/papers/ui-paper/report") && request.method() === "POST");
    await page.getByRole("button", { name: "生成解读", exact: true }).click();
    expect((await generation).postDataJSON()).toMatchObject({ style: "deep", focus: "Check uncertainty and limitations.", adversarial: true, language: "zh-CN" });
    await expect(page.getByRole("heading", { name: "Reviewed report", exact: true })).toBeVisible();
    await page.locator(".reading-version-details > summary").click();
    await expect(page.locator(".reading-version-detail-body")).toContainText("深入研读");
    await page.locator(".reading-version-details > summary").click();
    await page.getByText("复核过程", { exact: false }).click();
    await expect(
      page.getByText("Initial evidence-based draft.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("The sample is too small for generalization.", {
        exact: true,
      }),
    ).toBeVisible();
  });
  test("continuous PDF recovers from errors and preserves page during rapid zoom", async ({
    page,
  }, info) => {
    const pdf = await researchPdf(page, "two-page fixture", true);
    let available = false;
    await page.route("**/test-reader.pdf", (route) =>
      route.fulfill({
        contentType: "application/pdf",
        body: available ? pdf : Buffer.from("not a valid PDF"),
      }),
    );
    await page.route("**/api/papers/ui-paper", (route) =>
      route.fulfill({
        json: {
          paper: {
            ...seed,
            source: "pdf",
            pdfUrl: "/test-reader.pdf",
            pageCount: 2,
          },
        },
      }),
    );
    await page.getByText(title, { exact: true }).click();
    await page.getByRole("tab", { name: "论文", exact: true }).click();
    await expect(page.locator(".pdf-reader").getByRole("alert")).toContainText(
      "无法加载 PDF",
    );
    await page.screenshot({
      path: info.outputPath("pdf-recoverable-error.png"),
    });
    available = true;
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await expect(
      page.locator(
        '.pdf-reader canvas[data-rendered="true"][data-page-number="1"]',
      ),
    ).toBeVisible();
    await expect(page.locator(".pdf-continuous-page")).toHaveCount(2);
    // Scrolling, rather than the old next-page control, advances the reading page.
    await page.locator(".pdf-canvas-viewport").evaluate((element) => {
      const next = element.querySelector<HTMLElement>('[data-pdf-page="2"]')!;
      element.scrollTop = next.offsetTop - 16;
    });
    await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue("2");
    await expect(
      page.locator(
        '.pdf-reader canvas[data-rendered="true"][data-page-number="2"]',
      ),
    ).toBeVisible();
    await expect(
      page.locator('[data-pdf-page="2"] .pdf-text-layer'),
    ).toContainText("Second page evidence");
    await page.getByRole("button", { name: "上一页", exact: true }).click();
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    await page.getByRole("button", { name: "放大 PDF", exact: true }).click();
    await page.getByRole("button", { name: "适合宽度", exact: true }).click();
    await expect(
      page.locator(
        '.pdf-reader canvas[data-rendered="true"][data-page-number="2"]',
      ),
    ).toBeVisible();
    await expect(
      page.locator('[data-pdf-page="2"] .pdf-text-layer'),
    ).toContainText("Second page evidence");
    await expect(page.locator(".pdf-reader").getByRole("alert")).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("pdf-page-two.png") });
    await assertFits(page);
  });
  test("long PDF scrolls continuously with bounded canvases and source figure navigation", async ({
    page,
  }, info) => {
    const pdf = await researchPdf(page, "continuous reading", 20);
    await page.route("**/test-continuous.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: pdf }),
    );
    await page.route("**/api/papers/ui-paper", (route) =>
      route.fulfill({
        json: {
          paper: {
            ...seed,
            source: "pdf",
            pdfUrl: "/test-continuous.pdf",
            pageCount: 20,
            summary: { language: "zh-CN", markdown: "## Trial evidence\n\n:::figure figure-1\n\nSource evidence is available on the cited page.", createdAt: seed.createdAt, source: { kind: "agent", agent: "Test agent" } },
            figures: [
              {
                id: "figure-1",
                page: 2,
                caption: "Measured trial outcomes",
                crop: { x: 0, y: 0, width: 0.6, height: 0.4 },
              },
            ],
          },
        },
      }),
    );
    await page.getByText(title, { exact: true }).click();
    if (
      await page
        .getByRole("button", { name: "关闭助手", exact: true })
        .isVisible()
    )
      await page.getByRole("button", { name: "关闭助手", exact: true }).click();
    const reading = page.locator(".reading-prose");
    const figure = reading.locator(
      'canvas[data-figure-page="2"][data-rendered="true"]',
    );
    await reading.locator(".pdf-source-figure").scrollIntoViewIfNeeded();
    await expect(figure).toBeVisible();
    expect(
      await figure.evaluate((canvas: HTMLCanvasElement) => {
        const pixels = canvas
          .getContext("2d")!
          .getImageData(0, 0, canvas.width, canvas.height).data;
        let ink = 0;
        for (let i = 0; i < pixels.length; i += 4)
          if (pixels[i] < 220 || pixels[i + 1] < 220 || pixels[i + 2] < 220)
            ink++;
        return ink;
      }),
    ).toBeGreaterThan(100);
    await page
      .getByRole("button", { name: "在论文中查看第 2 页图表", exact: true })
      .click();
    await expect(
      page.getByRole("tab", { name: "论文", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue("2");
    await expect(
      page.locator(
        '.pdf-reader canvas[data-page-number="2"][data-rendered="true"]',
      ),
    ).toBeVisible();
    await expect(page.locator(".pdf-continuous-page")).toHaveCount(20);
    const viewport = page.locator(".pdf-canvas-viewport");
    await viewport.evaluate((element) => {
      element.scrollTop =
        element.querySelector<HTMLElement>('[data-pdf-page="10"]')!.offsetTop -
        16;
    });
    await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue(
      "10",
    );
    await expect(
      page.locator('[data-pdf-page="10"] .pdf-text-layer'),
    ).toContainText("Page 10 evidence");
    expect(await page.locator(".pdf-reader canvas").count()).toBeLessThan(8);
    await expect(page.locator('[data-pdf-page="1"] canvas')).toHaveCount(0);
    const scrollBefore = await viewport.evaluate((e) => e.scrollTop);
    await page.waitForTimeout(150);
    expect(
      Math.abs((await viewport.evaluate((e) => e.scrollTop)) - scrollBefore),
    ).toBeLessThan(2);
    await page.getByRole("button", { name: "放大 PDF", exact: true }).click();
    await page.getByRole("button", { name: "适合宽度", exact: true }).click();
    await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue(
      "10",
    );
    await page.getByLabel("PDF 页码", { exact: true }).fill("20");
    await page.getByLabel("PDF 页码", { exact: true }).press("Enter");
    await expect(
      page.locator(
        '.pdf-reader canvas[data-page-number="20"][data-rendered="true"]',
      ),
    ).toBeVisible();
    await expect(
      page.locator('[data-pdf-page="20"] .pdf-text-layer'),
    ).toContainText("Page 20 evidence");
    expect(await page.locator(".pdf-reader canvas").count()).toBeLessThan(8);
    await assertFits(page);
    await page.screenshot({ path: info.outputPath("continuous-paper.png") });
  });
  test("reader selection asks about an exact quote, translates and keeps native navigation", async ({
    page,
  }, info) => {
    await page.route('**/api/settings',route=>route.fulfill({json:{provider:'openai',baseUrl:'https://example.org/v1',model:'fixture-model',modelConfigured:true,apiKeyConfigured:false}}));
    await page.reload();
    const pdf = await researchPdf(page, "selection interaction", true);
    await page.route("**/test-selection.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: pdf }),
    );
    await page.route("**/api/papers/ui-paper", (route) =>
      route.fulfill({
        json: {
          paper: {
            ...seed,
            source: "pdf",
            pdfUrl: "/test-selection.pdf",
            pageCount: 2,
          },
        },
      }),
    );
    let sent = 0;
    const startedSessions: any[] = [];
    const inlineRequests: any[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (path === "/api/chats/new" && request.method() === "POST") startedSessions.push(request.postDataJSON());
      if (path === "/api/papers/ui-paper/assist" && request.method() === "POST") inlineRequests.push(request.postDataJSON());
      if (
        new URL(request.url()).pathname === "/api/chat" &&
        request.method() === "POST"
      )
        sent++;
    });
    await page.getByText(title, { exact: true }).click();
    await page.getByRole("tab", { name: "论文", exact: true }).click();
    const text = page
      .locator('[data-pdf-page="1"] .pdf-text-layer span')
      .filter({ hasText: "This experiment" })
      .first();
    await expect(text).toBeVisible();
    const quote = (await text.innerText()).trim();
    if (info.project.name === "desktop") {
      const bounds = (await text.boundingBox())!;
      await page.mouse.move(bounds.x + 1, bounds.y + bounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        bounds.x + bounds.width - 1,
        bounds.y + bounds.height / 2,
        { steps: 12 },
      );
      await page.mouse.up();
    } else {
      // Native mobile selection is supplied by the OS; dispatch its selection and
      // pointer-up events against the real PDF text nodes (not a fabricated quote).
      await text.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        element.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            pointerType: "touch",
          }),
        );
      });
    }
    const menu = page.getByRole("dialog", { name: "选中文字操作" });
    await expect(menu).toBeVisible();
    await expect(
      menu.getByRole("button", { name: "解释选中内容" }),
    ).toBeVisible();
    await expect(
      menu.getByRole("button", { name: "翻译选中内容" }),
    ).toBeVisible();
    const selected = await page.evaluate(() =>
      window.getSelection()!.toString().replace(/\s+/g, " ").trim(),
    );
    expect(selected.length).toBeGreaterThan(15);
    expect(quote).toContain(selected);
    expect(sent).toBe(0);
    await menu
      .getByLabel("针对选中文字的问题")
      .fill("这段中的 coverage 是怎么测量的？");
    await expect(menu).toBeVisible();
    await page.screenshot({
      path: info.outputPath("pdf-selection-question.png"),
    });
    await menu.getByRole("button", { name: "询问助手", exact: true }).click();
    await expect(page.locator(".selected-passage blockquote")).toHaveText(
      selected,
    );
    await expect(page.getByLabel("向研究助手提问")).toHaveValue(
      "这段中的 coverage 是怎么测量的？",
    );
    await expect(menu).toHaveCount(0);
    expect(sent).toBe(0);
    expect(startedSessions).toEqual([{ paperId: "ui-paper", kind: "question", metadata: { quote: selected, page: 1, pages: [1], sourceScope: 'pdf' } }]);
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByLabel("问答处理方式", { exact: true }).selectOption("agent");
    await page.getByRole("button", { name: "准备订阅任务", exact: true }).click();
    const agentTask = await page.evaluate(() => navigator.clipboard.readText());
    expect(agentTask).toContain(selected);
    expect(agentTask).toContain("[p.1]");
    expect(agentTask).toContain("这段中的 coverage 是怎么测量的？");
    expect(sent).toBe(0);
    const request = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === "/api/chat" &&
        request.method() === "POST",
    );
    await page.getByLabel("问答处理方式", { exact: true }).selectOption("api");
    await page.getByRole("button", { name: "发送问题" }).click();
    const message = (await request).postDataJSON().message;
    expect(message).toContain(selected);
    expect(message).toContain("[p.1]");
    await expect(page.getByRole("button", { name: "发送问题" })).toBeDisabled();
    await page.getByRole("button", { name: "关闭助手", exact: true }).click();
    const viewport = page.getByLabel("连续滚动论文页面", { exact: true });
    await viewport.focus();
    await viewport.press("ArrowRight");
    await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue("2");
    const second = page
      .locator('[data-pdf-page="2"] .pdf-text-layer[data-rendered="true"] span')
      .filter({ hasText: "Independent trials" })
      .first();
    await expect(second).toBeVisible();
    // Closing the dock changes fit-width scale. Select only the completed text
    // layer for the final geometry, rather than a node about to be replaced.
    await expect.poll(async () => {
      const layerScale = await second.evaluate(element => Number(element.closest<HTMLElement>(".pdf-text-layer")!.style.getPropertyValue("--total-scale-factor")));
      const viewportWidth = await viewport.evaluate(element => element.clientWidth - 32);
      const pageWidth = await page.locator('[data-pdf-page="2"]').evaluate(element => element.getBoundingClientRect().width);
      const naturalWidth = pageWidth / layerScale;
      return Math.abs(layerScale - Math.min(2, viewportWidth / naturalWidth));
    }).toBeLessThan(0.001);
    await second.evaluate((element) => {
      element.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerType: "touch",
        }),
      );
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      element.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, pointerType: "touch" }),
      );
    });
    await expect(menu).toBeVisible();
    await menu
      .getByRole("button", { name: "翻译选中内容", exact: true })
      .click();
    const inline = page.getByRole("dialog", { name: "就地阅读助手", exact: true });
    await expect(inline).toBeVisible();
    await expect(inline).toContainText("独立试验确认了观测趋势，并明确指出局限。");
    expect(inlineRequests).toHaveLength(1);
    expect(inlineRequests[0]).toMatchObject({ kind: "translation", page: 2, language: "zh-CN" });
    expect(inlineRequests[0].text).toContain("Independent trials");
    await expect(page.getByTestId("assistant-dock")).toHaveCount(0);
    await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue("2");
    expect(startedSessions).toHaveLength(1);
    expect(sent).toBe(1);
    await page.screenshot({
      path: info.outputPath("pdf-selection-assistant.png"),
    });
    await assertFits(page);
  });
  test("URL import dialog and recoverable import failure", async ({
    page,
  }, info) => {
    await nav(page, "导入");
    const dialog = page.getByRole("dialog");
    await page.screenshot({ path: info.outputPath("import.png") });
    await expect(
      dialog.getByRole("button", { name: "导入论文", exact: true }),
    ).toBeDisabled();
    await page.route("**/api/import", (route) =>
      route.fulfill({
        status: 400,
        json: { error: "The source could not be retrieved. Try another URL." },
      }),
    );
    await dialog.getByLabel("论文网址").fill("https://example.org/unavailable");
    await dialog.getByRole("button", { name: "导入论文", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Try another URL");
    await expect(
      dialog.getByRole("button", { name: "导入论文", exact: true }),
    ).toBeEnabled();
    await page.unroute("**/api/import");
    await dialog.getByLabel("论文网址").fill("https://example.org/new-paper");
    await dialog.getByRole("button", { name: "导入论文", exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: "Imported research paper",
        exact: true,
      }),
    ).toBeVisible();
    await expect(dialog).not.toBeVisible();
    await assertFits(page);
  });
  test("paper, full text, report export, chat, favorite and citation", async ({
    page,
  }, info) => {
    await page.getByText(title, { exact: true }).click();
    await expect(page.getByRole("tab", { name: "摘要" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    if (
      await page
        .getByRole("button", { name: "关闭助手", exact: true })
        .isVisible()
    )
      await page.getByRole("button", { name: "关闭助手", exact: true }).click();
    await page.getByRole("button", { name: "收藏论文", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "取消收藏", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /^(“\s*)?引用$/ }).click();
    await expect(page.getByRole("dialog").locator("pre")).toContainText(title);
    const citationDownload = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "下载 BibTeX", exact: true })
      .click();
    const citation = await citationDownload;
    expect(citation.suggestedFilename()).toBe("citation.bib");
    expect(await readFile((await citation.path())!, "utf8")).toContain(title);
    await page.getByRole("button", { name: "关闭引用" }).click();
    await page.getByRole("tab", { name: "论文", exact: true }).click();
    await expect(page.getByText(fullText, { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "摘要", exact: true }).click();
    await page
      .getByRole("button", { name: "生成原文摘录", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Research report", exact: true }),
    ).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载解读", exact: true }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.md$/);
    expect(await readFile((await file.path())!, "utf8")).toContain(
      "Strategy reweighting",
    );
    await page.screenshot({
      path: info.outputPath("paper-report.png"),
      fullPage: true,
    });
    await assertFits(page);
    await page.getByTitle("切换助手", { exact: true }).click();
    await page
      .getByLabel("向研究助手提问")
      .fill("What is the main contribution?");
    await page.getByLabel("问答处理方式", { exact: true }).selectOption("extractive");
    await page.getByRole("button", { name: "查找原文", exact: true }).click();
    await expect(
      page.getByText("strategy reweighting", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("paper-chat.png"),
      fullPage: false,
    });
    if (
      await page
        .getByRole("button", { name: "关闭助手", exact: true })
        .isVisible()
    )
      await page.getByRole("button", { name: "关闭助手", exact: true }).click();
    await nav(page, "收藏");
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  });
});

// A valid, text-only PDF generated in the test keeps integration independent of
// network availability and proprietary paper fixtures. No API routes are mocked.
async function researchPdf(
  page: Page,
  label: string,
  pageCount: number | boolean = 1,
): Promise<Buffer> {
  const document = await page.context().newPage();
  await document.setContent(
    (
      "<html><head><title>Integration Research Paper</title></head><body><h1>Integration Research Paper</h1><p>This experiment studies coverage and transfer in reasoning models.</p><p>The evaluation uses repeated trials and reports uncertainty.</p><p>Coverage improves under controlled conditions, with limited generalization.</p>" +
      Array.from(
        {
          length: Math.max(
            0,
            (typeof pageCount === "boolean" ? (pageCount ? 2 : 1) : pageCount) -
              1,
          ),
        },
        (_, index) =>
          `<section style="break-before:page"><h1>${index === 0 ? "Second page evidence" : `Page ${index + 2} evidence`}</h1><p>Independent trials confirm the observed trend with explicit limitations.</p><svg width="300" height="160" xmlns="http://www.w3.org/2000/svg"><rect width="90" height="100" y="60" fill="#8b4560"/><rect x="110" y="20" width="90" height="140" fill="#627fa9"/></svg></section>`,
      ).join("") +
      "</body></html>"
    ).replaceAll(
      "Integration Research Paper",
      "Integration Research Paper " + label,
    ),
  );
  const bytes = await document.pdf({ format: "A4" });
  await document.close();
  return bytes;
}

test("real backend: PDF upload, extractive report, question and persisted favorite", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "integration-research.pdf",
    mimeType: "application/pdf",
    buffer: await researchPdf(page, info.project.name),
  });
  await expect(page.getByRole("tab", { name: "摘要" })).toBeVisible();
  if (
    await page
      .getByRole("button", { name: "关闭助手", exact: true })
      .isVisible()
  )
    await page.getByRole("button", { name: "关闭助手", exact: true }).click();
  await page.getByRole("tab", { name: "论文", exact: true }).click();
  const renderedCanvas = page.locator(
    '.pdf-reader canvas[data-rendered="true"]',
  );
  await expect(renderedCanvas).toBeVisible();
  await expect(page.locator(".pdf-text-layer")).toContainText(
    "Integration Research Paper",
  );
  const ink = await renderedCanvas.evaluate((element: HTMLCanvasElement) => {
    const data = element
      .getContext("2d")!
      .getImageData(0, 0, element.width, element.height).data;
    let dark = 0,
      total = 0;
    for (let i = 0; i < data.length; i += 64) {
      total++;
      if (data[i] < 160 && data[i + 1] < 160 && data[i + 2] < 160) dark++;
    }
    return dark / total;
  });
  expect(ink).toBeGreaterThan(0.001);
  expect(ink).toBeLessThan(0.5);
  await page.screenshot({ path: info.outputPath("real-pdf-rendered.png") });
  const before = await page.getByLabel("PDF 缩放比例").innerText();
  await page.getByRole("button", { name: "放大 PDF", exact: true }).click();
  await expect(page.getByLabel("PDF 缩放比例")).not.toHaveText(before);
  await page.getByRole("button", { name: "适合宽度", exact: true }).click();
  await expect(renderedCanvas).toBeVisible();
  await page.getByRole("tab", { name: "摘要", exact: true }).click();
  await page.getByRole("button", { name: "生成原文摘录", exact: true }).click();
  await expect(page.getByText(/LOCAL EXTRACTIVE REPORT/)).toBeVisible();
  const favorite = page.getByRole("button", { name: "收藏论文", exact: true });
  if (await favorite.isVisible()) await favorite.click();
  await page.reload();
  await expect(page.getByRole("tab", { name: "摘要", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "取消收藏", exact: true }),
  ).toBeVisible();
  await page.getByTitle("切换助手", { exact: true }).click();
  await page
    .getByLabel("向研究助手提问")
    .fill("What does the evaluation measure?");
  await page.getByLabel("问答处理方式", { exact: true }).selectOption("extractive");
  await page.getByRole("button", { name: "查找原文", exact: true }).click();
  await expect(
    page.getByText("Local extractive mode · no model was called", {
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("real-pdf-chat.png"),
    fullPage: false,
  });
  await assertFits(page);
  await page.getByRole("button", { name: "p.1", exact: true }).last().click();
  await expect(
    page.getByRole("tab", { name: "论文", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "关闭助手", exact: true }).click();
  await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue("1");
  await expect(
    page.getByRole("button", { name: "上一页", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "下一页", exact: true }),
  ).toBeDisabled();
  await page.getByTitle("切换助手", { exact: true }).click();
  await page.getByRole("button", { name: "新对话", exact: true }).click();
  await expect(
    page.getByText("Local extractive mode · no model was called", {
      exact: true,
    }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "对话历史", exact: true })).toBeVisible();
  await expect(
    page.getByText("Local extractive mode · no model was called", {
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "对话历史", exact: true }).click();
  await page
    .getByRole("button", { name: /What does the evaluation measure/ })
    .click();
  await expect(
    page.getByText("Local extractive mode · no model was called", {
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("restored-conversation.png") });
  await assertFits(page);
});
