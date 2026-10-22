import { expect, test, type Page } from "@playwright/test";

const paperId = "annotation-paper";
async function setup(page: Page) {
  const fixture = await page.context().newPage();
  await fixture.setContent(
    '<h1>Annotation acceptance paper</h1><p>This controlled experiment studies repeated trials and evaluation.</p><section style="break-before:page"><h1>Second page evidence</h1><p>Normalized coordinates preserve annotations when the reader zooms.</p></section>',
  );
  const pdf = await fixture.pdf({ format: "A4" });
  await fixture.close();
  const paper = {
    id: paperId,
    title: "Annotation acceptance paper",
    authors: ["Test Researcher"],
    abstract: "A synthetic paper for annotation acceptance.",
    text: "This controlled experiment studies repeated trials and evaluation.",
    pages: [
      {
        number: 1,
        text: "This controlled experiment studies repeated trials and evaluation.",
      },
      { number: 2, text: "Normalized coordinates preserve annotations." },
    ],
    pdfUrl: "/test-annotations.pdf",
    url: "https://example.org/annotations",
    source: "upload",
    createdAt: "2026-10-22T00:00:00Z",
    tags: [],
  };
  const profile = {
    id: "test",
    name: "Test",
    provider: "openai",
    baseUrl: "https://api.example.org/v1",
    apiKeyConfigured: true,
    model: "test",
    models: ["test"],
  };
  const annotations: any[] = [];
  const assists: any[] = [];
  const sessions: any[] = [];
  let failNextAssist = false;
  await page.route("**/test-annotations.pdf", (route) =>
    route.fulfill({ contentType: "application/pdf", body: pdf }),
  );
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const body = request.postData() ? request.postDataJSON() : {};
    let result: any = {};
    if (path === "/settings")
      result = {
        ...profile,
        profiles: [profile],
        activeProfileId: "test",
        modelConfigured: true,
      };
    else if (path === "/papers") result = { papers: [paper] };
    else if (path === `/papers/${paperId}`) result = { paper };
    else if (path === `/papers/${paperId}/annotations`) {
      if (request.method() === "POST") {
        const annotation = {
          ...body,
          id: `annotation-${annotations.length}`,
          paperId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        annotations.push(annotation);
        result = { annotation };
      } else result = { annotations };
    } else if (path === `/papers/${paperId}/assist`) {
      assists.push(body);
      if (failNextAssist) {
        failNextAssist = false;
        await route.fulfill({
          status: 502,
          json: { error: "Temporary model failure" },
        });
        return;
      }
      const text = body.language.startsWith("en")
        ? "This is an inline reading result."
        : "这是就地生成的阅读结果。 $p=0.5$";
      result = {
        result: {
          text,
          source: { model: "test" },
          createdAt: new Date().toISOString(),
        },
        activity: {
          id: `activity-${assists.length}`,
          paperId,
          kind: body.kind,
          title: text,
          createdAt: new Date().toISOString(),
        },
      };
    } else if (path === "/chats/new") {
      sessions.push(body);
      result = { conversationId: `conversation-${sessions.length}` };
    } else if (path === "/chats") result = { messages: [] };
    else if (path === "/conversations") result = { conversations: [] };
    else if (path === "/activities") result = { activities: [] };
    await route.fulfill({ json: result });
  });
  await page.goto(`/zh?paper=${paperId}`);
  await expect(
    page.getByRole("heading", { name: paper.title, exact: true }),
  ).toBeVisible();
  await openReader(page);
  return {
    annotations,
    assists,
    sessions,
    failAssist: () => {
      failNextAssist = true;
    },
  };
}
async function openReader(page: Page) {
  const close = page.getByRole("button", { name: "关闭助手", exact: true });
  if (await close.isVisible()) await close.click();
  await page.getByRole("tab", { name: "论文", exact: true }).click();
  await expect(
    page.locator('.pdf-text-layer[data-rendered="true"]').first(),
  ).toBeVisible();
}
async function selectPassage(page: Page) {
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll(".pdf-text-layer span")).some((node) =>
      node.textContent?.includes("controlled experiment"),
    ),
  );
  await page.evaluate(() => {
    const span = Array.from(
      document.querySelectorAll(".pdf-text-layer span"),
    ).find((node) => node.textContent?.includes("controlled experiment"))!;
    span.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await expect(
    page.getByRole("dialog", { name: "选中文字操作" }),
  ).toBeVisible();
}

test("annotations retain coordinates across zoom and reload; notes store quote and tags", async ({
  page,
}) => {
  const state = await setup(page);
  const readerTop = await page.getByLabel("连续滚动论文页面", {exact:true}).evaluate(el=>el.getBoundingClientRect().top);
  await selectPassage(page);
  await page.getByRole("button", { name: "绿色", exact: true }).click();
  await page.getByRole("button", { name: "高亮选中内容", exact: true }).click();
  await expect.poll(() => state.annotations.length).toBe(1);
  await expect(page.locator('.pdf-annotation-feedback')).toContainText('已保存到笔记');
  await expect(page.locator('.pdf-annotation-toolbar')).toBeHidden();
  expect(await page.getByLabel("连续滚动论文页面", {exact:true}).evaluate(el=>el.getBoundingClientRect().top)).toBe(readerTop);
  await page.getByRole('button',{name:'关闭保存提示',exact:true}).click();
  await expect(page.locator('.pdf-annotation-feedback')).toBeHidden();
  expect(state.annotations[0]).toMatchObject({
    kind: "highlight",
    color: "green",
    page: 1,
  });
  expect(state.annotations[0].quote).toContain("controlled experiment");
  for (const rect of state.annotations[0].rects) {
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(1.001);
    expect(rect.y + rect.height).toBeLessThanOrEqual(1.001);
  }
  const before = await page
    .locator(".reader-annotation-paint rect")
    .first()
    .getAttribute("x");
  await page.getByRole("button", { name: "放大 PDF", exact: true }).click();
  await expect(
    page.locator(".reader-annotation-paint rect").first(),
  ).toHaveAttribute("x", before!);
  await page.getByRole("button", { name: "适合宽度", exact: true }).click();
  await selectPassage(page);
  await page.getByRole("button", { name: "划线选中内容", exact: true }).click();
  await expect.poll(() => state.annotations.length).toBe(2);
  await expect(page.locator(".reader-annotation-paint line")).toHaveCount(1);
  await expect(page.locator(".reader-annotation-paint line")).toHaveAttribute(
    "stroke-width",
    ".0025",
  );
  await selectPassage(page);
  await page.getByRole("button", { name: "添加选区笔记", exact: true }).click();
  await page
    .getByLabel("笔记内容", { exact: true })
    .fill("Check whether evaluation includes uncertainty.");
  await page
    .getByLabel("笔记标签", { exact: true })
    .fill("methods, evaluation");
  await page.getByRole("button", { name: "保存笔记", exact: true }).click();
  await expect.poll(() => state.annotations.length).toBe(3);
  expect(state.annotations[2]).toMatchObject({
    kind: "note",
    body: "Check whether evaluation includes uncertainty.",
    tags: ["methods", "evaluation"],
  });
  await page.reload();
  await openReader(page);
  await expect(page.locator(".reader-annotation-paint rect")).toHaveCount(2);
  await expect(page.locator(".reader-annotation-paint line")).toHaveCount(1);
});

test("inline explanation retries, switches language and saves without starting a chat; Ask starts its own session", async ({
  page,
}) => {
  const state = await setup(page);
  state.failAssist();
  await selectPassage(page);
  await page.getByLabel("选文结果语言", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "解释选中内容", exact: true }).click();
  const inline = page.getByRole("dialog", { name: "就地阅读助手" });
  await expect(inline).toBeVisible();
  await expect(inline.getByRole("alert")).toContainText(
    "Temporary model failure",
  );
  await inline.getByRole("button", { name: "重试", exact: true }).click();
  await expect(inline).toContainText("This is an inline reading result.");
  await inline.getByLabel("就地结果语言").selectOption("zh-CN");
  await expect(inline).toContainText("这是就地生成的阅读结果。");
  await expect(inline.locator(".katex")).toBeVisible();
  expect(state.sessions).toHaveLength(0);
  await inline.getByLabel("就地结果语言").selectOption("en");
  await expect(inline).toContainText("This is an inline reading result.");
  await inline.getByRole("button", { name: "保存到笔记", exact: true }).click();
  await expect.poll(() => state.annotations.length).toBe(1);
  expect(state.annotations[0]).toMatchObject({
    kind: "explanation",
    tags: ["en"],
    body: "This is an inline reading result.",
  });
  const box = await inline.boundingBox(),
    viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
  await inline
    .getByRole("button", { name: "关闭就地助手", exact: true })
    .click();
  await selectPassage(page);
  await page
    .getByLabel("针对选中文字的问题")
    .fill("Which limitation matters most?");
  await page.getByRole("button", { name: "询问助手", exact: true }).click();
  await expect.poll(() => state.sessions.length).toBe(1);
  expect(state.sessions[0]).toMatchObject({
    paperId,
    kind: "question",
    metadata: { page: 1 },
  });
  await expect(page.getByLabel("向研究助手提问")).toHaveValue(
    "Which limitation matters most?",
  );
});

test("handwriting is an explicit mode, drafts survive reload, undo is local and saving is explicit", async ({
  page,
}) => {
  const state = await setup(page);
  await expect(page.getByRole("img", { name: "手写画布" })).toHaveCount(0);
  await page.getByRole("button", { name: "手写", exact: true }).click();
  const canvas = page.getByRole("img", { name: "手写画布" }).first();
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width * 0.2,
    bounds.y + Math.min(130, bounds.height * 0.2),
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width * 0.4,
    bounds.y + Math.min(180, bounds.height * 0.24),
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(page.getByText("1 笔未保存")).toBeVisible();
  expect(state.annotations).toHaveLength(0);
  await page.reload();
  await openReader(page);
  await expect(page.getByText("1 笔未保存")).toBeVisible();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.getByText("1 笔未保存")).toHaveCount(0);
  expect(state.annotations).toHaveLength(0);
  await page.getByRole("button", { name: "手写", exact: true }).click();
  const restored = (await page
    .getByRole("img", { name: "手写画布" })
    .first()
    .boundingBox())!;
  await page.mouse.move(restored.x + restored.width * 0.2, restored.y + 110);
  await page.mouse.down();
  await page.mouse.move(restored.x + restored.width * 0.4, restored.y + 150, {
    steps: 8,
  });
  await page.mouse.up();
  await page.getByRole("button", { name: "保存手写", exact: true }).click();
  await expect.poll(() => state.annotations.length).toBe(1);
  expect(state.annotations[0]).toMatchObject({
    kind: "ink",
    page: 1,
    color: "blue",
  });
  expect(state.annotations[0].strokes[0].points.length).toBeGreaterThan(1);
  for (const point of state.annotations[0].strokes[0].points) {
    expect(point.x).toBeGreaterThanOrEqual(0);
    expect(point.x).toBeLessThanOrEqual(1);
    expect(point.y).toBeGreaterThanOrEqual(0);
    expect(point.y).toBeLessThanOrEqual(1);
  }
  await expect(page.getByText("1 笔未保存")).toHaveCount(0);
});

test("PDF quote reconstruction preserves spaces between positioned lines and text runs", async ({
  page,
}) => {
  const state = await setup(page);
  await page.evaluate(() => {
    const layer = document.querySelector(".pdf-text-layer")!;
    layer.replaceChildren();
    for (const [text, left, top] of [
      ["about", 20, 20],
      ["large", 20, 44],
      ["models", 70, 44],
      ["performance", 130, 44],
      ["in", 20, 68],
    ] as const) {
      const span = document.createElement("span");
      span.textContent = text;
      span.style.cssText = `position:absolute;left:${left}px;top:${top}px;font-size:14px;line-height:16px;font-family:Arial;transform:none;`;
      layer.appendChild(span);
    }
    const nodes = layer.querySelectorAll("span");
    nodes[0].dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    const range = document.createRange();
    range.setStart(nodes[0].firstChild!, 0);
    range.setEnd(nodes[4].firstChild!, 2);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await page.getByRole("button", { name: "询问助手", exact: true }).click();
  await expect.poll(() => state.sessions.length).toBe(1);
  expect(state.sessions[0].metadata.quote).toBe(
    "about large models performance in",
  );
});

test("PDF theme follows the app while original colors preserve pixels, position and annotations", async ({
  page,
}, info) => {
  const state = await setup(page);
  const timestamp = "2026-10-22T00:00:00Z";
  for (const [index, kind, color] of [
    [0, "highlight", "yellow"],
    [1, "underline", "green"],
    [2, "ink", "blue"],
  ] as const) {
    state.annotations.push({
      id: `theme-annotation-${index}`,
      paperId,
      kind,
      color,
      page: 2,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(kind === "ink"
        ? {
            strokes: [
              {
                width: 0.004,
                points: [
                  { x: 0.12, y: 0.14 },
                  { x: 0.35, y: 0.19 },
                ],
              },
            ],
          }
        : {
            rects: [
              { x: 0.03, y: 0.08 + index * 0.025, width: 0.55, height: 0.02 },
            ],
          }),
    });
  }
  await page.reload();
  await openReader(page);
  const pageNumber = page.getByLabel("PDF 页码", { exact: true });
  await pageNumber.fill("2");
  await page.getByRole("button", { name: "放大 PDF", exact: true }).click();
  const canvas = page.locator(
    '[data-pdf-page="2"] canvas[data-rendered="true"]',
  );
  await expect(canvas).toBeVisible();
  const colors = page.getByLabel("PDF 纸张颜色", { exact: true });
  const showColors = async () => { if (!(await colors.isVisible())) await page.getByRole("button", { name: "阅读工具", exact: true }).click(); };
  const zoom = await page
    .getByLabel("PDF 缩放比例", { exact: true })
    .innerText();
  const pixels = await canvas.evaluate((element) =>
    (element as HTMLCanvasElement).toDataURL(),
  );
  const savedAnnotations = JSON.stringify(state.annotations);
  const overlay = page.locator('[data-pdf-page="2"] .reader-annotation-paint');
  const coordinates = await overlay.innerHTML();
  const scrollTop = await page
    .locator(".pdf-canvas-viewport")
    .evaluate((element) => element.scrollTop);
  const switchTheme = async (dark: boolean) => {
    const mobileNavigation = page.getByRole("button", {
      name: "展开导航",
      exact: true,
    });
    if (await mobileNavigation.isVisible()) await mobileNavigation.click();
    await page
      .getByRole("button", {
        name: dark ? "切换深色主题" : "切换浅色主题",
        exact: true,
      })
      .click();
    if (await mobileNavigation.isVisible()) {
      await mobileNavigation.click();
      await expect(page.locator(".rail")).not.toHaveClass(/mobile-open/);
      await expect
        .poll(async () => {
          const bounds = (await page.locator(".rail").boundingBox())!;
          return bounds.x + bounds.width;
        })
        .toBeLessThanOrEqual(1);
    }
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      dark ? "dark" : "light",
    );
  };
  const expectPositionAndData = async () => {
    await expect(pageNumber).toHaveValue("2");
    await expect(page.getByLabel("PDF 缩放比例", { exact: true })).toHaveText(
      zoom,
    );
    expect(await overlay.innerHTML()).toBe(coordinates);
    expect(JSON.stringify(state.annotations)).toBe(savedAnnotations);
    expect(
      await canvas.evaluate((element) =>
        (element as HTMLCanvasElement).toDataURL(),
      ),
    ).toBe(pixels);
    expect(
      Math.abs(
        (await page
          .locator(".pdf-canvas-viewport")
          .evaluate((element) => element.scrollTop)) - scrollTop,
      ),
    ).toBeLessThan(3);
  };

  await showColors();
  await expect(colors).toHaveValue("theme");
  await expect(canvas).toHaveCSS("filter", "none");
  await switchTheme(true);
  await expect(canvas).toHaveCSS("filter", "invert(0.9) hue-rotate(180deg)");
  await expect(overlay).toHaveCSS("filter", "none");
  await expect(overlay).toHaveCSS("mix-blend-mode", "screen");
  await expect(page.locator('[data-pdf-page="2"] .pdf-text-layer')).toHaveCSS(
    "filter",
    "none",
  );
  await showColors();
  await expect(page.locator(".pdf-theme-color-notice")).toBeVisible();
  await expectPositionAndData();
  await page.screenshot({ path: info.outputPath("pdf-theme-dark.png") });

  // Selecting PDF text still uses the original text layer, independent of the filter.
  const selectedText = await page.evaluate(() => {
    const span = document.querySelector(
      '[data-pdf-page="2"] .pdf-text-layer span',
    )!;
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const text = selection.toString();
    selection.removeAllRanges();
    return text;
  });
  expect(selectedText).toContain("Second page evidence");
  await showColors();
  await colors.selectOption("original");
  await expect(canvas).toHaveCSS("filter", "none");
  await expect(overlay).toHaveCSS("mix-blend-mode", "multiply");
  await expect(page.locator(".pdf-theme-color-notice")).toBeHidden();
  await expectPositionAndData();
  await page.screenshot({ path: info.outputPath("pdf-theme-original.png") });
  await showColors();
  await colors.selectOption("theme");
  await switchTheme(false);
  await expect(canvas).toHaveCSS("filter", "none");
  await expectPositionAndData();
  await showColors();
  await colors.selectOption("original");
  await switchTheme(true);
  await expect(canvas).toHaveCSS("filter", "none");
  await expectPositionAndData();
  await page.reload();
  await openReader(page);
  await showColors();
  await expect(colors).toHaveValue("original");
  expect(JSON.stringify(state.annotations)).toBe(savedAnnotations);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBeTruthy();
});

async function selectAcrossPages(page: Page) {
  const smaller=page.getByRole('button',{name:'缩小 PDF',exact:true});
  for(let i=0;i<8 && await smaller.isEnabled();i++) await smaller.click();
  await expect(page.locator('[data-pdf-page="2"] .pdf-text-layer[data-rendered="true"]')).toBeVisible();
  await page.evaluate(()=>{
    const start=Array.from(document.querySelectorAll('[data-pdf-page="1"] .pdf-text-layer span')).find(el=>el.textContent?.includes('controlled experiment'))!;
    const end=Array.from(document.querySelectorAll('[data-pdf-page="2"] .pdf-text-layer span')).find(el=>el.textContent?.includes('Normalized coordinates'))!;
    start.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    const range=document.createRange();range.setStart(start.firstChild!,0);range.setEnd(end.firstChild!,end.textContent!.length);
    const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));
  });
  await expect(page.getByRole('dialog',{name:'选中文字操作',exact:true})).toContainText('p.1–2');
}

test('one cross-page selection saves one logical note and each painted page opens that same note at its own source',async({page})=>{
  const state=await setup(page);await selectAcrossPages(page);
  await page.getByRole('button',{name:'添加选区笔记',exact:true}).click();
  const editor=page.getByRole('dialog',{name:'添加笔记',exact:true});
  await expect(editor).toContainText('p.1–2');
  await page.getByLabel('笔记内容',{exact:true}).fill('A single comment shared by both pages.');
  await page.getByRole('button',{name:'保存笔记',exact:true}).click();
  await expect.poll(()=>state.annotations.length).toBe(1);
  const note=state.annotations[0];expect(note.segments).toHaveLength(2);
  expect(note.segments.map((segment:any)=>segment.page)).toEqual([1,2]);
  expect(note.quote).toContain('controlled experiment');expect(note.quote).not.toContain('Normalized coordinates');
  expect(note.segments[1].quote).toContain('Normalized coordinates');
  expect(note.body).toBe('A single comment shared by both pages.');
  await expect(page.locator('.pdf-annotation-feedback')).toContainText('保存为一条笔记');
  for(const number of [1,2])await expect(page.locator(`[data-pdf-page="${number}"] .reader-annotation-paint rect`).first()).toBeVisible();
  // At the minimum zoom both whole pages fit without any scroll range. Return
  // to a reading scale before asserting that page 2 becomes the active page.
  for(let i=0;i<6;i++)await page.getByRole('button',{name:'放大 PDF',exact:true}).click();
  await page.locator('[data-pdf-page="2"]').scrollIntoViewIfNeeded();
  await page.locator('[data-pdf-page="2"]').getByRole('button',{name:/打开笔记: A single comment/}).first().click();
  await expect(page.getByLabel('PDF 页码',{exact:true})).toHaveValue('2');
  await expect(page.getByRole('complementary',{name:'论文笔记',exact:true})).toContainText('p.1–2');
  await expect(page.getByLabel('笔记内容',{exact:true})).toHaveValue('A single comment shared by both pages.');
  await page.reload();
  expect(state.annotations).toHaveLength(1);await expect(page.locator('.notebook-panel')).toContainText('p.1–2');
});

test('saving a cross-page inline explanation keeps both source anchors in one annotation',async({page})=>{
  const state=await setup(page);await selectAcrossPages(page);
  await page.getByRole('button',{name:'解释选中内容',exact:true}).click();
  const inline=page.getByRole('dialog',{name:'就地阅读助手',exact:true});
  await expect(inline).toContainText('p.1–2');await expect(inline).toContainText('这是就地生成的阅读结果');
  await inline.getByRole('button',{name:'保存到笔记',exact:true}).click();
  await expect.poll(()=>state.annotations.length).toBe(1);expect(state.annotations[0].segments).toHaveLength(2);
  expect(state.annotations[0].kind).toBe('explanation');expect(state.annotations[0].body).toContain('就地生成');
  expect(state.sessions).toHaveLength(0);
});
