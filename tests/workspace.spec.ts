import { test, expect, type Page, type APIRequestContext, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function fixture(page: Page, request: APIRequestContext, name: string) {
  const renderer = await page.context().newPage();
  await renderer.setContent(`<html><head><title>Reading notebook ${name}</title><style>body{font:18px Georgia;margin:48px}section{break-before:page}h1,h2{font-size:25px}</style></head><body><h1>Reading notebook ${name}</h1><p>First evidence connects retrieval with reliable attribution.</p><p>The experiment compares controlled groups and preserves uncertainty.</p><section><h2>Second page: method</h2><p>Second evidence describes a controlled baseline comparison.</p><p>A separate validation dataset limits accidental overfitting.</p></section><section><h2>Third page: limits</h2><p>Third evidence cautions against broad claims without replication.</p></section></body></html>`);
  const buffer = await renderer.pdf({ format: "A4" });
  await renderer.close();
  const uploaded = await request.post("/api/upload", { multipart: { file: { name: `${name}.pdf`, mimeType: "application/pdf", buffer } } });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  const paper = (await uploaded.json()).paper;
  expect((await (await request.get("/api/health")).json()).modelConfigured).toBe(false);
  return paper;
}
async function closePanels(page: Page) {
  for (const label of ["关闭助手", "关闭笔记", "Close assistant", "Close notebook"]) {
    const close = page.getByRole("button", { name: label, exact: true });
    if (await close.isVisible()) await close.click();
  }
}
async function openReader(page: Page, id: string, pageNumber = 1) {
  await page.goto(`/zh/?paper=${id}`);
  await closePanels(page);
  await page.getByRole("tab", { name: "论文", exact: true }).click();
  await page.getByLabel("PDF 页码", { exact: true }).fill(String(pageNumber));
  await page.getByLabel("PDF 页码", { exact: true }).press("Enter");
  await expect(page.locator(`[data-pdf-page="${pageNumber}"] canvas[data-rendered="true"]`)).toBeVisible();
}
async function selectPassage(page: Page, pageNumber: number, prefix: string) {
  await page.getByLabel("PDF 页码", { exact: true }).fill(String(pageNumber));
  await page.getByLabel("PDF 页码", { exact: true }).press("Enter");
  const span = page.locator(`[data-pdf-page="${pageNumber}"] .pdf-text-layer span`).filter({ hasText: prefix }).first();
  await expect(span).toBeVisible();
  const menu = page.getByRole("dialog", { name: "选中文字操作", exact: true });
  // Select the actual PDF text nodes. Mobile native text selection is supplied by
  // the OS; this dispatches the same DOM selection/pointer events it produces.
  // Closing a desktop dock can replace the fit-width text layer. Resolve the
  // current text node again if that one render finishes during selection.
  await expect(async () => {
    await span.scrollIntoViewIfNeeded();
    await span.evaluate(element => {
      element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }));
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection()!;
      selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch" }));
    });
    await expect(menu).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 5000 });
  const quote = await page.evaluate(() => window.getSelection()!.toString().replace(/\s+/g, " ").trim());
  expect(quote).toContain(prefix);
  return { menu, quote };
}
async function annotations(request: APIRequestContext, id: string) {
  return (await (await request.get(`/api/papers/${id}/annotations`)).json()).annotations;
}
async function downloadText(page: Page, link: Locator) {
  const downloading = page.waitForEvent("download");
  await link.click();
  return readFile((await (await downloading).path())!, "utf8");
}
async function openNotebook(page: Page) {
  await page.getByTitle("笔记与批注", { exact: true }).click();
  const panel = page.getByRole("complementary", { name: "论文笔记", exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

test("highlights and notes survive reload and zoom, export exact content, and undo deletion", async ({ page, request }, info) => {
  const paper = await fixture(page, request, `annotations-${info.project.name}`);
  await openReader(page, paper.id, 2);
  const { menu, quote } = await selectPassage(page, 2, "Second evidence");
  await menu.getByRole("button", { name: "高亮选中内容", exact: true }).click();
  await expect.poll(async () => (await annotations(request, paper.id)).length).toBe(1);
  const highlight = (await annotations(request, paper.id))[0];
  expect(highlight.kind).toBe("highlight"); expect(highlight.page).toBe(2); expect(highlight.quote).toBe(quote);
  expect(highlight.rects.length).toBeGreaterThan(0);
  let panel = await openNotebook(page);
  await panel.locator(".notebook-card").filter({ hasText: quote }).click();
  await panel.getByLabel("笔记内容", { exact: true }).fill("Compare this baseline with the held-out validation set.");
  await panel.getByLabel("笔记标签", { exact: true }).fill("baseline, verify");
  await panel.getByRole("button", { name: "保存笔记", exact: true }).click();
  await expect.poll(async () => (await annotations(request, paper.id))[0].body).toContain("held-out validation");
  await panel.getByRole("button", { name: "blue", exact: true }).click();
  await expect.poll(async () => (await annotations(request, paper.id))[0].color).toBe("blue");
  const markdown = await downloadText(page, panel.getByRole("link", { name: "导出 Markdown", exact: true }));
  expect(markdown).toContain(quote); expect(markdown).toContain("[p.2]"); expect(markdown).toContain("held-out validation");
  const exported = JSON.parse(await downloadText(page, panel.getByRole("link", { name: "JSON", exact: true })));
  expect(exported.annotations[0].rects).toEqual(highlight.rects);
  expect(exported.annotations[0].tags).toEqual(["baseline", "verify"]);
  await page.reload();
  await closePanels(page);
  panel = await openNotebook(page);
  if (!(await panel.getByLabel("笔记内容", {exact:true}).isVisible()))
    await panel.locator(".notebook-card").filter({ hasText: quote }).click();
  await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue("2");
  await expect(panel.getByLabel("笔记内容", { exact: true })).toHaveValue("Compare this baseline with the held-out validation set.");
  await panel.getByRole("button", { name: "关闭笔记", exact: true }).click();
  const painted = page.locator(`[data-annotation-id="${highlight.id}"] rect`).first();
  await expect(painted).toBeVisible();
  await expect(painted).toHaveAttribute("x", String(highlight.rects[0].x));
  await page.getByRole("button", { name: "放大 PDF", exact: true }).click();
  await expect(painted).toHaveAttribute("x", String(highlight.rects[0].x));
  await expect(painted).toHaveAttribute("width", String(highlight.rects[0].width));
  await page.getByRole("button", { name: "适合宽度", exact: true }).click();
  panel = await openNotebook(page);
  // Mobile reopens the selected editor; return to the list before selecting it.
  await expect(panel.getByRole("button", { name: "收起编辑器", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "收起编辑器", exact: true }).click();
  await panel.locator(".notebook-card").filter({ hasText: quote }).click();
  await panel.getByRole("button", { name: "删除", exact: true }).click();
  await expect.poll(async () => (await annotations(request, paper.id)).length).toBe(0);
  await panel.getByRole("button", { name: "撤销", exact: true }).click();
  await expect.poll(async () => (await annotations(request, paper.id)).length).toBe(1);
  await panel.getByRole("button", { name: "新笔记", exact: true }).click();
  await panel.getByLabel("笔记内容", { exact: true }).fill("An independent paper-level note.");
  await panel.getByRole("button", { name: "保存笔记", exact: true }).click();
  await expect.poll(async () => (await annotations(request, paper.id)).filter((a: { kind: string }) => a.kind === "note").length).toBe(1);
  await page.screenshot({ path: info.outputPath("notebook-persistence.png") });
});

test("inline translation and explanation stay near the passage and have separate history", async ({ page, request }, info) => {
  const paper = await fixture(page, request, `inline-${info.project.name}`);
  const chatWrites: string[] = [];
  const calls: { kind: string; text: string; page: number; language: string }[] = [];
  page.on("request", req => { if (req.method() === "POST" && /\/api\/(?:chat|chats\/new)$/.test(new URL(req.url()).pathname)) chatWrites.push(req.url()); });
  // Simulate only the provider boundary. Persist the activity through the real
  // isolated backend so history/reload and Save to notes remain integration tests.
  await page.route('**/api/settings',route=>route.fulfill({json:{provider:'openai',baseUrl:'https://example.org/v1',model:'fixture-model',modelConfigured:true,apiKeyConfigured:false}}));
  await page.route(`**/api/papers/${paper.id}/assist`, async route => {
    const body = route.request().postDataJSON(); calls.push(body);
    const resultText = body.kind === "translation" ? "检索将证据与可靠归因联系起来。" : "这段说明了证据归因的作用，尚不能证明普遍有效。 [p.1]";
    const saved = await request.post(`/api/papers/${paper.id}/activities`, { data: { ...body, result: resultText, source: { agent: "E2E provider fixture" } } });
    expect(saved.ok()).toBeTruthy();
    const { activity } = await saved.json();
    await route.fulfill({ json: { result: activity.result, activity } });
  });
  await openReader(page, paper.id);
  const first = await selectPassage(page, 1, "First evidence");
  await first.menu.getByRole("button", { name: "翻译选中内容", exact: true }).click();
  let inline = page.getByRole("dialog", { name: "就地阅读助手", exact: true });
  await expect(inline).toContainText("检索将证据与可靠归因联系起来。");
  const bounds = (await inline.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
  await expect(page.locator(".assistant-dock")).toHaveCount(0);
  await inline.getByRole("button", { name: "保存到笔记", exact: true }).click();
  await expect(inline.getByRole("button", { name: "已保存", exact: true })).toBeDisabled();
  await inline.getByRole("button", { name: "关闭就地助手", exact: true }).click();
  const second = await selectPassage(page, 1, "First evidence");
  await second.menu.getByRole("button", { name: "解释选中内容", exact: true }).click();
  inline = page.getByRole("dialog", { name: "就地阅读助手", exact: true });
  await expect(inline).toContainText("尚不能证明普遍有效");
  await inline.getByRole("button", { name: "关闭就地助手", exact: true }).click();
  expect(calls.map(call => call.kind)).toEqual(["translation", "explanation"]);
  expect(calls[0].text).toBe(first.quote);
  expect(chatWrites).toEqual([]);
  expect((await annotations(request, paper.id)).map((a: { kind: string }) => a.kind)).toEqual(["translation"]);
  await page.reload(); await closePanels(page);
  await page.getByTitle("切换助手", { exact: true }).click();
  await page.getByRole("button", { name: "对话历史", exact: true }).click();
  const history = page.getByRole("region", { name: "阅读历史", exact: true });
  await history.getByRole("tab", { name: "翻译", exact: true }).click();
  await history.locator(".history-entry").filter({ hasText: first.quote }).click();
  await expect(history).toContainText("检索将证据与可靠归因联系起来。");
  await history.getByRole("tab", { name: "解释", exact: true }).click();
  await history.locator(".history-entry").filter({ hasText: second.quote }).click();
  await expect(history).toContainText("尚不能证明普遍有效");
  await history.getByRole("button", { name: "保存到笔记", exact: true }).click();
  await expect.poll(async () => (await annotations(request, paper.id)).map((a: { kind: string }) => a.kind).sort()).toEqual(["explanation", "translation"]);
  await history.getByRole("tab", { name: "问答", exact: true }).click();
  await expect(history).toContainText("此分类暂无记录");
  expect(chatWrites).toEqual([]);
  await page.screenshot({ path: info.outputPath("classified-reading-history.png") });
});

test("selection questions create separate sessions and switching history never carries another quote", async ({ page, request }, info) => {
  const paper = await fixture(page, request, `sessions-${info.project.name}`);
  await openReader(page, paper.id);
  const first = await selectPassage(page, 1, "First evidence");
  await first.menu.getByLabel("针对选中文字的问题").fill("问题一：这个证据说明什么？");
  await first.menu.getByRole("button", { name: "询问助手", exact: true }).click();
  await expect(page.locator(".selected-passage blockquote")).toHaveText(first.quote);
  const firstId = (await (await request.get(`/api/chats?paperId=${paper.id}`)).json()).conversationId;
  await page.getByLabel("问答处理方式", { exact: true }).selectOption("extractive");
  await page.getByLabel("向研究助手提问", { exact: true }).press("Enter");
  await expect.poll(async () => (await (await request.get(`/api/chats?paperId=${paper.id}`)).json()).messages.length).toBe(2);
  let messages = (await (await request.get(`/api/chats?paperId=${paper.id}`)).json()).messages;
  expect(messages[0].content).toContain(first.quote); expect(messages[0].content).toContain("[p.1]");
  await closePanels(page);
  const second = await selectPassage(page, 2, "Second evidence");
  await second.menu.getByLabel("针对选中文字的问题").fill("问题二：为什么需要基线？");
  await second.menu.getByRole("button", { name: "询问助手", exact: true }).click();
  await expect(page.locator(".selected-passage blockquote")).toHaveText(second.quote);
  const secondId = (await (await request.get(`/api/chats?paperId=${paper.id}`)).json()).conversationId;
  expect(secondId).not.toBe(firstId);
  // Switch away from a draft carrying a quote before sending it.
  await page.getByRole("button", { name: "对话历史", exact: true }).click();
  await page.locator(".reading-history .history-entry").filter({ hasText: "问题一：" }).click();
  await expect(page.locator(".selected-passage")).toHaveCount(0);
  await expect(page.getByLabel("向研究助手提问", { exact: true })).toHaveValue("");
  await expect(page.locator(".conversation")).toContainText(first.quote);
  // Extractive answers may legitimately cite multiple pages of the same paper;
  // only the user's question and quoted passage must stay session-specific.
  await expect(page.locator(".conversation .message.user")).not.toContainText(second.quote);
  await closePanels(page);
  const third = await selectPassage(page, 2, "Second evidence");
  await third.menu.getByLabel("针对选中文字的问题").fill("问题三：基线是否公平？");
  await third.menu.getByRole("button", { name: "询问助手", exact: true }).click();
  await page.getByLabel("问答处理方式", { exact: true }).selectOption("extractive");
  await page.getByLabel("向研究助手提问", { exact: true }).press("Enter");
  await expect.poll(async () => (await (await request.get(`/api/chats?paperId=${paper.id}`)).json()).messages.length).toBe(2);
  messages = (await (await request.get(`/api/chats?paperId=${paper.id}`)).json()).messages;
  expect(messages[0].content).toContain(second.quote); expect(messages[0].content).not.toContain(first.quote);
  const history = (await (await request.get(`/api/conversations?paperId=${paper.id}`)).json()).conversations;
  expect(history.filter((entry: { messageCount: number }) => entry.messageCount === 2)).toHaveLength(2);
  expect(history.every((entry: { kind: string }) => entry.kind === "question")).toBe(true);
});

test("one overview preserves versions, focus, reading style and Chinese-English routes", async ({ page, request }, info) => {
  const paper = await fixture(page, request, `versions-${info.project.name}`);
  const first = await request.put(`/api/papers/${paper.id}/insights`, { data: {
    source: { agent: "Codex" }, style: "quick", focus: "Only the central claim",
    summary: { language: "en", markdown: "## First quick overview\n\nThe evidence is promising but limited. [p.1]" },
    translations: [{ target: "summary", language: "zh-CN", markdown: "## 第一版快速解读\n\n证据值得注意，但仍然有限。[p.1]" }],
  } });
  expect(first.ok()).toBeTruthy();
  const firstId = (await first.json()).paper.activeReadingId;
  const second = await request.put(`/api/papers/${paper.id}/insights`, { data: {
    source: { agent: "Claude" }, style: "deep", focus: "训练设置与关键对照",
    summary: { language: "zh-CN", markdown: "## 第二版深入研读\n\n验证集与训练集必须分开。[p.2]" },
  } });
  const secondId = (await second.json()).paper.activeReadingId;
  await page.goto(`/zh/?paper=${paper.id}`); await closePanels(page);
  await expect(page.locator(".reading-prose")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "第二版深入研读", exact: true })).toBeVisible();
  await page.locator(".reading-version-details > summary").click();
  await expect(page.locator(".reading-version-detail-body")).toContainText("深入研读");
  await expect(page.locator(".reading-focus-record")).toContainText("训练设置与关键对照");
  await page.locator(".reading-version-details > summary").click();
  await page.getByLabel("解读版本", { exact: true }).selectOption(firstId);
  await expect(page.getByRole("heading", { name: "第一版快速解读", exact: true })).toBeVisible();
  await page.locator(".reading-version-details > summary").click();
  await expect(page.locator(".reading-version-detail-body")).toContainText("快速了解");
  await expect(page.locator(".reading-focus-record")).toContainText("Only the central claim");
  await page.reload(); await closePanels(page);
  await expect(page.getByLabel("解读版本", { exact: true })).toHaveValue(firstId);
  await page.getByLabel("阅读语言", { exact: true }).selectOption("en");
  await expect(page).toHaveURL(new RegExp(`/en/\\?paper=${paper.id}`));
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "First quick overview", exact: true })).toBeVisible();
  await expect(page.getByLabel("Reading version", { exact: true })).toHaveValue(firstId);
  await expect(page.getByRole("tab", { name: "Paper", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New version", exact: true }).click();
  await page.getByRole("radio", { name: /Critical read/ }).click();
  await page.getByLabel("Reading focus", { exact: true }).fill("Check comparable baselines and reproducibility.");
  await page.getByRole("button", { name: "Create source excerpts", exact: true }).click();
  await expect.poll(async () => (await (await request.get(`/api/papers/${paper.id}`)).json()).paper.readingVersions.length).toBe(3);
  await expect(page.locator(".reading-prose")).toHaveCount(1);
  await page.locator(".reading-version-details > summary").click();
  await expect(page.locator(".reading-version-detail-body")).toContainText("Critical read");
  await page.locator(".reading-version-details > summary").click();
  const saved = (await (await request.get(`/api/papers/${paper.id}`)).json()).paper;
  expect(saved.readingVersions.map((version: { id: string }) => version.id)).toEqual(expect.arrayContaining([firstId, secondId]));
  expect(saved.readingVersions.find((version: { id: string }) => version.id === saved.activeReadingId).focus).toBe("Check comparable baselines and reproducibility.");
  await page.getByLabel("Reading language", { exact: true }).selectOption("zh-CN");
  await expect(page).toHaveURL(new RegExp(`/zh/\\?paper=${paper.id}`));
  await expect(page.getByLabel("解读版本", { exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "论文", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("unified-versioned-reading.png") });
});

test("handwriting can be drawn, saved and restored with normalized geometry", async ({ page, request }, info) => {
  const paper = await fixture(page, request, `ink-${info.project.name}`);
  await openReader(page, paper.id);
  await page.getByRole("button", { name: "手写", exact: true }).click();
  const canvas = page.locator('[data-pdf-page="1"] .reader-ink-input');
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width * .22, y = Math.max(box.y + 35, box.y + box.height * .15);
  // Pointer events are generated by real mouse input even in touch-sized layouts.
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + Math.min(90, box.width * .25), y + 30, { steps: 12 });
  await page.mouse.move(x + Math.min(140, box.width * .4), y + 10, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "保存手写", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "保存手写", exact: true }).click();
  await expect.poll(async () => (await annotations(request, paper.id)).filter((a: { kind: string }) => a.kind === "ink").length).toBe(1);
  const ink = (await annotations(request, paper.id))[0];
  expect(ink.strokes[0].points.length).toBeGreaterThan(5);
  expect(ink.strokes[0].points.every((p: { x: number; y: number }) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)).toBe(true);
  await page.reload(); await closePanels(page);
  await page.getByRole("tab", { name: "论文", exact: true }).click();
  await expect(page.locator(`[data-annotation-id="${ink.id}"] path`)).toBeVisible();
  await expect(page.locator(`[data-annotation-id="${ink.id}"] path`)).toHaveAttribute("stroke-width", String(ink.strokes[0].width));
  const panel = await openNotebook(page);
  await panel.getByRole("tab", { name: "手写", exact: true }).click();
  await expect(panel.locator(".notebook-card")).toHaveCount(1);
  await expect(panel.locator(".notebook-card")).toContainText("手写笔迹");
});

test("late translation responses cannot rewind a newer reading selection", async ({ page, request }, info) => {
  const paper = await fixture(page, request, `translation-race-${info.project.name}`);
  const imported = [];
  for (const [language, markdown] of [["en", "## Fast overview\n\nA limited but useful result."], ["zh-CN", "## 详细解读\n\n严格区分训练和验证数据。"]]) {
    const saved = await request.put(`/api/papers/${paper.id}/insights`, { data: { source: { agent: "Codex" }, summary: { language, markdown } } });
    expect(saved.ok()).toBeTruthy(); imported.push((await saved.json()).paper.activeReadingId);
  }
  const [firstId, secondId] = imported;
  const settings = await (await request.get("/api/settings")).json();
  await page.route("**/api/settings", route => route.fulfill({ json: { ...settings, modelConfigured: true } }));
  let releaseTranslation!: () => void;
  const blocked = new Promise<void>(resolve => { releaseTranslation = resolve; });
  let markStarted!: () => void;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  await page.route(`**/api/papers/${paper.id}/translate`, async route => {
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({ target: "reading", readingId: secondId, language: "en" });
    const saved = await request.put(`/api/papers/${paper.id}/insights`, { data: {
      source: { agent: "E2E translation fixture" },
      translations: [{ target: "reading", readingId: secondId, language: "en", markdown: "## Delayed deep translation\n\nKeep training and validation separate." }],
    } });
    const snapshot = (await saved.json()).paper;
    const translation = snapshot.readingVersions.find((version: { id: string }) => version.id === secondId).translations.en;
    markStarted(); await blocked;
    await route.fulfill({ json: { paper: snapshot, translation } });
  });
  await page.goto(`/en/?paper=${paper.id}`); await closePanels(page);
  const selector = page.getByLabel("Reading version", { exact: true });
  await expect(selector).toHaveValue(secondId);
  await page.getByRole("button", { name: "Translate this version", exact: true }).click();
  await started;
  // Serializing selection while an operation saves is also a valid solution.
  const canSwitchDuringTranslation = await selector.isEnabled();
  if (canSwitchDuringTranslation) {
    await selector.selectOption(firstId);
    await expect.poll(async () => (await (await request.get(`/api/papers/${paper.id}`)).json()).paper.activeReadingId).toBe(firstId);
  }
  const completed = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith(`/api/papers/${paper.id}/translate`));
  releaseTranslation();
  await (await completed).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  if (!canSwitchDuringTranslation) {
    await expect(selector).toBeEnabled();
    await selector.selectOption(firstId);
  }
  // Immediate assertion catches a stale response even if a later poll would
  // eventually repair it by re-fetching the server's correct active version.
  expect(await selector.inputValue()).toBe(firstId);
  await expect(page.getByRole("heading", { name: "Fast overview", exact: true })).toBeVisible();
  await page.reload(); await closePanels(page);
  await expect(page.getByLabel("Reading version", { exact: true })).toHaveValue(firstId);
  await page.getByLabel("Reading version", { exact: true }).selectOption(secondId);
  await expect(page.getByRole("heading", { name: "Delayed deep translation", exact: true })).toBeVisible();
});
