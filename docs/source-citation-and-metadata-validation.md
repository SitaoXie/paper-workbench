# Source citations and PDF metadata validation

Validated 2026-10-29. Credentials, imported PDFs, API responses and screenshots remain in ignored runtime storage.

## Source passage navigation

New API readings and single-paper answers request original-language passage anchors for key textual claims. A final optional alignment request selects source sentence IDs rather than authoring quotes. Grouped/ranged references, broad syntheses and visual evidence may remain page-only. Matching proves the navigation location, not the scientific correctness of a claim.

The backend rereads cited PDF pages with PDF.js and shares text assembly/normalization with the reader. Existing article readings can be refined into a separate version without rewriting their prose. Local validation/normalization can run without a model. A failed optional phase does not discard a completed answer; explicit existing-reading enhancement fails without replacing the original version.

A real model enhancement of the local MAE reading produced 67 passage anchors and retained one page-only reference. Initial verification found seven legacy-extraction/PDF.js discrepancies. After canonical text repair, all 67 anchors matched exactly one location using the reader's normalization. Hover/focus preview and a repeated click on a loaded PDF visibly showed the original passage and yellow source-line highlight. This does not certify every cold-load/zoom/layout combination.

## Metadata extraction

The PDF importer now consumes source-supported individual Author properties, and the abstract parser recognizes inline `Abstract.` plus physical line-break hyphenation. Model extraction is an explicit, confirmed library action, individually or for selected PDFs. It uses the first two pages, including full-page images for configured vision models, returns candidates, and applies only selected fields after review. It does not replace generated reading versions. Undo and save-failure rollback preserve prior metadata; changed PDFs or concurrent edits invalidate candidates. Replacing the abstract also invalidates its cached translations; undo restores the prior translations unless newer translations were saved.

Real vision requests recovered and manually verified against front pages:

| Paper | Authors | Institutions | Original abstract |
| --- | ---: | ---: | --- |
| Multi-Scale Dense Networks for Resource Efficient Image Classification | 6 | 4 | Complete section, line breaks repaired |
| ShuffleNet V2: Practical Guidelines for Efficient CNN Architecture Design | 4 | 2 | Excludes title, author block and keywords |
| Deep Residual Learning for Image Recognition | 4 | 1 | Complete two-column section, excludes adjacent figure |

All three were saved to the local library. The ResNet workflow was also exercised through the actual UI, including model selection, candidate review, apply and undo. Chinese light and English dark confirmation layouts, batch confirmation/cancellation, a 1440-pixel desktop and the default narrow window were inspected. Provider selections for metadata extraction are per-operation and do not overwrite assistant settings. No public comments were posted.

Regression tests cover source mismatch/unknown names, incomplete abstracts, original sentence order, vision/text transport, parser boundaries, proposal review/apply/undo, PDF mutation, stale edits, exact rollback, translation invalidation and concurrent mutations. Citation tests cover Markdown syntax exclusions, fabricated/ambiguous quotes, source-selected IDs, failures/cancellation, immutable old versions and PDF line breaks. Both language versions of the metadata review component are tested with actual React events.

The Node test suite and production build pass. The complete existing Playwright suite was not rerun for this change; the live browser checks above are the UI acceptance performed here. No independent judge-agent approval or absence-of-all-bugs claim is made. Scanned PDFs without source text and ambiguous front matter may yield partial candidates; the interface keeps unsupported fields unavailable rather than inventing metadata.
