# A portable model validation workflow

Use a short, source-bound task before choosing a model for long readings. A connection probe establishes API compatibility, not scientific quality. Models differ in latency, reasoning-token use, translation accuracy and image reading even when they accept the same API request shape. No institution, vendor or model family is required by this workflow.

Keep validation private. Use an ignored local directory for excerpts, prompts, responses, timings and the result matrix. Use neutral profile labels in shareable reports; omit keys, endpoint URLs, account identifiers and request headers. Copy necessary settings in memory for each call rather than switching the live application's active profile while another reader uses it. Do not save benchmark output into a paper's reading or conversation history.

## A small evidence matrix

Choose source material that you can check directly in an imported paper:

| Task | Evidence | Check |
| --- | --- | --- |
| Statistical caveat | A page with sample size, counts, metric and uncertainty | Finite observed failures do not prove zero underlying probability. Do not infer paired counts or sample sizes from a p-value. Compare every claimed quantity with its actual source sentence. |
| Passage navigation | One optional `[label](#page=N "verbatim source excerpt")` | Verify the page and quote using the reader's deterministic matching rules. A fallback is not a verified match; label translation does not permit quote rewriting. |
| English → Chinese caption | A real caption containing a metric, inequality or budget | Check numbers, units, inequality direction, aggregation scope, uncertainty, baseline and technical meaning. Correct numbers alone do not prove a faithful translation. |
| Chinese → English caption | An original Chinese caption or an explicitly identified faithful human translation | Check the same quantities and scope. This is text translation, not independent pixel interpretation. |
| Optional vision | A source PDF crop actually rendered and inspected before submission | Keep category labels separate; compare every visible value to pixels. Distinguish an illustrative mechanism from empirical proof. Unreadable text stays unverified. |

Record source page/crop and hash, actual supplied context, output allowance, timeout, latency, request outcome, format validity and a separate quality judgment. Keep raw answers alongside their reviews in the private directory. A caption changing “averaged over the evaluated tasks” into “on mathematics tasks” is wrong even when the numerical threshold survives.

Useful failure categories include missing context, fabricated counts, altered quotation, incorrect metric, changed population or averaging scope, unsupported certainty, merged chart categories, invalid structure, connection failure, timeout and output-token exhaustion.

## Bound requests and retries

Use at most one small compatibility probe when needed, then concise tasks with known evidence. Set explicit request and output limits. A reasoning model may exhaust a small completion allowance before producing a short visible answer. Record that as a budget failure, not a successful empty response or proof that the model lacks the capability.

Permit at most one justified retry per model for a transient failure or identified budget/configuration problem, and record both outcomes and the changed condition. Do not repeatedly regenerate a wrong answer until one happens to pass. For a read-only benchmark, call the model helper with copied settings or use a temporary instance with isolated data; the production `/chat`, `/report` and `/translate` routes save results and are unsuitable for that claim.

## Inspect source selection separately

A complete selected page and a truncated page prefix are different experiments. For a failure, compare the actual context delivered to the provider with the evidence needed to answer. Pass the selected page through validated `metadata.page`; a number embedded in question text is not a structured selection. The server prioritizes that page within the source-character budget, then retrieves verbatim chunks through local lexical matching. It labels omitted context. This retrieval can still miss evidence, especially across languages or with poor extraction.

Use a controlled follow-up with the complete relevant passage to diagnose a coverage failure, keeping it separate from the production-path result. If a model succeeds with full evidence but invents details when it is omitted, both source selection and uncertainty handling need attention.

Separate request success, valid formatting, correct source location and scientific/translation quality. Preserve failures and exact source → output comparisons. Success on one crop or caption does not certify all charts, languages, long conversations or future provider versions. Broaden testing when intended use or an observed failure warrants it; this small matrix is not a bug-free release guarantee.
