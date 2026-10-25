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

## Diagram frame follow-up

Replaced the fixed 300px / 65vh frame toggle with SVG viewBox-based sizing. Diagrams start at their natural readable size, with native overflow scrolling and mouse dragging. Controls offer actual 10–400% scaling, fit width and 1:1 reset; keyboard plus/minus and Ctrl/Command + wheel also zoom. The viewport follows the scaled diagram height up to a bounded maximum, so wide, shallow diagrams do not reserve a large empty frame. Native touch scrolling is retained.

455 automated tests and the production build passed. Added geometry regressions for wide/tall SVGs plus DOM component tests for zoom, fit/reset, wheel, keyboard and mouse dragging; the tests supply geometry because jsdom performs no browser layout. Browser visual acceptance remains outstanding.

## Source-figure lightbox and pasted images

The source-figure lightbox previously measured client dimensions changed by its own scrollbars, then removed the current canvas while redrawing. It now fits against a size-contained border box with scrollbar allowance and swaps an offscreen completed canvas into place. This removes the resize/render feedback loop and retains the visible image while a new zoom is rendering.

461 automated tests and the production build passed. New tests simulate scrollbar client-width oscillation, retain the old canvas until completion, exercise clipboard file/item formats and image preparation, and verify image bytes through provider tool rounds, stored history and retry branches for both API protocols. A live check with Claude Opus 5.5 medium sent one MAE image and received a streamed interpretation (208 text events); the pixel-bearing request was verified. No personal credentials, runtime image files or conversation responses are included in source control. Live browser interaction acceptance remains outstanding.
