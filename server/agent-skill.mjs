import { readFile } from "node:fs/promises";
import { readingContract } from "./reading-policy.mjs";

const root = new URL("../skills/paper-workbench/", import.meta.url);
const references = [
  ["agent-import.md", "embedded-agent-import-protocol", "Embedded agent import protocol"],
  ["reading-contract.md", "paper-workbench-reading-contract", null],
  ["external-skills.md", "optional-external-research-skills", null],
  ["inline-visuals.md", "inline-diagrams-and-charts", null],
];

export async function agentSkillBundle() {
  const [skill, ...documents] = await Promise.all([
    readFile(new URL("SKILL.md", root), "utf8"),
    ...references.map(([name]) => name === "reading-contract.md" ? readingContract : readFile(new URL(`references/${name}`, root), "utf8")),
  ]);
  const links = new Map(references.map(([name, anchor]) => [name, anchor]));
  const inlineLinks = text => text.replace(/\]\((?:references\/)?(agent-import\.md|reading-contract\.md|external-skills\.md|inline-visuals\.md)(#[^\s)]+)?\)/g,
    (_match, name, fragment) => `](${fragment || `#${links.get(name)}`})`);
  return inlineLinks(`${skill}\n\n---\n\nReferences are embedded below（见下面内嵌协议）.\n\n${documents.map((document, i) => `${references[i][2] ? `## ${references[i][2]}\n\n` : ""}${document}`).join("\n\n---\n\n")}`);
}
