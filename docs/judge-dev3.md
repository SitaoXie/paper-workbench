# Independent judge: dev.3 review fixes

Status: **SCOPED PASS — the three P2 fixes passed independent candidate verification on 2026-10-23.** Candidate package version: `0.3.0-dev.3`, before commit/tag.

This review is limited to the three P2 defects found after the dev.2 checkpoint. It does not replace the broader reading-flow record in [judge-v4.md](judge-v4.md), and it is not a claim of complete product correctness. The judge does not implement these fixes.

## Acceptance criteria

| ID | Original failure | Required candidate evidence | Status |
| --- | --- | --- | --- |
| D3-01 | A figure-save response from a closed editor replaces a newer unsaved caption in the reopened editor's shared draft storage. | Start delayed save A, close, reopen, edit B, resolve A, close and reopen: B remains recoverable. A successful ordinary save must still become clean, and completing an old save must not resurrect a cleaned draft. | **PASS** |
| D3-02 | After an uncached browser Back starts loading paper B, Forward returns to the already displayed paper A; the late B response then changes the displayed paper and chat context while the URL remains A. | Repeat the original import/reload/held-library sequence. A remains the title, URL and chat context after late B success or failure. A deliberately completed Back must still open B. | **PASS** |
| D3-03 | A Markdown escape or character entity elsewhere in a text node causes plain page citations to escape translation-binding validation. A translation can change or omit a real page citation and be saved as completed. | Changed or omitted real citations after escapes/entities fail with HTTP 400 on external import, without changing the fixed reading or translation cache. Model-result restoration must reject the same changes. Unchanged or equivalently localized citations must pass; escaped citation literals must remain literals. | **PASS** |

## Isolation and verification boundaries

UI checks used the frozen compiled application in Chrome, with all API requests intercepted against synthetic test data and a locally generated PDF. API rejection checks used the actual candidate backend in an independent temporary data directory with no provider credentials. No production records, provider settings or public comments were changed. The API fixture's model-call counter remained zero.

The figure race was independently reproduced in the dev.2 build before the fix: the visible reopened editor still showed B after the old response, while its saved draft had become clean A; reopening exposed the loss. The candidate was checked separately after the implementation and build were frozen.

## Observed candidate results

### Figure save continuity

- The original delayed PATCH → close → reopen → edit B → resolve A → close/reopen sequence preserved B as a dirty, recoverable draft. This checks both the visible editor and tab-local draft persistence.
- An ordinary completed save became clean. A save completed while the editor stayed closed also reopened as the saved clean figure. Choosing a new crop afterward did not resurrect the saved item in the unsaved-drafts list.
- A delayed first POST was allowed to remain pending while the reopened caption was edited. Save and the conflicting collection's “Load latest figures” control were disabled. Once the first acknowledgement arrived, the newer caption remained; its next save used PATCH against the assigned figure ID. The observed write sequence was exactly POST, PATCH, with no duplicate POST.
- For both first POST and existing-figure PATCH, the editor was reopened while its initial collection GET was held. The save completed before that obsolete GET was released. The UI fetched a current collection, retained the saved caption and figure ID, displayed one saved figure, and reopened with the same result. The stale empty collection did not erase a newly created figure.

### Browser navigation continuity

The original sequence was retained: open B, import A, reload A while the library list is held, go Back to uncached B while its detail request is held, then Forward to A. Releasing B with a successful response kept A's URL, title, conversation and unsent draft. Releasing B with a controlled HTTP 503 also left A intact without displaying the obsolete request's error or redirecting to the library. No new B chat request followed either obsolete completion. A separate completed Back, without the cancelling Forward, opened B and its conversation normally.

### Citation integrity and visible navigation

For both `A \* B ... [p.4]` and `A &amp; B ... [p.4]`, changing the target citation to page 6 or omitting it returned HTTP 400 from the real insights-import endpoint. The complete in-memory store and its persisted file remained byte-for-byte unchanged after each rejection. Model-result restoration rejected the same four changes with status 502. Valid page-4 and Chinese `[第4页]` translations returned HTTP 200 while preserving the original reading and active version.

A mixed case allowed escaped `\[p.9]` and entity-created `&#91;p.8]` literals to change as ordinary text, but rejected a changed real page-4 citation without altering an already saved translation. Across these checks there were five rejected and three successful real HTTP imports.

The compiled UI separately rendered an actual p.4 source button after an escaped asterisk and an ampersand entity. Clicking it opened and rendered PDF page 4. Escaped `[p.9]` and entity-created `[p.8]` examples remained visible text without navigation buttons. This was checked in both desktop and phone-width layouts.

## Visual inspection

The judge opened the screenshots from the actual browser flows, rather than relying only on geometry assertions. At a 1440 × 1000 desktop viewport and an emulated 390 × 664 phone viewport, the pending-save explanation, disabled Save/Load latest controls and editable caption were readable and did not overlap. The figure dialog had no horizontal overflow in either inspected viewport. The caption accepted the newer edit before the pending response completed. The source rectangle in these screenshots is synthetic UI evidence, not an assessment of scientific crop quality.

The citation screenshots showed the real source button and literal examples without clipping or overlap. Local screenshot evidence is stored in the ignored `release/` directory:

- `judge-dev3-figure-pending-desktop.png`
- `judge-dev3-figure-pending-mobile.png`
- `judge-dev3-citations-desktop.png`
- `judge-dev3-citations-mobile.png`

## Final gate

**Pass for these three fixes and the exercised adjacent cases.** The judge independently executed ten distinct desktop browser scenarios, repeated pending-save and citation rendering/navigation at phone width, inspected four screenshots, and checked actual isolated HTTP persistence behavior. No remaining blocker was found within this scope.

This gate does not claim coverage of every network interleaving, a physical mobile device/keyboard, all browsers, live model quality, or the entire product. It does not supersede the remaining refinements in the broader reading-flow report. The release owner must still finish the repository's full validation and commit/tag the same frozen candidate before announcing the development checkpoint.
