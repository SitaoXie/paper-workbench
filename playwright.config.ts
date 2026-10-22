import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:4319";
export default defineConfig({
  testDir: "./tests",
  testMatch: ["overview-compact.spec.ts", "selection-agent-extra.spec.ts", "notebook-horizontal.spec.ts", "frontend-boundaries.spec.ts", "selection-agent.spec.ts", "pdf-selection-text.spec.ts", "chat-scroll.spec.ts", "notebook-segments.spec.ts", "reading-sections.spec.ts", "chat-actions.spec.ts", "agent-handoff.spec.ts", "workspace-experience.spec.ts", "outline.spec.ts", "reader-details.spec.ts", "pdf-search.spec.ts", "navigation.spec.ts", "ui.spec.ts", "reading.spec.ts", "state.spec.ts", "dock.spec.ts", "workspace.spec.ts", "annotations.spec.ts", "overview.spec.ts", "interactive.spec.ts", "captions.spec.ts", "drafts.spec.ts", "resume.spec.ts"],
  fullyParallel: false,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    ...(process.env.E2E_CHANNEL || process.env.E2E_BROWSER_CHANNEL
      ? { channel: process.env.E2E_CHANNEL || process.env.E2E_BROWSER_CHANNEL }
      : {}),
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run build && node server/index.mjs",
        url: baseURL + "/api/health",
        timeout: 120_000,
        reuseExistingServer: false,
        env: {
          PORT: "4319",
          DATA_DIR: mkdtempSync(join(tmpdir(), "paper-workbench-e2e-")),
        },
      },
});
