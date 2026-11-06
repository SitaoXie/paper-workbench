import { test, expect, type Page } from "@playwright/test";

const seed = {
  authors: [],
  abstract: "Source abstract.",
  text: "Source evidence.",
  url: "https://example.org/paper",
  source: "web",
  createdAt: "2026-10-22T00:00:00Z",
  tags: [],
  favorite: false,
};
const papers = [
  { ...seed, id: "state-alpha", title: "State audit Alpha" },
  { ...seed, id: "state-beta", title: "State audit Beta" },
];
const profile = {
  id: "default",
  name: "Audit connection",
  provider: "openai",
  baseUrl: "https://api.example.org/v1",
  model: "audit-model",
  models: ["audit-model", "audit-model-two"],
  apiKeyConfigured: true,
};
const settings = {
  ...profile,
  activeProfileId: "default",
  profiles: [profile],
  modelConfigured: true,
};

async function openLibrary(page: Page) {
  const menu = page.getByRole("button", { name: "展开导航", exact: true });
  const nav = page.getByRole("navigation");
  if (
    (await menu.isVisible()) &&
    !(await nav.getAttribute("class"))?.includes("mobile-open")
  )
    await menu.click();
  await nav.getByRole("button", { name: "文库", exact: true }).click();
}

test("a delayed favorite response cannot replace the newly opened paper", async ({
  page,
}) => {
  let releaseFavorite: (() => Promise<void>) | undefined;
  await page.route("**/api/**", async (route) => {
    if(new URL(route.request().url()).pathname==='/api/collections'){await route.fulfill({json:{collections:[]}});return;}
    const req = route.request();
    const path = new URL(req.url()).pathname.slice(4);
    let result: unknown = {};
    if (path === "/settings") result = settings;
    else if (path === "/papers") result = { papers };
    else if (path === "/chats") result = { messages: [], conversationId: null };
    else if (path.endsWith("/annotations")) result = { annotations: [] };
    else if (path.endsWith("/activities")) result = { activities: [] };
    else if (path.startsWith("/papers/")) {
      if (req.method() === "PATCH") {
        releaseFavorite = () =>
          route.fulfill({ json: { paper: { ...papers[0], favorite: true } } });
        return;
      }
      result = { paper: papers.find((p) => p.id === path.split("/")[2]) };
    }
    await route.fulfill({ json: result });
  });
  await page.goto("/?paper=state-alpha");
  await expect(
    page.getByRole("heading", { name: papers[0].title, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "收藏论文", exact: true }).click();
  await expect.poll(() => Boolean(releaseFavorite)).toBe(true);
  await openLibrary(page);
  await page.getByRole("button", { name: new RegExp(papers[1].title) }).click();
  await expect(
    page.getByRole("heading", { name: papers[1].title, exact: true }),
  ).toBeVisible();
  await releaseFavorite!();
  await expect(
    page.getByRole("heading", { name: papers[1].title, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: papers[0].title, exact: true }),
  ).toHaveCount(0);
  await expect(page).toHaveURL(/paper=state-beta/);
});

test("changing API origin or protocol clears a typed credential before any request", async ({
  page,
}) => {
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/**", async (route) => {
    if(new URL(route.request().url()).pathname==='/api/collections'){await route.fulfill({json:{collections:[]}});return;}
    const req = route.request();
    const path = new URL(req.url()).pathname.slice(4);
    let result: unknown = {};
    if (path === "/settings") result = settings;
    else if (path === "/settings/test") {
      requests.push(req.postDataJSON());
      result = { ok: true };
    } else if (path === "/papers") result = { papers: [] };
    await route.fulfill({ json: result });
  });
  await page.goto("/");
  const navToggle = page.getByRole("button", { name: "展开导航", exact: true });
  if (await navToggle.isVisible()) await navToggle.click();
  await page.getByTitle("模型设置", { exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.locator("#api-key").fill("audit-only-do-not-send-to-other-origin");
  // Changing an API path within the same origin does not discard an intentional key.
  await page.locator("#base-url").fill("https://api.example.org/v2");
  await expect(page.locator("#api-key")).toHaveValue(
    "audit-only-do-not-send-to-other-origin",
  );
  await page.locator("#base-url").fill("https://different.example.org/v1");
  await expect(page.locator("#api-key")).toHaveValue("");
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(JSON.stringify(requests[0])).not.toContain(
    "audit-only-do-not-send-to-other-origin",
  );
  const cleared = (
    requests[0].profiles as (typeof profile)[] &
      { apiKey?: string; clearApiKey?: boolean }[]
  )[0];
  expect(cleared.apiKey || "").toBe("");
  expect(cleared.clearApiKey).toBe(true);
  await page.locator("#api-key").fill("audit-second-provider-key");
  await page.locator("#provider").selectOption("anthropic");
  await expect(page.locator("#api-key")).toHaveValue("");
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(JSON.stringify(requests[1])).not.toContain(
    "audit-second-provider-key",
  );
});
