# Paper Workbench

A local research workspace inspired by alphaXiv's reading experience: a paper library, URL and PDF imports, paper summaries, evidence-grounded reports, search, and a research assistant with configurable model providers. This is an independent implementation, not an official alphaXiv client. It does not post public comments.

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
2. Open the paper to read its illustrated overview and continuously scrolling PDF. Select a reading language and translate the abstract or overview separately; originals remain available. Search your library or query arXiv for additional papers.
3. Choose how to generate content: use your existing Codex/Claude session with the skill below (no application API required), or configure providers in the model sidebar. A provider profile contains one base URL/key and multiple model IDs; save multiple profiles and switch their active model without re-entering a key. The OpenAI option supports compatible Chat Completions endpoints; Anthropic uses the Messages API. Use the connection test before generating reports. Advanced JSON options can supply provider-specific generation controls; they default to an empty object and cannot override messages or credentials. The source-character budget defaults to 44,000 and can be adjusted from 8,000 to 300,000 for your model. Reports state whether the extracted full text or excerpts were supplied; a character budget is not a token limit. The per-response output budget defaults to 4,096 tokens and can be adjusted from 512 to 16,384. Explicit token-limit truncation is treated as an error rather than a successful report.
4. Open the reading assistant from the persistent bubble. On desktop it docks beside the paper with a draggable, keyboard-adjustable divider; narrow windows use a full-height panel with a return-to-paper action. Select PDF text to ask, explain, or translate from a nearby input. Figure previews can be enlarged without losing the reading position. Ask questions about the selected paper or use the research assistant across your library. Start a new conversation or restore a saved one from conversation history. Generate a report with the adversarial option to run an analyst, a skeptical reviewer, and an editor.

The adversarial workflow is a review aid. Its roles may share one model; agreement does not establish scientific correctness. Unconfigured-provider fallbacks are labeled and should not be mistaken for live model answers. Extraction can be incomplete, especially for scanned PDFs without a text layer. Check source coverage and source links before relying on conclusions.

## Model configuration and data

Provider settings are supplied at runtime. HTTPS model endpoints are supported, including explicitly configured private inference services. Plain HTTP is restricted to localhost for local inference. This project has no hard-coded institutional endpoint or personal account requirement.

Model settings, paper data, chat history, and imported PDFs are stored locally under `DATA_DIR`. Keys are stored in the local settings file as plaintext with restricted filesystem permissions; they are not returned by the settings API. The app does not provide a multi-user authentication layer or encrypted secret vault. Keep it bound to loopback. The default runtime directory and `.env` are excluded from Git. If you choose another `DATA_DIR`, keep it outside the checkout or add it to your own ignore rules.

When using a remote model, the selected paper excerpts and question are sent to that configured provider. External paper search and URL import contact their source services. No public commenting or publication feature is included.

## Network configuration

Paper downloads and model calls respect explicit `HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY`, and `NO_PROXY` environment settings (lowercase variants are also supported). Use an HTTP(S) proxy URL; SOCKS proxy URLs are not supported. Loopback services should be included in `NO_PROXY`. These options are unset by default and contain no machine-specific proxy address.

Some network clients synthesize reserved addresses for public hostnames. Public paper downloads reject those addresses as part of private-network protection. On such networks, you can explicitly set `DNS_OVER_HTTPS_URL` to an HTTPS DNS JSON resolver, such as `https://cloudflare-dns.com/dns-query`. The selected resolver receives source hostname queries. The downloader validates the returned public addresses and pins the connection destination, including through the configured proxy; private targets remain blocked. This option does not change operating-system DNS settings.

## Use your Codex or Claude subscription

The [portable skill](skills/paper-workbench/SKILL.md) lets your already logged-in agent read the source, inspect PDF figures, produce summaries/translations/answers **in that agent session**, and save the results into this local reader. No alphaXiv account or additional model API key is required for this workflow. Your agent's own plan and usage limits still apply; the application does not access its login tokens or convert a subscription into an API key.

Open this checkout in Codex or Claude Code, then give it a task such as:

> Read skills/paper-workbench/SKILL.md. Use your current session to create a Chinese illustrated summary for the imported paper ID below, translate its original abstract into Chinese while keeping the English, and save both in Paper Workbench. Inspect the PDF before selecting figure crops. Do not call the workbench's model provider. Paper ID: paste the actual ID here.

Use the paper's “Agent / Skill” action to copy a task containing its actual ID and chosen language. The workflow is source → your agent's reasoning → local import → refreshed reader. An external agent can also answer a question and save the exchange in the application's conversation.

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

### Optional direct provider mode

For model calls directly from the browser, configure provider profiles in the sidebar. Each profile stores one endpoint/key and a list of models. The CLI's `report`, `translate`, and `ask` commands use the currently active provider; they do **not** invoke your Codex/Claude subscription:

```sh
node scripts/paper-workbench.mjs report "paper-id" --language zh-CN
node scripts/paper-workbench.mjs translate "paper-id" --target summary --language ja
node scripts/paper-workbench.mjs ask "What is the main evidence?" --paper "paper-id"
```

Set `PAPER_WORKBENCH_URL` to select another instance. To set an API key, use `PAPER_WORKBENCH_API_KEY` through your secret manager or pipe it to `node scripts/paper-workbench.mjs config set --key-stdin`. Keys are never accepted as command arguments. See [docs/API.md](docs/API.md) for settings and the full local contract.

## Check and contribute

```sh
npm test
npm run build
npm run test:e2e
```

The browser suite uses Playwright; install its Chromium browser with `npx playwright install chromium` if it is not already available. External service availability and live-model validation are separate from deterministic tests. See [docs/model-validation.md](docs/model-validation.md) for the recorded validation limits.

Before sharing a checkout, exclude runtime data, imported papers, API credentials, and private addresses. Code is licensed under [MIT](LICENSE). Paper contents and third-party names remain subject to their respective rights. No alphaXiv logo or proprietary application source is bundled.
