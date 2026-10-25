# Local HTTP API

Default origin: `http://127.0.0.1:4318`. JSON request bodies are limited to 256 KiB. Requests and responses use JSON except PDF upload and file retrieval. Errors have the shape `{ "error": "message" }` and a non-2xx HTTP status. Paper IDs are opaque; URL-encode them when constructing paths. This API is for a loopback, single-user application, not an authenticated public service.

## Library and import

### Question agent

`POST /api/chat` keeps its existing conversation, selection, processing and response contract, and adds optional boolean `webSearch` (default `false`; invalid types fail before session mutation). With a configured model, questions now use native tool calls. `processing: "extractive"` still makes no model or external-web calls even when `webSearch: true` is supplied.

The internal tools are `search_papers({query,paperId?})`, `read_pages({paperId,pages,offset?})`, and, only when enabled, `search_web({query})` and `read_webpage({url,offset?})`. Paper-scoped chats restrict local tools to that paper; general research chats can search the library. Searches return exact source excerpts and offsets. Pages accept 1–3 one-based PDF indices; long page text can be continued with `nextOffset`. Non-PDF source text uses input page 1 but returns `page: null`, and metadata-only results are labeled. Tools do not inspect image pixels.

Web searches use DuckDuckGo HTML by default or Tavily when `TAVILY_API_KEY` is present in the server environment; `PAPER_WORKBENCH_SEARCH_PROVIDER` explicitly chooses `duckduckgo` or `tavily`. No runtime key is returned by public APIs or passed to the model. Web reads accept only URLs explicitly supplied in the current question or returned by search, enforce existing public-network download safeguards, extract HTML/plain text and reject PDF/binary responses. External search snippets never imply a full webpage was read. Provider failures are tool errors, not empty successful searches. No automatic provider fallback occurs.

Limits: four retrieval rounds, at most ten executed tools, one final synthesis call, five-minute agent deadline plus per-profile request timeouts. Source text is shared between initial context and bounded tool results; oversized results return an explicit budget error. The model may answer directly when initial context suffices. Each model round is counted in the usage ledger with `stage: "question-agent-N"`. Unsupported native-tool providers and incomplete final answers return errors; the loop does not silently fall back to a fabricated tool transcript.

Saved assistant messages add `source.questionAgent`:

```json
{
  "version": 1,
  "webEnabled": false,
  "modelCalls": 2,
  "toolCharacters": 1200,
  "limitReached": false,
  "initialSources": [{"paperId":"paper-id","title":"Paper","coverage":"source-excerpts","characters":8000}],
  "steps": [{"tool":"read_pages","ok":true,"cached":false,"references":[{"paperId":"paper-id","title":"Paper","page":4,"start":0,"end":1000,"complete":true}]}]
}
```

Each step may include `query` and, on failure, `error`; references may instead contain a public `url`. These are server-recorded operations, not the model's self-report. Tool payloads, credentials and private model reasoning are not persisted in this metadata. Existing `source.inputContext.totalMessageCharacters` describes the initial message payload including agent instructions; additional retrieved evidence is in `toolCharacters`. Initial source IDs plus successfully retrieved local paper IDs populate the existing `sources` list. Native function calling follows the [OpenAI protocol](https://developers.openai.com/api/docs/guides/function-calling) and [Anthropic tool-result protocol](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls).

### Library endpoints

| Method | Path                                 | Request                                              | Response                                       |
| ------ | ------------------------------------ | ---------------------------------------------------- | ---------------------------------------------- |
| GET    | `/api/health`                        | —                                                    | Server health information                      |
| GET    | `/api/papers`                        | —                                                    | `{ "papers": [...] }`                          |
| GET    | `/api/papers/:id`                    | —                                                    | `{ "paper": {...} }`, including extracted text |
| POST   | `/api/import`                        | `{ "url": "https://arxiv.org/abs/1706.03762" }`      | `{ "paper": {...} }`                           |
| POST   | `/api/upload`                        | `multipart/form-data`, field `file` containing a PDF | `{ "paper": {...} }`                           |
| PATCH  | `/api/papers/:id`                    | Partial `{ "favorite": true, "title": "Correct title", "tags": ["Methods"] }` | Updated paper                                  |
| DELETE | `/api/papers/:id`                    | —                                                    | Deletion result                                |
| GET    | `/api/papers/:id/file`               | —                                                    | Imported PDF file, when present                |
| GET    | `/api/search?q=attention&source=all` | Query parameters                                     | `{ "papers": [...] }`                          |

Search `source` accepts `all`, `local`, or `arxiv`. Remote search results are metadata, not necessarily library entries. Import a result's `url` and use the resulting `paper.id` before requesting a report or paper-scoped answer. External search can fail independently of local search.

Paper metadata includes `authors` and `institutions`, independent ordered arrays of names. The overview displays them under the title; institutions are publication affiliations, not inferred current employers or author-to-institution mappings. Import reads explicit `citation_author_institution` / `citation_affiliation` web metadata and arXiv author affiliation fields when available. Missing metadata stays empty; PDF affiliations may be filled after checking the source. `PATCH /api/papers/:id` accepts `authors` (up to 1,000 names) and `institutions` (up to 200), each a non-empty single-line string of at most 300 characters. Names are whitespace-normalized and deduplicated; `[]` clears the corresponding field. Mixed patches validate before mutation and preserve readings, source pages and notes. Agent `source` output and exports retain both fields.

Paper URL downloads accept public HTTP(S) destinations on standard ports; private-network destinations are blocked and redirects are revalidated. This restriction concerns paper retrieval. It is distinct from the user-configured model endpoint policy below. PDF extraction requires readable text; a scanned image-only PDF may not yield usable content.

Classification edits accept at most 30 tags, each a non-empty single-line string up to 80 characters. Leading/trailing whitespace is removed, and case-insensitive Unicode-normalized duplicates are collapsed. `tags: []` clears classification. A corrected `title` must be non-empty single-line text up to 500 characters. A mixed patch validates every field before changing anything. These metadata edits preserve PDF contents, page anchors, notes and existing reading versions. A title change invalidates question recommendations; a tag change does not. `activeReadingId` remains available for selecting an existing reading version.

Public paper metadata includes an opaque `recommendationSourceRevision`, also in library listings. Clients use it to invalidate visible question suggestions when source text or title changes without replacing the PDF. It excludes ordinary generated reading versions, notes and tags; included visual evidence that enters model context is part of the source identity.

## Library folders

Folders and labels are separate. `paper.tags` remains a flat list of labels. `GET /api/collections` returns `{ collections }`; every entry has `id`, `name`, `kind`, `parentId`, `paperIds`, and `createdAt`. Three built-in `kind: "status"` folders have stable IDs `status-want-to-read`, `status-reading`, and `status-completed`. Status memberships may overlap, and do not imply assignment to a custom folder. Custom folder names are user content; the client translates only built-in status names.

- `POST /api/collections`: `{ "name": "Research topic", "parentId": null }` creates a custom folder. Names are single-line, 1–100 characters; sibling names must be unique after Unicode/case normalization.
- `PATCH /api/collections/:id`: partial `{ "name": "New name", "parentId": "parent-folder-id" }` renames or relocates a custom folder. `parentId: null` moves it to the root. Cycles, nesting under status folders and trees deeper than eight levels are rejected before mutation.
- `DELETE /api/collections/:id`: deletes a custom folder and its memberships, never its papers or notes. Nonempty membership is permitted, but existing subfolders cause a 409; relocate/delete those first. Built-in status folders cannot be renamed, relocated or deleted.
- `POST /api/collection-memberships`: `{ "paperIds": ["paper-id"], "addTo": ["folder-id"], "removeFrom": [] }` changes memberships atomically. Up to 500 existing papers and 100 folders in each operation are accepted. All references are validated before mutation. A folder cannot appear in both lists. An add deduplicates membership; an explicit move (add + remove) removes source membership even when the paper already exists in the destination. Other memberships and all paper data are preserved.

Every successful mutation returns the updated `{ collections }`. Paper deletion removes its memberships. Collection responses omit deleted paper IDs. These endpoints never invoke models. Legacy labels are not automatically turned into folders; create folders and assign memberships explicitly through the UI or API.

The information architecture is informed by [alphaXiv's public library tool documentation](https://www.alphaxiv.org/docs/mcp): folders/subfolders, overlapping paper memberships and reading-status folders. This does not imply visual parity or integration with alphaXiv accounts.

## Recommended questions

This optional feature is off by default. Select a separate saved connection/model through a partial settings update:

```json
{
  "recommendations": {
    "enabled": true,
    "profileId": "personal",
    "model": "model-a"
  }
}
```

The selected model must belong to that profile. Switching the main chat model does not change this selection. `{ "recommendations": { "enabled": false } }` disables automatic generation while retaining the selection. Removing its connection/model disables recommendations and clears their selection; explicitly enabling an invalid selection is rejected. No credentials are copied into these preferences.

| Method | Path | Request | Behavior |
| --- | --- | --- | --- |
| GET | `/api/papers/:id/recommendations?language=zh-CN` | `language`: `zh-CN` or `en`, default `zh-CN` | Read matching cache only; never invokes a model. |
| POST | `/api/papers/:id/recommendations` | `{ "language": "zh-CN", "refresh": false }` | Reuse matching cache or generate one set. `refresh: true` explicitly replaces a cached set. |

Both routes return `{ enabled, recommendation, cached }`. When disabled, GET returns `{ "enabled": false, "recommendation": null, "cached": false }`; POST returns 409 without making a provider request. When enabled with no matching cache, GET returns `recommendation: null`.

A recommendation contains `id`, `language`, `createdAt`, `questions` (3–5 items with `id`, `question`, `angle`), `source: { kind: "model", model, profileId }`, `coverage` and `contextCharacters`. Angles are `understanding`, `method`, `evidence`, `limitations`, or `extension`. They are unverified model suggestions, not established claims or answers. The UI should prepare an editable question when one is selected; sending it is a separate action.

Generation makes one model call using up to 44,000 source characters, capped by the selected profile's context setting. It requires strict JSON, distinct bounded questions and the requested language, with a conservative language mismatch check. It does not silently retry failures. Models that return malformed JSON, substantially wrong-language prose or truncated output must be retried explicitly or changed. Cache identity includes source text/PDF identity, title, language, provider/endpoint identity, model and generation configuration. Endpoint identity is hashed; returned cache data contains neither endpoints nor keys. Up to six source/configuration variants are retained per paper. Cache is stored only in the ignored local data store and omitted from ordinary paper responses.

Identical concurrent calls share one generation. The server allows at most two simultaneous generations and twelve new generations per minute; cache reads remain available. Changed source/configuration or a disabled feature invalidates a pending result before saving. A failed refresh preserves the prior valid set. Disabling the feature or aborting a browser request cannot undo an already submitted provider call. Actual calls are counted as `recommendations` in API usage.

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

`maxOutputTokens` sets the completion budget for each report role and each answer (integer 512–65,536; default 65,536 / 64K). Connection tests use a separate 30-token limit. An explicit provider token-limit stop is returned as HTTP 502 rather than stored as a complete answer/report; a failed regeneration preserves the last saved report. Reading length follows the requested style, focus, source complexity and available evidence, without fixed word or character quotas. The token budget is a transport ceiling, not a requested response length; providers may impose a lower supported maximum. Saved explicit budgets remain unchanged unless edited.

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

Translations preserve originals. Legacy targets `abstract`, `summary`, and `report` are stored as `paper.translations[language][target]`. The preferred `reading` target stores the translation on its immutable reading version and **requires an explicit nonempty `readingId`** in every insights import, including caption-only entries; missing/invalid IDs return 400, and a version outside this paper returns 404. It never follows the current active version. Language uses a valid BCP 47 tag. Omitted fields remain untouched. The supplied `figures` array replaces existing figures, so omit it to preserve them or include every wanted figure when editing the list. Coordinates are normalized fractions of the rendered PDF page with a top-left origin. Pages are one-based PDF page indices. Omitted `crop` displays a whole-page preview. Figures reference the imported PDF and do not upload arbitrary image URLs. A standalone `:::figure figure-id` line in overview Markdown embeds the matching figure at that reading position; translation should preserve it.

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

Optional `agentTaskId` is a standard UUID identifying the copied question task. It is validated before any conversation or message is created, normalized to lowercase, and stored on **both** the new user and assistant messages. The assistant response and later `/api/chats?paperId=...&conversationId=...` reads expose it; the CLI `answer` command forwards this JSON field unchanged. A consumer must match the fixed paper, conversation, task ID and question metadata before treating an imported answer as completion of its pending task. The ID is a correlation label, not authentication, source verification or an idempotency key: repeated successful imports still append exchanges. Omission remains compatible with older agents, but an unlabelled old answer must not complete a newer UUID-bound task. Invalid UUIDs return 400 without changing conversations or messages; normal paper/conversation binding checks still apply.

Subscription handoffs always supply the fixed `conversationId` and preserve the copied task's per-question `metadata`: a complete object overrides the old selection for this exchange; `null` explicitly suppresses inheritance after clearing a selection; omission inherits the addressed conversation's binding. A copied task includes `null` or the new full source scope, reading ID and page range when applicable. Do not drop that field or infer it from question prose. See source-scope validation below.

### Source passage links in Markdown

Reading overviews and question answers accept optional semantic passage links using standard Markdown; no new JSON field is required:

```markdown
[Coverage caveats](#page=42 "exact short verbatim excerpt from paper")
```

Replace the example with actual evidence. The fragment refers to the current paper's one-based PDF page index. The title is an original-language, contiguous source passage of at most 500 characters, copied from the cited page; escape Markdown title quotes/backslashes, then use normal JSON serialization. Use a short sentence where helpful, not a quote for every citation. `[p.N]` remains the page-only fallback. For metadata or web sources without PDF pages, retain `[Abstract]` / `[Source text]`. Multi-paper answers must name the relevant paper and avoid local passage links without a single-paper binding. An external URL containing `#page=` is never interpreted as a local PDF citation.

The server stores the title as untrusted Markdown, not a verified quotation, source geometry, note, or command. Model generation only encourages a title when its supplied page context contains the exact passage; truncated context does not authorize reconstruction of missing sentences. Generated overviews and visual-model observations are not original page text. The reader attempts a deterministic unique text match on the specified local PDF page, then highlights that match; unavailable, invalid or ambiguous quotes fall back to the page with an explanation. This locates source text and does not validate a scientific claim. Model/source links are never followed automatically. Translation must preserve the fragment and source-language title while translating the visible label. Structured interactive citations continue using their existing page/label fields.

Provider-driven article translation protects these bindings programmatically. A CommonMark parser with math support replaces each existing local page link with a per-request opaque destination before inference. Reference-style links, including repeated uses, are resolved and protected separately. The model can translate the displayed label; the server restores the original destination and decoded title using safe Markdown escaping, ignoring any replacement title supplied by the model. It verifies that every protected occurrence survives exactly once and that the result has the same local bindings and standalone `:::figure` marker counts. Code, math, images and external URLs containing page fragments are not reinterpreted as local citations. Invalid, missing, duplicated or invented bindings produce HTTP 502 with a safe retry message; the failed article is not cached and previously saved versions remain available. There is no automatic additional paid repair request. This preserves an existing source binding, not the accuracy of the quote or the quality of the translation. Agent imports remain untrusted Markdown and must follow the same source-preservation guideline.

## Separate translation

`POST /api/papers/:id/translate` with `{ "language": "ja", "target": "summary" }` calls the selected model to translate the specified original independently. Targets are `abstract`, `summary`, and `report`; response is `{translation,paper}`. Existing original content remains unchanged. For subscription-session translation without an application API key, use the agent import endpoint above instead.

## Reports and questions

Model reports and questions load the repository-owned reading contract from `skills/paper-workbench/references/reading-contract.md`. Reports load common evidence rules and the overview section; questions load their scoped section alongside the base evidence prompt. Translation uses only the faithful-translation section. New report, question and full-content translation model results record `source.readingPolicy: { id, version, sha256 }`, identifying the contract snapshot, not a certification of the output. Existing versions, extractive fallbacks and agent-authored content are not retroactively stamped. Passage assistance also receives the scoped guidance but retains its existing source metadata shape.

No external skill registry, user installation directory, remote prompt or upstream hooks are loaded by the API. Optional Supervisor/ARS collaboration belongs to copied subscription-agent tasks. `GET /api/agent-skill` returns a self-contained Markdown bundle with the import protocol, shared contract and external-skill guidance; local reference links become internal anchors.

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

The optional `processing` field makes the requested operation explicit. `"extractive"` performs local lexical source retrieval with **zero upstream model calls**, even when a provider is configured. It does not modify saved keys, settings or profiles; the returned and stored assistant `mode` is `"extractive"`. The answer labels the excerpts and explains that a Codex/Claude subscription session or configured API can provide cross-language synthesis. `"api"` requires a usable configured provider; otherwise the request returns 409 with `code:"chat_model_unconfigured"`, before creating a conversation or storing messages, instead of silently falling back. Other values (including null) return 400 before any session is created. Omitting `processing` preserves the previous behavior: use the configured provider when available, otherwise clearly labeled local extraction. Subscription-session work is prepared by the client and saved through `/api/chats/import`; it is not a third server processing mode. Explicit modes retain the same paper/session/selection isolation as other questions.

For a single-paper question with validated `metadata.page` or `metadata.pages`, source selection prioritizes those original PDF pages in full when they fit `contextChars`. If multiple selected pages exceed the budget, each gets a fair first verbatim excerpt before any page receives additional chunks. Remaining space uses verbatim chunks ranked by local question/quote word matches, followed by broad page excerpts. An oversized single selected page uses its matching chunks first. Limited Chinese research-term expansions help lexical retrieval but do not provide general cross-language semantic search. Sources that fit retain complete extracted text. Selected source text stays within the existing source-character budget, and omitted context remains labeled; a valid range does not imply that every selected page was included in full. Arbitrary page-looking question strings are not parsed into a trusted selection; metadata without a paper context or with an unavailable page is rejected. See [the portable validation guide](model-validation-guide.md) for private, source-bound model checks and their limits.

Question history has a separate total character allowance of `min(24000, floor(contextChars / 2))`, across at most the 12 latest messages. Newer turns take priority. User/assistant pairs stay together where possible; shortened messages retain their beginning and end with an explicit omission marker. The model is told when older messages are unavailable or a retained assistant reply has no paired question. The complete current question and validated selection are preserved; the source-character setting is **not** a total model token limit. The payload also includes system guidance, the current question/selection and provider JSON overhead, so choose settings with the model's actual context capacity in mind. Model answers optionally return numerical `source.inputContext` statistics: `sourceCharacters`, `historyCharacters`, `historyBudgetCharacters`, `includedHistoryMessages`, `omittedHistoryMessages`, `truncatedHistoryMessages`, `withdrawnVisualHistoryMessages`, `incompleteHistory`, `currentQuestionCharacters`, and `totalMessageCharacters`. These contain no source text or prompts and do not estimate tokens.

Stored assistant answers with explicit `source.visualEvidenceIds` are screened before entering later question context. If any referenced observation is excluded, stale, superseded, unavailable or has malformed provenance, that entire assistant message becomes an explicit withdrawal placeholder for the model; the original saved conversation remains untouched. Still-current historical observations are marked as unverified model output, never original paper text or a fresh pixel inspection, and their retained IDs appear in the answer's visual provenance. Caller-provided `history` is copied as role/content only, so clients cannot manufacture trusted provenance by attaching a `source` object. Legacy answers without visual IDs cannot be traced precisely to withdrawn observations; all earlier answers remain untrusted, and the model is instructed not to treat them as primary evidence.

`GET /api/chats?paperId=...` returns `{ "conversation": {...}, "messages": [...], "conversationId": "..." }` for the currently active conversation in that paper context. Omitting the paper ID selects the general assistant context. Up to the latest 100 messages are returned; older saved conversations remain available. `conversation` is the exact addressed session, including its source binding even when it has no messages, or `null` when no session exists. The optional `conversationId` query parameter selects a session in the supplied paper context without changing the active session; a mismatched paper/session returns 404.

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

`source <paper-id> [--pages 1-4,8]` returns primary extracted evidence plus relevant figure metadata and visual observations. It omits generated summaries, report translations, and reading versions by default, so a narrow page request does not consume an agent's context with every earlier interpretation. Add `--include-derived` to include those older fields explicitly, or use `readings` to inspect versions. In either mode, `visualEvidence` includes only records the server marked `eligibleForContext:true` against the **complete paper history**, using the same current/latest/included/source-matching policy and four-record limit as model context. Then `--pages` narrows figures and eligible observations to those pages. A newer excluded or stale observation on another page cannot resurrect an older matching one. An older server without eligibility markers yields no visual observations in `source`, rather than guessing eligibility. These observations remain unverified derived content. `get` and `export` retain the complete visual history with eligibility markers; false records are historical, not current model evidence. `export` also retains the full archive and available original PDF. Page ranges require safe positive integers and at most 1,000 distinct pages per call.

Run `node scripts/paper-workbench.mjs --help` for command syntax. The default instance can be changed with `PAPER_WORKBENCH_URL`. Requests default to a 300-second timeout; set `PAPER_WORKBENCH_TIMEOUT_MS` for a different limit. Every success prints JSON; failures print an error object to stderr and exit nonzero. `ask` sends one question per invocation and the server reuses its saved conversation. Use the HTTP `history` field to explicitly replace that context.

## Unified reading versions

The reader now uses one coherent reading document at a time. Public papers include `readingVersions` and `activeReadingId`; legacy `summary`, `report`, and their history fields remain compatible. Existing documents are derived into stable IDs without rewriting the originals. If no explicit active version exists, an existing illustrated summary is preferred over the older report. Generating or importing another document appends a version and selects it; it never removes previous versions.

A version contains `{id, markdown, language, style, focus, title, createdAt, source?, mode?, stages?, figures?, translations?}`. `style` is `quick`, `deep`, or `critical`. `focus` is an optional reading emphasis of up to 3,000 characters. Figures are snapshots of local PDF references belonging to that version. `translations` maps a canonical BCP 47 language tag directly to a translation object. Matching translations from legacy summary/report fields are retained with their source revision. Original Markdown remains unchanged by translation.

When a focused report's source exceeds `contextChars`, the focus also guides local lexical retrieval of original passages. Up to about 20% of the source budget retains explicitly partial page-prefix orientation; the remaining budget selects relevant original excerpts. It does not parse a page number from focus text as an authorized PDF selection, guarantee retrieval of all relevant evidence, or change `coverage` to full text. Empty-focus reports retain the general source excerpt policy. All adversarial roles receive the same available cropped-figure identities and captions; whole-page previews are not offered as extracted figures, and text-only generation does not inspect image pixels.

```json
{
  "adversarial": true,
  "language": "zh-CN",
  "style": "quick",
  "focus": "Explain the central idea and whether the comparison uses fair baselines."
}
```

Send this to `POST /api/papers/:id/report`. The response is `{report, readingVersion, paper}`. Quick, deep, and critical styles use distinct explanatory scopes rather than fixed word counts. A single final document is saved even when researcher, skeptic, and editor passes run. An unconfigured model still produces an explicitly labeled English extractive document, not a claimed translation or synthesis.

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
| GET | `/api/papers/:id/annotations/export?format=pdf` | Download a separate annotated PDF containing saved, active annotations |
| GET | `/api/papers/:id/annotations/pdf-source` | Read the current PDF hash and annotation export binding status |
| POST | `/api/papers/:id/annotations/pdf-source` | Explicitly accept current bytes for an otherwise unbound legacy import |

Every new PDF upload, direct PDF URL import and successful arXiv PDF import stores `sourcePdfRevision`, the SHA-256 of the originally imported bytes, as well as the current `pdfRevision`. Figure and vision operations may update the latter but never rewrite the original source binding. PDF annotation export compares the bytes it read with `sourcePdfRevision`; legacy uploads may use their original `contentHash`. A mismatch returns 409 `pdf_source_changed`, preserving all saved annotations and the source file.

An older import without a reliable original fingerprint returns 409 `pdf_source_unbound` until the reader explicitly accepts the current PDF through the operation below. In particular, a legacy arXiv import's mutable current `pdfRevision` is not evidence that its historical notes belong to the current file. Export does not silently bind such records to whatever bytes exist now. Markdown/JSON remain available. Missing source files return `pdf_source_missing` or `pdf_source_unavailable`. These are source-binding limits, not a claim that the original document or its annotations were independently verified.

`GET /api/papers/:id/annotations/pdf-source` returns `{pdfRevision,bindingStatus,boundPdfRevision?,annotationExportBinding?}`. `pdfRevision` is computed from current file bytes. `bindingStatus` is `original` when they match the immutable import hash (or legacy upload hash), `user-accepted` when they match an explicit legacy export choice, `unbound` when neither exists, or `changed` when bytes differ from the saved binding. `boundPdfRevision` is omitted for `unbound`. GET does not create or update a binding.

After the reader views the current PDF and explicitly chooses to use it for export, `POST` to that same endpoint accepts exactly `{"expectedPdfRevision":"SHA256_FROM_GET","acceptCurrentSource":true}`. Only an unbound import is eligible. The server hashes actual bytes and rechecks paper identity and source bindings after the asynchronous read; a stale hash or changed binding returns 409. Success returns HTTP 201 with the same state shape and stores `annotationExportBinding:{pdfRevision,acceptedAt,method:"user-accepted-current-pdf"}`. It does not modify `sourcePdfRevision`, any notes, or their positions, and does not assert that old annotations were verified. This choice is used only by annotation PDF export, never as original evidence provenance for model or figure operations.

An original or already accepted binding cannot be replaced by this endpoint. A matching existing binding returns 409 `pdf_source_already_bound`; changed bytes return 409 `pdf_source_changed`. Concurrent accepts save exactly one choice; a losing request may return `pdf_source_binding_changed`. Invalid request fields return 400 `pdf_source_acceptance_invalid`. Once accepted, another file change stops PDF export instead of silently accepting the new file. Reimport the correct source and review annotation positions when the current file is not the intended one.

PDF rectangle export accepts the same normalized `1e-6` edge tolerance as annotation saving, clamping only that small rounding excess to the visible page. It does not alter stored rectangles, and refuses larger excursions or a rectangle with no visible page area.

PDF export takes a snapshot of saved, non-deleted annotations and writes standard PDF annotations without flattening the paper. It preserves original page content, links and existing annotations; it does not modify the stored source or include browser drafts. Geometry-free notes become page comments. Response headers include `X-Annotation-Count` (emitted PDF annotation objects), `X-Annotation-Page-Comments`, and `X-Annotation-Source-Binding: original|user-accepted`; `Content-Disposition` supplies a sanitized title-based UTF-8 filename. Chinese note content is stored as Unicode. An unavailable source returns 404/409, changed bound source bytes return 409, and unsupported encryption, signatures or geometry return 422 with a safe `code` and `error`. Markdown/JSON export remains available. See [export implementation and independent-render checks](annotated-pdf-export.md). CLI `export <id> --out <new-directory> --annotated-pdf` adds this separate PDF to the normal bundle and returns `annotatedPdfWarning` if unavailable; it never replaces `paper.pdf`.

Markdown note exports include paper title, available authors, the original public paper URL and PDF URL when available. Each PDF note links to the actual PDF with a one-based `#page=N` fragment. Web notes link to source text. Local documents retain explicit page instructions when no portable public URL exists; exports never include the server's local PDF path or manufacture a public download address. Unsupported URL schemes, loopback/private IPs, embedded credentials and credential-bearing query links are omitted from the Markdown source links.

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

A selection across PDF pages is one logical annotation with a `segments` array and one shared `body`, `tags`, and `color`:

```json
{
  "kind": "note",
  "segments": [
    { "page": 4, "quote": "A passage at the end of this page.", "rects": [{ "x": 0.12, "y": 0.8, "width": 0.65, "height": 0.025 }] },
    { "page": 5, "quote": "Its continuation on the next page.", "rects": [{ "x": 0.12, "y": 0.1, "width": 0.65, "height": 0.025 }] }
  ],
  "body": "One comment covering both source passages.",
  "tags": ["follow-up"],
  "color": "yellow"
}
```

`segments` accepts 1–20 existing PDF pages in strictly increasing order, with no duplicates. A segment accepts only `page`, `quote`, and `rects`, and needs a nonempty quote or rectangles (scanned page regions can omit quote). The 12,000-character quote budget and 300-rectangle budget apply across **all** segments, not per page; all geometry is validated before saving any part. Segments are not accepted for web sources or ink strokes. The response also exposes top-level `page`, `quote`, and `rects` as aliases of the **first** segment for compatibility; if supplied alongside `segments`, those aliases must agree exactly after validation.

PATCH `{body,tags,color}` edits shared fields and retains every segment. Changing source anchors on a multi-segment record requires the complete `segments` array; a flat `page`, `quote`, or `rects` PATCH is rejected instead of silently discarding later pages. DELETE and `{restore:true}` operate atomically on the single annotation ID and all its segments. Old flat single-page records remain supported, and previously split records are never inferred or merged. JSON export remains `version:1` with additive `segments`; Markdown exports each source page and excerpt under one logical note, followed by one shared comment and tag list.

Handwriting uses `kind: "ink"` and `strokes: [{width,points:[{x,y,pressure?}]}]`. Width is a fraction of page width, greater than zero and at most `0.05`. Point coordinates and optional pressure lie in `[0,1]`. A request accepts up to 200 strokes and 12,000 total points, subject to the shared 256 KiB JSON-body limit. Markdown export describes ink annotations; JSON export retains their exact stroke geometry. Deleting a paper deletes its notes and activities as well.

## In-place explanation and translation history

`POST /api/papers/:id/assist` accepts:

```json
{ "kind": "translation", "text": "A selected passage.", "page": 4, "language": "zh-CN" }
```

A selection spanning several PDF pages can instead send `{ "kind":"explanation", "text":"Combined selected text.", "sourceScope":"pdf", "pages":[4,5], "language":"en" }`. `pages` follows the question metadata validation below; the server derives `page:4` for older clients. The entire selection creates one activity with the complete page range.

`kind` is `translation` or `explanation`. Selected text is limited to 12,000 characters. PDF selections must reference existing source pages. The configured model receives selected text and source context, with all selected PDF pages prioritized within the bounded context allowance. Translation returns only the selected passage in the target language; explanation asks for a concise grounded explanation with page references. Missing configuration returns an error instead of fabricating a translation. An incomplete or failed provider response is not saved.

Selections containing only numbers or symbols return HTTP 400 for translation before invoking a model; select surrounding words or use explanation instead. Empty, null, or null-like model results return HTTP 502 and create no activity. External activity imports likewise reject missing or null-like result text with HTTP 400.

Accepted selected text retains its exact leading indentation and trailing newlines in the model request and stored activity. If both `text` and `quote` are provided, their strings must match exactly. An old task containing trimmed text is still replayable with that same saved text; using its UUID for a newly indented selection is a changed binding and returns 409.

The numeric/symbol-only translation error has stable `code:"selection_no_translatable_text"` alongside its safe `error` message for client localization. An otherwise valid `/assist` request without a usable model configuration returns HTTP 400 with `code:"selection_model_unconfigured"` and a human-readable message; clients can offer the subscription passage handoff without guessing from message text. This code is specific to passage assistance, not other model APIs. Unknown internal or provider error codes are not passed through.

The response is `{result,activity}`. `result` has `{text,kind,language,source,createdAt}`. `activity` has `{id,paperId,kind,text,quote,sourceScope,language,result,source,createdAt}`, plus `page` and optional `pages` for a PDF selection, or `readingId` for a generated reading selection. Successful calls are automatically stored in **activities**, not notes or chats. Save a result as an annotation only after the user requests it. A paper allows one concurrent passage request; the local server permits up to three across papers and 30 starts per minute. Conflicts return 409 and rate limits return 429. Upstream credentials and error bodies are not exposed.

`GET /api/papers/:id/activities` returns `{activities:[...]}` newest first. Optional `?kind=translation` or `?kind=explanation` filters the history. For an external subscription agent, `POST /api/papers/:id/activities` accepts the same `kind`, `text`, `page`/`pages`, `sourceScope`, optional `readingId`, and `language`, plus `result` as either a string or `{text}`, and optional `source: {agent,model?}`. It records the result without invoking a provider or creating a note/conversation.

### Subscription passage task identity

External activity import optionally accepts `agentTaskId`, a standard UUID generated once by the selection handoff. The server normalizes UUID case to lowercase. The first successful import binds the saved task to `paperId`, normalized `sourceScope`, optional `readingId`, page/range, selected text, canonical language and kind. It returns HTTP 201 with `{activity}` including `agentTaskId`. All existing scope/page/version validation applies before saving. `text` and `quote` are aliases; supplying both with conflicting values is rejected. A supplied `paperId` must match the path, and `readingId` is valid only for a reading scope.

A second import with the same UUID, binding and result text returns HTTP 200 `{activity,reused:true}` with the original ID, timestamp and provenance. Concurrent identical imports produce one record. A different binding (including another paper) or changed result returns HTTP 409, preserving the saved record. An equivalent PDF singleton `pages:[4]` and legacy `page:4` have the same effective binding, though the first saved representation is retained. Invalid requests do not reserve a task ID. Imports without `agentTaskId` keep their legacy append behavior. This contract concerns activity import; it does not trigger, retry or coalesce provider inference.

`GET /api/papers/:id/activities?agentTaskId=uuid` returns only that paper's exact task result, or `{activities:[]}` when absent; it may be combined with `kind`. Invalid UUIDs return 400. The CLI supports `activities <paper-id> --agent-task <UUID>` and the existing `activity <paper-id> <activity.json|->` import command. No API provider key is required. The client must still compare returned kind, language, quote, scope, reading ID and effective page range with its fixed task, and guard against a selection change during refresh. A UUID correlates a task; it neither authenticates an agent nor verifies source fidelity. An explicit revision requires a fresh task. Keep the original task ID when checking an uncertain save or retrying the same payload.

## Question-session metadata

New conversations have `kind: "question"`. `POST /api/chats/new` optionally accepts `kind: "question"` and `metadata: {quote,page?,pages?}` with a paper context. A quote may contain up to 12,000 characters. `pages` is an optional array of 1–20 strictly increasing, unique, existing page numbers from a locally imported PDF; non-PDF sources cannot use it. The server derives `page` from its first entry, and rejects an explicitly conflicting `page`. Legacy single-page metadata keeps its original shape. A quote from a generated overview can omit both anchors rather than inventing a PDF page. Anchors establish source locations, not the truth or exactness of caller-supplied text; quoted metadata stays untrusted model input. Translation and explanation do not create question sessions. `POST /api/chat` and `/api/chats/import` also accept this metadata; it is preserved with the user message. `POST /api/chat` optionally accepts `conversationId` to address a specific session in the same paper rather than whichever session is currently active. Unknown or cross-paper IDs return 404. Existing conversations are exposed as question sessions after migration.

Selection metadata also supports an explicit `sourceScope`: `pdf`, `source-text`, `reading`, or `abstract`. A generated overview must send `{ "quote":"Selected interpretation", "sourceScope":"reading", "readingId":"existing-reading-version-id" }`; the reading version must belong to this paper (otherwise 404). An abstract selection uses `{ "quote":"Selected abstract text", "sourceScope":"abstract" }`; `source-text` identifies an imported non-PDF source and `pdf` requires a locally imported PDF. All non-PDF scopes must omit both `page` and `pages`, including selections from the abstract of a PDF paper. `readingId` is accepted only with `sourceScope:"reading"`. Scope alone is insufficient: supply a quote or a valid PDF page anchor. An abstract stored as a first-page excerpt remains labeled an excerpt in model instructions. The same validation applies to new sessions, direct questions, subscription imports and branch drafts. The declared scope describes origin; it does not verify that caller-supplied text matches that origin. Generated interpretation text stays outside the primary source corpus, and model instructions require checking its claims against original evidence. Existing metadata without a scope keeps its original shape; the server does not guess or retrofit a source type.

For `POST /api/chat` and `/api/chats/import`, omitting `metadata` inherits the addressed conversation's saved selection in a single-paper session, after validating its quote, scope, reading version and page anchors again. An explicit metadata object overrides the selection for that request. Send `metadata: null` to suppress inheritance for that request after the reader removes the selected passage. Inheritance/overrides are saved on the new user message for traceability but do not alter the conversation's original binding. No selection is borrowed from another conversation or paper, and general research sessions cannot inherit a paper selection. Clients that keep a removed selection disabled should continue sending `null` until the user chooses a new passage. Branch drafts retain the same validated page range and source scope. CLI users can create a bound overview session with `new-session <paper-id> --quote "Selected interpretation" --source-scope reading --reading <reading-id>`; `answer` imports JSON into that explicit conversation and follows the same inheritance or `metadata:null` rules.

`POST /api/chat` optionally accepts `questionText`, the original nonempty user input of at most 12,000 characters before any client-added source prose. It is preserved exactly on the saved user message for editing; the provider still receives `message` plus structured metadata. The response now includes `userMessage` with its persistent ID, content, optional `questionText`, selection metadata and session IDs, alongside the existing assistant `message`. Prefer sending the original question as `message` and the selected source separately as `metadata`, rather than concatenating the quote twice. For an existing `conversationId`, omit client `history` to use the server's saved message provenance and its bounded history/withdrawn-vision handling.

### Edit or retry a question in a new branch

`POST /api/conversations/:conversationId/branch` creates a new active question session without invoking a model:

```json
{ "paperId": "paper-id", "messageId": "saved-user-message-id", "action": "edit" }
```

`paperId` is required; use explicit `null` for a general research session. `action` is `edit` (default) or `retry` and records intent only. The source conversation, target saved message and supplied paper must match. A missing or cross-context resource returns 404; targeting an assistant message or passing unsupported fields returns 400. No request body can replace the target's stored content or source metadata during branch creation.

The new session contains fresh-ID copies of **all messages strictly before the target user question**, including any history outside the last-100-message display window. It excludes the target itself, its old answer and every later message. Its `source` is `{kind:"branch",conversationId,messageId,action,createdAt}`. Each copied message retains original text, timestamps, selected-source metadata and model/agent provenance, and adds `branchSource:{conversationId,messageId?,messageIndex,copiedAt}`. A legacy prefix message without an ID remains traceable by its source index. Existing source conversations and messages are unchanged; copied vision provenance still undergoes the usual invalidation checks when answering.

The 201 response is `{conversation,conversationId,messages,draft:{message,metadata,verbatim}}`. The draft uses the target's `questionText` when available, otherwise preserves its entire legacy `content` without guessing how a client appended selections. `verbatim:true` identifies this legacy fallback; clients must avoid appending the same quote again. The new session's bound selection comes only from the target user message, not an older conversation-level selection that the user may have removed. Missing target metadata is returned as `null`.

To edit, show the draft and send the edited question through the existing `/api/chat` with the new `conversationId`; to retry, submit the returned draft unchanged. These are separate actions: creating a branch performs no inference, never deletes the original, and does not silently reuse the old answer. A failed subsequent model request leaves the original session and the prepared branch available.

## Source scope for inline help

Inline `/assist` and agent `/activities` requests also accept `sourceScope`. Existing PDF requests default to `pdf` and retain their validated `page` and optional `pages`; non-PDF requests default to `source-text`. A generated overview selection uses `{sourceScope:"reading",readingId,kind,text,language}`. An original abstract selection uses `{sourceScope:"abstract",kind,text,language}`. These two scopes must omit both `page` and `pages`: an overview or abstract is not silently relabeled PDF page 1. `source-text` also rejects `pages`, while retaining legacy `page:1` compatibility. Reading IDs must belong to the paper. The response and saved activity preserve `sourceScope` and optional `readingId`; no conversation or annotation is created. Generated overview text is explicitly identified to the model as potentially fallible generated content, with original paper evidence supplied separately.

## Reviewed PDF figure references

`GET /api/papers/:id/figures` returns `{figures,pdfRevision,figuresRevision}` without modifying the library. It requires a locally imported PDF. `pdfRevision` is the SHA-256 of the actual stored PDF bytes; `figuresRevision` is an opaque revision of this paper's complete current figure collection. Neither exposes a private source path or image data. Missing or unusable local PDF files return a sanitized 409.

`POST /api/papers/:id/figures` inserts one reviewed crop. `PATCH /api/papers/:id/figures/:figureId` edits one existing reference while preserving its ID and the other figures. Both accept this envelope; PATCH's `figure` may contain only the fields to change:

```json
{
  "pdfRevision": "<pdfRevision from GET>",
  "expectedFiguresRevision": "<figuresRevision from GET>",
  "figure": {
    "page": 3,
    "crop": {"x":0.1,"y":0.15,"width":0.7,"height":0.35},
    "caption": "Figure 1: Caption checked against the source PDF.",
    "label": "Fig. 1"
  },
  "source": {"method":"pdfjs-candidate","reviewed":true}
}
```

`source.method` is `manual` or `pdfjs-candidate`; `reviewed:true` is required. Automatic browser candidates are provisional and are not published by these routes without this explicit review. A crop covering at least 90% of the page area requires `method:"manual"` and is stored with `largeCrop:true`. Review provenance records the user's crop review, not scientific verification or an independent pixel analysis. The crop uses normalized coordinates on the PDF page as rendered in its original page rotation. Pages must exist; dimensions must be positive and the entire rectangle must fit within that page. A caption is required (at most 3,000 characters); a label is optional (at most 120). External URLs, image bytes, caller-assigned IDs, source overrides, and unknown fields are rejected. A legacy page preview must receive an actual crop before it can be saved as a figure.

The response is `{paper,figure,figures,pdfRevision,figuresRevision}`, with HTTP 201 for insertion and 200 for editing. A changed PDF or collection revision returns 409; clients must reload and review current state before retrying. Two concurrent writes with the same old collection revision cannot both succeed. Each paper supports 30 references. Edits retain at most 20 flat prior states in `figure.history`, including the previous crop, caption, source and replacement time. No separate image asset is stored.

Before the first edit, legacy readings are materialized into stable versions. Existing reading `figures` and their caption translations remain unchanged. A new report captures its source and figures before its first model request; researcher, skeptic, editor, interactive conversion and final version all use that same snapshot. `readingVersion.figuresRevision` records that snapshot's collection revision, and `pdfRevision` records the source bytes checked for the operation. Editing current figures during generation does not discard a completed paid report or overwrite the newer current crops. Conversion of a saved reading keeps that reading's own figure snapshot. Archived crops are source references, not a separate PDF backup; if the underlying PDF is replaced, a client must not present their old geometry as verified against the new bytes.

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
- `excluded:true` on every new observation: saved for inspection, but not supplied to later reports or questions until the user explicitly includes it. Existing records without this field retain their prior included behavior; no migration changes their choice.
- `binding:"client-rendered-pdf-crop"`: source coordinates are validated, but pixel-level correspondence is not independently checked on the server.
- `limitations`: machine-readable explanatory caveats. Public records additionally expose `stale:true` if their source crop has since changed, and `eligibleForContext` computed from the complete paper history. A matching crop alone does not make a superseded or excluded record eligible. The eligibility flag is a current inclusion policy, not scientific verification, and is not persisted as authoritative input.

Raw image bytes are not persisted or logged. Up to four matching, current, included observations may be supplied as clearly marked, unverified evidence to a later text report or question. Receiving a successful analysis, reviewing its crop, or saving a note does not include it automatically. Report/message sources expose `pixelsProvided:false`, `visualEvidenceMode:"prior-vision-observations"` (or `"none"`), and the exact `visualEvidenceIds` actually present in that text context. This does not claim that the text model directly inspected or verified pixels. Records with changed source crops are retained for provenance but excluded from subsequent model evidence.

New vision records additionally include `pdfRevision`, computed from the local PDF before inference and checked again before saving. A source-byte change during inference returns 409 and saves no observation. A known PDF revision mismatch invalidates observations even when page number and crop coordinates are unchanged. Legacy records without a hash remain compatible while the source is unchanged; when an explicit byte revision change is observed, those records receive `sourceRevisionChanged:true` and stay excluded if the PDF later reverts. A reviewed crop bound to different source bytes must be reviewed again before a new vision request. The PDF files are application-owned immutable imports; these checks do not grant permission to replace them in place, and there is no background filesystem watcher.

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

### Derived interactive versions without a provider

To add an interactive companion to an **existing original reading**, use the distinct `derivedInteractive` import. Read the fixed version through `GET /api/papers/:id` or CLI `readings`; public versions expose `derivationRevision`, an opaque SHA-256 comparison token. It binds the original Markdown, language, style, focus, title, figure snapshot, attribution, creation time and known PDF/page binding. It excludes translation caches and the active selection. For legacy versions without a stored figure snapshot, the exposed snapshot is resolved from their existing source once for that read; changing that fallback before import invalidates the token.

```json
{
  "source": {"agent":"Codex"},
  "derivedInteractive": {
    "sourceReadingId":"fixed-original-reading-id",
    "expectedSourceRevision":"actual-64-character-derivationRevision-from-the-source-version",
    "agentTaskId":"1e489e92-565c-4e3d-93fd-0977585b5ba6",
    "interactive": {
      "schemaVersion":1,
      "blocks":[
        {"id":"scope","type":"concept","title":"Evidence scope","text":"Replace with a source-supported companion in the original reading language.","citations":[{"page":4}]}
      ]
    }
  }
}
```

Replace the example revision, UUID and content with the copied task and inspected source. This envelope permits only `source` and `derivedInteractive`; the nested object permits only the four shown fields. Combining it with `summary`, `report`, translations, replacement Markdown, language, figures or an active-version change is rejected. The source must belong to this paper. The existing interactive schema and bounds apply; figure blocks must use this version's real crop and cite its page, even if the current library has newer figures. Display text remains escaped text; arbitrary HTML/script/resource fields are rejected, not executed or fetched.

The server synchronously checks the revision and task binding before insertion and copies original Markdown, language, style, focus, title and figures without rewriting them. It appends one version with `mode:"agent-interactive"`, `derivedFromReadingId`, `derivedSourceRevision`, `agentTaskId`, `source` identifying the companion's agent, and `articleSource` retaining the original article attribution when available. New translations are empty: cached translations are not promoted to original text or silently applied to new blocks. Neither the old versions/translations nor `summary`, `report`, current figures or the effective active version are changed.

The response is `{paper,readingVersion,reused}`. An exact retry for the same paper, source revision, task UUID and normalized blocks returns the saved version with `reused:true`; a concurrent identical submission appends once. A reused UUID with different source or blocks, or a changed source revision, returns 409 without overwriting content. Invalid fields return 400 and a source outside this paper returns 404. Inspect the saved task after an unknown outcome; do not silently choose a fresh UUID or revision to bypass a conflict. These checks bind local records; they are not scientific verification or a background check of externally replaced PDF bytes. No inference request or configured provider key is involved. The caller may offer the returned new version for explicit selection separately.

Translating `target:"reading"` translates Markdown and interactive display text. IDs, block types/order, figure IDs and citations remain unchanged. The model receives only a display-text array, `[{id,fields:[{name,value}]}]`; it does not reconstruct source bindings. Block IDs and field names must match exactly, with no missing, duplicate or unknown entries. The application merges validated values into the original structure and then checks the complete result again. Every title, explanation, question and answer is translatable; formulas, technical names and brief quotations may remain unchanged. Basic English/Chinese script and unchanged-text checks reject substantial untranslated display prose. These checks are not complete language identification or a guarantee of translation quality. Mapping or language failures receive at most one repair attempt using the same display-only format and strict validation. External agents continue to import full interactive objects under the original source-binding contract.

If the article translation succeeds but interactive translation fails, the endpoint returns HTTP 200 with the completed article and `translation.interactiveTranslationError`, including a safe failure category such as timeout, connectivity, output limit, language or source binding. The response omits unusable `interactive` blocks. Clients must show article fallback and the partial-completion state. Repeating the same request reuses the existing article and retries only interactive translation; no additional flag is needed. A successful retry saves `translation.interactive` and clears the error. Public paper responses also hide invalid historical blocks without deleting their underlying stored record. External agents can import optional interactive translations under the same language and binding checks; a Markdown-only agent translation remains valid and can be completed later.

### Choosing whether a visual observation enters later context

`PATCH /api/papers/:id/visual-evidence/:evidenceId` accepts exactly `{ "excluded": true }` to stop using a saved observation in future model requests, or `{ "excluded": false }` to explicitly permit use in later readings and answers. The boolean is required; invalid types or extra fields return 400. Unknown or cross-paper evidence IDs return 404. The response is `{evidence,paper}` and the record stores `excluded` and `updatedAt`; its image interpretation and history are preserved. Inclusion never clears `modelUnverified`, marks the observation verified, or edits a source crop.

Inclusion is permitted only for the most recently appended observation of that figure, with a current matching page/crop and PDF source. A non-latest observation, changed crop, missing PDF, or changed PDF bytes returns 409 with a safe explanation. The server reads the actual PDF hash and rechecks the live observation after that asynchronous read; a client cannot enable a stale observation by bypassing the interface. Exclusion remains permitted for historical or stale observations.

Evidence selection first chooses the most recently appended observation for each figure, then checks its crop and exclusion state. If that latest record is excluded or stale, earlier records are **not** revived automatically. Thus a new pending observation pauses the figure's older interpretation until the latest is explicitly included. Saved observations remain available for inspection. This does not retroactively rewrite saved readings, messages, or requests already in progress; regenerate affected material as needed. The policy contains unintended propagation of model errors; inclusion is a context choice, not scientific validation.

### Translation reuse and concurrent requests

Both model translations and subscription `insights` translations preserve the multiset of existing local `#page=N` Markdown destinations and their original-language quote titles, plus actual standalone `:::figure ID` slots. Visible labels, paragraph grouping and reference-link syntax may change. Code, math and raw-HTML examples are not figure slots or source citations. Model output restores its protected bindings by construction; an external translation that drops, duplicates, invents or changes a binding returns 400 before any part of the import is saved. This validation checks saved binding fidelity, not whether a quoted scientific statement is true. Legacy abstract/summary/report imports use the same rule.

Plain prose citations also preserve page numbers, range endpoints and occurrence counts. The bounded syntax matches the reader: `[p.4]`, `[pp.4–6]`, lists such as `[p.4, 7]`, and the Chinese equivalent `[第4页]`. Spacing, leading zeros, supported range separators and list grouping may change; page numbers may not. Code, formulas, escaped literals and labels inside existing links/images are excluded. A changed or missing plain citation fails model translation with 502 or subscription import with 400, before saving any article or other content from that import. Existing invalid caches become stale through the same binding checks.

Empty responses and exact null/undefined sentinel results cannot be saved as completed article or caption translations. Short technical labels and formulas remain permitted. Public reads retain historical raw records but mark an invalid article translation `stale:true`, and hide invalid caption maps with `captionTranslationError`. Such records cannot satisfy cache reuse or caption-only article prerequisites. A corrected translation may be imported or generated through the existing retry path; no stored original reading or figure geometry is rewritten.

`POST /api/papers/:id/translate` reuses a non-stale complete saved translation for the requested source revision and canonical language, without invoking a model. This includes agent-authored translations; there is no implicit regeneration of complete results on repeated clicks. An interactive reading's incomplete or invalid translated blocks are the exception: the existing article is reused while only the blocks are retried. For `target:"reading"`, requests for the same paper, reading ID, language and source hash share one in-flight translation job. Legacy `abstract`, `summary` and `report` requests similarly share a job for the same paper, target, language and source revision. Interactive Markdown and block translation remain one shared job.

A failed job is removed and may be retried. An incomplete article is not cached; a complete article is retained when its subsequent interactive step fails. Invalid interactive blocks are never treated as a complete cache. Changed or deleted sources still reject obsolete results. If an external agent publishes a valid translation of that source while inference is running, the model result does not overwrite it. Coalescing lasts within the current server process; it does not resume provider requests after a server restart.

## Reading figure-caption translations

Each `readingVersions[i].translations[language]` can contain `figureCaptions: {"figure-id":"Translated caption"}`, `figureCaptionsSourceHash`, and an optional `captionTranslationError`. The map covers every figure with a non-empty caption in that reading version's figure snapshot. Source figure IDs, pages, crops and captions remain unchanged. Captions are all sent for translation; the server does not guess whether a short technical caption already belongs to the target language. The model receives caption text and IDs only, not pixels or geometry, and must return a complete ID-bound map with at most one validation repair.

For English and Chinese, generation, external imports and cache reads also reject substantial prose that obviously remains in the other language. This conservative script/unchanged-prose check permits short technical labels, numbers and formulas; it is not comprehensive language detection or verification of semantic fidelity. A copied Chinese caption in an English cache is hidden without deleting the historical raw value and can be retried using the same caption-only workflow. Qualifiers, aggregation and which task a statistic describes still require source review even if numbers and language checks pass.

The existing `POST /api/papers/:id/translate` request with `target:"reading"`, `readingId`, and `language` completes missing components. Valid cached Markdown and interactive blocks are reused while missing or stale captions alone are translated. Reused article `markdown`, `createdAt`, `source` and `sourceHash` stay unchanged. If `language` equals the original version's canonical language, the original article and interactive blocks can be reused directly while captions are translated. Empty caption sets invoke no caption model request. Caption cache identity separately includes figure IDs, original captions, pages and crops; a caption or crop change never forces article retranslation. Concurrent requests for the same reading, language and source-caption hash share one job.

A caption failure returns HTTP 200 with the available article and interactive content plus a safe `captionTranslationError`; it does not claim completion. Repeating the same request retries missing captions. Public responses omit stale or invalid caption maps while retaining their raw stored history. A source-caption change during inference rejects the obsolete result with HTTP 409. A valid external translation imported during inference takes precedence over the late model response.

External agents may include `figureCaptions` in a `target:"reading"` translation inside `PUT /api/papers/:id/insights`. Keys must exactly match all non-empty captions bound to that reading version; values must be non-empty strings of at most 6,000 characters. Unknown, missing, inherited or duplicate IDs and geometry objects are rejected. The insights endpoint also rejects duplicate JSON object keys, including Unicode-escaped aliases. Source hashes are assigned by the server, never trusted from the caller. A caption-only entry may omit `markdown` when a valid article translation already exists for that language or the language matches the original version; its article and interactive content are preserved. Otherwise a translated article is required. Legacy `abstract`, `summary` and `report` translation imports do not accept caption maps: use the immutable reading ID.

```json
{
  "source": { "agent": "Codex" },
  "translations": [{
    "target": "reading",
    "readingId": "existing-reading-version-id",
    "language": "zh-CN",
    "figureCaptions": { "chart": "图注的中文译文。" }
  }]
}
```

### Single-figure CLI

`node scripts/paper-workbench.mjs figures <paper-id>` reads the current figure collection and both revision hashes. `figure <paper-id> <reviewed-figure.json|->` forwards the reviewed POST payload above; `--figure <figure-id>` uses PATCH. Neither command invokes a model. The CLI does not retry writes or silently replace stale revision hashes. Inspect the collection after an unknown outcome, and review any conflict before submitting again. Legacy insight imports with a top-level `figures` array still replace the whole list.

## API token usage

`GET /api/usage?days=30&timeZone=Asia%2FShanghai&offset=0` returns token totals, per-field reporting coverage, request/failure counts, model and operation groups, daily groups, and up to 50 recent calls. `days` accepts `7`, `30`, `90`, or `all`; it filters inclusive calendar dates in the requested IANA `timeZone` (default UTC). `offset` pages the call list without changing aggregates. Optional `model` is the exact opaque `models[].key` returned by this endpoint; groups distinguish connection profile, protocol and configured model. Invalid filters return 400.

Recording starts when this feature is enabled. `trackingSince` persists across server restarts. Every actual workbench model request is counted, including connection tests, report draft/review/edit stages, translations, interactive generation, caption translation and vision. Cached/coalesced translations, local extraction and imported Codex/Claude subscription work produce no extra model call and no usage record. Requests made outside this application are not visible. No historical counts are estimated or backfilled.

Each record has a timestamp, configured provider/model/profile label, operation, optional stage, duration, status (`success`, `failed`, `incomplete`) and nullable token fields. Counts are accepted only as nonnegative safe integers. Missing or unusable usage is `null`, never an invented zero. Known counts are retained even if a provider returns an error, truncated output, or no usable text. Network/JSON failures generally have unknown usage; an abrupt server shutdown can also prevent recording. Totals are reported counters, not a bill.

- OpenAI-compatible Chat Completions: input = `prompt_tokens`, output = `completion_tokens`; use `total_tokens` when consistent, or derive the total from known input/output when absent. Cached input and reasoning counters are subsets and are never added again. Optional cache-write counts are retained separately.
- Anthropic Messages: input = `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`; omitted/null optional cache counters contribute zero to this protocol's input sum. Output = `output_tokens`; total = input + output. The UI's cache breakdown remains unknown when that field was not returned. Extended-thinking tokens are not inferred from text.
- Aggregates expose `totals` and `reported` counts for each field. If some calls lack that field, the displayed sum is a known subtotal (`≥`), not a complete total. `unknownUsage` counts calls with no usable total. `failed` includes incomplete outputs.

Usage is stored locally in `DATA_DIR/api-usage.jsonl`, separately from the paper store. It contains no prompts, generated text, endpoint URLs, headers or API keys. Profile names and model IDs are retained as user-configured labels. Serialized appends preserve concurrent calls; damaged lines are skipped and reported in `storage.unreadableRecords`. Read/write failures appear in `storage.readError` / `unsavedRecords` and never trigger model retries. Unsaved records remain in memory only for that process; the UI warns that totals may be incomplete. The data file is runtime-only and must not be committed or published.

Accounting references: [OpenAI Chat Completion usage](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/retrieve) and [Anthropic input/cache accounting](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#tracking-cache-performance). Compatible gateways may omit or depart from these schemas; the workbench does not infer provider billing rates or subscription usage.
