import { expect, test, type Page } from "@playwright/test";

async function openPaper(page: Page, width = 1440, height = 900, longConversation = false) {
  await page.setViewportSize({ width, height });
  const fixture = await page.context().newPage();
  await fixture.setContent(`<html><body>${Array.from({ length: 6 }, (_, i) => `<section style="break-before:${i ? "page" : "auto"}"><h1>Dock reader page ${i + 1}</h1><p>Evidence remains visible while the research assistant changes width.</p></section>`).join("")}</body></html>`);
  const pdf = await fixture.pdf({ format: "A4" });
  await fixture.close();
  const paper = { id: "dock-paper", title: "Dock reading fixture", authors: ["Research Team"], abstract: "A reproducible research document.", text: "Evidence remains visible.", source: "pdf", url: "https://example.org/paper", pdfUrl: "/dock-fixture.pdf", pageCount: 6, createdAt: "2026-10-22T00:00:00Z", tags: [] };
  await page.route("**/dock-fixture.pdf", route => route.fulfill({ contentType: "application/pdf", body: pdf }));
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    const messages = longConversation ? Array.from({ length: 24 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `Research message ${i + 1}: ${"The source evidence needs careful comparison with its limitations. ".repeat(5)}` })) : [];
    const result = path === "/api/settings" ? { provider: "openai", baseUrl: "https://api.example.org/v1", model: "research-model", apiKeyConfigured: false, modelConfigured: false } : path === "/api/papers" ? { papers: [paper] } : path === "/api/papers/dock-paper" ? { paper } : path === "/api/chats" ? { messages, conversationId: null } : path === "/api/conversations" ? { conversations: [] } : {};
    return route.fulfill({ json: result });
  });
  await page.goto("/?paper=dock-paper");
  await page.getByRole("tab", { name: "论文", exact: true }).click();
  await expect(page.locator('.pdf-reader canvas[data-rendered="true"]').first()).toBeVisible();
}

async function openDock(page: Page) {
  await page.getByRole("button", { name: "打开悬浮助手", exact: true }).click();
  await expect(page.getByTestId("assistant-dock")).toBeVisible();
}

async function fitsViewport(page: Page, locator = page.getByLabel("向研究助手提问")) {
  const bounds = (await locator.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
}

test("wide dock reserves reading space and keyboard/drag resize preserves the page", async ({ page }) => {
  await openPaper(page);
  await page.getByLabel("PDF 页码", { exact: true }).fill("4");
  await expect(page.locator('[data-pdf-page="4"] canvas[data-rendered="true"]')).toBeVisible();
  await openDock(page);
  const dock = page.getByTestId("assistant-dock");
  const rect = (await dock.boundingBox())!;
  expect(rect.width).toBeGreaterThanOrEqual(560);
  expect(rect.height).toBeGreaterThanOrEqual(850);
  expect((await page.locator(".pdf-reader").boundingBox())!.x + (await page.locator(".pdf-reader").boundingBox())!.width).toBeLessThanOrEqual(rect.x);
  await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue("4");
  const separator = page.getByRole("separator", { name: "调整助手宽度" });
  await separator.focus();
  await separator.press("ArrowRight");
  await expect.poll(async () => (await dock.boundingBox())!.width).toBeLessThan(rect.width);
  const beforeDrag = (await dock.boundingBox())!.width;
  const grip = (await separator.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x - 48, grip.y + grip.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await dock.boundingBox())!.width).toBeGreaterThan(beforeDrag);
  await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue("4");
  await fitsViewport(page);
  await page.getByRole("button", { name: "关闭助手", exact: true }).click();
  await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue("4");
  await expect(page.getByRole("button", { name: "打开悬浮助手", exact: true })).toBeVisible();
});

test("narrow startup grows into a wide desktop dock and keeps drafts through overlays", async ({ page }) => {
  await openPaper(page, 670, 608);
  await openDock(page);
  await page.getByLabel("向研究助手提问").fill("请比较这段证据与论文结论。");
  await fitsViewport(page);
  await fitsViewport(page, page.getByRole("button", { name: "关闭助手", exact: true }));
  await fitsViewport(page, page.getByLabel("切换当前模型"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(async () => (await page.getByTestId("assistant-dock").boundingBox())!.width).toBeGreaterThanOrEqual(560);
  await page.getByRole("button", { name: "关闭助手", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 608 });
  await openDock(page);
  const rect = (await page.getByTestId("assistant-dock").boundingBox())!;
  expect(rect).toMatchObject({ x: 0, y: 0, width: 390, height: 608 });
  await expect(page.getByLabel("向研究助手提问")).toHaveValue("请比较这段证据与论文结论。");
  await fitsViewport(page);
  await fitsViewport(page, page.getByRole("button", { name: "关闭助手", exact: true }));
  await fitsViewport(page, page.getByLabel("切换当前模型"));
  await page.getByRole("button", { name: "返回论文", exact: true }).click();
  await expect(page.getByTestId("assistant-dock")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "论文", exact: true })).toHaveAttribute("aria-selected", "true");
});

test("long conversation scrolls inside the dock while composer and close stay visible", async ({ page }) => {
  await openPaper(page, 1440, 900, true);
  await openDock(page);
  const conversation = page.locator(".assistant-dock .conversation");
  await expect.poll(() => conversation.evaluate(e => e.scrollHeight > e.clientHeight)).toBeTruthy();
  const before = (await page.getByLabel("向研究助手提问").boundingBox())!;
  await conversation.evaluate(e => { e.scrollTop = 0; });
  const after = (await page.getByLabel("向研究助手提问").boundingBox())!;
  expect(after.y).toBeCloseTo(before.y, 1);
  for (const width of [670, 390]) {
    await page.setViewportSize({ width, height: 608 });
    await fitsViewport(page);
    await fitsViewport(page, page.getByRole("button", { name: "关闭助手", exact: true }));
    await fitsViewport(page, page.getByLabel("切换当前模型"));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
});
