# v0.3.0-dev.4 — component recovery and subscription continuity

This checkpoint addresses one P2 and two P3 findings from the dev.3 audit. The independent release gate is recorded in [judge-dev4.md](judge-dev4.md).

## Changes

- A failed optional PDF reader, source figure or figure editor is contained at that feature. The surrounding overview and assistant stay mounted. A local error panel offers explicit page reload; it does not remount a cached rejected import or automatically reload. The reader can return to the overview, figures can navigate to their source page, and the editor can be closed by pointer or keyboard. Reader/editor reload synchronously flushes existing reading history and position storage; source figures use the existing page-exit persistence.
- A subscription question carries a UUID through the copied task and answer import. Completion requires the matching adjacent user/agent-answer pair, complete question, paper, conversation and explicit selection binding. Old or unrelated answers cannot complete it. Only the draft revision used to prepare the task is cleared; later edits and a newer task remain intact. The server validates the optional ID before writing and retains compatibility with older imports.
- Pending and completed question-task cards are stored in bounded, validated browser-tab storage. Reload preserves their exact destination and task text without creating a session or making a model call. Dismissal and paper deletion remove their stored cards. Storage failure leaves the task usable in memory and shows the reload limitation. The portable skill and API documentation describe the task-ID contract.

## Verification

The unit/API suite passed 344 tests and the production build passed. The targeted browser checks passed 8 reader/figure recovery cases and 32 subscription-question cases across desktop and emulated phone viewports. The skill validator passed. The clean complete browser suite passed 460 tests with two viewport-conditional skips (462 cases) in 8.2 minutes. The independent judge issued a scoped PASS after actual browser operation, sixteen screenshot inspections and a real isolated answer-import check. The local service was restarted and returned healthy status with version `0.3.0-dev.4`.

The first complete-suite attempt exposed a frame-sensitive assertion in an existing selection-restoration test: it read the browser selection about 12 ms after clicking, before the scheduled animation frame. The failure screenshot already showed the exact restored highlight. The assertion now waits up to two seconds for the same complete selected text, without changing product behavior or relaxing the expected content. All 18 repeated combinations of restoration state and viewport passed; the subsequent complete suite passed against a fresh isolated backend serving the same frozen candidate.

## Limits

Recovery is an explicit document reload, not a promise that every transient editor state survives a runtime failure. Saved notes and persisted reading positions/drafts remain available subject to browser storage availability; unsaved component-only UI state may not. Question-task IDs correlate answers and do not provide idempotency or authentication. A successful answer import repeated twice still appends twice; inspect the fixed conversation before retrying an uncertain save.

Verification uses generated PDFs, isolated data directories and controlled responses. It does not require or validate a paid provider, an institutional account, translation quality, or physical mobile/stylus behavior. A scoped judge pass and passing regressions do not establish the absence of all defects.
