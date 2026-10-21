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

Optional `report` has the same `{language,markdown}` shape as `summary`. Use summary for the overview reading surface; use report for the separate research report. Leave unrelated fields absent. A translation has target `abstract`, `summary`, or `report` and remains separate from its original. When translating a summary/report, read that exact original first. Preserve mathematical notation, numbers, page references, and links. Existing translations for other targets/languages remain saved.

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

The marker renders the local PDF crop and caption at that point in the overview. Keep it unchanged when translating. Use only existing or concurrently supplied figure IDs; a marker does not create a figure. Figures without a marker can still appear in the gallery.

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
