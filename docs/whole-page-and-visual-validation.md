# Whole-page questions and inline visuals

Validation scope: the question-context policy, on-demand page reads, source citation previews, declarative diagrams and charts.

- PDF questions with at most 15 initially selected PDF pages receive all available extracted page text in page order. The earlier character budget no longer slices these pages.
- Above that quota, the initial source contains a stable brief. The agent may search and request complete individual pages. Oversized requests fail explicitly rather than returning a misleading partial page.
- Question, selection and history notices follow the stable source prefix. This provides an opportunity for prefix caching; no provider cache-hit improvement was measured.
- Full extracted text is distinct from PDF pixels. Missing pages, incomplete extraction and image-only content remain explicit.
- Empty retrieval blocks are hidden. Mermaid and numeric chart fences render inline, with source fallback; the generic skill includes the format.
- Exact passage citations can preview original source lines and a highlighted PDF crop. Clicking locates the passage with a six-second highlight. Ambiguous or unmatched quotes fall back to the page and disclose the failure.

Checks performed:

- 453 automated tests passed, including 1/14/15/16-page boundaries, dense whole-page tool results, invariant initial prefixes, missing extraction, long-paper selection → page tool → response, empty retrieval blocks, chart validation, bilingual Mermaid parsing and original PDF coordinates under rotation.
- Production TypeScript/Vite build passed. Large-chunk warnings remain; Mermaid is loaded on demand.
- A live API check using Gemini 3.8 Flash with the public 14-page MAE paper verified that every extracted page's complete text was present in the first request. One model request returned a Chinese explanation, page citations, an exact-passage citation and one Mermaid flowchart. The actual returned diagram parsed successfully.
- Skill structure validation passed.

Browser automation was unavailable for this turn. Hover positioning, touch/keyboard interaction, dark/light theme appearance and six-second on-screen fading have not received live browser acceptance. This is not a judge-approved release and does not claim the absence of bugs. Runtime responses and personal configuration remain ignored and are not included here.
