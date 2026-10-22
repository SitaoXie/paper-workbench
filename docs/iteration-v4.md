# Reading-workflow iteration 4

This is an active development checkpoint, not a release approval. The independent browser review is recorded in [judge-v4.md](judge-v4.md); its unresolved findings take precedence over earlier release decisions.

## Reading and source continuity

Overview paragraphs, chapter links and fixed versions retain their reading position through evidence detours. PDF navigation includes a searchable outline, full-document text search, source-quote matching and a return history. Exact quotes are highlighted only when the imported source has one unambiguous match; a missing or repeated quote falls back visibly to the source page.

PDF annotations retain real page geometry. A cross-page selection produces one logical note with separate anchors. At high magnification, notebook source actions reveal the relevant column. Opening the assistant does not replay an old note action, and closing then reopening the assistant preserves a manually chosen table column even when the wider viewport temporarily clamps horizontal scrolling. A new pan or source action replaces that intention.

Translation and explanation history keeps the selected category and expanded record within the browser tab. A short single-page source quotation can return to its exact PDF passage. Generated-overview sources carry their fixed reading ID and use read-only navigation rather than silently changing the active version.

## Language, figures and portable output

The original abstract, generated reading and its translation remain distinct. Caption translations follow their exact version and source-caption hash. Missing or stale captions are identified rather than relabeled as translated. Source pixels remain unchanged. The article, interactive reading, lightbox and exported document share the visible caption choice.

An ordinary article or interactive reading can be exported as an offline HTML file with local figure crops, mathematical markup and public source links. Markdown and copied answers retain useful source references without exposing private workspace URLs. Synthetic offline-browser checks and a read-only inspection of a real exported article are separate evidence: the in-app browser blocked the real downloaded `file:` URL, so that artifact was not claimed to have been opened there.

The overview toolbar keeps the current language and AI/source distinction visible while moving model, timestamp and focus details into an optional panel. In the inspected fixture, the first prose paragraph begins 159 pixels below the toolbar on desktop and 199 pixels below it on a phone. These are fixture measurements, not a guarantee for every document.

## API and subscription sessions

Selection translation and explanation can use a configured API or a Codex/Claude session handoff. A copied task binds the workspace, paper, source kind, fixed reading version when applicable, pages, exact quotation, output language and operation to one UUID. Import is idempotent, and a mismatched or late result cannot replace another selection. No API is called when subscription processing is selected. Question handoffs bind a separate conversation and preserve older drafts. These mechanisms do not reuse login tokens or require any institutional endpoint.

Oversized selections produce an actionable limit rather than silently asking about a truncated quote. Original source content, generated interpretation and external instructions remain separate, including when an agent retrieves a saved conversation.

## Checks and remaining work at v0.3.0-dev.1

The latest Node run passed 196 tests. Focused desktop/phone checks passed the 18 reader-detail and horizontal-navigation cases, with an additional two-case regression for replacing a deferred horizontal position after a new source search. The full browser suite passed 240 tests with two device-conditional skips. The build and TypeScript checks passed. A reload assertion was made specific to the restored reader, avoiding a transient match against several library cards.

The judge independently rechecked the source-history and table-column fixes, plus light/dark PDF themes, original-color fallback, formulas and visible highlights. These passes are limited to the described papers and interactions. Unresolved browser findings include duplicated mathematical text in native partial selections (also observed in the reference application), and returning from an abstract-history record without scrolling to the abstract or revealing its matching source language. Both remain open at this checkpoint.

The next material workflow gap is preparing figures in newly imported papers. Image objects alone miss vector figures, panel titles and multi-part plots. The planned local flow proposes candidates, shows their bounds on the original page, allows adjustment and requires explicit acceptance. Only confirmed crops should become input to future readings; existing reading snapshots must remain unchanged. This flow is not yet implemented at this checkpoint.

## Work after the v0.3.0-dev.1 checkpoint

The native mathematical-copy and original-abstract return findings above have since passed independent browser rechecks. The figure manager now proposes source candidates, permits manual crop adjustment, keeps recoverable drafts and saves one revision-bound figure without replacing unrelated crops. Existing reading versions retain their figure snapshots. Image analysis uses higher-resolution source crops and more explicit panel/axis prompts; real model trials still produced factual mistakes. New observations are therefore kept out of later readings and questions until explicitly included, remain unverified afterward, and can be excluded again without rewriting saved versions.

The notebook now exports a separate annotated PDF with Unicode note contents, cross-page markup and ink. Independent rendering and source-structure checks supplement the UI download tests. New imports record an immutable original-file fingerprint. Legacy imports without that fingerprint offer an explicit current-source review; accepting the current file is recorded separately and never presented as verification of old annotations. The source PDF and notebook records are not rewritten. Native external-reader popup editing remains unverified because the available desktop was locked and the browser rejected direct file URLs; no workaround was used.

PDF internal links now expose distinguishable source-derived names. Named bibliography citations can show a deterministic region around the PDF destination before an explicit jump, with optional extracted source text. Ordinary section clicks retain direct navigation. Hover previews, where available, do not call a model or fetch reference metadata. The source preview follows paper-color preferences and closes when reading resumes. This is a local source glance, not a claim to reproduce alphaXiv's enriched paper-metadata cards.

Offscreen overview selection drafts now fold into a compact return control while retaining the selected text, question, operation, language, subscription task and pending result. The corresponding PDF workflow and the combined candidate remain under adversarial review. None of these interim checks changes the independent judge's overall hold until the integrated build is rechecked.


## Fixed-version subscription work and browser navigation

An existing reading now offers a Codex/Claude translation task for its exact version, including caption-only and interactive-translation supplements. This handoff calls no configured model API. The first real isolated trial copied the task in the browser, saved its Chinese article and caption using the repository CLI, refreshed the same version, and checked language switches, another version, the unchanged image pixels, a PDF citation and its return position. Concurrent refreshes cannot replace a newer target cache or restore an unmounted paper snapshot. Partial imports with different canonical language tags are upgraded to full translation when no valid target article exists; Chinese language variants are not assumed identical.

Abstract and source-text citations in prose, interactive cards and paper answers now open the existing source. The abstract action shows the saved original without changing the reading language, and the return action restores the prior article location. Code, formulas, escaped brackets and external links are not rewritten as citations.

A browser history entry is created for an explicit library/paper opening, reader-tab change or source-page action. Back/Forward restore the overview version/paragraph or PDF page, zoom and within-page position. Ordinary scrolling replaces bounded navigation geometry rather than adding entries; no question, note, selected text, API setting or paper prose is serialized into these entries. A synchronous departure capture handles a rapid Back before the last PDF scroll animation frame has reported. Existing chapter deep links retain their own behavior.

Meaningful selection drafts in both Article and PDF views now fold when other workspace controls are used. Opening the assistant or pressing Escape does not discard an unsent question, pending result or copied subscription task. Empty selection menus can still close normally; explicit discard and a genuinely new selection retain their intended semantics. Actual integrated judge rechecks are still required before the hold can be removed.


## v0.3.0-dev.2 convergence

The assistant now exposes an explicit processing choice. Without an API, Enter and suggested questions prepare a fixed Codex/Claude subscription task and retain the draft; they do not silently perform keyword extraction. Model API and local source search are separate explicit choices. The latter never calls a configured model. A real isolated browser-to-Codex-to-CLI-to-browser exchange was checked against the original Attention pages 4, 6 and 8, including narrow-sidebar controls, source navigation and conversation continuity.

A second real subscription handoff added an interactive companion to an existing fixed reading. Its original article, language, style, focus and figure snapshot were preserved. Refresh did not select the new version; opening it was explicit. The original article and companion have separate provenance in version details and offline exports. Chinese caption/article caches and the existing selected version survived the import.

Independent browser rechecks closed the Article/PDF selection-draft loss and native browser-history findings. The judge also revisited alphaXiv's multilingual figures, source detours and assistant layout. Comparison is based on the actual sampled workflows, not a claim of universal parity or scientific accuracy. The detailed gate and remaining findings are in [judge-v4.md](judge-v4.md).

The final full desktop/mobile run executed 418 cases: 408 passed, two device-conditional cases skipped, and eight outdated assertions failed. Those eight expected background versions to take over a fixed reading or looked for the replaced subscription button. Tests were updated to require preserved fixed versions, explicit switching, late-response safety, write counts and the explicit processing selector; all eight then passed against an isolated real backend. This yields 416 passing cases across the full run and targeted recheck, not a claim that the initial full run was clean. No production code was changed to make those outdated expectations pass.

Remaining nonblocking experience work includes a successful subscription-answer state in the task panel, consistent in-app return shortcuts after several successive answer citations, and recoverable lazy-chunk loading when an old browser tab survives a local rebuild. A reload recovers the observed stale-asset case. Native external PDF popup editing and physical stylus pressure/palm rejection remain unverified. Real multimodal trials demonstrated why image observations must remain visibly unverified and excluded from future model context until deliberately included.


The final Node suite passed **322/322** and the production TypeScript/Vite build passed. Translation binding now rejects changed, missing or duplicated plain page citations as well as changed semantic source links and figure markers. Equivalent Chinese page labels remain valid; code, mathematical text and escaped examples are excluded. Model failures and subscription imports preserve the original version instead of saving a corrupted translation. Runtime data, provider settings, imported PDFs and local validation images remain outside the Git checkpoint.

After the final plain-page binding change, all 36 desktop/mobile reading, fixed-version translation and derived-interactive browser cases passed against a freshly restarted isolated backend. The local primary server was restarted and reported version `0.3.0-dev.2` with healthy status.
