import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// Only this repository-owned document is loaded. No installed skills, user
// paths, remote repositories or hooks are discovered by the API process.
export const readingContract = readFileSync(new URL("../skills/paper-workbench/references/reading-contract.md", import.meta.url), "utf8");
const headings = {
  common: "Common evidence rules",
  overview: "Reading overview",
  question: "Paper question",
  translation: "Faithful translation",
};
const sections = Object.fromEntries(Object.entries(headings).map(([key, heading]) => {
  const marker = `## ${heading}\n`;
  const start = readingContract.indexOf(marker);
  if (start < 0) throw new Error(`Missing reading contract section: ${heading}`);
  return [key, readingContract.slice(start).split(/\n## /, 1)[0].trim()];
}));
const version = readingContract.match(/^Policy version: (\d+)$/m)?.[1];
if (!version) throw new Error("Reading contract requires a policy version.");
export const readingPolicyIdentity = Object.freeze({
  id: "paper-workbench-reading", version,
  sha256: createHash("sha256").update(readingContract).digest("hex"),
});

export function readingPolicyPrompt(mode) {
  if (!["overview", "question", "translation"].includes(mode)) throw new Error("Unknown reading policy mode.");
  // Questions already receive the evidence rules in the base system prompt;
  // avoid duplicating them at the expense of source/history context. Translation
  // must not inherit synthesis instructions to rewrite the paper's conclusions.
  return mode === "overview" ? `${sections.common}\n\n${sections.overview}` : sections[mode];
}
