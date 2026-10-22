# v0.3.0-dev.3 — review fixes

This checkpoint addresses the three P2 findings from the dev.2 review. The independent acceptance record is [judge-dev3.md](judge-dev3.md). Broader reading-experience work remains documented in [judge-v4.md](judge-v4.md).

## Changes

- A figure-save response now acknowledges only its submitted draft. Closing and reopening the crop editor, then changing the caption or crop, preserves the newer edit. A completed creation supplies its figure ID to the newer draft, so the next save updates that figure. Pending saves prevent resubmitting or rebasing the same draft across editor instances. An initial figure-list response captured before a completed save is fetched again before restoring drafts. Other drafts, the selected draft, and the in-memory fallback for blocked tab storage remain intact.
- Browser navigation has a separate intent sequence for pending paper lookups. After Back starts an uncached lookup and Forward returns to the currently displayed paper, a late success or error cannot change the paper, conversation, or unsent question. Existing detail and conversation loads for the mounted paper remain valid.
- Translation validation and displayed page links share a CommonMark-aware citation scanner. An unrelated Markdown escape or entity no longer hides a real page citation. Changing, omitting, or adding a citation rejects the entire imported translation with HTTP 400; model-result validation returns 502. Valid localized page labels pass. Escaped citation literals, code, formulas, and existing links keep their meanings.

## Regression evidence

The original figure-loss browser regression failed against the dev.2 build: the newly typed caption B reopened as the submitted caption A. Both navigation outcomes also failed against dev.2 before the fix. The escape/entity citation bypass was independently confirmed before correction.

The corrected figure suite covers both existing and newly created figures, blocked tab storage, a save finishing while the editor is closed, an unrelated selected draft, duplicate-submission prevention, and an old initial GET arriving after a save acknowledgement. All 24 desktop/mobile cases passed. All 22 history cases passed, including the late-success and late-error regressions. The unit/API suite passed 333 tests. The production build passed.

The independent judge issued a scoped PASS after ten distinct desktop scenarios, phone-width pending-save and citation-navigation checks, four screenshot inspections, and isolated real HTTP persistence checks. The complete browser suite then passed 434 tests with two viewport-conditional skips in 7.9 minutes. It ran against a fresh isolated backend serving the same frozen build. The primary local service was restarted and returned healthy status with version `0.3.0-dev.3`.

## Verification limits

This checkpoint uses synthetic PDFs and isolated API fixtures for deterministic race reproduction. Model-path rejection is exercised with controlled upstream responses; no paid provider inference or institutional credentials are required. It does not re-certify remote-provider availability, translation quality, physical stylus behavior, or the broader backlog. Test results and the judge's scoped approval do not establish that the application has no bugs.
