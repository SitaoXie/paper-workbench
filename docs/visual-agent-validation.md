# Visual question agent and assistant preferences validation

Validated 2026-10-26.

## Implemented behavior

- Original PDF page, saved figure/table, and normalized page-region image tools feed pixels into the ongoing native tool loop. Table crops can be requested even when no saved figure ID exists.
- Both OpenAI-compatible and Anthropic message formats preserve call IDs and complete all pending tool results before continuing. Text-only models do not receive image tools.
- Separate text-layer and page-image input modes preserve the 15-page initial quota. Page-image mode supplies one full raster per page in order; longer documents use brief context and on-demand images.
- Built-in balanced, concise, detailed and teaching prompts are read-only. Custom styles are editable and persistent across connection changes. Subscription question handoffs include the chosen style.
- Evidence includes actual page image counts, tool operations and page/crop attribution. Saved history does not masquerade as currently visible pixels.

## Checks completed

- `npm test`: 478 tests passed.
- `npm run build`: passed; existing large-chunk advisory remains.
- Real PDF raster checks: page dimensions, crop pixel colors, rotated pages, out-of-range pages, outside-workspace files, cancellation.
- Protocol tests: both provider formats, image payloads in subsequent rounds, tool errors followed by final synthesis, duplicate-render caching, six-image tool limit, image bytes excluded from text budgets and saved metadata.
- Mode tests: ordered short-paper images, long-paper brief context, unchanged full-text mode, rejection of text-only models before chat mutations.
- Preferences tests: immutable built-ins, custom persistence across restart/model changes, atomic invalid-edit rejection, bilingual component controls, editable custom prompts, read-only built-ins, portal placement and Escape dismissal. Component tests use jsdom and simulated geometry, not a real browser.
- Live configured vision-model check on the 14-page MAE paper: page-image tool → figure directory → figure crop → final answer; 3 model calls, 2 image results, 178 streaming events. Answer discussed observed diagram colors, visible patches/mask tokens and the depicted bird.
- Live page-image input check: 14 ordered page images, 1 model call, 203 streaming events; final answer interpreted the first-page architecture diagram and cited its page. No model configuration was changed for either test. Provider usage was recorded locally.
- Local server restarted and settings endpoint checked. Saved API profiles and active model were preserved; initial defaults remain balanced style and text-layer input.

## Acceptance limits

Browser automation was previously denied by automatic approval review. No browser interaction or end-to-end visual acceptance was attempted through another route. No judge approval or release tag is claimed. Remaining manual checks are the popover layout in the live narrow assistant, small-screen/keyboard layout, and visual comparison across light/dark themes. Passing automated checks does not establish bug-free behavior.
