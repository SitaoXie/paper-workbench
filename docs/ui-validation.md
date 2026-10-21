# UI and browser validation

Validated on 2026-10-22. This record covers the implemented local workspace, not every alphaXiv feature or every possible browser state. Passing checks do not establish that the application has no bugs or that its UI is pixel-identical to alphaXiv.

## Reproduce

```sh
npm install
npx playwright install chromium
npm run test:e2e
```

The validation run used an already-installed Google Chrome through `E2E_CHANNEL=chrome npm run test:e2e`. The configuration defaults to Playwright Chromium and does not require a particular browser installation path. `E2E_CHANNEL` is an optional override. `E2E_BASE_URL` can target an already-running dedicated test instance; do not point the real integration test at a personal working library.

By default, Playwright builds the current source, starts the real server on loopback port 4319, and supplies a new temporary data directory. It does not read or modify the developer's ordinary port-4318 library or provider configuration. The UI fixtures contain generic paper metadata and fake credentials only. Temporary integration data remain in the operating system's temporary directory after a run.

## Latest reading iteration

The later reading and assistant revisions are recorded in [reading-v2-validation.md](reading-v2-validation.md) and the independent [experience-judge.md](experience-judge.md). The historical baseline below predates continuous PDF selection, external agent imports, and the resizable assistant dock.

## Earlier baseline results

After replacing native PDF embedding, the final run completed **12 of 12 tests successfully in 18.3 seconds**, including the build. The suite runs six scenarios at each of these sizes:

| Project | Engine and viewport |
| --- | --- |
| Desktop | Chromium, 1440 × 1000 CSS pixels |
| Mobile | Chromium with iPhone 13 emulation, 390 × 664 CSS-pixel viewport, 390 × 844 screen, device scale 3 |

Mobile emulation is not a test of Safari/WebKit or a physical iPhone.

| Scenario | Verified behavior |
| --- | --- |
| Navigation, search, model settings, theme | Library and favorites navigation; empty search and reset; OpenAI/Anthropic form selection; connection-test feedback; saved settings; dark theme; assistant answer display |
| Keyless local inference and review | A configured local endpoint without an API key enables AI report actions; researcher and skeptic stages can be expanded and read |
| PDF failure and page changes | Invalid PDF produces an actionable error; retry loads a valid two-page PDF; rapid previous/next and zoom/fit changes settle on the requested page with the correct selectable text |
| URL import | Empty submission disabled; failed retrieval presents an error and permits correction; successful import opens its paper |
| Paper workflow | Detail fetch provides full text beyond the list's abstract; summary/reader tabs; favorite; BibTeX download with actual file-content verification; report generation and Markdown download; paper-scoped question |
| Real backend integration | Browser-generated text PDF uploaded through the actual multipart endpoint; actual PDF.js canvas pixels checked against all-white/all-black failure and text-layer content verified; zoom/fit; extractive report; persisted favorite; evidence-grounded extractive answer; page citation navigation; first/last-page controls; new conversation stays empty after reload; prior conversation can be restored from history |

The first five scenarios use browser route fixtures for repeatability. The final scenario does **not** mock API routes: uploads, extraction, storage, reports, answers, conversation creation, reload, and history selection all use the actual server. It deliberately uses the explicitly labeled extractive mode and does not claim to validate a remote model response. Provider checks belong in [model-validation.md](model-validation.md).

All reviewed flows assert that the document does not overflow the mobile or desktop viewport horizontally. Screenshots were visually inspected for desktop paper/sidebar separation, mobile assistant and composer placement, model configuration, the import dialog, and light/dark appearance.

## Evidence artifacts

`playwright-report/index.html` contains the test report. `test-results/` contains scenario screenshots, regenerated on each run and excluded from source control. Relevant filenames include:

- `home.png`, `settings.png`, `import.png`
- `research-dark.png`
- `paper-report.png`, `paper-chat.png`
- `real-pdf-chat.png`, `restored-conversation.png`
- `real-pdf-rendered.png`, `pdf-recoverable-error.png`, `pdf-page-two.png`

Chat and restored-history screenshots capture the viewport; the report screenshot captures the full document. Full-page screenshots of fixed-position components can place those components at the current scroll offset, so viewport screenshots are used to judge sidebar placement. Failure screenshots and traces are retained automatically.

## Reference comparison and repaired findings

The reference exploration inspected the supplied alphaXiv paper, its summary and PDF modes, the assistant, search results, and both light and dark themes. No account was created, no login was performed, and no public comment was posted.

The local implementation follows the reference's narrow paper navigation, summary/paper switch, author chips, restrained burgundy/pink palette, information panel, assistant suggestion cards, and bottom composer. Review feedback led to these corrections:

- Fetch complete paper details when opening a list item; the list response intentionally omits full text.
- Display locally uploaded PDFs using the local file endpoint.
- Replace browser-native PDF iframes with bundled PDF.js canvas rendering and a selectable text layer after the in-app browser displayed a black PDF pane. Checking only iframe presence had missed this real failure; the suite now checks rendered canvas pixels and text content.
- Provide a real BibTeX file download alongside copying.
- Prevent the expanded-navigation wordmark from wrapping into a second row.
- Use a 680-pixel assistant column on large screens; keep the toolbar in the remaining paper column.
- Increase abstract/body and author-chip readability, and match rounded paper actions more closely.
- Distinguish a usable keyless local endpoint from an unconfigured model.
- Persist new conversations and make prior conversations selectable after refresh.

The current reference fidelity is structural and visual, not a pixel-diff certification. Branding, some typography, homepage copy, paper thumbnails, metadata sections, and PDF-viewer controls remain distinct. The project uses its own identity and does not bundle alphaXiv's logo or proprietary application source.

An additional manual check in the Codex in-app browser used the actual supplied 44-page paper. The lead agent verified the first-page title, authors, and abstract, navigated to page two, and opened the 680-pixel assistant. ResizeObserver then adjusted the PDF from 143% to 94% and rendered the resized page; the accessibility tree exposed the real paper's text layer. This supplements the deterministic two-page browser fixture rather than replacing it.

## Limits of this validation

- The suite does not establish correctness of scientific claims or independence of the three roles when they use one model.
- No real Safari, Firefox, Android device, screen reader, complete keyboard/focus audit, or visual-regression baseline was exercised.
- Browser tests verify actual PDF canvas content, text-layer presence, two-page navigation, zoom/fit, and rendering-error recovery. They do not exhaustively validate mathematical glyph fidelity, all CJK/embedded-font formats, complex image codecs, text-selection alignment, printing, annotations, or embedded hyperlinks.
- OCR, scanned/encrypted/damaged PDFs, very large libraries, long-running requests, connection interruption, and every external site's extraction behavior are not covered by these browser scenarios.
- Source-provider availability, real model latency/quality, and remote search quality are separate integration concerns. URL-import success in the deterministic UI scenario is a fixture; the real integration scenario uses local PDF upload.
- Mathematical rendering is bundled locally. KaTeX is deduplicated to a patched version and split into a separate build chunk; the final build completes without the earlier chunk-size advisory.

Within the exercised scope, no unresolved blocking UI defect remained after the final run. Broader claims of “bug-free” or “pixel-perfect” would exceed this evidence.

The final backend run passed 17 of 17 tests. The final npm dependency audit reported zero known vulnerabilities. These checks apply to the locked dependency versions at the validation date.
