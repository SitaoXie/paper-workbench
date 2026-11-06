import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

async function sourceFixture(page: Page, request: APIRequestContext, title: string) {
  const renderer = await page.context().newPage();
  await renderer.setContent(`<html><head><title>${title}</title><style>body{font:18px Georgia;margin:48px}section{break-before:page}</style></head><body><h1>${title}</h1><p>A finding begins on this source page.</p><section><h2>Continuation</h2><p>The continuation contains SECOND_SEGMENT_ONLY evidence.</p></section></body></html>`);
  const buffer = await renderer.pdf({ format: "A4" });
  await renderer.close();
  const result = await request.post("/api/upload", { multipart: { file: { name: `${title}.pdf`, mimeType: "application/pdf", buffer } } });
  expect(result.ok(), await result.text()).toBeTruthy();
  const { paper } = await result.json();
  const segments = [
    { page: 1, quote: "A finding begins on this source page.", rects: [{ x: .1, y: .2, width: .5, height: .03 }] },
    { page: 2, quote: "The continuation contains SECOND_SEGMENT_ONLY evidence.", rects: [{ x: .1, y: .2, width: .6, height: .03 }] },
  ];
  const created = await request.post(`/api/papers/${paper.id}/annotations`, { data: { kind: "note", segments, body: "One shared initial comment.", tags: ["initial"] } });
  expect(created.ok(), await created.text()).toBeTruthy();
  return { paper, segments, annotation: (await created.json()).annotation };
}

test("one cross-page note searches and locates every excerpt, edits once, and survives reload and atomic undo", async ({ page, request }, info) => {
  const { paper, segments, annotation } = await sourceFixture(page, request, `Grouped note ${info.project.name}`);
  const endpoint = `/api/papers/${paper.id}/annotations`;
  await page.goto(`/en/?paper=${paper.id}`);
  await page.getByTitle("Notes & annotations", { exact: true }).click();
  const notebook = page.getByRole("complementary", { name: "Paper notebook", exact: true });
  await expect(notebook).toBeVisible();
  await expect(notebook.locator(".notebook-card")).toHaveCount(1);
  await expect(notebook.locator(".notebook-card")).toContainText("p.1–2");
  await expect(notebook.locator(".notebook-card")).toContainText("2 pages");
  await notebook.getByRole("textbox", { name: "Search notes", exact: true }).fill("SECOND_SEGMENT_ONLY");
  await expect(notebook.locator(".notebook-card")).toHaveCount(1);
  await notebook.locator(".notebook-card").click();
  const editor = notebook.locator(".notebook-editor");
  await expect(editor.locator(".notebook-source-segment")).toHaveCount(2);
  await expect(editor.getByRole("textbox", { name: "Note content", exact: true })).toHaveCount(1);
  for (const segment of segments) await expect(editor.getByRole("region", { name: `Excerpt from page ${segment.page}`, exact: true })).toContainText(segment.quote);
  await editor.getByRole("button", { name: "Locate excerpt on page 2", exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: "PDF page number", exact: true })).toHaveValue("2");
  await editor.getByRole("textbox", { name: "Note content", exact: true }).fill("The comment was edited once for both pages.");
  await editor.getByRole("textbox", { name: "Note tags", exact: true }).fill("reviewed, cross-page");
  await editor.getByRole("button", { name: "Save note", exact: true }).click();
  await expect.poll(async () => (await (await request.get(endpoint)).json()).annotations[0].body).toBe("The comment was edited once for both pages.");
  const saved = (await (await request.get(endpoint)).json()).annotations;
  expect(saved).toHaveLength(1); expect(saved[0].id).toBe(annotation.id);
  expect(saved[0].segments).toEqual(segments); expect(saved[0].tags).toEqual(["reviewed", "cross-page"]);
  await page.reload();
  // The saved open notebook and selected editor restore after the initial
  // paper request. Clicking the covered toolbar during that interval races the
  // mobile overlay and can accidentally toggle the restored panel closed.
  await expect(notebook).toBeVisible();
  await expect(notebook.locator(".notebook-card")).toHaveCount(1);
  await expect(editor).toBeVisible();
  await expect(editor.getByRole("textbox", { name: "Note content", exact: true })).toHaveValue("The comment was edited once for both pages.");
  await expect(editor.locator(".notebook-source-segment")).toHaveCount(2);
  await editor.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(notebook.locator(".notebook-card")).toHaveCount(0);
  expect((await (await request.get(endpoint)).json()).annotations).toHaveLength(0);
  await notebook.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(notebook.locator(".notebook-card")).toHaveCount(1);
  const restored = (await (await request.get(endpoint)).json()).annotations;
  expect(restored).toHaveLength(1); expect(restored[0].id).toBe(annotation.id); expect(restored[0].segments).toEqual(segments);
});

test('reloading the notebook restores the selected note and unsaved draft without moving the PDF, and a repeated marker reopens its editor',async({page,request},info)=>{
  const {paper,annotation}=await sourceFixture(page,request,`Notebook continuity ${info.project.name}`);
  await page.goto(`/en/?paper=${paper.id}&page=2`);
  const pdf=page.getByRole('spinbutton',{name:'PDF page number',exact:true});await expect(pdf).toHaveValue('2');
  await page.getByTitle('Notes & annotations',{exact:true}).click();
  const notebook=page.getByRole('complementary',{name:'Paper notebook',exact:true});await notebook.locator('.notebook-card').click();
  await notebook.getByRole('button',{name:'Locate excerpt on page 2',exact:true}).click();
  const editor=notebook.locator('.notebook-editor'),content=editor.getByRole('textbox',{name:'Note content',exact:true});
  await content.fill('Unsaved revision survives a reload; the source body is unchanged.');
  await page.reload();
  await expect(content).toHaveValue('Unsaved revision survives a reload; the source body is unchanged.');
  await expect(pdf).toHaveValue('2');
  expect((await (await request.get(`/api/papers/${paper.id}/annotations`)).json()).annotations[0].body).toBe(annotation.body);
  await editor.getByRole('button',{name:'Close editor',exact:true}).click();
  await page.reload();await expect(editor).toBeHidden();
  await page.getByRole('button',{name:'Close notebook',exact:true}).click();
  await page.locator('[data-pdf-page="2"]').getByRole('button',{name:/Open note: One shared initial comment/}).click();
  await expect(content).toHaveValue('Unsaved revision survives a reload; the source body is unchanged.');
  await editor.getByRole('button',{name:'Close editor',exact:true}).click();
  if(info.project.name==='mobile')await page.getByRole('button',{name:'Close notebook',exact:true}).click();
  await page.locator('[data-pdf-page="2"]').getByRole('button',{name:/Open note: One shared initial comment/}).click();
  await expect(content).toHaveValue('Unsaved revision survives a reload; the source body is unchanged.');
  await editor.getByRole('button',{name:'Save note',exact:true}).click();
  await expect.poll(async()=>(await (await request.get(`/api/papers/${paper.id}/annotations`)).json()).annotations[0].body).toContain('Unsaved revision survives');
});
