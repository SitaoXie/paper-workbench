import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

async function fixture(page: Page, request: APIRequestContext, name: string) {
  const renderer = await page.context().newPage();
  await renderer.setContent(`<html><head><title>${name}</title><style>body{font:18px Georgia;margin:48px}section{break-before:page}p{line-height:1.6}</style></head><body>
    <h1>${name}</h1><p>Replication is required before general claims.</p><p>Local reading starts here.</p>
    <section><h2>Second page</h2><p>Methods and measured uncertainty.</p></section>
    <section><h2>Third page</h2><p>Distantneedle occurs only on this initially unrendered page.</p><p>Replication provides a separate check.</p><p><span>cross</span><b>span</b> preserves offsets.</p><p>inter-<br>operability connects the two lines.</p><p>跨页检索 中文研究</p></section>
    <section><h2>Fourth page</h2><p>Independent limitations and future work.</p></section>
    <section><h2>Fifth page</h2><p>Replication can reveal changed conditions.</p></section>
  </body></html>`);
  const buffer = await renderer.pdf({ format: "A4" }); await renderer.close();
  const uploaded = await request.post("/api/upload", { multipart: { file: { name: `${name}.pdf`, mimeType: "application/pdf", buffer } } });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  return (await uploaded.json()).paper;
}
async function openReader(page: Page, paperId: string, language = "en") {
  await page.goto(`/${language}/?paper=${paperId}`);
  for (const label of ["Close assistant", "关闭助手", "Close notebook", "关闭笔记"]) {
    const close = page.getByRole("button", { name: label, exact: true }); if (await close.isVisible()) await close.click();
  }
  await page.getByRole("tab", { name: language === "en" ? "Paper" : "论文", exact: true }).click();
  await expect(page.locator('[data-pdf-page="1"] canvas[data-rendered="true"]')).toBeVisible();
}
async function openSearch(page: Page, language = "en") {
  await page.getByRole("button", { name: language === "en" ? "Find in PDF" : "查找 PDF 正文", exact: true }).click();
  const input = page.getByRole("searchbox", { name: language === "en" ? "Find in PDF text" : "在 PDF 正文中查找", exact: true });
  await expect(input).toBeFocused(); return input;
}

test("full PDF find locates an unrendered third page, highlights source text and returns to the reading position", async ({ page, request }, info) => {
  const paper = await fixture(page, request, `Full text ${info.project.name}`);
  const inference: string[] = [];
  page.on("request", req => { if (req.method() === "POST" && /\/(assist|chat|report|translate)$/.test(new URL(req.url()).pathname)) inference.push(req.url()); });
  await openReader(page, paper.id);
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Zoom in PDF", exact: true }).click();
  await expect(page.locator('[data-pdf-page="3"] canvas')).toHaveCount(0);
  const viewport = page.getByLabel("Continuous paper pages", { exact: true });
  const previousTop = await viewport.evaluate(element => element.scrollTop);
  const input = await openSearch(page);
  await input.fill("distantneedle");
  await expect(page.getByLabel("Search result count", { exact: true })).toHaveText("1 / 1");
  await expect(page.getByLabel("PDF page number", { exact: true })).toHaveValue("3");
  const highlights = page.locator('[data-pdf-page="3"] .pdf-search-highlight');
  await expect(highlights.first()).toBeVisible();
  const rect = await highlights.first().boundingBox(); expect(rect!.width).toBeGreaterThan(5); expect(rect!.height).toBeGreaterThan(5);
  await page.getByRole("button", { name: "Close PDF search", exact: true }).click();
  await expect(page.locator(".pdf-search-highlight")).toHaveCount(0);
  await page.getByRole("button", { name: "Back to previous position", exact: true }).click();
  await expect(page.getByLabel("PDF page number", { exact: true })).toHaveValue("1");
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeCloseTo(previousTop, 0);
  expect(inference).toEqual([]);
});

test("PDF find supports span boundaries, wrapped hyphens, Chinese, keyboard cycling and no-result clearing", async ({ page, request }, info) => {
  const paper = await fixture(page, request, `Find controls ${info.project.name}`);
  await openReader(page, paper.id);
  const input = await openSearch(page);
  await input.fill("crossspan");
  await expect(page.getByLabel("Search result count", { exact: true })).toHaveText("1 / 1");
  await expect(page.getByLabel("PDF page number", { exact: true })).toHaveValue("3");
  await expect.poll(() => page.locator('[data-pdf-page="3"] .pdf-search-highlight').count()).toBeGreaterThanOrEqual(2);
  await input.fill("interoperability");
  await expect(page.getByLabel("Search result count", { exact: true })).toHaveText("1 / 1");
  await expect.poll(() => page.locator('[data-pdf-page="3"] .pdf-search-highlight').count()).toBeGreaterThanOrEqual(2);
  await input.fill("中文");
  await expect(page.getByLabel("Search result count", { exact: true })).toHaveText("1 / 1");
  await input.fill("replication");
  await expect(page.getByLabel("Search result count", { exact: true })).toHaveText("1 / 3");
  await input.press("Enter");
  await expect(page.getByLabel("Search result count", { exact: true })).toHaveText("2 / 3");
  await expect(page.getByLabel("PDF page number", { exact: true })).toHaveValue("3");
  await input.press("Shift+Enter");
  await expect(page.getByLabel("Search result count", { exact: true })).toHaveText("1 / 3");
  await expect(page.getByLabel("PDF page number", { exact: true })).toHaveValue("1");
  await input.fill("no_such_unique_phrase");
  await expect(page.getByText("No matches in extracted text", { exact: true })).toBeVisible();
  await expect(page.locator(".pdf-search-highlight")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Next result", exact: true })).toBeDisabled();
  await input.fill("");
  await expect(page.getByLabel("Search result count", { exact: true })).toHaveText("0 / 0");
  await input.press("Escape");
  await expect(input).toHaveCount(0);
});

test("PDF search shortcuts stay inside the active reader and changing documents clears the old query", async ({ page, request }, info) => {
  const first = await fixture(page, request, `First searchable ${info.project.name}`);
  const second = await fixture(page, request, `Second searchable ${info.project.name}`);
  await openReader(page, first.id, "zh");
  if (info.project.name === "desktop") await page.keyboard.press("ControlOrMeta+f");
  else await openSearch(page, "zh");
  const input = page.getByRole("searchbox", { name: "在 PDF 正文中查找", exact: true });
  await expect(input).toBeFocused(); await input.fill("distantneedle");
  await expect(page.getByLabel("查找结果计数", { exact: true })).toHaveText("1 / 1");
  await page.getByRole("tab", { name: "摘要", exact: true }).click();
  await expect(input).not.toBeVisible();
  const navigation = page.getByRole("navigation", { name: "主导航", exact: true });
  const menu = page.getByRole("button", { name: "展开导航", exact: true });
  if (await menu.isVisible() && !((await navigation.getAttribute("class")) || "").includes("mobile-open")) await menu.click();
  await navigation.getByRole("button", { name: "文库", exact: true }).click();
  await page.locator(".paper-card-main").filter({ hasText: second.title }).click();
  await page.getByRole("tab", { name: "论文", exact: true }).click();
  const next = await openSearch(page, "zh");
  await expect(next).toHaveValue("");
  await expect(page.getByLabel("查找结果计数", { exact: true })).toHaveText("0 / 0");
  await expect(page.locator(".pdf-search-highlight")).toHaveCount(0);
});
