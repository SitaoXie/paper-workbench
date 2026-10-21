# Reading experience and agent-session validation

Validation date: 2026-10-22. This records observed behavior rather than a claim of pixel identity or absence of all defects.

## Reference observations

The [reference paper](https://www.alphaxiv.org/abs/2610.04158) was inspected read-only in the browser. No comment, note, or external question was submitted.

The reference puts a language selector beside submission metadata, then title/authors, a collapsed original abstract with an explicit expand action, paper actions, and AI Overview. Its overview inserts a real figure after the introductory paragraph, followed by explanatory prose and page citations. A floating assistant action remains reachable at the lower right. On the PDF page, scrolling crosses page boundaries continuously, page numbers track the viewport, and PDF annotation links lead to references/sections. Selecting text reveals a nearby contextual input with question, explanation, and translation actions.

The earlier workbench implementation differed materially: paginated PDF navigation, English-only generated report, no illustrated overview, one model per settings record, and a skill that merely forwarded generation to the application's API. The revision separates external agent reasoning from direct provider generation, keeps translations alongside originals, references actual PDF crops, and supports endpoint profiles with multiple model IDs.

## Real agent-session workflow

The current Codex session read the target paper's extracted text for all 44 PDF pages, including the appendices, and produced a Chinese overview, a complete Chinese abstract translation, a Japanese abstract translation, a faithful Chinese translation of the existing English model report, and a source-grounded Chinese answer. Results were saved through the portable `publish` and `answer` CLI commands. No application model-generation endpoint was used for these artifacts.

The original English abstract and saved report remained unchanged. Translations carry their source hash and were returned with `stale: false`. Summary and answer provenance is `kind: agent`, `agent: Codex`. The report translation explicitly distinguishes translation from correction: it retains the existing report's interpretations rather than presenting a silently revised report as a faithful translation. Figure crops were inspected and supplied separately from the text workflow.

The source-based overview explicitly flags the distinction between finite-budget coverage and strategy support. It also notes an apparent reporting discrepancy: Figure 5's caption describes average R² above 0.99, while the individual values in Table 3 are approximately 0.845–0.987. This is a request for clarification of aggregation, not an invented reconciliation.

## Independent checks

- 18 CLI behavioral assertions checked page selection, PDF export, overwrite refusal, JSON file/stdin import, question import, language forwarding, and malformed-input rejection.
- 10 assertions against a real isolated backend with **no configured model** verified summary/translation/answer persistence, original retention, agent provenance, and source retrieval. An injected inference trap recorded zero model calls.
- The revised skill passed the official skill frontmatter validator. Its downloaded version includes the import contract so a standalone SKILL.md does not depend on a missing reference file.
- `tests/reading.spec.ts` exercises the browser against the actual isolated backend: JSON import without a key, a rendered PDF crop placed inside overview prose, original/translation switching, missing/stale translation messaging, short Chinese abstract overflow, skill download, and saved external-agent answers. It runs for desktop and mobile configurations; consult the latest test run for pass/fail status.

During adversarial inspection, false figure discovery from prose such as “Figure 2 illustrates…” was found and corrected to caption-line matching. Language-tag case normalization was added so `zh-cn` imports match the `zh-CN` reading option. The UI was also checked for silent fallback when a selected language has no saved translation, and for short Chinese text overflowing a fixed-height abstract despite containing fewer than 480 characters.

## Remaining scope

A user's agent session must have access to the local checkout and running application. The browser itself does not reuse subscription credentials or start an authenticated agent session. Direct provider requests remain an optional separate mode, subject to endpoint availability. PDF extraction is limited to a readable text layer; source images must be visually checked before precise cropping. Generated and translated scientific claims still require source review.

## Previous reading acceptance run

- `npm test`: **25/25 passed**.
- `E2E_CHANNEL=chrome npm run test:e2e`: **26/26 passed**, with desktop 1440 × 1000 and mobile 390 × 664 browser configurations. A subsequent focused selection test also verifies that subscription handoff includes the exact selected quote, page, and question, without triggering a model request.
- Production build and TypeScript checks passed; production dependency audit reported **0 vulnerabilities**.
- Real in-app-browser mouse selection on the 44-page paper displayed the nearby input, explanation, and translation actions. The entered question and precise source excerpt arrived in the fixed assistant panel without sending a request. The assistant bubble remains reachable while scrolling.
- Real PDF page 1 had 13 annotation links; an internal reference correctly navigated to page 16. Continuous reading, arbitrary page jumps, zoom/fit stability, and bounded canvas counts were independently checked.
- A delayed favorite request and an API-origin change were independently tested: the current paper is not replaced by an older response, and a typed credential is cleared before a request to another destination. Conversation-switch controls are disabled while a switch is pending; paper changes also guard late responses.
- The current paper's two overview figures are actual source crops from PDF pages 2 and 4, placed in the corresponding explanatory sections. No figure button overlays scientific chart content. Newly imported papers without verified crops show explicitly labeled source-page previews; precise illustration placement is supplied through the agent workflow, not falsely claimed as universal automatic figure extraction.

Direct academy-provider verification in this iteration could not complete: both direct and proxy TLS paths to the existing configured endpoint were reset before authentication. Public HTTPS and local proxy connectivity worked. No credential or institution endpoint was copied into source files, and no general network restriction was weakened. The real subscription-agent workflow succeeded independently of that unavailable endpoint.

### Provider recovery recheck

After the user reported restored connectivity, the same saved provider passed its connection test (HTTP 200, about 1 second). A separate French abstract translation completed in 13.65 seconds (1,769 characters, `stale: false`), and a Chinese paper question completed in 11.57 seconds with page citations. The English original and existing Chinese/Japanese translations remained saved. The provider's model catalog returned one accessible model; no nonexistent model IDs were added as presets. These checks verify real connectivity and persistence, not scientific correctness of every generated interpretation.


## Resizable assistant and reading-layout iteration

The independent judge revisited alphaXiv before reviewing the new local build. The reference uses a broad, nearly full-height assistant beside the reading column on desktop. The previous 440 px floating panel did not meet that baseline and was rejected. The replacement reserves document space for a resizable dock; on narrow screens it becomes a tall overlay, and on phones a full-screen panel with a return-to-paper action. Unadjusted width follows the viewport; an explicit drag or keyboard adjustment becomes a local presentation preference.

The overview now uses a centered, bounded reading layout with 16 px / 28 px prose and figures capped at 760 px. Clicking a figure opens a modal which re-renders the same PDF crop at the requested resolution, supports 100–300% zoom and scrolling, and restores focus when closed. Source-page navigation remains a separate action. The PDF reading area removes the previous top whitespace, uses a 48 px main toolbar plus compact PDF controls, and fills the remaining viewport.

The judge verified real PDF scrolling, selected-text question composition, page/paragraph retention through assistant open/close, and a real provider answer. Desktop and narrow-screen geometry, figure magnification, and viewport-change regressions are recorded in [experience-judge.md](experience-judge.md). Automated coverage includes `tests/dock.spec.ts` for side-by-side geometry and responsive/manual widths, and `tests/reading.spec.ts` for crop-preserving magnification and focus restoration.

A separate navigation defect discovered by the challenger was corrected: opening the application shell via an external link is allowed only for a top-level GET document navigation to `/`. Cross-site API requests, including navigations to API paths, remain blocked. Backend regression checks cover both cases.


The first expanded browser run passed 31 of 32 scenarios. Its failure occurred when an automated second selection targeted a text layer during the fit-width re-render caused by closing the dock. The test now waits for completed text rendering at the final page geometry instead of using a fixed delay. The selection flow then passed six consecutive desktop/mobile repetitions. The independent judge also checked real dragging after assistant open/close and did not reproduce a persistent selection failure.

No dependencies changed in this layout iteration. A fresh dependency-audit request was unavailable because the registry connection reset; the earlier zero-vulnerability result above remains a historical result, not a new successful audit.


Final release regression: **25/25 backend tests**, **32/32 browser tests (41.4 seconds)**, **6/6 repeated selection scenarios**, and production TypeScript/Vite build passed. The independent judge's PASS is recorded separately with its scoped limitations. The source package excludes local data, provider credentials, imported PDFs, build output, and runtime screenshots.
