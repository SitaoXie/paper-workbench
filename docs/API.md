# Local HTTP API

Default origin: `http://127.0.0.1:4318`. JSON request bodies are limited to 256 KiB. Requests and responses use JSON except PDF upload and file retrieval. Errors have the shape `{ "error": "message" }` and a non-2xx HTTP status. Paper IDs are opaque; URL-encode them when constructing paths. This API is for a loopback, single-user application, not an authenticated public service.

## Library and import

| Method | Path                                 | Request                                              | Response                                       |
| ------ | ------------------------------------ | ---------------------------------------------------- | ---------------------------------------------- |
| GET    | `/api/health`                        | —                                                    | Server health information                      |
| GET    | `/api/papers`                        | —                                                    | `{ "papers": [...] }`                          |
| GET    | `/api/papers/:id`                    | —                                                    | `{ "paper": {...} }`, including extracted text |
| POST   | `/api/import`                        | `{ "url": "https://arxiv.org/abs/1706.03762" }`      | `{ "paper": {...} }`                           |
| POST   | `/api/upload`                        | `multipart/form-data`, field `file` containing a PDF | `{ "paper": {...} }`                           |
| PATCH  | `/api/papers/:id`                    | `{ "favorite": true }`                               | Updated paper                                  |
| DELETE | `/api/papers/:id`                    | —                                                    | Deletion result                                |
| GET    | `/api/papers/:id/file`               | —                                                    | Imported PDF file, when present                |
| GET    | `/api/search?q=attention&source=all` | Query parameters                                     | `{ "papers": [...] }`                          |

Search `source` accepts `all`, `local`, or `arxiv`. Remote search results are metadata, not necessarily library entries. Import a result's `url` and use the resulting `paper.id` before requesting a report or paper-scoped answer. External search can fail independently of local search.

Paper URL downloads accept public HTTP(S) destinations on standard ports; private-network destinations are blocked and redirects are revalidated. This restriction concerns paper retrieval. It is distinct from the user-configured model endpoint policy below. PDF extraction requires readable text; a scanned image-only PDF may not yield usable content.

## Provider settings

| Method | Path                 | Request                                        | Response                                                            |
| ------ | -------------------- | ---------------------------------------------- | ------------------------------------------------------------------- |
| GET    | `/api/settings`      | —                                              | Public provider settings, `apiKeyConfigured`, and `modelConfigured` |
| PUT    | `/api/settings`      | Partial settings object                        | Public provider settings                                            |
| POST   | `/api/settings/test` | `{}` for saved settings, or temporary settings | Connection test result                                              |

Settings expose `profiles` and `activeProfileId`, plus the active profile mirrored at top level for compatibility. A profile has a stable `id`, display `name`, `provider` (`openai` or `anthropic`), `baseUrl`, `models` (1–100 model IDs), selected `model`, optional `apiKey`, optional `extraBody`, `contextChars`, `maxOutputTokens`, and `requestTimeoutSeconds`. Up to 30 profiles can be stored. One endpoint/key is shared by all models in that profile; different profiles retain separate credentials.

```json
{
  "profiles": [
    {
      "id": "personal",
      "name": "My API",
      "provider": "openai",
      "baseUrl": "https://api.example.org/v1",
      "models": ["model-a", "model-b"],
      "model": "model-a"
    }
  ],
  "activeProfileId": "personal"
}
```

The example endpoint and model IDs are placeholders. A supplied `profiles` array replaces the saved list: include all profiles that should remain. Entries are matched by `id` for key preservation, and a new profile does not inherit another profile's key. To switch without replacing the list, send `{ "activeProfileId": "personal", "model": "model-b" }`. The selected model must belong to that profile. Legacy flat updates remain supported and affect only the active profile. Public settings responses redact every profile's key. Omit `apiKey` to preserve it when the provider and endpoint origin remain unchanged; switching provider or endpoint origin clears the old key unless a new key is explicitly supplied. Use `clearApiKey: true` to remove it. `contextChars` sets the source-character budget (integer 8,000–300,000; default 44,000). Choose a value that fits the model's context window and latency limits; characters are not tokens. If the extracted source fits the budget, every extracted page is included in full; otherwise excerpts are supplied and marked as truncated.

`maxOutputTokens` sets the completion budget for each report role and each answer (integer 512–16,384; default 4,096). Connection tests use a separate 30-token limit. An explicit provider token-limit stop is returned as HTTP 502 rather than stored as a complete answer/report; a failed regeneration preserves the last saved report. A concise report prompt and sufficient token budget are both necessary.

`requestTimeoutSeconds` sets the timeout for each individual model request (integer 15–600; default 90). Existing profiles without this field retain the 90-second behavior. It applies to OpenAI-compatible and Anthropic requests, including questions, report stages, translations, interactive generation, connection tests and vision analysis. Independent vision uses its selected profile's timeout. A timeout returns a sanitized HTTP 502 and does not save an incomplete result. Configure the active profile with `PUT /api/settings` and `{"requestTimeoutSeconds":240}`, or use `node scripts/paper-workbench.mjs config set --request-timeout-seconds 240`. This does not extend the CLI's separate end-to-end HTTP timeout (`PAPER_WORKBENCH_TIMEOUT_MS`, default 300,000 ms); for long or multistage jobs, set that limit sufficiently high as well.

`extraBody` supplies provider-specific generation options, for example `{ "chat_template_kwargs": { "thinking": false } }`. It defaults to `{}`, is limited to 16,000 serialized characters, and cannot override messages, the model, streaming, tools, token limits, or credentials. Consult the provider for supported options. The OpenAI provider supports compatible Chat Completions servers. HTTPS provider endpoints may be private services explicitly selected by the user; plain HTTP is allowed only on loopback hosts.

`apiKeyConfigured` indicates that a key is stored; `modelConfigured` also recognizes keyless loopback inference endpoints. Settings responses never include the saved key. Credentials are persisted locally with restricted permissions, not encrypted. Do not save real keys in source control, command arguments, test snapshots, or API documentation. The CLI accepts keys through `PAPER_WORKBENCH_API_KEY` or stdin. Model requests send relevant text and questions to the configured endpoint.

## Agent-authored content (no model provider required)

`PUT /api/papers/:id/insights` stores content created in an existing Codex, Claude, or other agent session. It makes no inference request and requires no model key. Partial fields are accepted:

```json
{
  "source": { "agent": "Codex" },
  "summary": {
    "language": "zh-CN",
    "markdown": "An evidence-grounded overview with [p.4]."
  },
  "translations": [
    {
      "target": "abstract",
      "language": "zh-CN",
      "markdown": "A translation of the original abstract."
    }
  ],
  "figures": [
    {
      "id": "figure-1",
      "page": 4,
      "crop": { "x": 0.1, "y": 0.2, "width": 0.8, "height": 0.35 },
      "caption": "A caption checked against the actual figure."
    }
  ]
}
```

Optional `report` uses the same `{language,markdown}` shape as `summary`. Source requires `agent` and optionally accepts `model`; the server sets `kind: "agent"` and timestamps. The response is `{paper}`. It marks imported summaries/reports `mode: "agent"` rather than claiming a server model generated them. The source identifier is attribution, not cryptographic verification.

Translations preserve originals and are stored as `paper.translations[language][target]`; targets are `abstract`, `summary`, and `report`. Language uses a valid BCP 47 tag. Omitted fields remain untouched. The supplied `figures` array replaces existing figures, so omit it to preserve them or include every wanted figure when editing the list. Coordinates are normalized fractions of the rendered PDF page with a top-left origin. Pages are one-based PDF page indices. Omitted `crop` displays a whole-page preview. Figures reference the imported PDF and do not upload arbitrary image URLs. A standalone `:::figure figure-id` line in overview Markdown embeds the matching figure at that reading position; translation should preserve it.

`POST /api/chats/import` stores an exchange produced by an external agent:

```json
{
  "paperId": "imported-paper-id",
  "question": "What limits the conclusion?",
  "answer": "A source-grounded answer with [p.4].",
  "source": { "agent": "Claude Code" }
}
```

Optional `conversationId` selects a conversation belonging to that paper; omission uses its active conversation. The result follows the chat response shape. Source attribution is persisted with the assistant message. This endpoint does not invoke a model. Repeating a successful request appends another exchange.

## Separate translation

`POST /api/papers/:id/translate` with `{ "language": "ja", "target": "summary" }` calls the selected model to translate the specified original independently. Targets are `abstract`, `summary`, and `report`; response is `{translation,paper}`. Existing original content remains unchanged. For subscription-session translation without an application API key, use the agent import endpoint above instead.

## Reports and questions

`POST /api/papers/:id/report`

```json
{ "adversarial": true, "language": "zh-CN" }
```

Returns `{ "report": ..., "paper": {...} }`. Report `coverage` distinguishes `full-text-extracted`, `source-excerpts`, and `abstract-only`; `contextCharacters` records source-context characters actually sent, and `sourceCharacters` records the complete source representation, including metadata and page markers. Extractive reports make no model call and use `contextCharacters: 0`. With adversarial review enabled, analyst, reviewer, and editor passes inspect the available paper content. They can share the same model; this is a critique process, not independent empirical replication. An unconfigured-provider fallback is explicitly labeled.

`POST /api/chat`

```json
{
  "paperId": "imported-paper-id",
  "message": "Which evidence supports the main claim?",
  "history": [
    { "role": "user", "content": "Summarize the method." },
    { "role": "assistant", "content": "Earlier answer." }
  ]
}
```

`paperId` and `history` are optional. Without `paperId`, the assistant uses library context. Omitted `history` reuses the saved conversation for that paper or general assistant; pass `history: []` for a fresh context. The response includes `message: { role: "assistant", content: "..." }`, `conversationId`, and may include `sources`. Follow the returned source links and distinguish a model interpretation from quoted evidence. Pass only the conversation history intended for the selected provider.

`GET /api/chats?paperId=...` returns `{ "messages": [...], "conversationId": "..." }` for the currently active conversation in that paper context. Omitting the paper ID selects the general assistant context. Up to the latest 100 messages are returned; older saved conversations remain available.

Add `&conversationId=...` to read one specific session without changing the active session. The session must belong to the supplied paper context, or to the general context if `paperId` is omitted; unknown and cross-context IDs return 404. Polling clients should pass their selected ID so an external agent opening another session cannot replace the visible history. An empty `conversationId` is invalid; omission retains the active-session behavior.

## Conversations

| Method | Path                             | Request                                                                              | Response                                                                |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| POST   | `/api/chats/new`                 | `{ "paperId": "..." }`, or `{}` for general research                                 | `{ "conversation": {...}, "conversationId": "...", "messages": [] }`    |
| GET    | `/api/conversations?paperId=...` | Optional paper context                                                               | `{ "conversations": [...], "activeConversationId": "..." }`             |
| PUT    | `/api/conversations/active`      | `{ "paperId": "...", "conversationId": "..." }`; omit `paperId` for general research | `{ "conversation": {...}, "conversationId": "...", "messages": [...] }` |

Each conversation has `id`, `paperId`, `title`, `createdAt`, and `updatedAt`; the list also returns `messageCount`. Starting a new conversation persists the selection without deleting earlier conversations. Choosing a saved conversation restores it in the same paper or general context. The server captures the active conversation when a question starts, so switching conversations during a request cannot attach its answer to the newly selected conversation. Existing saved chat records are migrated on startup.

The CLI `ask` command uses the active conversation. Use these HTTP endpoints or the UI to start or select another conversation.

No endpoint publishes a public comment, posts to alphaXiv, or uploads research conversations to an unrelated social service.

## CLI

Run `node scripts/paper-workbench.mjs --help` for command syntax. The default instance can be changed with `PAPER_WORKBENCH_URL`. Requests default to a 300-second timeout; set `PAPER_WORKBENCH_TIMEOUT_MS` for a different limit. Every success prints JSON; failures print an error object to stderr and exit nonzero. `ask` sends one question per invocation and the server reuses its saved conversation. Use the HTTP `history` field to explicitly replace that context.

## Unified reading versions

The reader now uses one coherent reading document at a time. Public papers include `readingVersions` and `activeReadingId`; legacy `summary`, `report`, and their history fields remain compatible. Existing documents are derived into stable IDs without rewriting the originals. If no explicit active version exists, an existing illustrated summary is preferred over the older report. Generating or importing another document appends a version and selects it; it never removes previous versions.

A version contains `{id, markdown, language, style, focus, title, createdAt, source?, mode?, stages?, figures?, translations?}`. `style` is `quick`, `deep`, or `critical`. `focus` is an optional reading emphasis of up to 3,000 characters. Figures are snapshots of local PDF references belonging to that version. `translations` maps a canonical BCP 47 language tag directly to a translation object. Matching translations from legacy summary/report fields are retained with their source revision. Original Markdown remains unchanged by translation.

```json
{
  "adversarial": true,
  "language": "zh-CN",
  "style": "quick",
  "focus": "Explain the central idea and whether the comparison uses fair baselines."
}
```

Send this to `POST /api/papers/:id/report`. The response is `{report, readingVersion, paper}`. Quick, deep, and critical styles use distinct prompts and lengths. A single final document is saved even when researcher, skeptic, and editor passes run. An unconfigured model still produces an explicitly labeled English extractive document, not a claimed translation or synthesis.

Switch a saved version with `PATCH /api/papers/:id` and `{ "activeReadingId": "reading-version-id" }`. The ID must belong to that paper; the existing `favorite` update can be included independently.

Translate a selected revision with `POST /api/papers/:id/translate`:

```json
{ "target": "reading", "readingId": "reading-version-id", "language": "en" }
```

Omitting `readingId` uses the active revision. The result is `{translation,paper}`. For subscription agents, `PUT /api/papers/:id/insights` also accepts translations with `target: "reading"`, `readingId`, `language`, and `markdown`. Optional top-level `style` and `focus` apply to imported summary/report content. Each supplied summary/report appends a distinct reading revision; new clients should import one complete document per generation.

## Highlights, notes, underlines, and handwriting

Annotation storage is independent from conversations and reading versions. All coordinates use normalized page fractions with a top-left origin. Pages are one-based PDF indices; a non-PDF source accepts page `1` only.

| Method | Path | Request / response |
| --- | --- | --- |
| GET | `/api/papers/:id/annotations` | `{annotations:[...]}`; add `?includeDeleted=true` to include the undoable trash |
| POST | `/api/papers/:id/annotations` | Annotation fields below; returns HTTP 201 `{annotation}` |
| PATCH | `/api/papers/:id/annotations/:annotationId` | Partial mutable fields; returns `{annotation}` |
| DELETE | `/api/papers/:id/annotations/:annotationId` | Soft delete; returns `{ok:true,annotation}` with `deletedAt` |
| PATCH | `/api/papers/:id/annotations/:annotationId` | `{restore:true}` restores a deleted annotation |
| GET | `/api/papers/:id/annotations/export?format=markdown` | Download active notes as Markdown |
| GET | `/api/papers/:id/annotations/export?format=json` | Download active notes including exact geometry as `{version,paper,annotations}` |

```json
{
  "kind": "highlight",
  "page": 4,
  "rects": [{ "x": 0.12, "y": 0.3, "width": 0.65, "height": 0.025 }],
  "quote": "The selected source passage.",
  "body": "Check whether this holds for the ablation as well.",
  "color": "yellow",
  "tags": ["method", "follow-up"]
}
```

Kinds: `highlight`, `underline`, `note`, `ink`, `translation`, `explanation`. Colors: `yellow`, `green`, `blue`, `pink`, `purple`. Optional `language` is a BCP 47 tag. Server-generated fields are `id`, `paperId`, `createdAt`, `updatedAt`, and optional `deletedAt`; do not send these as mutable fields. `quote` is limited to 12,000 characters, `body` to 50,000, tags to 20 entries of 80 characters, and rectangles to 300. Notes and saved translation/explanation annotations need body text; highlights/underlines need a quote or rectangles. Embedded remote images and active HTML are rejected; text remains untrusted Markdown.

Handwriting uses `kind: "ink"` and `strokes: [{width,points:[{x,y,pressure?}]}]`. Width is a fraction of page width, greater than zero and at most `0.05`. Point coordinates and optional pressure lie in `[0,1]`. A request accepts up to 200 strokes and 12,000 total points, subject to the shared 256 KiB JSON-body limit. Markdown export describes ink annotations; JSON export retains their exact stroke geometry. Deleting a paper deletes its notes and activities as well.

## In-place explanation and translation history

`POST /api/papers/:id/assist` accepts:

```json
{ "kind": "translation", "text": "A selected passage.", "page": 4, "language": "zh-CN" }
```

`kind` is `translation` or `explanation`. Selected text is limited to 12,000 characters and must reference an existing page. The configured model receives selected text and nearby source context. Translation returns only the selected passage in the target language; explanation asks for a concise grounded explanation with page references. Missing configuration returns an error instead of fabricating a translation. An incomplete or failed provider response is not saved.

The response is `{result,activity}`. `result` has `{text,kind,language,source,createdAt}`. `activity` adds `{id,paperId,quote,page}` and contains the same result. Successful calls are automatically stored in **activities**, not notes or chats. Save a result as an annotation only after the user requests it. A paper allows one concurrent passage request; the local server permits up to three across papers and 30 starts per minute. Conflicts return 409 and rate limits return 429. Upstream credentials and error bodies are not exposed.

`GET /api/papers/:id/activities` returns `{activities:[...]}` newest first. Optional `?kind=translation` or `?kind=explanation` filters the history. For an external subscription agent, `POST /api/papers/:id/activities` accepts the same `kind`, `text`, `page`, and `language`, plus `result` as either a string or `{text}`, and optional `source: {agent,model?}`. It records the result without invoking a provider or creating a note/conversation.

## Question-session metadata

New conversations have `kind: "question"`. `POST /api/chats/new` optionally accepts `kind: "question"` and `metadata: {quote,page}` with a paper context. Translation and explanation do not create question sessions. `POST /api/chat` and `/api/chats/import` also accept this metadata; it is preserved with the user message. The model receives quoted metadata as source context. `POST /api/chat` optionally accepts `conversationId` to address a specific session in the same paper rather than whichever session is currently active. Unknown or cross-paper IDs return 404. Existing conversations are exposed as question sessions after migration.

## Source scope for inline help

Inline `/assist` and agent `/activities` requests also accept `sourceScope`. Existing PDF requests default to `pdf` and retain their validated `page`; non-PDF requests default to `source-text`. A generated overview selection uses `{sourceScope:"reading",readingId,kind,text,language}`. An original abstract selection uses `{sourceScope:"abstract",kind,text,language}`. These two scopes must omit `page`: an overview or abstract is not silently relabeled PDF page 1. Reading IDs must belong to the paper. The response and saved activity preserve `sourceScope` and optional `readingId`; no conversation or annotation is created. Generated overview text is explicitly identified to the model as potentially fallible generated content, with original paper evidence supplied separately.

## Explicit vision configuration and figure evidence

Every provider profile has `modelCapabilities`, a map from its configured model IDs to `"text"` or `"vision"`. Omitted entries default to `"text"`; model names never imply vision support. Declaring capability is a user assertion, not a provider compatibility test. `PUT /api/settings` accepts a separate vision choice referencing an existing profile and model:

```json
{
  "profiles": [{
    "id": "my-provider",
    "name": "My provider",
    "provider": "openai",
    "baseUrl": "https://api.example.com/v1",
    "model": "text-reader",
    "models": ["text-reader", "figure-reader"],
    "modelCapabilities": {"text-reader":"text", "figure-reader":"vision"}
  }],
  "activeProfileId": "my-provider",
  "vision": {"enabled":true,"profileId":"my-provider","model":"figure-reader"}
}
```

Keys are entered locally using the existing settings mechanism. Public settings return capabilities and the vision choice but never API keys. Disabled vision is the default. Text report generation does not automatically invoke a vision model.

`POST /api/papers/:id/figures/:figureId/analyze` submits a client-rendered crop from an already imported local PDF:

```json
{
  "page": 4,
  "crop": {"x":0.1,"y":0.2,"width":0.8,"height":0.35},
  "image": {"mimeType":"image/png","data":"BASE64_WITHOUT_DATA_URL_PREFIX"},
  "language": "zh-CN",
  "focus": "Explain visible axes and distinguish observations from speculation."
}
```

The figure must already exist with the same page and normalized crop; caption-only page previews are rejected. The server accepts PNG or JPEG, at most 4 MiB decoded, 12,000 pixels per dimension and 24 megapixels; the route's encoded JSON limit is 6 MiB. Remote image URLs and unsupported MIME types are rejected. Focus is limited to 3,000 characters. There is one active vision request per paper, two globally, and 12 starts per minute. Source edits during inference return 409 rather than attaching an answer to a different crop. OpenAI-compatible requests use image URL content containing a data URL; Anthropic uses base64 image content. Upstream failures are sanitized and are not saved.

The response is `{evidence,paper}`. `paper.visualEvidence` retains records with `id`, `figureId`, `page`, `crop`, `caption`, `markdown`, `language`, `focus`, `imageHash`, image dimensions/MIME type, `createdAt`, `source:{kind:"model",model,profileId}`, and explicit provenance:

- `pixelsProvided:true`: pixels were submitted, not independently verified.
- `analysisMethod:"vision-model"` and `modelUnverified:true`: this is a model interpretation.
- `binding:"client-rendered-pdf-crop"`: source coordinates are validated, but pixel-level correspondence is not independently checked on the server.
- `limitations`: machine-readable explanatory caveats. Public records additionally expose `stale:true` if their source crop has since changed.

Raw image bytes are not persisted or logged. The last four matching, current observations may be supplied as clearly marked, unverified evidence to a later text report or question. Report/message sources expose `pixelsProvided:false`, `visualEvidenceMode:"prior-vision-observations"` (or `"none"`), and the exact `visualEvidenceIds` actually present in that text context. This does not claim that the text model directly inspected or verified pixels. Records with changed source crops are retained for provenance but excluded from subsequent model evidence.

## Structured interactive readings

Report requests accept `format:"article"|"interactive"` (default `article`). An interactive reading first produces grounded Markdown, then a second structured generation. Both belong to one immutable reading version with `{format:"interactive",interactive:{schemaVersion:1,blocks:[...]}}`. If the structured pass fails, the existing reading remains unchanged. Unlike the article's labeled extractive fallback, interactive generation requires a configured model or an externally imported agent result.

Blocks are plain data, never executable code:

```json
{
  "schemaVersion": 1,
  "blocks": [
    {"id":"idea-1","type":"concept","title":"Central idea","text":"A concise grounded explanation.","citations":[{"page":4}]},
    {"id":"chart-1","type":"figure","figureId":"figure-1","explanation":"Interpretation with uncertainty.","citations":[{"page":4}]},
    {"id":"check-1","type":"question","question":"What limits the result?","answer":"The reported evaluation scope.","explanation":"Why this matters.","citations":[{"page":4}]}
  ]
}
```

There are 1–24 blocks with unique stable IDs. PDF citations must name existing pages, and figure blocks must refer to a real crop in that reading version and cite its actual page. Sources without PDF pages use source labels or empty citations. Unknown fields, including script or URL slots, are rejected. Text fields are displayed as text and are never executed.

`PUT /api/papers/:id/insights` accepts `format` and `interactive` inside its `summary` or `report` object. For a single-document import, these may instead be top-level fields. An interactive document still requires Markdown for accessible article fallback and export. Supplying top-level interactive blocks with both summary and report is ambiguous and rejected. Imports are validated before any document is replaced.

Translating `target:"reading"` translates Markdown and interactive display text. IDs, block types/order, figure IDs and citations remain unchanged. The model receives only a display-text array, `[{id,fields:[{name,value}]}]`; it does not reconstruct source bindings. Block IDs and field names must match exactly, with no missing, duplicate or unknown entries. The application merges validated values into the original structure and then checks the complete result again. Every title, explanation, question and answer is translatable; formulas, technical names and brief quotations may remain unchanged. Basic English/Chinese script and unchanged-text checks reject substantial untranslated display prose. These checks are not complete language identification or a guarantee of translation quality. Mapping or language failures receive at most one repair attempt using the same display-only format and strict validation. External agents continue to import full interactive objects under the original source-binding contract.

If the article translation succeeds but interactive translation fails, the endpoint returns HTTP 200 with the completed article and `translation.interactiveTranslationError`, including a safe failure category such as timeout, connectivity, output limit, language or source binding. The response omits unusable `interactive` blocks. Clients must show article fallback and the partial-completion state. Repeating the same request reuses the existing article and retries only interactive translation; no additional flag is needed. A successful retry saves `translation.interactive` and clears the error. Public paper responses also hide invalid historical blocks without deleting their underlying stored record. External agents can import optional interactive translations under the same language and binding checks; a Markdown-only agent translation remains valid and can be completed later.

### Excluding an unreliable visual observation

`PATCH /api/papers/:id/visual-evidence/:evidenceId` accepts exactly `{ "excluded": true }` to stop using a saved observation as evidence in future model requests, or `{ "excluded": false }` to restore eligibility. The boolean is required; invalid types or extra fields return 400. Unknown or cross-paper evidence IDs return 404. The response is `{evidence,paper}` and the record stores `excluded` and `updatedAt`; its image interpretation and history are preserved.

Evidence selection first chooses the most recently appended observation for each figure, then checks its crop and exclusion state. If that latest record is excluded or stale, earlier records are **not** revived automatically. Restoring an older record does not override a newer excluded record. This does not retroactively rewrite saved readings, messages, or requests already in progress; regenerate affected material as needed.

### Translation reuse and concurrent requests

`POST /api/papers/:id/translate` reuses a non-stale complete saved translation for the requested source revision and canonical language, without invoking a model. This includes agent-authored translations; there is no implicit regeneration of complete results on repeated clicks. An interactive reading's incomplete or invalid translated blocks are the exception: the existing article is reused while only the blocks are retried. For `target:"reading"`, requests for the same paper, reading ID, language and source hash share one in-flight translation job. Legacy `abstract`, `summary` and `report` requests similarly share a job for the same paper, target, language and source revision. Interactive Markdown and block translation remain one shared job.

A failed job is removed and may be retried. An incomplete article is not cached; a complete article is retained when its subsequent interactive step fails. Invalid interactive blocks are never treated as a complete cache. Changed or deleted sources still reject obsolete results. If an external agent publishes a valid translation of that source while inference is running, the model result does not overwrite it. Coalescing lasts within the current server process; it does not resume provider requests after a server restart.
