# Community reading skills and interactive paper export

Research date: 2026-10-22. This is a source-based design note, not an installation recommendation or a claim that the listed skills have been executed. Only upstream repositories, their actual skill files, license files, and the authors' paper were used. No third-party code or skill text was copied into this project.

## Verified candidates

Popularity is not treated as a quality score. Repository stars and maintainers' adoption claims do not establish the quality of an individual skill. The candidates below were selected for concrete overlap with this workspace.

| Candidate and verified source | License found | Useful idea | Limitation and our improvement |
| --- | --- | --- | --- |
| K-Dense **scientific-critical-thinking** — [upstream skill](https://raw.githubusercontent.com/K-Dense-AI/scientific-agent-skills/main/skills/scientific-critical-thinking/SKILL.md) | MIT in skill metadata and [repository license](https://raw.githubusercontent.com/K-Dense-AI/scientific-agent-skills/main/LICENSE.md) | Extract evidence before criticizing; distinguish observations, consequences, uncertainty, and possible remedies. | Its biomedical appraisal frameworks do not apply automatically to every CS or theoretical paper. Our critical reading should choose checks appropriate to the paper and cite a page for each substantive concern. Missing reporting is not proof that an experiment was omitted. |
| K-Dense **literature-review** — [upstream skill](https://raw.githubusercontent.com/K-Dense-AI/scientific-agent-skills/main/skills/literature-review/SKILL.md) | MIT | Separate search, screening, extraction, synthesis, and citation verification; keep retrieval limitations visible. | It is a broad review workflow, with optional external services and document dependencies. A one-paper reading must not claim to be a systematic review. Reuse source tracking and evidence boundaries without requiring external accounts or installing the whole collection. |
| **Paper2All / Paper2Web** — [authors' repository](https://github.com/YuhangChen1/Paper2All), [Paper2Web paper](https://arxiv.org/abs/2510.15842) | No root license declaration was found in the inspected repository page/README. Do not assume permission to redistribute its code. | Iteratively refine both content and layout; evaluate navigation, completeness, interaction, and knowledge retention. | It targets academic project homepages and a broader presentation pipeline; its documented setup includes separate tools and API configuration. Our goal is a local reading artifact, with reproducible evidence links and no promotional publishing. Borrow the workflow and evaluation ideas, not unlicensed implementation. |
| Anthropic **web-artifacts-builder** — [upstream skill](https://raw.githubusercontent.com/anthropics/skills/main/skills/web-artifacts-builder/SKILL.md) | [Apache-2.0](https://raw.githubusercontent.com/anthropics/skills/main/skills/web-artifacts-builder/LICENSE.txt) | Bundle the artifact into one HTML file with its assets included. | Its React/Parcel/component scaffold is excessive for a few concept cards and self-checks. It describes testing as optional. Here a small controlled template is sufficient, and offline, keyboard, and mobile verification are release requirements. |
| Anthropic **frontend-design** — [upstream skill](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md) | [Apache-2.0](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/LICENSE.txt) | Establish typography, layout, and visual hierarchy from the actual subject; critique rendered screenshots. | Visual distinctiveness alone does not prove comprehension or source fidelity. Preserve a quiet reading surface, familiar controls, readable figures, and restrained interaction. Use source comprehension as an acceptance criterion. |

The K-Dense repository now calls itself [Scientific Agent Skills](https://github.com/K-Dense-AI/scientific-agent-skills), and its old `claude-scientific-skills` URL redirects there. The presumed upstream `skills/paper-2-web/SKILL.md` path returned 404 during this review. A skill name appearing in third-party catalogs is therefore not enough to establish its current upstream location, license, or quality.

Anthropic's repository is not uniformly Apache-2.0. Its [PDF skill license](https://raw.githubusercontent.com/anthropics/skills/main/skills/pdf/LICENSE.txt) is restrictive and source-available. Do not vendor that skill under this project's MIT license. If any permitted upstream implementation is later reused, retain its specific license and attribution rather than relying on the repository name.

For verification, the official [webapp-testing skill](https://raw.githubusercontent.com/anthropics/skills/main/skills/webapp-testing/SKILL.md) supplies a useful inspect-then-act Playwright pattern and has an [Apache-2.0 license](https://raw.githubusercontent.com/anthropics/skills/main/skills/webapp-testing/LICENSE.txt). Our existing TypeScript Playwright tests can cover the same behavior without adding a separate Python testing stack.

## Product model and implementation boundary

The following records the original design proposal for Paper Workbench, not a claim that upstream projects implement this exact API. The shipped v0.2 contract is documented in [API.md](API.md); its offline exporter uses native HTML disclosure elements with no JavaScript, and its stricter citation schema permits validated page numbers or source labels rather than arbitrary model-provided URLs.

Use the existing `readingVersions` list and `activeReadingId`. Keep reading **style** separate from presentation **format**:

- Style: `quick`, `deep`, or `critical`, plus the reader's free-text focus.
- Format: the normal article or an interactive reading website.
- One version contains one source-grounded interpretation. Switching its presentation must not add another competing report section or erase its earlier form.
- A newly generated interpretation becomes a new version; the language, focus, source coverage, agent/model provenance, and figure snapshot remain attached to that version.

A backwards-compatible extension could be:

```ts
interface ReadingVersion {
  // Existing id, language, style, focus, markdown, figures, provenance, etc.
  format?: "article" | "interactive";
  interactive?: {
    schemaVersion: 1;
    blocks: Array<
      | { type: "concept"; title: string; text: string; citations: Citation[] }
      | { type: "figure"; figureId: string; explanation: string; citations: Citation[] }
      | { type: "question"; question: string; answer: string; explanation?: string; citations: Citation[] }
    >;
  };
}
interface Citation {
  page?: number;
  url?: string;
  label?: string;
}
```

The model or external Codex/Claude session produces only validated structured content. The application owns the renderer and its interactions. It does not execute model-authored JavaScript or accept arbitrary HTML as a reading payload. Existing Markdown remains the accessible text fallback and export source.

An initial version needs only three meaningful interactions:

1. **Concept cards:** show a concise definition; reveal the paper-specific implication and its evidence on demand.
2. **Figure walkthroughs:** show the actual verified PDF crop beside an explanation, with an explicit source page. Enlarge without losing position. A recreated schematic must be labeled as an illustration, never presented as the paper's original figure.
3. **Self-checks:** reveal an answer and its source after the reader has considered a question. Use low-stakes comprehension prompts. Do not invent a scientific result, equation, numerical experiment, or correctness score merely to make the page interactive.

Short papers can omit unnecessary blocks. A mathematical paper may use concept and argument cards; an empirical paper may emphasize figures, controls, and limits. A quick reading should remain short even when rendered interactively. Deep reading adds method and evidence; critical reading emphasizes assumptions and boundaries.

## Suggested API integration

Extend the existing generation and agent-import contracts rather than creating a parallel paper website database:

- Generation request: retain `style`, `focus`, and `language`; optionally add `format: "interactive"`.
- Agent publication: accept the same structured interactive data beside the new version's Markdown and verified figures. Retain current local CLI/HTTP and subscription-session paths.
- Read and select: use the existing paper response and version selector.
- Export: an HTML export identifies the precise `readingId` and language. It does not silently export a newer version or a different translation.

Translations should be associated with the exact immutable version and source hash. A translated article must not be paired with untranslated interactive answers without telling the reader. If translated blocks are absent, explicitly show the source language or the article fallback. The language switch does not rewrite user notes, source titles, or original figure text.

## Standalone HTML requirements

Export a single HTML file with inline application-owned CSS/JavaScript, system fonts, and optional embedded PNG/WebP crops from verified local PDF figures. The file must work with the application stopped and the network unavailable. Do not include CDN scripts, analytics, API keys, configured provider URLs, account identifiers, local filesystem paths, or a dependency on the exporting user's machine.

The HTML should include the paper title, source link or citation, version identifier/date, language, reader's focus, and concise provenance. Include public source links only after validation. Do not copy credential-bearing URL parameters into exports. For a local-only PDF, retain page citations and a clear source-file label rather than a broken loopback link. PDF redistribution is separate from exporting a reading; do not embed the whole paper by default.

Render content as escaped text or sanitized Markdown, validate permitted URL schemes, and bind only application-owned interactions. Embedded JSON must escape characters that can terminate a script element. A restrictive content policy can disallow network connections and third-party frames while allowing the known exporter runtime and embedded figure assets. Opening a source link is an explicit reader action.

## Acceptance criteria

- One active reading area and one shared version selector; no duplicated “illustrated summary” and “AI report” competing below it.
- Each substantive claim, figure explanation, and self-check answer has a source location, or is explicitly identified as interpretation or an open question.
- No simulated scientific plots, sliders, or numerical outputs without an actual model/data definition. Static evidence is preferable to a misleading interactive demonstration.
- Opening the exported file offline renders the complete text, figures, cards, and self-checks; a network-request audit finds no automatic requests.
- Keyboard users can reach controls and reveal answers; mobile layouts do not overflow; print shows the source and answers in a useful reading order; reduced motion is respected.
- A figure crop and its page citation still match after switching versions, languages, and export format.
- Injection fixtures such as HTML/script-like paper text remain inert. Exports contain no runtime secrets or user-specific paths.
- Judge review covers source fidelity and readability as well as aesthetics. The Paper2Web paper's evaluation dimensions are useful inspiration, not proof that this implementation outperforms alphaXiv.

Implementation priority: structured content plus deterministic single-file export first; elaborate simulations only when a paper supplies suitable equations/data and a separate validation case justifies them.
