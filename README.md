# Paper Workbench

A local research workspace inspired by alphaXiv's reading experience: a paper library, URL and PDF imports, versioned reading overviews, source-linked notes, search, and a research assistant with configurable model providers. This is an independent implementation, not an official alphaXiv client. It does not post public comments.

## Run locally

Requires Node.js 22.13 or newer and npm.

```sh
npm install
npm run build
npm start
```

Open http://127.0.0.1:4318. For development, run `npm run dev` and open the Vite URL printed in the terminal (normally http://127.0.0.1:5173). The Vite development server proxies API requests to port 4318.

The server listens on loopback. The default runtime directory is `.local-data` in the working directory. To use another port or directory, provide `PORT` and `DATA_DIR` in the process environment. `.env.example` describes the variables. `npm start` and `npm run dev` automatically load an optional `.env` file; copy the example to `.env` and set only what your environment needs. Neither setup nor startup reads personal model accounts, institutional credentials, or sibling projects.

## Read, search, and ask

1. Import a public paper webpage, arXiv/alphaXiv URL, direct PDF URL, or a local PDF.
2. Open the single reading overview or continuously scrolling PDF. PDF paper follows the light/dark theme; choose Original colors to inspect charts without color adjustment. Theme changes preserve your page, zoom, and annotations. Generate a Quick / Deep / Critical read with an optional focus, then switch saved versions without losing prior work. Choose article or interactive presentation; interactive versions can be downloaded as standalone offline HTML. Chinese and English controls use `/zh/` and `/en/` routes. Explicitly switching language translates the selected version on first use when a model is configured and reuses its saved translation afterward. The original is preserved. Search the library or arXiv for additional papers.
3. Choose how to generate content: use your existing Codex/Claude session with the skill below (no application API required), or configure providers in the model sidebar. A provider profile contains one base URL/key and multiple model IDs; save multiple profiles and switch their active model without re-entering a key. The OpenAI option supports compatible Chat Completions endpoints; Anthropic uses the Messages API. Use the connection test before generating reports. Advanced JSON options can supply provider-specific generation controls; they default to an empty object and cannot override messages or credentials. The source-character budget defaults to 44,000 and can be adjusted from 8,000 to 300,000 for your model. Reports state whether the extracted full text or excerpts were supplied; a character budget is not a token limit. The per-response output budget defaults to 4,096 tokens and can be adjusted from 512 to 16,384. Explicit token-limit truncation is treated as an error rather than a successful report.
4. Open the reading assistant from the persistent bottom-right controls. The assistant and notebook toggles remain reachable alongside the composer without reserving an empty footer. On desktop it docks beside the paper with a draggable, keyboard-adjustable divider; narrow windows use a full-height panel with a return-to-paper action. Select text in the overview, abstract, or PDF to translate/explain in place; Ask creates a separate question session with the selection. PDF selections can also be highlighted, underlined, or annotated. The notebook supports tags, search, Markdown preview, source jumps, soft-delete/undo, and Markdown/JSON or annotated-PDF export. Basic mouse/stylus ink has local undo and explicit saving; physical stylus pressure and palm rejection have not been device-tested. Figure previews can be enlarged without losing the reading position. Ask questions about the selected paper or use the research assistant across your library. Start a new conversation or restore a saved one from conversation history. Deep and Critical generation run a researcher, skeptical reviewer, and editor. Question sessions, translations, explanations, and overview versions have separate history categories.

The adversarial workflow is a review aid. Its roles may share one model; agreement does not establish scientific correctness. Unconfigured-provider fallbacks are labeled and should not be mistaken for live model answers. Extraction can be incomplete, especially for scanned PDFs without a text layer. Check source coverage and source links before relying on conclusions.

Selection translation/explanation has its own Chinese/English result-language choice, independent of the site's language. If interactive generation fails after the article is complete, the article is saved with an explicit notice. Retry conversion from that version without repeating the research/review stages. Structured-output repair is limited to one additional model request; transport errors are not silently retried.

Article and interactive translation can also complete separately. A failed or visibly untranslated set of cards does not discard the article translation. The reader shows the translated article and offers Retry interactive translation; incomplete cards are withheld from the interactive view and export. The Chinese/English mismatch check catches substantial untranslated prose, but is not a guarantee of translation quality or scientific accuracy.

Selection actions can use either a configured model API or an existing Codex/Claude subscription. A copied task is bound to the paper, exact selection, result language, operation, source pages and, for AI overview text, its fixed reading version. Importing the same completed task twice reuses the activity; a conflicting result cannot overwrite it. Refresh loads the result beside the selection without creating a question session. Selections over 12,000 characters are explicitly rejected instead of silently processed as truncated text. Cross-page PDF notes keep one logical note with separate source anchors.

The PDF reader includes a searchable text layer, outline and accessible internal links, with return-to-reading navigation. Named bibliography links can preview a source region before jumping; ordinary section links still navigate directly. Previews are drawn from the local PDF and do not invoke a model. Chapter links retain the overview version. Browser Back/Forward also follows explicit library, paper, overview and PDF-source navigation while preserving the reading position. Conversation scroll position, unsent question drafts and notebook edits are restored within the current browser tab. Opening or resizing the assistant preserves the current PDF position. Ordinary illustrated articles and interactive cards both export standalone HTML with embedded source crops, tables and equations; Markdown copies replace internal figure placeholders with visible captions and public source links.

## API usage

Open **API usage** in the left navigation to see input, output and total tokens, cache/reasoning breakdowns, daily usage, activity/model groups and paginated call history. Filter by the last 7/30/90 days or all time and model connection; dates follow your browser's timezone. The page itself never calls a model.

Only workbench API requests made after tracking is enabled are recorded. Every report review round is counted; translations reused from saved versions and Codex/Claude subscription imports are excluded. Failed requests with reported usage still count. Unknown usage is visibly distinguished from zero, and partial totals are marked `≥`. No prices or past usage are guessed. Counts persist locally in the runtime data directory, without prompts, answers, API keys or endpoint URLs. See [the usage API contract](docs/API.md#api-token-usage) for accounting and storage limits.

## Model configuration and data

Provider settings are supplied at runtime. HTTPS model endpoints are supported, including explicitly configured private inference services. Plain HTTP is restricted to localhost for local inference. This project has no hard-coded institutional endpoint or personal account requirement.

Each profile also has a per-request timeout, from 15 to 600 seconds (default 90). Long visual or reasoning requests may need more time than a connection probe. A multi-stage reading can take several request timeouts in total. The CLI's separate overall timeout defaults to 300 seconds and can be set with `PAPER_WORKBENCH_TIMEOUT_MS`.

Model settings, paper data, chat history, and imported PDFs are stored locally under `DATA_DIR`. Keys are stored in the local settings file as plaintext with restricted filesystem permissions; they are not returned by the settings API. The app does not provide a multi-user authentication layer or encrypted secret vault. Keep it bound to loopback. The default runtime directory and `.env` are excluded from Git. If you choose another `DATA_DIR`, keep it outside the checkout or add it to your own ignore rules.

Saving a connection in the sidebar or CLI persists its key, endpoint, model list and selected model in `DATA_DIR/store.json`; restarting the server restores them automatically. There is no need to re-enter the key. The optional `.env` configures server/network options; it does not automatically populate provider credentials. `PAPER_WORKBENCH_API_KEY` is a CLI input for `config set`, which saves the configuration through the same settings API.

When using a remote model, the selected paper excerpts and question are sent to that configured provider. External paper search and URL import contact their source services. No public commenting or publication feature is included.

## Figure understanding

Text-only models can use source text and figure captions and place actual cropped PDF figures near the relevant paragraph. The interface labels that image pixels were not analyzed. In model settings, explicitly declare image-input capability for a model and optionally select a separate visual connection/model. Names never imply capability. Figure analysis is opt-in: the browser renders the selected PDF crop and sends that image only when Analyze is clicked. The model's observations are stored with the source page, crop, model, image hash, and limitations; image bytes are not retained in those records. New observations are not used in later readings or questions until explicitly included. They remain unverified secondary evidence after inclusion. A changed PDF or crop makes older evidence stale.

Only the latest non-stale, included analysis for each figure is eligible for later model context. Compare its source crop and caption, then include it or keep it for reference. Inclusion can be undone; pending or excluded results do not silently fall back to an older observation or rewrite saved answers. Legacy observations keep their existing inclusion status. The exact evidence IDs used by a new request are recorded.

The server verifies payload shape and the crop binding supplied by the client; it does not independently render and authenticate those pixels. Model output remains fallible. Original-PDF downloads preserve the original file. The notebook can separately export an annotated PDF with saved highlights, underlines, notes and ink; unsaved drafts are excluded, and notes without spatial geometry become page comments. The export preserves source content and existing links; encrypted, signed or unsupported documents return a clear error, with Markdown/JSON alternatives still available. See [PDF export details and verification limits](docs/annotated-pdf-export.md). Offline article and interactive HTML embed only their used figure crops, not the full source PDF.

## Network configuration

Paper downloads and model calls respect explicit `HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY`, and `NO_PROXY` environment settings (lowercase variants are also supported). Use an HTTP(S) proxy URL; SOCKS proxy URLs are not supported. Loopback services should be included in `NO_PROXY`. These options are unset by default and contain no machine-specific proxy address.

Some network clients synthesize reserved addresses for public hostnames. Public paper downloads reject those addresses as part of private-network protection. On such networks, you can explicitly set `DNS_OVER_HTTPS_URL` to an HTTPS DNS JSON resolver, such as `https://cloudflare-dns.com/dns-query`. The selected resolver receives source hostname queries. The downloader validates the returned public addresses and pins the connection destination, including through the configured proxy; private targets remain blocked. This option does not change operating-system DNS settings.

## Use your Codex or Claude subscription

The [portable skill](skills/paper-workbench/SKILL.md) lets your already logged-in agent read the source, inspect PDF figures, produce summaries/translations/answers **in that agent session**, and save the results into this local reader. No alphaXiv account or additional model API key is required for this workflow. Your agent's own plan and usage limits still apply; the application does not access its login tokens or convert a subscription into an API key.

The paper assistant has an explicit question-processing selector. Without a configured API it defaults to **Codex / Claude subscription**: Enter or **Prepare subscription task** creates a fixed conversation task, copies it when permitted, and retains your draft. The inline task also supports manual copying and refreshing the saved answer. Paste it into your existing agent session to execute it. With an API configured, **Model API** is the default; **Local source search** remains an explicit option and never calls a model, even when credentials are configured. Suggested questions follow the selected mode too.

Prepared tasks and their completed status survive reloads within the same browser tab. A matching imported question/answer pair with the copied task ID marks the task complete; only its unchanged draft is cleared. Newer edits remain in the composer. Closing a task card keeps it dismissed. If tab storage is unavailable, the task stays usable in memory and a notice explains the reload limit. Older answer imports without a task ID remain readable but cannot mark a tracked task complete.

Open this checkout in Codex or Claude Code, then give it a task such as:

> Read skills/paper-workbench/SKILL.md. Use your current session to create a Chinese illustrated summary for the imported paper ID below, translate its original abstract into Chinese while keeping the English, and save both in Paper Workbench. Inspect the PDF before selecting figure crops. Do not call the workbench's model provider. Paper ID: paste the actual ID here.

Use the paper's “Agent / Skill” action to copy a task containing its actual ID and chosen language. The workflow is source → your agent's reasoning → local import → refreshed reader. An external agent can also answer a question and save the exchange in the application's conversation. For an already saved reading, its translation controls copy a task bound to that version; the result can include the complete article, figure captions and existing interactive cards. Refresh imports the saved result into that language without creating another reading.

Adding interactivity to an existing reading preserves its original article and figure snapshot in a separate version. The original article and the new interactive companion keep distinct attribution in version details and both offline export formats. A saved result becomes visible through refresh, but the reader explicitly chooses whether to open it.

```sh
node scripts/paper-workbench.mjs health
node scripts/paper-workbench.mjs list
node scripts/paper-workbench.mjs source "paper-id" --pages 1-5
node scripts/paper-workbench.mjs export "paper-id" --out "/tmp/new-paper-evidence"
# The current agent reads the source, inspects the PDF, and writes insights.json.
node scripts/paper-workbench.mjs publish "paper-id" "/tmp/insights.json"
node scripts/paper-workbench.mjs answer "paper-id" "/tmp/answer.json"
```

Use the actual `paper.id` returned by import/list. `publish` saves only to the local application; it does not publish online. The [agent import reference](skills/paper-workbench/references/agent-import.md) gives JSON examples for summaries, translations, figures, and answers. Do not commit evidence bundles or generated reading data.

Codex can read the repository skill directly, or you can copy its folder into your own configured skills directory. Claude Code can read `CLAUDE.md` and the same skill directly, or you can copy the skill folder to `.claude/skills/paper-workbench` in your checkout. When installed separately, locate and run commands from this application's checkout. Other agents can use the same Node.js CLI or HTTP API.

### Shared reading policy and optional companion skills

Both generation paths use the project's [shared reading contract](skills/paper-workbench/references/reading-contract.md): evidence-grounded explanations appropriate to the paper type, clear limitation provenance, and faithful translation. The API loads task-specific sections from that file; external agents read it through the skill. This is a prompt contract, not a guarantee of scientific accuracy.

In overview generation settings, the optional **Codex / Claude assistance skills** selector adds Supervisor-Skills, ARS-Codex, or both to the copied subscription task. It preserves the selected language, style, focus and format. The agent uses separately available skills and reports missing capabilities; the site does not install them or execute their hooks. This selector does not change direct API generation. These upstream suites have separate noncommercial licenses and are not bundled MIT dependencies; see the [external-skill guide](skills/paper-workbench/references/external-skills.md) and source assessments in `docs/`. The default project workflow needs neither suite. Downloaded `/api/agent-skill` embeds the import protocol, shared contract and external-skill guide with internal links.

### Optional direct provider mode

For model calls directly from the browser, configure provider profiles in the sidebar. Each profile stores one endpoint/key and a list of models. The CLI's `report`, `translate`, and `ask` commands use the currently active provider; they do **not** invoke your Codex/Claude subscription:

```sh
node scripts/paper-workbench.mjs report "paper-id" --language zh-CN --style deep --format interactive --focus "Evidence and limitations"
node scripts/paper-workbench.mjs translate "paper-id" --target reading --reading "reading-version-id" --language en
node scripts/paper-workbench.mjs ask "What is the main evidence?" --paper "paper-id"
```

Set `PAPER_WORKBENCH_URL` to select another instance. To set an API key, use `PAPER_WORKBENCH_API_KEY` through your secret manager or pipe it to `node scripts/paper-workbench.mjs config set --key-stdin`. Keys are never accepted as command arguments. See [docs/API.md](docs/API.md) for settings and the full local contract.

## Check and contribute

```sh
npm test
npm run build
npm run test:e2e
```

The browser suite uses Playwright; install its Chromium browser with `npx playwright install chromium` if it is not already available. External service availability and live-model validation are separate from deterministic tests. See [docs/model-validation.md](docs/model-validation.md) for the recorded validation limits. Product research and release decisions are documented in `docs/competitor-study-v3.md`, `docs/community-reading-skills.md`, and `docs/judge-v3.md`.

Before sharing a checkout, exclude runtime data, imported papers, API credentials, and private addresses. Code is licensed under [MIT](LICENSE). Paper contents and third-party names remain subject to their respective rights. No alphaXiv logo or proprietary application source is bundled.
