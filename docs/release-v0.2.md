# v0.2.0 reading workspace

This milestone combines one versioned reading surface, a continuously scrolling PDF, source-linked annotations, and an adjustable assistant/notebook. It is an independent local application inspired by alphaXiv and Zotero; it does not bundle their application code, branding, or a public commenting service.

## User-facing changes

- Compact persistent assistant/notebook controls sit beside the composer, with their bottom edges aligned. The subscription-task shortcut is a directly clickable code icon in the input toolbar. Opening the assistant no longer reserves an empty footer; its width can be dragged or adjusted by keyboard. PDF controls respond to the reading column's width, including a roughly 300-pixel column next to a wide assistant.
- PDF paper follows the application theme, with an independent Original colors override for figure verification. Theme changes preserve page position, zoom, text selection, and source-linked annotation geometry. Dark-mode annotation colors and persistent-control contrast were also checked.
- The library/search entry point no longer eagerly imports the PDF engine through the vision preview. It loads when a PDF or source figure is needed; the measured main JavaScript bundle decreased from about 1.04 MB to 0.54 MB before compression. This is a bundle-size measurement, not a benchmark of end-user loading latency.
- Quick, Deep, and Critical readings accept a focus prompt. Previous versions remain selectable. Explicitly switching Chinese/English translates the selected version on first use, preserves its identity and source bindings, then reuses the cached translation.
- Translation progress, completion, and errors survive navigation to evidence pages. Failed translations require an explicit retry. The server coalesces concurrent requests for the same version/language and returns valid cached results; an older response cannot switch the reader to another paper or version.
- A translated article remains readable when interactive translation fails. The model translates a list of display strings; the application preserves card order, types, page citations, and figure IDs by construction. Basic Chinese/English checks also reject substantial untranslated prose; the reader withholds incomplete cards/export and can retry only the cards. The check does not substitute for language or scientific review. Chinese emphasis adjacent to punctuation renders correctly without altering code, formulas, or escaped text.
- PDF, abstract, and overview selections offer translation/explanation in place, an independent result-language choice, and a separate Ask session. Popovers stay within the available viewport. History separates questions, translations, explanations, and reading versions; non-PDF selections never invent a page anchor.
- Highlights, underlines, Markdown notes, tags, search, source jumps, undoable deletion, and basic pointer ink are stored locally. Exports are Markdown/JSON sidecars; downloading the original PDF does not embed annotations.
- Profiles hold multiple model IDs and an adjustable per-request timeout. Vision capability is explicit; an optional separate model can inspect an actual source crop. Only the latest valid, non-excluded analysis of each figure enters later text generation, and the exact evidence IDs are recorded. Historical model observations remain visible and unverified; incorrect observations can be excluded from future model context.
- Interactive readings use validated concepts, cropped figures, and self-checks. A standalone HTML export embeds the used crops and works offline without scripts or third-party assets. The application renders the model's structured content rather than executing model-written HTML.
- A failed final interactive step retains the completed article. Conversion can be retried from that immutable version without repeating the research/review stages. Schema repair is bounded to one additional request, and failed conversion does not create duplicate article versions.
- The shared Codex/Claude skill supports the agent's own authenticated session, versioned readings, translations, questions, notes, and interactive content. No agent login token is read by the application.

## Validation

The release process uses isolated backend and browser test data; it does not delete or overwrite the personal library. Tests cover source binding, immutable versions and translation races, image input validation, explicit visual capability, stale crops, evidence snapshots during concurrent inference, annotation geometry across zoom/reload, conversation boundaries, offline export safety, responsive controls, and recovery from failed requests.

- `npm test`: 72 passed.
- `npm run build`: passed TypeScript checking and the production build.
- `E2E_CHANNEL=chrome npm run test:e2e`: 80 passed across desktop and mobile projects, including the final navigation/translation and composer-alignment regressions.
- The repository skill passed the skill-format validator. Distribution checks exclude runtime data and private credentials; synthetic privacy-test strings are intentionally retained as test fixtures.
- A fresh source-only directory passed `npm ci --offline --no-audit --no-fund` and the production build without the development machine's `.env`, model settings, or paper library. The offline install used the existing npm package cache; it does not mean dependencies are bundled in the source archive.

Browser acceptance and its limits are recorded in [the independent judge report](judge-v3.md). Real provider successes, timeouts, and scientific interpretation failures are recorded separately in [model validation](model-validation.md). A successful HTTP response, multiple model roles, or a passing regression suite is not evidence of universal scientific correctness.

## Portability and remaining scope

Runtime settings, API keys, imported papers, generated reports, and local screenshots are excluded from the source archive. There is no institution-specific endpoint, required account, or personal filesystem path in the distributed code. The local server binds to loopback; this is not a hosted multi-user service.

Physical stylus pressure/palm rejection and native mobile keyboard behavior remain untested. Scanned-PDF OCR, Zotero synchronization, embedded-PDF annotation export, collaborative accounts, and arbitrary executable model-generated websites are outside this milestone. Source text and visual observations can be incomplete or wrong; verify material claims against the paper.
