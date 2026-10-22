import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { readFile } from "node:fs/promises";

async function paperFixture(
  page: Page,
  request: APIRequestContext,
  name: string,
) {
  const renderer = await page.context().newPage();
  await renderer.setContent(
    `<html><head><title>Subscription Reading ${name}</title></head><body><h1>Subscription Reading ${name}</h1><p>Original English abstract: controlled trials show improved coverage with uncertainty.</p><p>The experiment compares two groups and requires independent validation.</p><section style="break-before:page"><h2>Figure 1: Controlled results</h2><svg width="400" height="180"><rect x="20" y="50" width="110" height="120" fill="#8b4560"/><rect x="180" y="10" width="110" height="160" fill="#627fa9"/></svg><p>Measured evidence appears on this second page.</p></section></body></html>`,
  );
  const buffer = await renderer.pdf({ format: "A4" });
  await renderer.close();
  const response = await request.post("/api/upload", {
    multipart: {
      file: { name: `${name}.pdf`, mimeType: "application/pdf", buffer },
    },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).paper;
}
async function closeAssistant(page: Page) {
  const close = page.getByRole("button", { name: "关闭助手", exact: true });
  if (await close.isVisible()) await close.click();
}
async function insights(request: APIRequestContext, id: string, body: unknown) {
  const response = await request.put(`/api/papers/${id}/insights`, {
    data: body,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).paper;
}

test("subscription-only reading: JSON import, translation, original and inline figure", async ({
  page,
  request,
}, info) => {
  const paper = await paperFixture(
    page,
    request,
    `illustrated-${info.project.name}`,
  );
  const health = await (await request.get("/api/health")).json();
  expect(health.modelConfigured).toBe(false);
  const generationRequests: string[] = [];
  page.on("request", (req) => {
    if (
      req.method() === "POST" &&
      /\/(report|translate|chat)$/.test(new URL(req.url()).pathname)
    )
      generationRequests.push(req.url());
  });
  await page.goto(`/?paper=${paper.id}`);
  await closeAssistant(page);
  await page.locator(".reading-tools")
    .getByRole("button", { name: "用 Codex / Claude", exact: true })
    .click();
  const prompt = await page.getByLabel("代理任务").inputValue();
  expect(prompt).toContain(paper.id);
  expect(prompt).toContain("不调用工作台模型生成接口");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载通用 Skill" }).click();
  const skill = await download;
  const skillText = await readFile((await skill.path())!, "utf8");
  expect(skillText).toContain("current agent session");
  expect(skillText).toContain("/api/papers/:id/insights");
  const longChineseAbstract =
    "受控实验显示覆盖率提高，但样本仍有限，必须进一步核对证据。".repeat(12);
  expect(longChineseAbstract.length).toBeLessThan(480);
  const payload = {
    source: { agent: "Codex" },
    summary: {
      language: "zh-CN",
      markdown:
        "## 本次实验的中文解读\n\n两组结果有差异，但仍需独立验证。[p.2]\n\n:::figure result-figure\n\n## 解读之后\n\n不要把有限样本当作普遍规律。",
    },
    translations: [
      { target: "abstract", language: "zh-CN", markdown: longChineseAbstract },
    ],
    figures: [
      {
        id: "result-figure",
        page: 2,
        crop: { x: 0.05, y: 0.05, width: 0.8, height: 0.35 },
        caption: "实验对照图：结论仍需独立验证。",
      },
    ],
  };
  await page
    .locator('.agent-bridge input[type="file"]')
    .setInputFiles({
      name: "insights.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(payload)),
    });
  await expect(
    page.getByRole("heading", { name: "本次实验的中文解读" }),
  ).toBeVisible();
  await expect(page.locator(".abstract-section")).toContainText(
    longChineseAbstract,
  );
  const expandAbstract = page.getByRole("button", {
    name: "展开摘要",
    exact: true,
  });
  await expect(expandAbstract).toBeVisible();
  await expandAbstract.click();
  await expect(
    page.getByRole("button", { name: "收起摘要", exact: true }),
  ).toBeVisible();
  const abstractDimensions = await page
    .locator(".abstract-text")
    .evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }));
  expect(abstractDimensions.scroll).toBeLessThanOrEqual(
    abstractDimensions.client + 1,
  );
  // The figure is placed in reading order, not deferred to an unrelated gallery.
  const figure = page
    .locator(".reading-prose figure")
    .filter({ hasText: "实验对照图：结论仍需独立验证。" })
    .first();
  await expect(figure).toHaveClass(/is-crop/);
  await figure.scrollIntoViewIfNeeded();
  await expect(figure.locator('canvas[data-rendered="true"]')).toBeVisible();
  const order = await figure.evaluate((el) => {
    const following = [...document.querySelectorAll("h2")].find(
      (h) => h.getAttribute('aria-label') === "解读之后",
    );
    return (
      !!following &&
      !!(
        el.compareDocumentPosition(following) & Node.DOCUMENT_POSITION_FOLLOWING
      )
    );
  });
  expect(order).toBe(true);
  expect(
    await figure
      .locator("canvas")
      .evaluate((canvas: HTMLCanvasElement) => canvas.width / canvas.height),
  ).toBeGreaterThan(1.5);
  await expect(
    page.getByText(":::figure result-figure", { exact: true }),
  ).toHaveCount(0);
  const enlarge = figure.getByRole("button", { name: "放大第 2 页图表" });
  await enlarge.click();
  const preview = page.getByRole("dialog", { name: "论文原图 · 第 2 页" });
  await expect(preview).toBeVisible();
  const enlargedCanvas = preview.locator('canvas[data-rendered="true"]');
  await expect(enlargedCanvas).toBeVisible();
  const initialWidth = await enlargedCanvas.evaluate(el => el.getBoundingClientRect().width);
  await preview.getByRole("button", { name: "放大图表", exact: true }).click();
  await expect(preview.getByRole("button", { name: "图表适应窗口" })).toHaveText("125%");
  await expect.poll(() => enlargedCanvas.evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(initialWidth * 1.2);
  await expect(enlargedCanvas).toBeVisible();
  const panArea = preview.locator('.pdf-figure-lightbox-scroll');
  const panBounds = (await panArea.boundingBox())!;
  const originalLeft = await panArea.evaluate(el => el.scrollLeft);
  await page.mouse.move(panBounds.x + panBounds.width * .65, panBounds.y + Math.min(120, panBounds.height / 2));
  await page.mouse.down();
  await page.mouse.move(panBounds.x + panBounds.width * .45, panBounds.y + Math.min(120, panBounds.height / 2), {steps: 12});
  await page.mouse.up();
  await expect.poll(() => panArea.evaluate(el => el.scrollLeft)).toBeGreaterThan(originalLeft + 5);
  const cropDownload = page.waitForEvent('download');
  await preview.getByRole('button', {name:'下载原图裁切', exact:true}).click();
  const png = await readFile((await (await cropDownload).path())!);
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect(png.readUInt32BE(16) / png.readUInt32BE(20)).toBeGreaterThan(1.5);
  const cropRatio = await enlargedCanvas.evaluate((el: HTMLCanvasElement) => el.width / el.height);
  expect(cropRatio).toBeGreaterThan(1.5);
  const dialogBox = await preview.boundingBox();
  expect(dialogBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await preview.getByRole("button", { name: "图表适应窗口" }).click();
  await expect(preview.getByRole("button", { name: "图表适应窗口" })).toHaveText("100%");
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await expect(enlarge).toBeFocused();
  const figureTop = await figure.evaluate(el => el.getBoundingClientRect().top);
  await enlarge.click();
  await preview.getByRole('button', {name:'图表来自 p.2', exact:true}).click();
  await expect(preview).toHaveCount(0);
  await expect(page.getByLabel('PDF 页码', {exact:true})).toHaveValue('2');
  await page.getByRole('button', {name:'返回摘要阅读位置',exact:true}).click();
  await expect.poll(() => figure.evaluate(el => el.getBoundingClientRect().top)).toBeCloseTo(figureTop, 0);

  const after = await (await request.get(`/api/papers/${paper.id}`)).json();
  expect(after.paper.abstract).toBe(paper.abstract);
  expect(after.paper.summary.source.kind).toBe("agent");
  await page
    .getByRole("button", { name: "查看原文", exact: true })
    .first()
    .click();
  await expect(page.locator(".abstract-section")).toContainText(paper.abstract);
  await page.getByRole("button", { name: "返回译文", exact: true }).click();
  await page.getByLabel("阅读语言").selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveURL(new RegExp(`/en/\\?paper=${paper.id}`));
  await expect(page.locator(".reading-overview .translation-missing")).toContainText(
    "This version has no translation in the selected language",
  );
  await expect(page.getByRole("heading", { name: "本次实验的中文解读" })).toBeVisible();
  await page.getByLabel("Reading language").selectOption("zh-CN");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await page.screenshot({
    path: info.outputPath("subscription-illustrated.png"),
    fullPage: false,
  });
  expect(generationRequests).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});

test("external translations preserve immutable versions and flag stale legacy translations", async ({
  page,
  request,
}, info) => {
  const paper = await paperFixture(page, request, `translation-${info.project.name}`);
  const original = await insights(request, paper.id, {
    source: { agent: "Claude Code" },
    summary: {
      language: "zh-CN",
      markdown: "## 初版中文解读\n第一次受控实验的结果。[p.2]",
    },
    translations: [{ target: "summary", language: "en", markdown: "## First English reading\nA first controlled result. [p.2]" }],
  });
  const firstVersion = original.activeReadingId;
  expect(firstVersion).toBeTruthy();
  await page.goto(`/en/?paper=${paper.id}`);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "First English reading" })).toBeVisible();
  await expect(page.locator(".reading-overview")).toHaveCount(1);
  const changed = await insights(request, paper.id, {
    source: { agent: "Codex" },
    summary: {
      language: "zh-CN",
      markdown: "## 修订后的中文解读\n不确定性比最初估计更大。[p.2]",
    },
  });
  expect(changed.translations.en.summary.stale).toBe(true);
  expect(changed.summaryHistory[0].markdown).toContain("初版中文解读");
  // A translation remains valid for its immutable source revision. It must not
  // silently become the translation of a newly generated reading.
  expect(changed.readingVersions.find((version: any) => version.id === firstVersion).translations.en.markdown).toContain("First English reading");
  expect(changed.activeReadingId).not.toBe(firstVersion);
  await page.reload();
  await expect(page.getByRole("heading", { name: "修订后的中文解读" })).toBeVisible();
  await expect(page.locator(".reading-overview .translation-missing")).toContainText("This version has no translation in the selected language");
  await expect(page.getByRole("heading", { name: "First English reading" })).toHaveCount(0);
  await page.getByLabel("Reading version").selectOption(firstVersion);
  await expect(page.getByRole("heading", { name: "First English reading" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "修订后的中文解读" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("Reading version")).toHaveValue(firstVersion);
  await expect(page.getByRole("heading", { name: "First English reading" })).toBeVisible();
  await page.getByRole("button", { name: "Show original", exact: true }).click();
  await expect(page.getByRole("heading", { name: "初版中文解读" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "First English reading" })).toHaveCount(0);
});

test("external subscription answer is persisted and visible without API key", async ({
  page,
  request,
}, info) => {
  const paper = await paperFixture(
    page,
    request,
    `answer-${info.project.name}`,
  );
  const response = await request.post("/api/chats/import", {
    data: {
      paperId: paper.id,
      question: "这项实验有什么限制？",
      answer: "当前样本不能建立普遍结论，需要独立验证。[p.2]",
      source: { agent: "Codex" },
    },
  });
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).message.source.kind).toBe("agent");
  await page.goto(`/?paper=${paper.id}`);
  if (!(await page.getByLabel("向研究助手提问").isVisible()))
    await page.getByTitle("切换助手", { exact: true }).click();
  await expect(
    page.getByText("这项实验有什么限制？", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("当前样本不能建立普遍结论，需要独立验证。", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /用 Codex \/ Claude 订阅回答/ }),
  ).toBeVisible();
  const chat = await (
    await request.get(`/api/chats?paperId=${paper.id}`)
  ).json();
  expect(chat.messages).toHaveLength(2);
  expect(chat.messages[1].source.agent).toBe("Codex");
  expect(
    (await (await request.get("/api/health")).json()).modelConfigured,
  ).toBe(false);
});
