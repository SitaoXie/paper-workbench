# Local agent import contract

Run CLI commands from the application checkout. These commands save locally and make no model request:

```sh
node scripts/paper-workbench.mjs source "paper-id" --pages 1-4,8
node scripts/paper-workbench.mjs export "paper-id" --out "/tmp/new-reading-bundle"
node scripts/paper-workbench.mjs publish "paper-id" "/tmp/insights.json"
node scripts/paper-workbench.mjs answer "paper-id" "/tmp/answer.json"
```

Replace the example ID and paths with the actual imported ID and new temporary paths. `export` refuses to overwrite an existing directory. `publish` and `answer` also accept `-` to read JSON from stdin. JSON files must be at most 256 KiB. Do not put paper content in tracked example files.

## Summary, report, translation, and figures

`publish` calls `PUT /api/papers/:id/insights` with a partial update:

```json
{
  "source": { "agent": "Codex" },
  "style": "quick",
  "focus": "主要结论与证据边界",
  "summary": {
    "language": "zh-CN",
    "markdown": "## 核心发现\n用实际论文内容替换本示例；重要结论附 [p.4]。"
  },
  "translations": [
    {
      "target": "abstract",
      "language": "zh-CN",
      "markdown": "原始摘要的完整中文翻译。"
    }
  ]
}
```

`source.agent` identifies the session actually doing the work (for example Codex or Claude Code); optional `source.model` is only for a known model, never an invented identity. The server sets provenance `kind: "agent"` and timestamps. It does not verify model output's scientific accuracy.

Use `summary` for one coherent reading overview. Top-level `style` is `quick`, `deep`, or `critical`; `focus` is optional text of up to 3,000 characters. Every import creates and selects a new immutable reading version while preserving older versions. `report` remains accepted for older agents, but both become versions in the same overview surface; avoid supplying both. Leave unrelated fields absent. A translation has target `abstract` or `reading`; for `reading`, include `readingId` from `readings`. Legacy targets `summary`/`report` remain compatible. When translating, read that exact version first. Preserve mathematical notation, numbers, page references, and links. Existing translations for other targets/languages remain saved.

Optional `figures` is a replacement array of:

```json
{
  "id": "figure-1",
  "page": 4,
  "crop": { "x": 0.1, "y": 0.2, "width": 0.8, "height": 0.35 },
  "caption": "Describe the actual figure after visually checking this crop."
}
```

Place a figure within summary/report Markdown with a standalone marker matching its saved `id`:

```text
A paragraph explaining the mechanism. [p.2]

:::figure figure-1

## The next section
```

The marker renders the local PDF crop and caption at that point in the overview. Keep it unchanged when translating. Use only existing or concurrently supplied figure IDs; a marker does not create a figure. Only referenced figures appear within the overview. A saved figure is not automatically appended as a duplicate gallery.

These crop numbers are illustrative, not a suggested crop for any paper. Coordinates are fractions of the rendered PDF page, with origin at its top left; values must remain within the page. `page` is the PDF's one-based page number, not a printed roman/numeric page label. `crop` can be omitted to show the complete source page, but label it as a page preview, not a figure extraction. For a polished illustrated overview, inspect the rendered figure and trim surrounding body text. Keep caption claims consistent with the original caption and plot axes. Do not send image bytes or external URLs: the UI renders the selected source PDF region locally. Include existing wanted figures when updating this array.

## Answer import

`answer` calls `POST /api/chats/import` using the CLI paper ID and this JSON:

```json
{
  "source": { "agent": "Claude Code" },
  "question": "What limits the main conclusion?",
  "answer": "Write the answer from actual source evidence and cite [p.4]."
}
```

Optional `conversationId` selects an existing conversation for that paper. Without it, the current active conversation is used. Repeating the command adds another exchange; inspect the return value before retrying a request with an unknown outcome. An HTTP error is a failed save, not a successful answer.

## Exact-version translations

```json
{
  "source": {"agent": "Codex"},
  "translations": [{"target": "reading", "readingId": "actual-reading-version-id", "language": "en", "markdown": "Translate the selected original faithfully, preserving [p.4] and figure markers."}]
}
```

Use `use-reading "paper-id" "reading-id"` to select an existing version without generating another. An unknown outcome should be checked with `readings` before publishing again, because each successful import adds a version.

## Notes and lookup activities

`note` creates an annotation without calling a provider:

```json
{"kind":"note","page":4,"quote":"An exact source quote.","body":"The reader's requested note, with evidence distinguished from interpretation.","color":"yellow","tags":["methods"]}
```

Kinds are `note`, `highlight`, `underline`, `ink`, `translation`, and `explanation`. Rectangles for spatial highlights use `{x,y,width,height}` fractions of the PDF page, with a top-left origin. Omit rectangles for a source-linked note rather than inventing them. Colors: `yellow`, `green`, `blue`, `pink`, `purple`. `docs/API.md` defines update, soft-delete/restore, export, and handwriting contracts.

`activity` records an agent-produced lookup in the appropriate history without opening a question session:

```json
{"kind":"explanation","page":4,"text":"An exact source quote.","language":"en","result":"The source-grounded explanation.","source":{"agent":"Claude Code"}}
```

Use `activities` to verify it. Neither activity creation nor answer import implicitly saves a note. To retain a lookup as a note, create a corresponding annotation only when requested. New note/activity/answer commands append records; check the returned record or current history before retrying an uncertain save.

## Interactive format

Supply top-level `format: "interactive"` and `interactive` alongside one `summary`. The Markdown remains the portable article form; structured blocks provide the interactive view of the same version.

```json
{
  "schemaVersion": 1,
  "blocks": [
    {"id":"concept-1","type":"concept","title":"An important concept","text":"Explain it from the source.","citations":[{"page":2}]},
    {"id":"figure-1","type":"figure","figureId":"verified-figure-id","explanation":"Describe only what the actual crop and source support.","citations":[{"page":2}]},
    {"id":"question-1","type":"question","question":"What does this evidence establish?","answer":"An answer grounded in the paper.","explanation":"State its main limitation.","citations":[{"page":4}]}
  ]
}
```

Replace all examples with real evidence. IDs must be unique ASCII identifiers starting with a letter. Up to 24 blocks are accepted. Figure blocks must reference an existing or concurrently supplied verified crop and cite its actual PDF page. For sources without PDF pages, cite `{"label":"Source text"}`. No code, HTML slots, remote assets, or arbitrary URLs are accepted as block fields. The renderer escapes text and implements its own interactions.

A translation can include `interactive` beside translated `markdown`. Preserve every block's ID, type, order, figure binding, and citations; translate only the displayed text. The exact version remains selected. If only article text has been translated, the UI labels the missing interactive translation rather than quietly mixing languages.
