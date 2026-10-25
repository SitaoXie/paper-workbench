# Streaming assistant and inline result markers

Validated on 2026-10-26. Runtime credentials, test responses and local configuration remain in the ignored data directory.

- Automated coverage includes UTF-8/SSE fragmentation, OpenAI tool argument assembly, Anthropic thinking/signature separation, usage accounting on truncation, early token delivery before provider completion, disconnect cancellation, JSON-only compatibility, failed previews excluded from subsequent history, and thinking-panel default expansion/collapse in Chinese and English.
- Marker coverage includes text-anchor relocation and ambiguity rejection, isolation between languages/papers/versions, storage failures, and PDF hide/restore preserving multi-page anchors and result bodies.
- Real OpenAI-compatible calls through two configured providers completed source-page retrieval followed by streaming answers. One returned 76 display fragments and another 31. A separate thinking-capable provider returned 317 thinking fragments and 29 answer fragments. These are connectivity checks, not latency or model-quality benchmarks. Thinking is displayed only when returned explicitly by the provider.
- PDF result markers are server-persisted annotations. Overview/abstract markers are browser-local previews; their full operations remain in server activity history. Old activities without captured source rectangles are not retroactively assigned guessed PDF anchors.
- Browser automation was unavailable for this iteration following the earlier approval restriction. No live browser click/layout acceptance or judge-agent approval is claimed. Component rendering, source-anchor logic, API tests and real-provider streams were checked; desktop/mobile pointer interactions still need browser acceptance when available.
