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

Settings expose `profiles` and `activeProfileId`, plus the active profile mirrored at top level for compatibility. A profile has a stable `id`, display `name`, `provider` (`openai` or `anthropic`), `baseUrl`, `models` (1–100 model IDs), selected `model`, optional `apiKey`, optional `extraBody`, `contextChars`, and `maxOutputTokens`. Up to 30 profiles can be stored. One endpoint/key is shared by all models in that profile; different profiles retain separate credentials.

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
