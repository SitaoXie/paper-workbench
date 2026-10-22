# Independent judge: dev.4 recovery and subscription tasks

Status: **PASS — independent scoped acceptance and final regression gate complete; eligible for the `v0.3.0-dev.4` development tag.**

Candidate: `0.3.0-dev.4`, reviewed on 2026-10-23. The independently checked compiled entry is `dist/assets/index-CtnfEp4F.js`, SHA-256 `d4ce4becff9da28a0b50f989c929ff6e26d6871cd073a1f1dc5e15cfb0434c9f`.

This review covers the reader-module failure and the two subscription-task usability issues reproduced after `v0.3.0-dev.3`. The judge does not implement product changes. [judge-dev3.md](judge-dev3.md) remains the preceding acceptance record; this document does not reopen its closed defects.

## Required acceptance

| ID | Original observed problem | Candidate acceptance criteria | Status |
| --- | --- | --- | --- |
| D4-01 | A failed lazy PDF-reader module request can unmount the entire application, leaving a blank page without recovery controls. | Inject a missing/failed module response. The app remains usable and presents an actionable recovery. Overview and assistant remain accessible. Explicit recovery restores the reader after the resource becomes available, preserving reading position, saved notes, an unsent question and its prepared task. A persistent failure must not cause an automatic reload loop. | PASS in all four device/language scenarios |
| D4-02 | After a subscription answer is imported and refreshed, the task panel still describes a prepared/unsubmitted question, and the original question remains in the composer. | A matching imported answer produces an explicit completed state. Only the unchanged submitted draft may be cleared; a newer question remains untouched. Unrelated or previously existing messages must not be treated as completion of a new task. Refresh must remain bound to its paper and conversation. | PASS, including negative controls and a real isolated HTTP import |
| D4-03 | Refreshing a page hides its pending subscription-task panel even though the question draft and conversation survive. Re-preparing restores the identical task, but the recovery route is not apparent. | The pending card and exact task binding survive a page reload. Completed status survives subsequent reloads. Explicitly closing a card persists that choice rather than resurrecting it. Restoring a task must not create a second conversation, change the fixed destination, or send a model request. | PASS, including explicit dismissal and storage-failure feedback |

## Independent execution

The judge used independent Chrome contexts against the frozen compiled application: desktop 1440 × 1000 and emulated iPhone 13 at 390 × 664, each in English and Chinese. Generated six-page PDF, saved-note and conversation fixtures replaced all API responses in the main UI scenarios. Only the lazy-module request was forced to HTTP 404; installed assets were not removed or modified. The judge operated visible controls, inspected resulting DOM/state and request logs, and visually reviewed all sixteen saved screenshots. This is independent browser execution, separate from the implementation team's test suite.

### Reader recovery

Each of the four scenarios prepared a subscription question, opened page 4, changed zoom and scrolled within the page before forcing the PDF module to fail on reload. The local error panel remained visible while the rest of the application stayed mounted. A second explicitly requested reload with the module still unavailable returned to the same usable failure state. Neither failure triggered an automatic navigation loop during the observation windows.

The assistant retained the unsent question and byte-for-byte identical task text, including its task UUID and fixed destination. Returning to the overview displayed the reading, and the notebook displayed the pre-existing saved note without any annotation write. After the module became available, the explicit reload restored page 4, the same zoom and vertical scroll within 3 pixels. Restoring the pending task did not create another conversation. All four request logs contained only the expected initial conversation creation; no model endpoint or annotation write was made.

Two adjacent boundaries were independently checked. A failed source-figure module left surrounding prose readable, and its source-page action opened page 2 in the reader. A failed figure-editor module on the Chinese phone viewport displayed reachable Reload and Close controls, trapped Tab/Shift+Tab within the dialog, and closed with Escape. The underlying reader and an unsent assistant draft survived.

### Subscription completion and persistence

Each device/language scenario rejected two completion impostors: the same question with an older task UUID, and the current UUID with a different question. A matching user/agent answer pair changed the card to an explicit imported state and cleared only the unchanged submitted draft. After another task was prepared and the composer edited, importing that task's answer preserved the newer unsent text, including after reload.

Pending cards retained their exact task text across reloads. Completed cards retained their completed state. Closing either kind of card and reloading did not resurrect it. Repeating an earlier question produced a fresh UUID and remained pending despite older answers with the same wording. Even an answer arriving after explicit dismissal did not reopen the closed card.

To check the server/UI seam, the judge also started the real application with a new temporary store and no provider, without API interception. The UI created a conversation and copied a task. A real HTTP import of a deterministic fixture answer with that task UUID returned 200. Refreshing the UI showed the imported answer and completed card, and cleared the unchanged question. The persisted store contained exactly the corresponding two messages with matching paper, conversation and task UUID. Reload retained completion. The instrumented model fetch count was zero; the temporary store was removed afterward.

For the storage-failure boundary, the browser was made to throw when saving the task-storage key. Preparing and reading the task still worked in memory, opening/closing the assistant retained it, and the UI explicitly warned that reload could lose the current task or restore an earlier state. This is honest degraded behavior; persistence after reload is not guaranteed when browser storage is unavailable.

## Visual evidence

The screenshots are local, ignored review artifacts under `release/`; they are not required distributable assets.

| Evidence | Files |
| --- | --- |
| Reader failure, all four combinations | `judge-dev4-reader-failure-{desktop,mobile}-{en,zh}.png` |
| Restored question/task after reader recovery | `judge-dev4-task-restored-{desktop,mobile}-{en,zh}.png` |
| Completed task, all four combinations | `judge-dev4-task-completed-{desktop,mobile}-{en,zh}.png` |
| Real API import and visible completion | `judge-dev4-real-api-task-import.png` |
| Local source-figure failure | `judge-dev4-figure-failure-desktop-en.png` |
| Mobile figure-editor failure and focus | `judge-dev4-manager-failure-mobile-zh.png` |
| Storage warning | `judge-dev4-storage-warning-desktop-zh.png` |

The new recovery and task controls were visible and reachable in the reviewed images, without an observed new overlap or overflow. The enlarged PDF visible behind the assistant reflects the deliberately retained zoom; this check does not establish fit-width rendering quality for every document.

## Scope and final gate

No independent blocker remains in these three fixes. Phone coverage uses browser emulation, not a physical device or mobile keyboard. The main task flows use ordinary questions; the complete selected-text metadata and cross-session race matrix is outside this independent sample. The judge did not exercise a real model, browser restart, storage eviction over time, every failure mode, or every possible document. No production data, public comments or application implementation files were changed.

The scope is recovery and task continuity. The consecutive answer-reference route previously questioned in round 4 was rechecked on dev.3 and returned from page 4 to page 8, page 6 and the overview correctly; it is not an open defect for this release.

The first complete regression attempt reported an immediate selection-restoration assertion failure. The test now waits up to two seconds for the exact expected selection, since the visible popup can precede restoration of the document Range in the next animation frame. The implementation lead reported repeated targeted passes. The judge inspected the revised assertion and the subsequent clean full-run log; the product code and independently tested candidate asset were unchanged. The initial failure and its investigation are retained rather than counted as a passing initial run.

The judge then independently read the final local logs: the clean browser run completed with **460 passed and 2 skipped** out of 462 cases in 8.2 minutes; Node completed with **344 passed, 0 failed and 0 skipped**; the production build completed successfully. The two browser skips are explicit viewport conditions in `tests/workspace-experience.spec.ts`: the desktop reserved-width layout case is skipped in the mobile project, and the narrow-screen preference case is skipped in the desktop project. They are complementary device-specific cases, not disabled failing checks. The compiled entry's SHA-256 was rechecked and still matches the candidate above.

With these logs and the independent browser evidence, this scoped development acceptance is complete and the implementation lead may create the development tag. This is not a claim that the whole product is bug-free or that every reading workflow has been re-audited. Local verification logs are retained as `.local-data/dev4-e2e-final.log`, `.local-data/dev4-node-final.log` and `.local-data/dev4-build.log`.
