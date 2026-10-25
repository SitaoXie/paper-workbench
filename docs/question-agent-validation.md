# Question agent validation — 2026-10-26

Implemented native tool loops for OpenAI-compatible Chat Completions and Anthropic Messages. API chat retains its session and selected-passage bindings; subscription tasks remain separate. Tools search local original text, read specified extracted pages, search public websites and read observed public URLs. External access is opt-in per question.

## Checks

- Full Node test suite: 426 passed. Fourteen new agent tests cover both provider protocols, multi-round local and external tools, signed/reasoning-block transport without persistence, per-round token accounting, page offsets and partial coverage, invalid arguments, disabled web access, private-network rejection, search failure handling, tool/round budgets, ninth-paper relevance, API persistence, and bilingual evidence rendering. Focused agent tests also passed after the final malformed-query handling change.
- Production TypeScript/Vite build passed. Existing large-chunk warning remains.
- A real configured OpenAI-compatible model completed a question about the public MAE paper (arXiv 2111.06377): search original text → read page 4 → answer with page references. Three model calls succeeded and were recorded in the usage ledger. This verifies one configured model, not every compatible gateway or every answer's scientific correctness.
- Public webpage reading retrieved the arXiv abstract page and extracted 4,356 characters. The local downloader's public-address rules were retained.
- DuckDuckGo's live response was a verification page. The adapter correctly reported a failure; no verification bypass was attempted. Tavily's request/response adapter passed isolated transport tests, but no live Tavily key was configured, so authenticated web search remains unverified in this environment.
- Restarted the local server and verified health, the deployed agent UI bundle, and rejection of an invalid `webSearch` value before mutation.

## Limits

No browser-driven interaction or visual layout acceptance was performed in this run; component rendering checks do not substitute for a desktop/mobile browser review. No release tag was created. Page reads currently provide text and captions, not PDF pixels. A configured model must support native tool calling. Search-provider credits are not model tokens and are not counted as token usage. Generated answers and webpage content remain fallible evidence.

Runtime smoke-test outputs and logs are kept in the ignored local data directory; no provider credentials, private endpoints or user-library data are included in this document.
