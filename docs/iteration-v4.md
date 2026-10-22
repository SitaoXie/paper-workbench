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

## Checks and remaining work

The latest Node run passed 196 tests. Focused desktop/phone checks passed the 18 reader-detail and horizontal-navigation cases, with an additional two-case regression for replacing a deferred horizontal position after a new source search. The full browser suite passed 240 tests with two device-conditional skips. The build and TypeScript checks passed. A reload assertion was made specific to the restored reader, avoiding a transient match against several library cards.

The judge independently rechecked the source-history and table-column fixes, plus light/dark PDF themes, original-color fallback, formulas and visible highlights. These passes are limited to the described papers and interactions. Unresolved browser findings include duplicated mathematical text in native partial selections (also observed in the reference application), and returning from an abstract-history record without scrolling to the abstract or revealing its matching source language. Both remain open at this checkpoint.

The next material workflow gap is preparing figures in newly imported papers. Image objects alone miss vector figures, panel titles and multi-part plots. The planned local flow proposes candidates, shows their bounds on the original page, allows adjustment and requires explicit acceptance. Only confirmed crops should become input to future readings; existing reading snapshots must remain unchanged. This flow is not yet implemented at this checkpoint.
